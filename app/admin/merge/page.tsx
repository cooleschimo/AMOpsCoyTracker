/**
 * /admin/merge — entity resolution review. Brief §6.
 *
 * Automated resolution reaches ~80%; this is the last 20%. Every pair is put as
 * a question for a human, and "different" is a first-class answer, recorded so
 * the pair stops being surfaced.
 */
import { getDb } from '../../../lib/db';
import { companies, people, organizations, roles, entityMerges } from '../../../lib/schema';
import { companyCandidates, personCandidates, orgCandidates, type Candidate } from '../../../lib/resolve';
import { hasAdmin } from '../../../lib/auth';
import { eq } from 'drizzle-orm';
import { MergeControls } from './controls';
import { SectionHeading } from '@/components/primitives';

export const dynamic = 'force-dynamic';

/* Shared class strings. A reading column, matching the sibling admin pages. */
const MAIN = 'mx-auto max-w-[860px] px-5 pb-16 pt-7';
const H1 = 'mb-2 font-display text-2xl font-semibold tracking-tight';
const BODY = 'text-sm text-foreground/85';
const META = 'text-xs text-muted-foreground';
const CARD = 'mb-3 rounded-md border border-border bg-card p-3.5';
const TAB = 'rounded-md border border-border px-3 py-1.5 text-xs text-foreground/85 no-underline hover:bg-muted';
const TAB_ON = 'border-foreground bg-foreground text-background hover:bg-foreground';
/* Caution notice — where a claim is weaker than it looks. */
const NOTE = 'rounded-md border border-caution/40 bg-caution-soft/40 px-3 py-2.5 text-xs leading-relaxed text-caution';

/**
 * Score badge ground. The literal hexes carried meaning rather than brand — a
 * confident match, a borderline one, and a weak one — so each maps to the
 * token that already says that on every other page.
 */
const scoreTone = (score: number) =>
  score >= 0.8 ? 'bg-confirmed' : score >= 0.6 ? 'bg-caution' : 'bg-muted-foreground';

export default async function MergePage({ searchParams }: { searchParams: Promise<{ token?: string; type?: string }> }) {
  const sp = await searchParams;
  if (!(await hasAdmin(sp.token))) {
    return <main className={MAIN}><h1 className={H1}>Not authorised</h1>
      <p className={BODY}>Append <code>?token=…</code> with your ADMIN_TOKEN.</p></main>;
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
    <main className={MAIN}>
      <SectionHeading title="Entity resolution review" />
      <p className={`${NOTE} mt-5`}>
        Prefer <strong>false splits over false merges</strong>. A duplicate is untidy; a wrong
        merge invents a connection that does not exist, and an RD acting on it looks foolish in
        front of a founder. When unsure, choose <em>Different</em> or <em>Not sure</em>.
      </p>
      <nav className="mb-2.5 mt-[18px] flex gap-2">
        {['person', 'company', 'organization'].map((t) => (
          <a key={t} href={`?type=${t}${sp.token ? `&token=${sp.token}` : ''}`}
             className={`${TAB}${t === type ? ` ${TAB_ON}` : ''}`}>{t}s</a>
        ))}
      </nav>
      <p className={`${META} num mb-3.5`}>{cands.length} undecided {type} pair{cands.length === 1 ? '' : 's'} · {decided.length} already decided</p>
      {cands.length === 0 && <p className={BODY}>Nothing awaiting review.</p>}
      {cands.slice(0, 60).map((c) => (
        <div key={`${c.leftId}-${c.rightId}`} className={CARD}>
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className={`${scoreTone(c.score)} num rounded-sm px-2 py-0.5 text-xs font-semibold text-background`}>
              {c.score.toFixed(2)}
            </span>
            <span className={META}>{c.signals.join(' · ')}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1"><div className="text-2xs text-muted-foreground">#{c.leftId}</div><div className="break-words text-sm font-medium">{c.leftName}</div></div>
            <div className={META}>vs</div>
            <div className="min-w-0 flex-1"><div className="text-2xs text-muted-foreground">#{c.rightId}</div><div className="break-words text-sm font-medium">{c.rightName}</div></div>
          </div>
          {c.sharedContext && <p className="mt-2 text-xs text-confirmed">Shared: {c.sharedContext}</p>}
          {c.caution && <p className="mt-2 text-xs leading-relaxed text-caution">⚠ {c.caution}</p>}
          <MergeControls entityType={type as 'person' | 'company' | 'organization'}
            leftId={c.leftId} rightId={c.rightId} signals={c.signals} score={c.score} />
        </div>
      ))}
    </main>
  );
}
