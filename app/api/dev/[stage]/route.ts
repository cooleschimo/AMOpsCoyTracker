/**
 * Manual stage re-runs. Brief §12a, item 3.
 *
 * The pipeline runs on GitHub Actions, so this is not how a stage normally
 * executes — it is how one gets re-run at 11pm when the scheduled run failed
 * and the maintainer wants the fix confirmed without waiting a day or editing
 * a workflow file. `workflow_dispatch` covers the same need from the GitHub UI;
 * this covers it from a terminal with curl.
 *
 * The stage list comes from lib/stages.ts, the same table the runner uses, so
 * a stage that exists here exists there.
 *
 * Admin token, not the dashboard one: a stage costs LLM budget and writes to
 * the database, which is a different level of trust from reading the week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { checkAdminHeader } from '../../../../lib/auth';
import { STAGES } from '../../../../lib/stages';

// A stage runs for minutes, well past the default serverless budget; Vercel
// Hobby caps at 300s and will cut a long stage off regardless.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Run one stage and wait for it.
 *
 * `--dry` is honoured so a caller can check a stage starts and reads what it
 * expects without spending the day's token allowance.
 */
function runStage(script: string, args: string[], timeoutMs: number) {
  return new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve) => {
    const child = spawn('npx', ['tsx', `scripts/${script}`, ...args], {
      cwd: process.cwd(),
      env: process.env,
    });
    let output = '';
    let timedOut = false;
    const cap = (s: string) => {
      // Enough to see where a stage stopped, bounded so a chatty stage cannot
      // return megabytes into a terminal.
      if (output.length < 100_000) output += s;
    };
    child.stdout.on('data', (b) => cap(String(b)));
    child.stderr.on('data', (b) => cap(String(b)));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}\nspawn failed: ${(e as Error).message}`, timedOut });
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ stage: string }> },
) {
  if (!checkAdminHeader(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { stage: name } = await params;
  const stage = STAGES.find((s) => s.name === name);
  if (!stage) {
    return NextResponse.json(
      { error: `no stage named "${name}"`, stages: STAGES.map((s) => s.name) },
      { status: 404 },
    );
  }

  const dry = req.nextUrl.searchParams.get('dry') === '1';
  // Capped below the function's own limit so the answer says "the stage ran
  // long" rather than the platform cutting the response off mid-flight.
  const timeoutMs = Math.min(stage.timeoutMin * 60_000, 280_000);

  const started = Date.now();
  const { code, output, timedOut } = await runStage(
    stage.script,
    [...(stage.args ?? []), ...(dry ? ['--dry'] : [])],
    timeoutMs,
  );

  return NextResponse.json(
    {
      stage: stage.name,
      script: stage.script,
      cost: stage.cost,
      dry,
      ok: code === 0 && !timedOut,
      exitCode: code,
      timedOut,
      ms: Date.now() - started,
      output: output.slice(-20_000),
    },
    { status: code === 0 && !timedOut ? 200 : 500 },
  );
}

/** The stage list, so a caller can see what names are valid. */
export async function GET(req: NextRequest) {
  if (!checkAdminHeader(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    stages: STAGES.map((s) => ({
      name: s.name, cost: s.cost, phase: s.phase, timeoutMin: s.timeoutMin, why: s.why,
    })),
  });
}
