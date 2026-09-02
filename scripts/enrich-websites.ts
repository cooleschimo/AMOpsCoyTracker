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
import { resolveWebsite } from '../lib/enrich';
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
  const targets = await db.select({ id: companies.id, name: companies.name, description: companies.description })
    .from(companies)
    .where(and(
      trackedCompanies(companies),
      isNull(companies.website),
    ));
  const list = limit ? targets.slice(0, limit) : targets;
  console.log(`${list.length} companies without a website`);
  if (!list.length) return;

  const [run] = await db.insert(runs).values({ stage: 'enrich_web' }).returning();
  const counts = { attempted: 0, resolved: 0, unresolved: 0, via_domain_guess: 0, via_search: 0, search_ambiguous: 0 };

  for (const c of list) {
    counts.attempted++;
    // 1. Domain construction first: free, no external request beyond the
    //    candidate fetch itself.
    const knownIndustry = (c.description ?? '').replace('Form D industry group: ', '') || null;
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
        counts.via_search++;
        searchNote = research.context.slice(0, 300);
        r = { domain: research.website.host, title: null, description: research.context.slice(0, 300) || null,
              text: research.context, verified: true, thin: false,
              verifyReason: `web search: ${research.website.why}` };
      } else if (research.context) {
        // No website found, but real context exists. Record it: the assessment
        // can use a description even without a domain.
        searchNote = research.context.slice(0, 400);
      }
      if (research.investorHosts.length) {
        console.log(`      investors seen: ${research.investorHosts.map((h) => h.host).join(', ')}`);
      }
    } else counts.via_domain_guess++;

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
