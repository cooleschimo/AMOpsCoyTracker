/**
 * Which keys are spent, remembered across runs. Brief §3.
 *
 * `Budget` tracks exhaustion in memory, which is right within a run and useless
 * between them: every process started blind and rediscovered each spent key
 * with its own wasted 429. With twelve of twenty-two keys gone, one assessment
 * batch walked the whole chain before reaching a live provider, and every batch
 * after it did the same.
 *
 * THE RECORD EXPIRES WITH THE CAPS IT DESCRIBES. Every limit here is per day —
 * Gemini's twenty requests, OpenRouter's fifty, Groq's token allowance — and
 * they reset at UTC midnight, so a row is stamped with the UTC day it was
 * learned on and only that day's rows are read back. A key spent yesterday is
 * simply not returned today; nothing has to clear it.
 *
 * A run that crosses midnight stamps its rows with the day it STARTED, which is
 * the day whose allowance it was spending. The day is fixed when the budget
 * opens and carried through to the write — asking the clock again at write time
 * files the evening's exhaustion under tomorrow, and tomorrow then starts with
 * a chain it believes is already spent and skips every LLM stage.
 *
 * Old rows are deleted opportunistically rather than on a schedule: the table
 * is tiny, and a cleanup that only happens when something is already writing
 * cannot itself fail unnoticed.
 */
import { getSql } from './db';

/**
 * The UTC day a cap belongs to. Providers reset at UTC midnight.
 *
 * The clock is only asked when the run has not already answered. A stage is a
 * separate process, so the answer travels as an environment variable that the
 * runner sets once and every child inherits — the day belongs to the run, and
 * a stage that opens its budget at 01:30 is still spending the evening's
 * allowance.
 */
export const RUN_DAY_ENV = 'PIPELINE_CAP_DAY';

export function capDay(d?: Date): string {
  if (!d) {
    const fromRun = process.env[RUN_DAY_ENV];
    if (fromRun && /^\d{4}-\d{2}-\d{2}$/.test(fromRun)) return fromRun;
  }
  return (d ?? new Date()).toISOString().slice(0, 10);
}

async function ensureTable() {
  const sql = getSql();
  await sql`
    create table if not exists provider_exhaustion (
      provider text not null,
      cap_day date not null,
      reason text,
      noted_at timestamptz default now(),
      primary key (provider, cap_day))`;
}

/**
 * A key that was rejected rather than spent.
 *
 * Kept apart from provider_exhaustion on purpose. That table is stamped with a
 * cap day because the caps reset; a revoked key does not reset, and filing it
 * there would both clear it at midnight and tell the next run to skip a key it
 * should be shouting about. lib/llm.ts marks the call `transient` for the same
 * reason — but transient meant nothing survived the process, so a dead key was
 * visible only as a warning in a log nobody reads until the morning.
 *
 * `noted_at` is refreshed on conflict: what matters is whether the key is still
 * being rejected, not when it first was.
 */
async function ensureRejectedTable() {
  const sql = getSql();
  await sql`
    create table if not exists provider_rejected (
      provider text primary key,
      reason text,
      noted_at timestamptz default now())`;
}

/** Record a credential the provider refused. Never throws; this is a report, not a gate. */
export async function recordRejected(provider: string, reason: string): Promise<void> {
  try {
    await ensureRejectedTable();
    await getSql()`
      insert into provider_rejected (provider, reason)
      values (${provider}, ${reason.slice(0, 200)})
      on conflict (provider) do update set reason = excluded.reason, noted_at = now()`;
  } catch { /* a report, not a requirement */ }
}

/** A key that answered again is no longer rejected. */
export async function clearRejected(provider: string): Promise<void> {
  try {
    await ensureRejectedTable();
    await getSql()`delete from provider_rejected where provider = ${provider}`;
  } catch { /* as above */ }
}

/** Keys currently being refused, newest first. Never throws. */
export async function rejectedKeys(): Promise<Array<[string, string]>> {
  try {
    await ensureRejectedTable();
    const rows: any = await getSql()`
      select provider, reason from provider_rejected
      where noted_at > now() - interval '36 hours' order by noted_at desc`;
    return rows.map((r: any) => [String(r.provider), String(r.reason ?? 'credential rejected')]);
  } catch {
    return [];
  }
}

/**
 * Keys already known spent today, as Budget's constructor wants them.
 *
 * Never throws: this is an optimisation, and a run that cannot read it should
 * discover exhaustion the slow way rather than not run at all.
 */
export async function spentToday(): Promise<Array<[string, string]>> {
  try {
    await ensureTable();
    const rows: any = await getSql()`
      select provider, reason from provider_exhaustion where cap_day = ${capDay()}::date`;
    return rows.map((r: any) => [String(r.provider), String(r.reason ?? 'spent earlier today')]);
  } catch {
    return [];
  }
}

/**
 * Record what this run found spent, and drop what is no longer today's.
 *
 * Also never throws. Failing to write it costs the next run some 429s; failing
 * the run over it would cost the whole stage.
 */
export async function recordSpent(spent: Array<[string, string]>, day = capDay()): Promise<void> {
  try {
    await ensureTable();
    const sql = getSql();
    for (const [provider, reason] of spent) {
      await sql`
        insert into provider_exhaustion (provider, cap_day, reason)
        values (${provider}, ${day}::date, ${reason.slice(0, 200)})
        on conflict (provider, cap_day) do nothing`;
    }
    /*
     * Keep a day either side of this one. A run that starts at 22:00 writes
     * against the day it started while the clock has already moved on, so
     * "older than today" is not the same question as "no longer any day's
     * business" — and deleting the run's own rows out from under it is how the
     * evidence for a spent evening disappears.
     */
    await sql`delete from provider_exhaustion where cap_day < ${day}::date - 1`;
  } catch { /* an optimisation, not a requirement */ }
}

/**
 * A Budget that knows what today already spent, and says so when the run ends.
 *
 * The pipeline builds a Budget in fifteen places; every one of them wants this
 * behaviour and none of them wants to think about it, so the loading and the
 * writing-back live here rather than at each call site.
 *
 * `budget.done()` is what records the result. A stage that forgets to call it
 * loses nothing that was true before it started — it just leaves the next run
 * to rediscover whatever this one learned.
 */
export async function openBudget(priorTokensToday = 0) {
  const { Budget } = await import('./budget');
  const day = capDay();
  const budget = new Budget(priorTokensToday, await spentToday());
  return Object.assign(budget, {
    done: () => recordSpent(budget.spentProviders(), day),
  });
}
