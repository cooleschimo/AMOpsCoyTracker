'use server';
/**
 * Dashboard writes. Brief §11, §11b.
 *
 * Every action here is feedback that tunes future recommendations, which is why
 * dismissals carry a structured reason and account status is recorded even when
 * it changes nothing this week.
 *
 * Anonymous by design (§7a): there is no recipient identity in the schema.
 * `voter_key` is a per-browser cookie UUID that dedupes repeat clicks, so no
 * query can read it as a person.
 */
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { companies, dispositions, monitoring, opportunities } from '../lib/schema';
import { isAccountStatus, type AccountStatus } from '../lib/accounts';
import { DISPOSITIONS, REASONS, type Disposition, type Reason } from '../lib/dispositions';

const VOTER_COOKIE = 'voter_key';

async function voterKey(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(VOTER_COOKIE)?.value;
  if (existing) return existing;
  const key = randomUUID();
  // A year is long enough that a director's reactions dedupe across a pilot,
  // short enough that a shared machine eventually forgets.
  jar.set(VOTER_COOKIE, key, { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true });
  return key;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Record a disposition against a company.
 *
 * `draft_email` opens an opportunity as well (§9): owner, next action and due
 * date stay optional, because demanding a due date before a first internal
 * conversation guarantees the button never gets pressed.
 */
export async function setDisposition(input: {
  companyId: number;
  itemId?: number | null;
  disposition: Disposition;
  reason?: Reason | null;
  note?: string | null;
}): Promise<ActionResult> {
  if (!DISPOSITIONS.includes(input.disposition)) return { ok: false, error: 'unknown disposition' };
  if (input.reason && !REASONS.includes(input.reason)) return { ok: false, error: 'unknown reason' };

  const db = getDb();
  const key = await voterKey();
  const reasons = input.reason ? [input.reason] : [];

  try {
    await withRetry(async () => {
      const sql = getSql();
      // One disposition per company per browser; a change of mind overwrites.
      await sql`
        insert into dispositions (item_id, company_id, voter_key, disposition, reasons, note)
        values (${input.itemId ?? null}, ${input.companyId}, ${key},
                ${input.disposition}, ${reasons}, ${input.note ?? null})
        on conflict (item_id, voter_key) do update
          set disposition = excluded.disposition,
              reasons = excluded.reasons,
              note = excluded.note`;
    });

    if (input.disposition === 'monitor') {
      await withRetry(async () => {
        const sql = getSql();
        await sql`
          insert into monitoring (company_id, voter_key, item_id, note)
          values (${input.companyId}, ${key}, ${input.itemId ?? null}, ${input.note ?? null})
          on conflict (company_id, voter_key) do update set removed_at = null`;
      });
    }

    if (input.disposition === 'draft_email') {
      const open: any = await getSql()`
        select id from opportunities
        where company_id = ${input.companyId} and status not in ('closed', 'dropped') limit 1`;
      if (!open.length) {
        await withRetry(() =>
          db.insert(opportunities).values({ companyId: input.companyId, status: 'open' }),
        );
      }
    }

    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Undo a disposition. The row is removed so the company returns to the list. */
export async function clearDisposition(companyId: number): Promise<ActionResult> {
  const key = await voterKey();
  try {
    await withRetry(async () => {
      const sql = getSql();
      await sql`delete from dispositions where company_id = ${companyId} and voter_key = ${key}`;
      // Monitoring keeps its row: how long a company sat monitored is evidence
      // about the assessment, and a deleted row cannot say that.
      await sql`update monitoring set removed_at = now()
                where company_id = ${companyId} and voter_key = ${key} and removed_at is null`;
    });
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Drop a company from monitoring, keeping the record of the period it ran. */
export async function dropFromMonitoring(companyId: number): Promise<ActionResult> {
  const key = await voterKey();
  try {
    await withRetry(async () => {
      const sql = getSql();
      await sql`update monitoring set removed_at = now()
                where company_id = ${companyId} and voter_key = ${key} and removed_at is null`;
    });
    revalidatePath('/monitoring');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Account status is a separate axis from disposition: it answers "do we already
 * know this company", and the placement logic reads it directly (§10).
 */
export async function setAccountStatus(
  companyId: number,
  status: AccountStatus,
): Promise<ActionResult> {
  if (!isAccountStatus(status)) return { ok: false, error: 'unknown account status' };
  try {
    await withRetry(() =>
      getDb()
        .update(companies)
        .set({
          accountStatus: status,
          accountStatusSource: 'rd_review',
          accountStatusReviewedAt: new Date(),
        })
        .where(eq(companies.id, companyId)),
    );
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
