/**
 * /admin/merge — entity resolution review. Brief §6.
 *
 * Automated resolution reaches ~80%; this is the last 20%. Nothing here merges
 * automatically: every pair is a question, and "different" is a first-class
 * answer that gets recorded so the pair is never asked about again.
 */
import { getDb } from '../../../lib/db';
import { companies, people, organizations, roles, entityMerges } from '../../../lib/schema';
import { companyCandidates, personCandidates, orgCandidates, type Candidate } from '../../../lib/resolve';
import { hasAdmin } from '../../../lib/auth';
import { eq } from 'drizzle-orm';
import { MergeControls } from './controls';

export const dynamic = 'force-dynamic';

export default async function MergePage({ searchParams }: { searchParams: Promise<{ token?: string; type?: string }> }) {
  const sp = await searchParams;
  if (!(await hasAdmin(sp.token))) {
    return <main style={S.main}><h1 style={S.h1}>Not authorised</h1>
      <p style={S.p}>Append <code>?token=…</code> with your ADMIN_TOKEN.</p></main>;
  }

  const db = getDb();
  const type = sp.type ?? 'person';
  const decided = await db.select().from(entityMerges);
  const isDecided = (t: string, a: number, b: number) =>
    decided.some((d) => d.entityType === t && ((d.keptId === a && d.mergedId === b) || (d.keptId === b && d.mergedId === a)));

  let cands: Candidate[] = [];
  if (type === 'company') {
    const rows = await db.select({
      id: companies.id, name: companies.name, normalizedName: companies.normalizedName,
      website: companies.website, cik: companies.cik, aliases: companies.aliases,
    }).from(companies);
    cands = companyCandidates(rows).filter((c) => !isDecided('company', c.leftId, c.rightId));
  } else if (type === 'organization') {
    const rows = await db.select({ id: organizations.id, name: organizations.name, normalizedName: organizations.normalizedName }).from(organizations);
    cands = orgCandidates(rows).filter((c) => !isDecided('organization', c.leftId, c.rightId));
  } else {
    const rs = await db.select({ personId: roles.personId, companyId: roles.companyId, companyName: companies.name })
      .from(roles).leftJoin(companies, eq(companies.id, roles.companyId));
    const byPerson = new Map<number, { ids: number[]; names: string[] }>();
    for (const r of rs) {
      if (r.personId == null) continue;
      if (!byPerson.has(r.personId)) byPerson.set(r.personId, { ids: [], names: [] });
      const e = byPerson.get(r.personId)!;
      if (r.companyId != null && !e.ids.includes(r.companyId)) { e.ids.push(r.companyId); if (r.companyName) e.names.push(r.companyName); }
    }
    const prows = await db.select({ id: people.id, name: people.name, normalizedName: people.normalizedName }).from(people);
    cands = personCandidates(prows.map((p) => ({ ...p, companyIds: byPerson.get(p.id)?.ids ?? [], companyNames: byPerson.get(p.id)?.names ?? [] })))
      .filter((c) => !isDecided('person', c.leftId, c.rightId));
  }

  return (
    <main style={S.main}>
      <h1 style={S.h1}>Entity resolution review</h1>
      <p style={S.note}>
        Prefer <strong>false splits over false merges</strong>. A duplicate is untidy; a wrong
        merge invents a connection that does not exist, and an RD acting on it looks foolish in
        front of a founder. When unsure, choose <em>Different</em> or <em>Not sure</em>.
      </p>
      <nav style={S.nav}>
        {['person', 'company', 'organization'].map((t) => (
          <a key={t} href={`?type=${t}${sp.token ? `&token=${sp.token}` : ''}`}
             style={{ ...S.tab, ...(t === type ? S.tabOn : {}) }}>{t}s</a>
        ))}
      </nav>
      <p style={S.count}>{cands.length} undecided {type} pair{cands.length === 1 ? '' : 's'} · {decided.length} already decided</p>
      {cands.length === 0 && <p style={S.p}>Nothing awaiting review.</p>}
      {cands.slice(0, 60).map((c) => (
        <div key={`${c.leftId}-${c.rightId}`} style={S.card}>
          <div style={S.scoreRow}>
            <span style={{ ...S.score, background: c.score >= 0.8 ? '#0a7' : c.score >= 0.6 ? '#c80' : '#888' }}>
              {c.score.toFixed(2)}
            </span>
            <span style={S.signals}>{c.signals.join(' · ')}</span>
          </div>
          <div style={S.pair}>
            <div style={S.side}><div style={S.id}>#{c.leftId}</div><div style={S.name}>{c.leftName}</div></div>
            <div style={S.vs}>vs</div>
            <div style={S.side}><div style={S.id}>#{c.rightId}</div><div style={S.name}>{c.rightName}</div></div>
          </div>
          {c.sharedContext && <p style={S.shared}>Shared: {c.sharedContext}</p>}
          {c.caution && <p style={S.caution}>⚠ {c.caution}</p>}
          <MergeControls entityType={type as 'person' | 'company' | 'organization'}
            leftId={c.leftId} rightId={c.rightId} signals={c.signals} score={c.score} />
        </div>
      ))}
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: { maxWidth: 860, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, sans-serif', color: '#111' },
  h1: { fontSize: 22, marginBottom: 8 },
  note: { fontSize: 13, lineHeight: 1.55, background: '#fffbe6', border: '1px solid #f0e0a0', padding: '10px 12px', borderRadius: 6 },
  nav: { display: 'flex', gap: 8, margin: '18px 0 10px' },
  tab: { padding: '6px 12px', border: '1px solid #ddd', borderRadius: 6, textDecoration: 'none', color: '#333', fontSize: 13 },
  tabOn: { background: '#111', color: '#fff', borderColor: '#111' },
  count: { fontSize: 12, color: '#666', marginBottom: 14 },
  card: { border: '1px solid #e3e3e3', borderRadius: 8, padding: 14, marginBottom: 12 },
  scoreRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  score: { color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600 },
  signals: { fontSize: 12, color: '#666' },
  pair: { display: 'flex', alignItems: 'center', gap: 12 },
  side: { flex: 1, minWidth: 0 },
  id: { fontSize: 11, color: '#999' },
  name: { fontSize: 15, fontWeight: 500, wordBreak: 'break-word' },
  vs: { fontSize: 12, color: '#aaa' },
  shared: { fontSize: 12, color: '#0a7', marginTop: 8 },
  caution: { fontSize: 12, color: '#a40', marginTop: 8, lineHeight: 1.5 },
  p: { fontSize: 14, color: '#444' },
};
