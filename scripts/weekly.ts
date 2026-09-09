/**
 * The weekly run: every stage in dependency order, one command.
 *
 * Order is not arbitrary. Ingest writes items; filter-score reads unprocessed
 * items and needs them present. score-companies reads the week's kept items and
 * the hiring snapshot, so both ingests must finish first. assess-companies is
 * accumulative and reads the signals score-companies just wrote. The digest
 * reads all of it.
 *
 * A stage that fails does not stop the run. A news source that times out should
 * not cost you the scoring, and a half-filled week is worth more than none —
 * the summary at the end says which stages failed so the gap is visible rather
 * than silent.
 *
 * Two cadences, one script.
 *
 * --daily runs everything that finds and scores, grouped into four phases —
 * gather, enrich, judge, publish — and marked with what each one spends. Most
 * draw on the shared LLM allowance and the rest only fetch, which is the
 * distinction that matters when a run fails: every llm stage fails together
 * when the allowance is gone or a key stops authenticating, and no fetch stage
 * is touched by either. Discovery has to be daily because a feed holds a story
 * for a day or two and a weekly pull silently misses whatever fell off — and a
 * company found on Tuesday should be scored by the time the digest is written.
 *
 * The stages marked `weeklyOnly` sit out of the daily run, because what they
 * read does not change overnight: an exhibitor list is republished over months,
 * and the digest goes out once.
 *
 * The default is the full run, digest included, for the day the digest goes out.
 *
 * Usage: npx tsx scripts/weekly.ts [--daily] [--from <stage>] [--only <a,b>]
 *          [--skip <a,b>] [--dry]
 */
import '../lib/loadenv';
import { spawn } from 'node:child_process';

/**
 * What a stage spends.
 *
 * 'llm' stages draw on the shared daily allowance in lib/budget.ts; 'fetch'
 * stages only cost network time. The distinction is the one that matters when a
 * run goes wrong, because every llm stage fails the same way for the same
 * reason — the allowance is gone, or a key stopped authenticating — and no
 * fetch stage is affected by either. A flat list of twelve names cannot say
 * that, so the summary groups on it.
 */
type Cost = 'llm' | 'fetch';

/**
 * The phases a run moves through. Named rather than numbered so a failure reads
 * as "nothing was judged this run" instead of "stage 9 of 12 failed".
 */
type Phase = 'gather' | 'enrich' | 'judge' | 'publish';

const PHASE_WHAT: Record<Phase, string> = {
  gather: 'find companies and the news about them',
  enrich: 'fill in what the judgment will read',
  judge: 'decide what matters and why',
  publish: 'check the finished set and render it',
};

type Stage = {
  name: string;
  script: string;
  args?: string[];
  /** Minutes after which the stage is abandoned and the run moves on. */
  timeoutMin: number;
  phase: Phase;
  cost: Cost;
  /** Skipped by --daily: what it reads does not change overnight. */
  weeklyOnly?: boolean;
  why: string;
};

