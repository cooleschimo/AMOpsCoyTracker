'use server';
/**
 * Disposition recording. Brief §11, DESIGN_RATIONALE §7a and §12.
 *
 * Anonymous by design (§7a): there is no recipient identity anywhere in the
 * schema. `voter_key` is a per-browser cookie UUID that dedupes repeat clicks
 * and nothing more, so no query can read it as a person.
 *
 * The structured reason is what makes a dismissal useful (§12) — it is the tool
 * learning, and each reason routes to a different fix:
 *   irrelevant_company -> entity resolution, or the company rubric
 *   too_early          -> timing weights in the rubric
 *   no_sg_angle        -> the item rubric
 *   already_tracked    -> updates account_status, which the tool cannot know
 * Without a reason a dismissal is just a lost item.
 */
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../../../lib/db';
import { companies, dispositions, opportunities } from '../../../lib/schema';
// A 'use server' module may export ONLY async functions, so the vocabulary
// lives in lib/dispositions.ts rather than here.
import { DISPOSITIONS, REASONS } from '../../../lib/dispositions';

/** Per-browser UUID. Set once, reused. Not an identity. */
async function voterKey(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get('voter_key')?.value;
  if (existing) return existing;
  const fresh = randomUUID();
  // 1 year; the cookie only dedupes clicks, so losing it costs nothing.
  jar.set('voter_key', fresh, { httpOnly: true, sameSite: 'lax', maxAge: 31_536_000, path: '/' });
  return fresh;
}

export async function recordDisposition(formData: FormData) {
  const itemId = Number(formData.get('itemId'));
  const companyId = formData.get('companyId') ? Number(formData.get('companyId')) : null;
  const disposition = String(formData.get('disposition') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;
  const reasons = REASONS.filter((r) => formData.get(`reason_${r}`) === 'on');

  if (!Number.isFinite(itemId) || !(DISPOSITIONS as readonly string[]).includes(disposition)) return;

  const db = getDb();
  const key = await voterKey();

  await withRetry(() => db.insert(dispositions).values({
    itemId, companyId, voterKey: key, disposition, reasons, note,
  }).onConflictDoUpdate({
    target: [dispositions.itemId, dispositions.voterKey],
    set: { disposition, reasons, note },
  }));

  // ---- Immediate data correction, no ML (RATIONALE §12 loop 1) ----------

  // "Already tracked" is knowledge the tool cannot derive: EDB's own account
  // history. Record it with its provenance rather than inferring it.
  if (companyId && reasons.includes('already_tracked')) {
    await withRetry(() => db.update(companies).set({
      accountStatus: 'existing_account',
      accountStatusSource: 'rd_review',
      accountStatusReviewedAt: new Date(),
    }).where(eq(companies.id, companyId)));
  }

  // "Draft an email" opens an opportunity. Owner, next action and due date are
  // optional at creation (§11): demanding a due date before a first internal
  // conversation guarantees the button never gets pressed.
  if (companyId && disposition === 'draft_email') {
    const sql = getSql();
    const open: any = await sql`
      select id from opportunities
      where company_id = ${companyId} and status not in ('closed', 'dropped') limit 1`;
    if (!open.length) {
      await withRetry(() => db.insert(opportunities).values({
        companyId, status: 'open', nextAction: null, owner: null,
      }));
    }
  }

  revalidatePath(`/item/${itemId}`);
}
