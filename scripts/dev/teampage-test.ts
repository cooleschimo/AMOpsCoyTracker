import '../../lib/loadenv';
import { getSql } from '../../lib/db';
import { findTeamPageUrl, scrapeTeamPage, TEAM_PATHS } from '../../lib/people-scrape';
import { search } from '../../lib/search-providers';
import { normalizeDomain } from '../../lib/normalize';
(async () => {
  const sql = getSql();
  // Signalling companies that still have nobody.
  const rows: any = await sql`
    select c.id, c.name, c.website from companies c
    join company_signals cs on cs.company_id = c.id
    where c.website is not null
      and not exists (select 1 from roles r where r.company_id = c.id)
      and (cs.expansion >= 2 or cs.partnership >= 2)
    order by c.name limit 5`;
  for (const c of rows) {
    const domain = normalizeDomain(c.website); if (!domain) continue;
    let best = 0, how = '';
    for (const p of TEAM_PATHS.slice(0,5)) {
      const r = await scrapeTeamPage(`https://${domain}${p}`);
      if (r.ok && r.people.length > best) { best = r.people.length; how = `path ${p}`; }
    }
    if (!best) {
      const found = await findTeamPageUrl(domain, c.name, search as any);
      if (found) { const r = await scrapeTeamPage(found); if (r.ok) { best = r.people.length; how = `search → ${found.slice(0,58)}`; } }
    }
    console.log(`${c.name.padEnd(22)} ${String(best).padStart(2)} people  ${how || 'nothing'}`);
  }
})();
