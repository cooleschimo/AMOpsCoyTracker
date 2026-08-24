/**
 * Reclassify already-ingested Form D companies through lib/edgar-industry.ts.
 *
 * Companies routed to 'organization' are moved: an organizations row is created
 * and the company row is marked scope_status='moved_to_org', which keeps the
 * decision auditable and the original row intact.
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { companies, organizations } from '../lib/schema';
import { routeIndustry } from '../lib/edgar-industry';
import { normalizeOrgName } from '../lib/normalize';

(async () => {
  const db = getDb();
  const rows = await db.select().from(companies).where(eq(companies.discoveredVia, 'form_d'));
  const counts = { seen: 0, to_org: 0, out_of_scope: 0, sector_matched: 0, pending: 0 };

  for (const c of rows) {
    counts.seen++;
    const industry = (c.description ?? '').replace('Form D industry group: ', '') || null;
    const r = routeIndustry(industry);

    if (r.disposition === 'organization') {
      const norm = normalizeOrgName(c.name);
      const ex = await db.select({ id: organizations.id }).from(organizations)
        .where(eq(organizations.normalizedName, norm)).limit(1);
      if (!ex.length) {
        await db.insert(organizations).values({
          name: c.name, normalizedName: norm, orgType: 'vc',
          notes: `Form D ${industry}; moved from companies by backfill-scope`,
        });
      }
      await db.update(companies)
        .set({ scopeStatus: 'moved_to_org', scopeReason: r.reason })
        .where(eq(companies.id, c.id));
      counts.to_org++;
      continue;
    }

    await db.update(companies)
      .set({ scopeStatus: r.disposition, scopeReason: r.reason, sectors: r.sectors })
      .where(eq(companies.id, c.id));
    if (r.disposition === 'out_of_scope') counts.out_of_scope++;
    else if (r.sectors.length) counts.sector_matched++;
    else counts.pending++;
  }
  console.table(counts);
})();
