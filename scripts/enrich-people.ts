/**
 * Title and public bio for people the graph already knows.
 *
 * Scoped to people at companies with a live signal, which is a handful rather
 * than the full 570 — enriching everyone would spend search quota on people
 * nobody is about to look up.
 *
 * DESIGN_RATIONALE §14 governs what may be fetched. Profile sites are never
 * fetched directly; a URL returned by a third-party search index is that
 * index's crawl rather than ours, and anything derived from a snippet is
 * written `probable` with the source URL attached so the page can say where it
 * came from.
 *
 * Contact details are recorded where a public source gives them. The source url
 * travels with each one and is checked against the results the search actually
 * returned, because a model asked for an email will otherwise assemble a
 * plausible one from a naming pattern — indistinguishable from a real address
 * once stored. A contact whose source cannot be confirmed is dropped rather
 * than kept with a caveat nobody would act on differently.
 *
 * Usage: npx tsx scripts/enrich-people.ts [--limit N] [--all] [--dry]
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { people, runs } from '../lib/schema';
import { search, searchRequestsUsed } from '../lib/search-providers';
import { callJson } from '../lib/llm';
import { Budget } from '../lib/budget';
import { pool, workersFromArgs } from '../lib/pool';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const SYSTEM = `You extract a person's professional title and a short bio from public search results.

You are given a NAME, the COMPANY the graph associates them with, and search result snippets. Return only what the snippets actually say.

RULES:
- The person must be the one at the named company. Names collide constantly; a different person with the same name is worth nothing, and a wrong bio attached to a real person is worse than none. If the snippets are about someone else, return found: false.
- The title is their role at that company, in their own words where the snippet gives it: "Co-founder and CTO", "Partner", "VP International". Not a description you compose.
- The bio is at most 40 words, drawn from the snippets. Prior roles, background, what they work on. No speculation, no adjectives the snippets do not support.
- Return an email or phone ONLY where a snippet plainly contains one, whatever the domain. Never construct an address from a naming pattern — a guessed address looks exactly like a found one and is worthless. Never a home address. Where no snippet contains a contact, return empty strings and say so; that is a normal result, not a failure.
- If the snippets are thin or ambiguous, return found: false. An absent bio is a fact the page can state; a guessed one is not.

- If one of the results is this person's profile page on a professional network, return its url in profile_url. Return it only when the snippet confirms it is the same person at the named company.

Return ONE JSON object, no prose, no markdown fences:
{"found":true,"title":"<their role, or empty string>","bio":"<= 40 words, or empty string>","source_url":"<the url the information came from>","profile_url":"<their profile url, or empty string>","contact_email":"<work email from a snippet, or empty string>","contact_phone":"<work phone from a snippet, or empty string>","contact_source_url":"<the url the contact came from, or empty string>"}`;

(async () => {
  const db = getDb();
  const sqlc = getSql();
  const limit = Number(arg('limit', '0'));
  const all = flag('all');
  const dry = flag('dry');
  const workers = workersFromArgs();

  /**
   * People at companies with a live signal, unless --all. Someone nobody is
   * about to look up does not need a search spent on them.
   */
  const targets: any = all
    ? await sqlc`
        select distinct p.id, p.name, c.name as company
        from people p join roles r on r.person_id = p.id
        join companies c on c.id = r.company_id
        where p.title is null order by p.name`
    : await sqlc`
        select distinct p.id, p.name, c.name as company
        from people p
        join roles r on r.person_id = p.id
        join companies c on c.id = r.company_id
        join company_signals cs on cs.company_id = c.id
        where p.title is null and (cs.expansion >= 2 or cs.partnership >= 2)
        order by p.name`;

  const list = limit ? targets.slice(0, limit) : targets;
  console.log(`${list.length} people to enrich${all ? ' (all)' : ' (at companies with a live signal)'}`);
  if (!list.length) return;

  const [run] = await db.insert(runs).values({ stage: 'enrich_people' }).returning();
  const budget = new Budget();
  const counts = {
    people: 0, searched: 0, found: 0, not_found: 0, failed: 0,
    with_contact: 0, with_profile: 0,
    // Contacts the model returned that failed verification. A rising count here
    // means the model is inventing addresses, which is worth knowing.
    contact_rejected: 0,
  };

  try {
    const enrichOne = async (p: any) => {
      counts.people++;
      const hits = await search(`"${p.name}" "${p.company}"`, { maxResults: 5 });
      counts.searched++;
      if (!hits.length) {
        counts.not_found++;
        console.log(`  ${p.name}: no results`);
        return;
      }

      const snippets = hits.map((h, i) =>
        `[${i + 1}] ${h.title}\n    ${(h.description ?? '').slice(0, 220)}\n    ${h.url}`,
      ).join('\n');

      const res = await callJson<{
        found: boolean; title: string; bio: string; source_url: string; profile_url?: string;
        contact_email?: string; contact_phone?: string; contact_source_url?: string;
      }>({
        system: SYSTEM,
        user: `NAME: ${p.name}\nCOMPANY: ${p.company}\n\nSEARCH RESULTS:\n\n${snippets}`,
        budget,
        temperature: 0.1,
      });

      if (!res.ok || !res.data) { counts.failed++; console.warn(`  ${p.name}: ${res.error}`); return; }
      if (!res.data.found) {
        counts.not_found++;
        console.log(`  ${p.name}: nothing usable`);
        return;
      }

      // Only a url we actually supplied. A model returning one of its own has
      // invented the source, which is what the provenance is for.
      const supplied = new Set(hits.map((h) => h.url));
      const sourceUrl = supplied.has(res.data.source_url) ? res.data.source_url : hits[0].url;
      const host = (() => { try { return new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch { return null; } })();
      // Only a url the index returned. The page behind it is never fetched.
      const profileRaw = String(res.data.profile_url ?? '').trim();
      const profileUrl = profileRaw && supplied.has(profileRaw) ? profileRaw : null;

      /**
       * A contact is kept only when it survives three checks: the source url is
       * one the search returned, the value looks like an address or a number,
       * and the value appears in the returned text. A model asked for an email
       * will otherwise assemble one from a naming convention, which reads
       * exactly like a finding and is not one.
       */
      const emailRaw = String(res.data.contact_email ?? '').trim().toLowerCase();
      const phoneRaw = String(res.data.contact_phone ?? '').trim();
      const contactSrc = String(res.data.contact_source_url ?? '').trim();
      const contactSourceUrl = contactSrc && supplied.has(contactSrc) ? contactSrc : null;

      // The contact must appear in the text the search returned, not merely be
      // paired with a real url. Citing a genuine page alongside an assembled
      // address would otherwise pass, and an assembled address is the failure
      // this guards against.
      const corpus = hits.map((h) => `${h.title} ${h.description ?? ''}`).join(' ').toLowerCase();
      const digitsOf = (v: string) => v.replace(/\D/g, '');
      const contactEmail = contactSourceUrl
        && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(emailRaw)
        && corpus.includes(emailRaw)
        ? emailRaw : null;
      const contactPhone = contactSourceUrl
        && /^[+\d][\d\s().-]{6,}$/.test(phoneRaw)
        && digitsOf(corpus).includes(digitsOf(phoneRaw))
        ? phoneRaw : null;

      if (!dry) {
        await withRetry(() => db.update(people).set({
          title: res.data!.title?.trim() || null,
          bio: res.data!.bio?.trim() || null,
          bioSource: host,
          bioSourceUrl: sourceUrl,
          // Snippet-derived, so probable rather than confirmed (§14).
          bioStatus: 'probable',
          profileUrl,
          contactEmail, contactPhone, contactSourceUrl,
          contactFoundAt: contactEmail || contactPhone ? new Date() : null,
          bioFetchedAt: new Date(),
        }).where(eq(people.id, p.id)));
      }
      counts.found++;
      if (contactEmail || contactPhone) counts.with_contact++;
      else if (emailRaw || phoneRaw) counts.contact_rejected++;
      if (profileUrl) counts.with_profile++;
      console.log(`  ${p.name}: ${res.data.title || '(no title)'} — ${host}${contactEmail ? ' · email' : ''}${profileUrl ? ' · profile' : ''}`);
    };

    await pool(list, workers, enrichOne, () => budget.halted);

    await db.update(runs).set({
      finishedAt: new Date(),
      counts: { ...counts, search_requests: searchRequestsUsed() },
      tokensIn: budget.tokensIn, tokensOut: budget.tokensOut,
    }).where(eq(runs.id, run.id));

    console.log('\ncounts:', JSON.stringify(counts), `· ${searchRequestsUsed()} search requests`);
    if (dry) console.log('DRY RUN — nothing written');
  } catch (e) {
    await db.update(runs)
      .set({ finishedAt: new Date(), counts, error: (e as Error).message })
      .where(eq(runs.id, run.id));
    throw e;
  }
})();
