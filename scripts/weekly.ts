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
 * --daily runs everything that finds and scores: ingest, discover, filter,
 * rescue, score, assess. Discovery has to be daily because a feed holds a story
 * for a day or two and a weekly pull silently misses whatever fell off — and a
 * company found on Tuesday should be scored by the time the digest is written.
 *
 * The default is the full run, digest included, for the day the digest goes out.
 *
 * Usage: npx tsx scripts/weekly.ts [--daily] [--from <stage>] [--only <a,b>]
 *          [--skip <a,b>] [--dry]
 */
import '../lib/loadenv';
import { spawn } from 'node:child_process';

type Stage = {
  name: string;
  script: string;
  args?: string[];
  /** Minutes after which the stage is abandoned and the run moves on. */
  timeoutMin: number;
  why: string;
};

const STAGES: Stage[] = [
  { name: 'news', script: 'ingest-news.ts', timeoutMin: 25,
    why: 'Google News per company plus the press wires' },
  { name: 'context', script: 'ingest-context.ts', timeoutMin: 15,
    why: 'policy and sector moves that shift a company without it acting' },
  { name: 'discover', script: 'discover-news.ts', timeoutMin: 10,
    why: 'companies named in untargeted news that we do not track yet' },
  /*
   * Enrichment, in dependency order and placed after discovery so a company
   * found this run is filled in on the same run rather than waiting a week.
   *
   * websites before people: ingest-people only considers a company that has a
   * website, so running it first would skip everything discovery just added.
   * location after news, because it reads a company's accumulated headlines
   * rather than the single one that surfaced it.
   */
  { name: 'websites', script: 'enrich-websites.ts', timeoutMin: 20,
    why: 'a website is what the assessment reads, and what people scraping needs' },
  { name: 'people', script: 'ingest-people.ts', timeoutMin: 25,
    why: 'the named people §8 builds warm paths from' },
  { name: 'location', script: 'enrich-location.ts', timeoutMin: 15,
    why: 'a discovered hq is one headline\'s guess until the rest are read' },
  // After discovery and websites: a board is found from the company's site, and
  // hiring feeds the momentum axis, so a company discovered this run would
  // otherwise be scored with no hiring evidence at all.
  { name: 'ats', script: 'ingest-ats.ts', timeoutMin: 30,
    why: 'job boards; the hiring snapshot score-companies reads' },
  { name: 'filter', script: 'filter-score.ts', timeoutMin: 45,
    why: 'canonicalise, drop, cluster, score the items' },
  { name: 'rescue', script: 'rescue-mismatch.ts', timeoutMin: 20,
    why: 'items the name filter dropped that are about the company after all' },
  { name: 'score', script: 'score-companies.ts', timeoutMin: 45,
    why: 'the three axes per company for this week' },
  { name: 'assess', script: 'assess-companies.ts', timeoutMin: 45,
    why: 'accumulative judgment: prior assessment plus what arrived since' },
  { name: 'digest', script: 'render-digest.ts', args: ['--save'], timeoutMin: 10,
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
  // The digest is the only weekly-only stage; everything before it is daily.
  const daily = flag('daily');

  let stages = STAGES;
  if (from) {
    const i = stages.findIndex((s) => s.name === from);
    if (i < 0) { console.error(`no stage named "${from}" — one of ${STAGES.map((s) => s.name).join(', ')}`); process.exit(1); }
    stages = stages.slice(i);
  }
  if (only) stages = stages.filter((s) => only.includes(s.name));
  if (daily) stages = stages.filter((s) => s.name !== 'digest');
  stages = stages.filter((s) => !skip.includes(s.name));

  console.log(`${daily ? 'daily' : 'weekly'} run — ${stages.length} stages${dry ? ' (DRY)' : ''}\n`);
  const results: Array<{ stage: string; ok: boolean; ms: number; note: string }> = [];

  for (const stage of stages) {
    console.log(`\n${'='.repeat(70)}\n${stage.name} — ${stage.why}\n${'='.repeat(70)}`);
    const r = await run(stage, dry);
    results.push({ stage: stage.name, ...r });
    console.log(`\n[${r.ok ? 'ok' : 'FAILED'}] ${stage.name} in ${(r.ms / 60_000).toFixed(1)}m ${r.note}`);
  }

  console.log(`\n\n${'='.repeat(70)}\nSUMMARY\n${'='.repeat(70)}`);
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.stage.padEnd(9)} ${(r.ms / 60_000).toFixed(1).padStart(5)}m  ${r.note}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`\n${failed.length} stage${failed.length === 1 ? '' : 's'} failed: ${failed.map((f) => f.stage).join(', ')}`);
    console.log(`Rerun from the first failure: npx tsx scripts/weekly.ts --from ${failed[0].stage}`);
  }
  process.exit(failed.length ? 1 : 0);
})();
