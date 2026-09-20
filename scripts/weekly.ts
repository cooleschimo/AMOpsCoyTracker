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
import { appendFileSync } from 'node:fs';

import { STAGES, PHASE_WHAT, type Stage, type Cost, type Phase } from '../lib/stages';
import { llmProviders } from '../lib/env';
import { spentToday } from '../lib/budget-store';


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

  /*
   * Stop before the runner does.
   *
   * A hosted job is killed at six hours, and that kill lands as `cancelled`,
   * not `failure` — every step shows `skipped`, so an `if: failure()` cleanup
   * never runs and nothing records where the work got to. Two runs died that
   * way at 350 and 351 minutes with no trace beyond the stage list.
   *
   * So the run ends itself while it still can. Stopping between stages rather
   * than mid-stage keeps the guarantee every stage already offers: each one
   * takes only what it has not done, so the next run picks up exactly here.
   *
   * --deadline is minutes from start; 0 disables it, which is the right default
   * for a laptop where nothing is going to cancel the process.
   */
  const deadlineMin = Number(argOf('deadline', inCi ? '290' : '0'));
  const startedAt = Date.now();
  let stoppedEarly: string | null = null;

  /*
   * Is there any LLM allowance left at all?
   *
   * Asked once, before the stages run, because the answer is the same for all
   * of them: every key in the chain is shared, so when the last one is spent no
   * LLM stage can do anything. Yesterday three of them found that out the
   * expensive way — discover exited at 5.7m, sectors and rescue each spun until
   * their timeout killed them, 68 minutes to produce nothing, and the run then
   * failed as though something had gone wrong with the work.
   *
   * lib/llm.ts declines to gate per provider, and it is right to: a chain of
   * twenty-two keys is exactly the thing that should try the next one. This is
   * the level above, where "nothing to try" is knowable before a stage starts.
   *
   * Never throws. spentToday() already swallows its own errors, and a run that
   * cannot read the table should attempt the work rather than refuse it.
   */
  const labels = llmProviders().map((p) => (p.label ?? p.name).toLowerCase());
  const spent = new Set((await spentToday()).map(([label]) => label.toLowerCase()));
  const live = labels.filter((l) => !spent.has(l));
  const noAllowance = labels.length > 0 && live.length === 0;
  if (noAllowance) {
    console.log(`\nEvery LLM key is spent for today (${labels.length} in the chain).`);
    console.log('LLM stages will be skipped rather than spend their timeouts failing.');
    console.log('The allowance resets at the UTC day boundary.');
  }

  for (const stage of stages) {
    /*
     * Skipped, and recorded as skipped. Not ok:true — the work did not happen
     * and the summary must not imply it did — but not a failure either, or the
     * job goes red for a quota that will reset on its own and the resume step
     * dispatches a run that would find the same empty chain.
     */
    if (noAllowance && stage.cost === 'llm') {
      console.log(`\n${'='.repeat(70)}\n${stage.name} [llm] — SKIPPED, no allowance\n${'='.repeat(70)}`);
      results.push({ stage: stage.name, ok: true, ms: 0, note: 'skipped: no LLM allowance today' });
      continue;
    }
    const elapsedMin = (Date.now() - startedAt) / 60_000;
    if (deadlineMin > 0 && elapsedMin >= deadlineMin) {
      stoppedEarly = stage.name;
      console.log(`\n${'='.repeat(70)}`);
      console.log(`DEADLINE — ${elapsedMin.toFixed(0)}m elapsed, stopping before ${stage.name}`);
      console.log(`Resume with: npx tsx scripts/weekly.ts --from ${stage.name}`);
      console.log(`${'='.repeat(70)}`);
      break;
    }
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

  /*
   * What kind of night this was, for the step that reads it.
   *
   * The exit code cannot carry this: it has two values and three meanings —
   * stopped at the deadline, genuinely failed, and did what it could afford.
   * The first two both exit 1 and want opposite responses, so the category goes
   * out beside the code rather than encoded in it.
   */
  const say = (verdict: string, code: string) => {
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${verdict}\ncode=${code}\n`);
    }
    console.log(`\n  verdict: ${verdict} (${code})`);
  };

  if (stoppedEarly) {
    console.log(`\nStopped at the deadline. Next stage: ${stoppedEarly}`);
    say('deadline', 'deadline-stop');
    // Non-zero on purpose: a job that ends 0 concludes `success` and the
    // re-dispatch step never fires.
    process.exit(1);
  }
  if (failed.length || barren.length) {
    say('broken', failed.length ? 'stage-failed' : 'stage-barren');
    process.exit(1);
  }
  say(noAllowance ? 'partial' : 'healthy', noAllowance ? 'allowance-exhausted' : 'healthy');
  process.exit(0);
})();
