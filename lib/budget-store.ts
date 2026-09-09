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
 * simply not returned today; nothing has to clear it, and a run that starts at
 * 23:59 and ends at 00:01 reads the day it started, which is the day whose
 * allowance it was spending.
 *
 * Old rows are deleted opportunistically rather than on a schedule: the table
 * is tiny, and a cleanup that only happens when something is already writing
 * cannot itself fail unnoticed.
 */
import { getSql } from './db';

/** The UTC day a cap belongs to. Providers reset at UTC midnight. */
export function capDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
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
export async function recordSpent(spent: Array<[string, string]>): Promise<void> {
  try {
    await ensureTable();
    const sql = getSql();
    const day = capDay();
    for (const [provider, reason] of spent) {
      await sql`
        insert into provider_exhaustion (provider, cap_day, reason)
        values (${provider}, ${day}::date, ${reason.slice(0, 200)})
        on conflict (provider, cap_day) do nothing`;
    }
    await sql`delete from provider_exhaustion where cap_day < ${day}::date`;
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
  const budget = new Budget(priorTokensToday, await spentToday());
  return Object.assign(budget, {
    done: () => recordSpent(budget.spentProviders()),
  });
}
