'use server';
/**
 * Set account status by hand. Brief §4, DESIGN_RATIONALE §14.
 *
 * THIS IS THE ONE FACT THE TOOL CANNOT DERIVE. Whether EDB already holds an
 * account, has met the company, or has decided not to pursue it lives in EDB's
 * own records — §14 keeps that history off personal infrastructure, so it can
 * only ever arrive by a person typing it here.
 *
 * It matters because §7a ranks on the company axis: a company already in
 * conversation should not be presented as a new discovery, and a company
 * deliberately not pursued should stop consuming a digest slot.
 *
 * TRI-STATE, NEVER BOOLEAN (schema.ts). 'no_status' is the honest default and
 * stays the default: absence of a record is not evidence of no relationship.
 * Every change records its source and the time it was reviewed, so a stale
 * status is visible as stale rather than trusted.
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, withRetry } from '../../../lib/db';
import { companies } from '../../../lib/schema';
import { FAMILIARITIES } from '../../../lib/familiarity';

export async function setFamiliarity(formData: FormData) {
  const companyId = Number(formData.get('companyId'));
  const status = String(formData.get('status') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (!Number.isFinite(companyId)) return;
  if (!(FAMILIARITIES as readonly string[]).includes(status)) return;

  const db = getDb();
  await withRetry(() => db.update(companies).set({
    familiarity: status,
    // Provenance travels with the value: an unsourced assertion is worthless
    // (§15), and 'rd_review' distinguishes a human record from anything
    // inferred.
    familiaritySource: note ? `rd_review: ${note.slice(0, 200)}` : 'rd_review',
    familiarityReviewedAt: new Date(),
  }).where(eq(companies.id, companyId)));

  revalidatePath('/admin/familiarity');
}
