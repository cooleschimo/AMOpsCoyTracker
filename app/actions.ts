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
import { refineCaRegion, regionForState } from '@/lib/edgar';
import { companies, dispositions, monitoring, opportunities } from '../lib/schema';
import { isFamiliarity, type Familiarity } from '../lib/familiarity';
import { DISPOSITIONS, REASONS, type Disposition, type Reason } from '../lib/dispositions';
import { PATH_KINDS, PATH_REVIEW_STATUSES, type PathKind, type PathReviewStatus } from '../lib/ui-types';
import { currentUser } from '../lib/session';

const VOTER_COOKIE = 'voter_key';

/**
 * Every write here needs an account.
 *
 * Hiding a button is not an access control: a server action has a stable
 * endpoint and anyone holding the shared dashboard link can post to it. So the
 * refusal lives here, where the write actually happens, and the hidden controls
 * are only there to stop a guest reaching for something that would fail.
 */
async function requireUser(): Promise<
  { ok: true; user: { id: number; name: string } } | { ok: false; error: string }
> {
  const me = await currentUser();
  if (!me) return { ok: false, error: 'Sign in to do that.' };
  return { ok: true, user: { id: me.id, name: me.name } };
}

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
  const auth = await requireUser();
  if (!auth.ok) return auth;
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
  const auth = await requireUser();
  if (!auth.ok) return auth;
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
  const auth = await requireUser();
  if (!auth.ok) return auth;
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
 * Put a company back under monitoring after it was dropped.
 *
 * Clearing `removed_at` resumes the original watch rather than starting a new
 * one, so the period the company has been monitored stays continuous — an undo
 * that opened a second row would read as two shorter watches with a gap.
 */
export async function restoreToMonitoring(companyId: number): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const key = await voterKey();
  try {
    await withRetry(async () => {
      const sql = getSql();
      await sql`update monitoring set removed_at = null
                where company_id = ${companyId} and voter_key = ${key}
                  and removed_at is not null`;
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
export async function setFamiliarity(
  companyId: number,
  status: Familiarity,
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!isFamiliarity(status)) return { ok: false, error: 'unknown account status' };
  try {
    await withRetry(() =>
      getDb()
        .update(companies)
        .set({
          familiarity: status,
          familiaritySource: 'rd_review',
          familiarityReviewedAt: new Date(),
        })
        .where(eq(companies.id, companyId)),
    );
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Correct a company's location.
 *
 * Where a company sits decides which geography tab it appears under, and for
 * news-discovered companies it is the model's reading of a headline rather than
 * anything filed — right often enough to be useful, wrong often enough that
 * Implantica came through as San Diego. So it is editable, and a correction is
 * marked 'manual' so the next automated pass leaves it alone.
 *
 * A US state sets the region; anything else clears it, since hq_region is a US
 * concept and a stale region on a company that moved abroad is worse than none.
 */
export async function setLocation(
  companyId: number,
  city: string,
  state: string,
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const c = city.trim().slice(0, 120);
  const st = state.trim().slice(0, 60);
  if (!c) return { ok: false, error: 'a city is required' };

  const isUsState = /^[A-Za-z]{2}$/.test(st);
  const region = isUsState
    ? (st.toUpperCase() === 'CA' ? refineCaRegion(c) : regionForState(st.toUpperCase()))
    : null;

  try {
    await withRetry(() =>
      getDb()
        .update(companies)
        .set({
          hqCity: c,
          hqState: isUsState ? st.toUpperCase() : (st || null),
          hqRegion: region,
          hqSource: 'manual',
        })
        .where(eq(companies.id, companyId)),
    );
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Record a human judgment about a possible path. Brief §8, RATIONALE §9.
 *
 * THE HONESTY RULE CLOSES HERE. Everything `lib/paths.ts` returns is an
 * association derived from public data — a shared investor, a shared board
 * seat, two companies at one conference. Whether EDB can actually use it is
 * internal knowledge that no source carries, so until somebody says otherwise
 * a path stays `unreviewed` and the UI calls it a possibility. This is the only
 * way it becomes anything else.
 *
 * The review keys on the CONNECTOR rather than the path, matching how
 * `findWarmPaths` reads it back: a partner who links this company to four
 * others is one relationship and one judgment, not four. `via_person_id` and
 * `via_org_id` are both null for an event path, which is a legitimate key —
 * an event has no connector beyond the company itself.
 *
 * `do_not_use` outranks the status wherever both are set, because a conflict is
 * a reason to stop regardless of how promising the path looked.
 */
export async function reviewPath(input: {
  companyId: number;
  pathKind: PathKind;
  viaPersonId?: number | null;
  viaOrgId?: number | null;
  status: PathReviewStatus;
  internalOwner?: string | null;
  note?: string | null;
  doNotUse?: boolean;
}): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!PATH_KINDS.includes(input.pathKind)) return { ok: false, error: 'unknown path kind' };
  if (!PATH_REVIEW_STATUSES.includes(input.status)) return { ok: false, error: 'unknown review status' };

  const personId = input.viaPersonId ?? null;
  const orgId = input.viaOrgId ?? null;
  const note = (input.note ?? '').trim().slice(0, 500) || null;
  const owner = (input.internalOwner ?? '').trim().slice(0, 120) || null;

  try {
    const sql = getSql();
    /*
     * Matched on the same tuple `findWarmPaths` reads back, nulls included.
     * `is not distinct from` rather than `=`, since a null via_person_id never
     * equals a null via_person_id and every event review would insert a new row
     * on each click.
     */
    const existing: any = await sql`
      select id from path_reviews
      where company_id = ${input.companyId}
        and path_kind = ${input.pathKind}
        and via_person_id is not distinct from ${personId}
        and via_org_id is not distinct from ${orgId}
      limit 1`;

    if (existing.length) {
      await withRetry(() => sql`
        update path_reviews set
          status = ${input.status},
          internal_owner = ${owner},
          note = ${note},
          do_not_use = ${input.doNotUse ?? false},
          confirmed_by = 'rd_review',
          confirmed_at = now()
        where id = ${existing[0].id}`);
    } else {
      await withRetry(() => sql`
        insert into path_reviews
          (company_id, path_kind, via_person_id, via_org_id, status,
           internal_owner, note, do_not_use, confirmed_by, confirmed_at)
        values
          (${input.companyId}, ${input.pathKind}, ${personId}, ${orgId}, ${input.status},
           ${owner}, ${note}, ${input.doNotUse ?? false}, 'rd_review', now())`);
    }

    /*
     * The write is what matters; refreshing the page's cache is housekeeping.
     * revalidatePath throws outside a request context — a script calling this
     * action directly, for instance — and letting that surface would report a
     * successful save as a failure and roll the UI back over it.
     */
    try { revalidatePath(`/company/${input.companyId}`); } catch { /* not in a request */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
