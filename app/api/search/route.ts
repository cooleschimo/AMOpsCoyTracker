/**
 * Search across everything that has a page: companies, investors, people.
 *
 * One endpoint rather than three, because the reader does not know which kind
 * of thing they are looking for — they know a name. Results carry their kind so
 * the caller can label and route them.
 *
 * Ranked by how the match sits in the name, not by relevance scoring. A prefix
 * match is what someone typing a name means, and a name that merely contains
 * the string is a weaker answer to the same question: typing "anth" wants
 * Anthropic before Samantha Cho.
 *
 * Companies come before people and investors within a rank, because this is a
 * company tool and a name typed into it is far more often a company's. Then
 * shorter names first: a longer name containing the query carries more that the
 * reader did not type.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSql } from '../../../lib/db';
import { optional } from '../../../lib/env';

export const dynamic = 'force-dynamic';

export type SearchHit = {
  kind: 'company' | 'org' | 'person';
  id: number;
  name: string;
  /** Sectors for a company, title for a person, nothing for an investor. */
  detail: string | null;
};

const HREF: Record<SearchHit['kind'], (id: number) => string> = {
  company: (id) => `/company/${id}`,
  org: (id) => `/org/${id}`,
  person: (id) => `/person/${id}`,
};

export function hrefFor(hit: SearchHit): string {
  return HREF[hit.kind](hit.id);
}

export async function GET(req: NextRequest) {
  /*
   * The same gate as every page. Search reads the whole graph, so an endpoint
   * that answered without a token would be a way around the dashboard's own
   * lock — the tokens are shared secrets in a cookie, and this reads the one
   * the page already set.
   */
  const jar = await cookies();
  const tok = jar.get('dashboard_token')?.value ?? jar.get('admin_token')?.value;
  const expected = optional('DASHBOARD_TOKEN');
  const admin = optional('ADMIN_TOKEN');
  if (!tok || (tok !== expected && tok !== admin)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  // Two characters is where the result set stops being everything.
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 8), 25);
  const like = `%${q}%`;
  const prefix = `${q}%`;

  const sql = getSql();
  const rows: any = await sql`
    select * from (
      select 'company' as kind, c.id, c.name,
             array_to_string(c.sectors, ' · ') as detail,
             case when c.name ilike ${prefix} then 0 else 1 end as rank
        from companies c
       where c.name ilike ${like}
         and coalesce(c.scope_status, 'unknown') <> 'out_of_scope'
         -- Scraping leaves link text and urls in the name column. They are
         -- real rows and stay in the graph, but offering one as a destination
         -- sends the reader to a page about nothing.
         and c.name !~ '(opens in new tab|https?://|\\.com/)'
         and length(c.name) <= 60
      union all
      select 'org', o.id, o.name, null, case when o.name ilike ${prefix} then 0 else 1 end
        from organizations o where o.name ilike ${like}
      union all
      select 'person', p.id, p.name, p.title, case when p.name ilike ${prefix} then 0 else 1 end
        from people p where p.name ilike ${like}
    ) hits
    order by rank, kind <> 'company', length(name), name
    limit ${limit}`;

  const hits: SearchHit[] = (rows as any[]).map((r) => ({
    kind: r.kind,
    id: Number(r.id),
    name: String(r.name ?? ''),
    detail: r.detail ? String(r.detail) : null,
  }));

  return NextResponse.json({ hits });
}