const STAGES: Stage[] = [
  /*
   * Context and discovery come before the per-company news search, because the
   * search only asks about companies already in the table.
   *
   * Running news first meant a company discovered on Tuesday had no news of its
   * own until Wednesday: it arrived with the single headline that surfaced it,
   * and scoring judged it on that one sentence. Discovering first closes that
   * gap — the same run that finds a company also pulls its news.
   */
  { name: 'context', script: 'ingest-context.ts', timeoutMin: 15, phase: 'gather', cost: 'fetch',
    why: 'the untargeted feeds: policy, sector moves, and the trade press discovery reads' },
  { name: 'discover', script: 'discover-news.ts', timeoutMin: 10, phase: 'gather', cost: 'llm',
    why: 'companies named in untargeted news that we do not track yet' },
  { name: 'news', script: 'ingest-news.ts', timeoutMin: 30, phase: 'gather', cost: 'fetch',
    why: 'Google News per company, including the ones just discovered' },
  /*
   * Enrichment, in dependency order and placed after discovery so a company
   * found this run is filled in on the same run rather than waiting a week.
   *
   * websites before people: ingest-people only considers a company that has a
   * website, so running it first would skip everything discovery just added.
   * location after news, because it reads a company's accumulated headlines
   * rather than the single one that surfaced it.
   */
  /*
   * 45 minutes and a per-run cap. Each company costs a few domain probes and,
   * for a one-word name, a model call to confirm the site is not a different
   * company of the same name — about nine seconds each, so the 272 companies
   * currently without a website would run past any smaller budget. The cap
   * keeps one run bounded as the backlog grows; the rest are picked up next
   * run, strongest signal first.
   */
  { name: 'websites', script: 'enrich-websites.ts', args: ['--limit', '150'], timeoutMin: 45, phase: 'enrich', cost: 'llm',
    why: 'a website is what the assessment reads, and what people scraping needs' },
  { name: 'people', script: 'ingest-people.ts', timeoutMin: 25, phase: 'enrich', cost: 'fetch',
    why: 'the named people §8 builds warm paths from' },
  { name: 'location', script: 'enrich-location.ts', timeoutMin: 15, phase: 'enrich', cost: 'llm',
    why: 'a discovered hq is one headline\'s guess until the rest are read' },
  /*
   * After people, because an exhibitor list names a person who may already be
   * in the graph from a team page, and matching one is better than creating a
   * second row for the same person.
   *
   * Weekly rather than daily. A conference exhibitor list is republished over
   * months, not overnight, and each read costs a model call per chunk of a
   * directory that runs to hundreds of lines.
   */
  { name: 'events', script: 'ingest-events.ts', timeoutMin: 20, phase: 'enrich', cost: 'llm',
    weeklyOnly: true,
    why: 'who from the list will be at which show, and when — the one forward-looking path' },
  // After discovery and websites: a board is found from the company's site, and
  // hiring feeds the momentum axis, so a company discovered this run would
  // otherwise be scored with no hiring evidence at all.
  { name: 'ats', script: 'ingest-ats.ts', timeoutMin: 30, phase: 'enrich', cost: 'fetch',
    why: 'job boards; the hiring snapshot score-companies reads' },
  { name: 'filter', script: 'filter-score.ts', timeoutMin: 45, phase: 'judge', cost: 'llm',
    why: 'canonicalise, drop, cluster, score the items' },
  // After filter: it reads what the filter kept, and only the residue the
  // ambiguity rules could not settle.
  { name: 'ambiguous', script: 'adjudicate-ambiguous.ts', timeoutMin: 20, phase: 'judge', cost: 'llm',
    why: 'headlines about the word, not the company, that no rule can separate' },
  { name: 'rescue', script: 'rescue-mismatch.ts', timeoutMin: 20, phase: 'judge', cost: 'llm',
    why: 'items the name filter dropped that are about the company after all' },
  { name: 'score', script: 'score-companies.ts', timeoutMin: 45, phase: 'judge', cost: 'llm',
    why: 'the three axes per company for this week' },
  { name: 'assess', script: 'assess-companies.ts', timeoutMin: 45, phase: 'judge', cost: 'llm',
    why: 'accumulative judgment: prior assessment plus what arrived since' },
  { name: 'review', script: 'review-dashboard.ts', timeoutMin: 10, phase: 'publish', cost: 'llm',
    why: 'the set is only checkable once placement has decided what is in it' },
  { name: 'digest', script: 'render-digest.ts', args: ['--save'], timeoutMin: 10, phase: 'publish', cost: 'llm',
    weeklyOnly: true,
    why: 'placement matrix and the rendered digest' },
];

const argOf = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

function run(stage: Stage, dry: boolean): Promise<{ ok: boolean; ms: number; note: string }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = ['tsx', `scripts/${stage.script}`, ...(stage.args ?? []), ...(dry ? ['--dry'] : [])];
    const child = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let tail = '';
    const keep = (buf: Buffer) => {
      process.stdout.write(buf);
      tail = (tail + buf.toString()).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);

    const killer = setTimeout(() => {
      child.kill('SIGTERM');
      // A stage that ignores SIGTERM would hold the whole run open.
      setTimeout(() => child.kill('SIGKILL'), 10_000);
    }, stage.timeoutMin * 60_000);

    child.on('close', (code, signal) => {
      clearTimeout(killer);
      const ms = Date.now() - started;
      const counts = tail.match(/counts?:\s*(\{[\s\S]*?\})/)?.[1]?.replace(/\s+/g, ' ').slice(0, 240);
      resolve({
        ok: code === 0,
        ms,
        note: signal ? `timed out after ${stage.timeoutMin}m` : counts ?? (code === 0 ? '' : `exit ${code}`),
      });
    });
  });
}

