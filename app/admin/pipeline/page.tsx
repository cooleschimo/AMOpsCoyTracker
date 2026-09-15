/**
 * /admin/pipeline — what the pipeline is doing, stage by stage.
 *
 * A process list answers "is it alive" and never "is it getting anywhere": a
 * wedged stage and a working one look identical from outside, which is how a
 * chained run once sat doing nothing for twenty minutes while every check said
 * it was fine.
 *
 * So the rate columns lead. Items scored in the last five minutes and companies
 * assessed in the last half hour are what separate slow from stuck; the backlog
 * says how much is left, and the per-stage rows say which one is holding it.
 *
 * Refreshes itself every fifteen seconds. A status page that needs reloading is
 * one nobody watches.
 */
import { getPipelineStatus, type StageStatus } from '../../../lib/dashboard-data';
import { hasAdmin } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const MAIN = 'mx-auto max-w-[940px] px-5 pb-16 pt-7';
const H1 = 'font-display text-2xl font-semibold tracking-tight';
const SUB = 'mb-5 text-sm text-muted-foreground';
const H2 = 'mb-2.5 mt-6 text-xs font-bold uppercase tracking-[0.08em] text-primary';
const META = 'text-xs text-muted-foreground';

const PHASES = ['gather', 'enrich', 'judge', 'publish'] as const;

/** Colour carries the same meaning as the word, for a glance rather than a read. */
const STATE_STYLE: Record<StageStatus['state'], string> = {
  running: 'bg-primary/15 text-primary',
  ok: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/15 text-destructive',
  stale: 'bg-transparent text-muted-foreground/50',
};

const STATE_WORD: Record<StageStatus['state'], string> = {
  running: 'running', ok: 'done', failed: 'failed', stale: 'not today',
};

/** The two or three numbers from a counts blob that say what a stage achieved. */
function headline(counts: Record<string, unknown> | null): string {
  if (!counts) return '';
  const keys = ['inserted', 'kept', 'scored', 'assessed', 'created', 'classified',
    'located', 'restored', 'written', 'dropped_items', 'survived_filters'];
  const parts = keys
    .filter((k) => typeof counts[k] === 'number' && (counts[k] as number) > 0)
    .slice(0, 3)
    .map((k) => `${(counts[k] as number).toLocaleString()} ${k.replace(/_/g, ' ')}`);
  return parts.join(' · ');
}

export default async function PipelinePage(
  { searchParams }: { searchParams: Promise<{ token?: string }> },
) {
  const sp = await searchParams;
  if (!(await hasAdmin(sp.token))) {
    return <main className={MAIN}><h1 className={H1}>Not authorised</h1>
      <p className={SUB}>Append <code>?token=…</code> with your ADMIN_TOKEN.</p></main>;
  }

  const s = await getPipelineStatus();
  const anyRunning = s.stages.some((x) => x.state === 'running');

  return (
    <main className={MAIN}>
      {/* Server-rendered, so a refresh is the only way to update it. */}
      <meta httpEquiv="refresh" content="15" />

      <h1 className={H1}>Pipeline</h1>
      <p className={SUB}>
        Week of {s.weekOf}. {anyRunning ? 'A stage is running.' : 'Nothing is running.'}{' '}
        This page reloads every 15 seconds.
      </p>

      {/* The rate first: it is the number that distinguishes slow from stuck. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="items scored" value={s.rate.itemsScored5m} note="last 5 min" live={s.rate.itemsScored5m > 0} />
        <Tile label="assessed" value={s.rate.assessed30m} note="last 30 min" live={s.rate.assessed30m > 0} />
        <Tile label="to score" value={s.backlog.score} note="companies waiting" />
        <Tile label="to assess" value={s.backlog.assess} note="companies waiting" />
      </div>

      {s.backlog.filter > 0 && (
        <p className="mt-3 text-xs text-caution">
          {s.backlog.filter.toLocaleString()} items are still unjudged — scoring cannot see them
          until the filter runs.
        </p>
      )}

      {PHASES.map((phase) => {
        const rows = s.stages.filter((x) => x.phase === phase);
        if (!rows.length) return null;
        return (
          <section key={phase}>
            <h2 className={H2}>{phase}</h2>
            <div className="divide-y divide-border/60 border-y border-border/60">
              {rows.map((st) => (
                <div key={st.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                  <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-2xs ${STATE_STYLE[st.state]}`}>
                    {STATE_WORD[st.state]}
                  </span>
                  <span className="min-w-[7rem] text-sm font-medium">{st.name}</span>
                  <span className="text-2xs uppercase tracking-wider text-muted-foreground/60">
                    {st.cost}
                  </span>
                  {st.minutes !== null && (
                    <span className={`num ${META} ${st.minutes > st.timeoutMin ? 'text-destructive' : ''}`}>
                      {st.minutes}m / {st.timeoutMin}m
                    </span>
                  )}
                  <span className={`${META} basis-full sm:basis-auto`}>
                    {st.error ? <span className="text-destructive">{st.error.slice(0, 90)}</span>
                      : headline(st.counts) || st.why}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function Tile(
  { label, value, note, live }: { label: string; value: number; note: string; live?: boolean },
) {
  return (
    <div className="rounded-sm border border-border/60 px-3 py-2">
      <div className={`num text-xl font-semibold leading-none ${live ? 'text-primary' : ''}`}>
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-xs">{label}</div>
      <div className="text-2xs text-muted-foreground">{note}</div>
    </div>
  );
}
