/**
 * Resolve websites for companies that have none, so the company assessment has
 * something real to judge. lib/enrich.ts explains why this leans on domain
 * construction ahead of a search API.
 *
 * companies.website is written only on a verified match. A wrong website is
 * worse than none, because it feeds a confident wrong assessment.
 *
 * Usage: npx tsx scripts/enrich-websites.ts [--limit N] [--dry]
 */
import '../lib/loadenv';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { companies, runs } from '../lib/schema';
import { trackedCompanies } from '../lib/scope';
import { resolveWebsite, tryDomain, SAME_NAME_SYSTEM, buildSameNamePrompt } from '../lib/enrich';
import { callJson } from '../lib/llm';
import { Budget } from '../lib/budget';
import { researchCompany } from '../lib/websearch';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

(async () => {
  const db = getDb();
  const limit = Number(arg('limit', '0'));
  const dry = process.argv.includes('--dry');

  // Every watched company (lib/scope.ts). A website is the gate on people and
  // therefore on warm paths, so restricting this to one discovery route left
  // whole origins without either.
  /*
   * Strongest signal first, because a run is capped and the companies that
   * matter are the ones reaching the digest — a website is what the assessment
   * reads, so an unresolved company with a live trigger is judged on a name.
   * Without an order a capped run picks alphabetically, which is arbitrary.
   */
  const targets = await db.select({
      id: companies.id, name: companies.name, description: companies.description,
      sectors: companies.sectors, scopeReason: companies.scopeReason,
      signal: sql<number>`coalesce((select max(greatest(cs.expansion, cs.partnership))
                                     from company_signals cs where cs.company_id = ${companies.id}), 0)`,
    })
    .from(companies)
    .where(and(
      trackedCompanies(companies),
      isNull(companies.website),
    ))
    .orderBy(sql`coalesce((select max(greatest(cs.expansion, cs.partnership))
                            from company_signals cs where cs.company_id = ${companies.id}), 0) desc`,
             companies.name);
  const list = limit ? targets.slice(0, limit) : targets;
  console.log(`${list.length} companies without a website`);
  if (!list.length) return;

  const [run] = await db.insert(runs).values({ stage: 'enrich_web' }).returning();
  const budget = new Budget();
  const counts = { attempted: 0, resolved: 0, unresolved: 0, via_domain_guess: 0, via_search: 0, search_ambiguous: 0, search_rejected: 0, same_name_rejected: 0 };

  for (const c of list) {
    counts.attempted++;
    // 1. Domain construction first: free, no external request beyond the
    //    candidate fetch itself.
    /*
     * Everything known about what this company does, for the same-name check.
     * Form D supplies an industry group; a news-discovered company has neither
     * that nor a description, but it does have the sectors the classifier gave
     * it and the headline that found it — which is what tells Aslan the
     * defence-AI company from aslan.ai the Thai finance site.
     */
    const knownIndustry = [
      (c.description ?? '').replace('Form D industry group: ', ''),
      (c.sectors ?? []).join(' '),
      c.scopeReason ?? '',
    ].filter(Boolean).join(' ').trim() || null;
    let r = await resolveWebsite(c.name, knownIndustry);
    let searchNote = '';

    // 2. Fall back to web search, which returns mentions as well as the
    //    company's own site - news, investor pages, directories. Those are
    //    graph material in their own right (an investor host absent from
    //    funds.ts).
    if (!r) {
      const research = await researchCompany(c.name);
      if (research.looksAmbiguous) {
        counts.search_ambiguous++;
      } else if (research.website) {
        /*
         * A search hit is a candidate, not an answer. This used to assert
         * `verified: true` on the search's own say-so, which is how AIR was
         * recorded as air-burkina.com — the search path skipped the page check
         * every guessed domain has to pass. Fetching it through tryDomain puts
         * both routes behind the same bar.
         */
        const checked = await tryDomain(research.website.host, c.name);
        if (checked?.verified) {
          counts.via_search++;
          searchNote = research.context.slice(0, 300);
          r = { ...checked, verifyReason: `web search: ${research.website.why}; ${checked.verifyReason}` };
        } else {
          counts.search_rejected++;
          console.log(`  ✗ ${c.name} -> ${research.website.host} rejected: ${checked?.verifyReason ?? 'page did not load'}`);
          if (research.context) searchNote = research.context.slice(0, 400);
        }
      } else if (research.context) {
        // No website found, but real context exists. Record it: the assessment
        // can use a description even without a domain.
        searchNote = research.context.slice(0, 400);
      }
      if (research.investorHosts.length) {
        console.log(`      investors seen: ${research.investorHosts.map((h) => h.host).join(', ')}`);
      }
    } else counts.via_domain_guess++;

    /*
     * A one-word name that got past the stem check still has to be the right
     * company. Keyword corroboration cannot settle these — "Finance ·
     * Intelligence · Daily" on a Thai stock site reads as AI to any pattern
     * loose enough to catch real AI companies — and 151 of the 272 companies
     * needing a website have one-word names, so this is the common case rather
     * than the edge.
     */
    if (r && !c.name.trim().includes(' ')) {
      const known = knownIndustry ?? '';
      const verdict = await callJson<{ same_company: boolean; why: string }>({
        system: SAME_NAME_SYSTEM,
        user: buildSameNamePrompt(c.name, known || '(nothing recorded)', { domain: r.domain, title: r.title, text: r.text }),
        budget,
        schema: {
          type: 'object',
          properties: { same_company: { type: 'boolean' }, why: { type: 'string' } },
          required: ['same_company', 'why'],
          additionalProperties: false,
        },
        reasoningEffort: 'low',
      });
      // A failed call is not a yes. Without an answer the match is unconfirmed,
      // and an unconfirmed site is the thing this whole path exists to avoid.
      if (!verdict.ok || !verdict.data?.same_company) {
        counts.same_name_rejected++;
        console.log(`  ✗ ${c.name} -> ${r.domain} rejected: ${verdict.data?.why ?? verdict.error ?? 'unconfirmed'}`);
        r = null;
      }
    }

    if (r) {
      counts.resolved++;
      console.log(`  ✓ ${c.name} -> ${r.domain}`);
      console.log(`      ${(r.description ?? r.title ?? '').slice(0, 100)}`);
      if (!dry) {
        // Store the site description so the assessment reads real copy rather
        // than a bare name. The prefix keeps its provenance visible.
        const blurb = [r.title, r.description].filter(Boolean).join(' — ').slice(0, 500);
        await db.update(companies).set({
          website: r.domain,
          description: blurb ? `Website: ${blurb}` : undefined,
        }).where(eq(companies.id, c.id));
      }
    } else {
      counts.unresolved++;
      console.log(`  ✗ ${c.name}${searchNote ? ' (context only, no site)' : ''}`);
      if (searchNote && !dry) {
        await db.update(companies)
          .set({ description: `Web search: ${searchNote}` })
          .where(eq(companies.id, c.id));
      }
    }
  }

  if (!dry) await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  console.log('');
  console.table(counts);
})();