(async () => {
  const dry = flag('dry');
  const only = argOf('only')?.split(',').map((s) => s.trim());
  const skip = argOf('skip')?.split(',').map((s) => s.trim()) ?? [];
  const from = argOf('from');
  const daily = flag('daily');

  let stages = STAGES;
  if (from) {
    const i = stages.findIndex((s) => s.name === from);
    if (i < 0) { console.error(`no stage named "${from}" — one of ${STAGES.map((s) => s.name).join(', ')}`); process.exit(1); }
    stages = stages.slice(i);
  }
  if (only) stages = stages.filter((s) => only.includes(s.name));
  if (daily) stages = stages.filter((s) => !s.weeklyOnly);
  stages = stages.filter((s) => !skip.includes(s.name));

  const nLlm = stages.filter((s) => s.cost === 'llm').length;
  console.log(`${daily ? 'daily' : 'weekly'} run — ${stages.length} stages `
    + `(${nLlm} spend LLM budget, ${stages.length - nLlm} only fetch)${dry ? ' (DRY)' : ''}\n`);

  /*
   * GitHub Actions folds ::group:: into a collapsible section, so a phase reads
   * as one chunk in the log rather than twelve undifferentiated stages. Locally
   * the markers are just lines, which is why the phase header is printed either
   * way.
   */
  const inCi = Boolean(process.env.GITHUB_ACTIONS);
  let openPhase: Phase | null = null;
  const enterPhase = (ph: Phase) => {
    if (openPhase === ph) return;
    if (openPhase && inCi) console.log('::endgroup::');
    openPhase = ph;
    const title = `${ph.toUpperCase()} — ${PHASE_WHAT[ph]}`;
    console.log(inCi ? `::group::${title}` : `\n${'#'.repeat(70)}\n${title}\n${'#'.repeat(70)}`);
  };
  const results: Array<{ stage: string; ok: boolean; ms: number; note: string }> = [];

  for (const stage of stages) {
    enterPhase(stage.phase);
    console.log(`\n${'='.repeat(70)}\n${stage.name} [${stage.cost}] — ${stage.why}\n${'='.repeat(70)}`);
    const r = await run(stage, dry);
    results.push({ stage: stage.name, ...r });
    console.log(`\n[${r.ok ? 'ok' : 'FAILED'}] ${stage.name} in ${(r.ms / 60_000).toFixed(1)}m ${r.note}`);
  }

  if (openPhase && inCi) console.log('::endgroup::');
  console.log(`\n\n${'='.repeat(70)}\nSUMMARY\n${'='.repeat(70)}`);
  /*
   * Grouped by phase, and marked with what each stage spends.
   *
   * A flat list of twelve names cannot answer the question actually asked of a
   * failed run — was this the model or the network — and the answer decides
   * what to do about it. Every llm stage fails together when the allowance is
   * gone or a key stops authenticating, and no fetch stage is touched by
   * either: Monday's run had eight llm stages fail on 428 rejected calls while
   * every fetch stage reported fine.
   */
  const byPhase = new Map<Phase, typeof results>();
  for (const r of results) {
    const st = STAGES.find((s) => s.name === r.stage);
    const ph = st?.phase ?? 'judge';
    byPhase.set(ph, [...(byPhase.get(ph) ?? []), r]);
  }
  for (const ph of ['gather', 'enrich', 'judge', 'publish'] as Phase[]) {
    const rows = byPhase.get(ph);
    if (!rows?.length) continue;
    console.log(`\n  ${ph.toUpperCase()} — ${PHASE_WHAT[ph]}`);
    for (const r of rows) {
      const cost = STAGES.find((s) => s.name === r.stage)?.cost === 'llm' ? 'llm  ' : 'fetch';
      console.log(`    ${r.ok ? 'ok  ' : 'FAIL'} ${cost} ${r.stage.padEnd(9)} ${(r.ms / 60_000).toFixed(1).padStart(5)}m  ${r.note}`);
    }
  }

  /*
   * When every failure is an llm stage, the cause is upstream of any of them —
   * the allowance, or a key — and naming stages one by one buries that.
   */
  const llmNames = new Set(STAGES.filter((s) => s.cost === 'llm').map((s) => s.name));
  const failedStages = results.filter((r) => !r.ok);
  if (failedStages.length && failedStages.every((f) => llmNames.has(f.stage))) {
    console.log(`\n  Every failed stage was an LLM stage. Check the allowance and the keys `
      + `before re-running: one spent or rejected key fails all of them the same way.`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`\n${failed.length} stage${failed.length === 1 ? '' : 's'} failed: ${failed.map((f) => f.stage).join(', ')}`);
    console.log(`Rerun from the first failure: npx tsx scripts/weekly.ts --from ${failed[0].stage}`);
  }

  /*
   * A stage that ran and produced nothing is not a success.
   *
   * Every stage exits 0 when the LLM allowance is spent, because being out of
   * quota is not a crash — so a run where scoring and assessment both did
   * nothing reported green. That is the worst outcome to report: worse than
   * failing, because nobody looks at a green run.
   *
   * The counts already say it. A scoring stage that scored nothing, or an
   * assessment where every batch failed, is called out here and the run exits
   * non-zero so the schedule shows red.
   */
  const barren = results.filter((r) => {
    if (!r.ok) return false;
    const m = r.note.match(/"(scored|assessed|classified)":\s*0\b/);
    const allBatchesFailed = /"batches":\s*([1-9]\d*)/.test(r.note)
      && /"(batches_failed|failed_batches)":\s*([1-9]\d*)/.test(r.note)
      && r.note.match(/"batches":\s*(\d+)/)?.[1]
        === r.note.match(/"(?:batches_failed|failed_batches)":\s*(\d+)/)?.[1];
    return Boolean(m) || allBatchesFailed;
  });
  if (barren.length) {
    console.log(`\n${barren.length} stage${barren.length === 1 ? '' : 's'} ran but produced nothing: `
      + `${barren.map((b) => b.stage).join(', ')}`);
    console.log('Usually the daily LLM allowance: every provider spent before the run started.');
  }

  process.exit(failed.length || barren.length ? 1 : 0);
})();
