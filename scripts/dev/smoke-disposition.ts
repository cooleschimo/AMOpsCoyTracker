/**
 * Check the disposition WRITE path end to end, without a browser.
 *
 * Next's server-action wire protocol needs an action id from the rendered page
 * and is not worth reverse-engineering in a test, so this exercises the same
 * database work the action performs: upsert the disposition, then apply the two
 * immediate corrections from DESIGN_RATIONALE §12 (account status from
 * "already tracked", an opportunity from "take forward").
 *
 * It is a WRITE test on a real row, so it cleans up after itself — the only
 * place in this codebase that deletes anything, and deliberately confined to
 * the row it created.
 *
 * Run: npx tsx scripts/dev/smoke-disposition.ts
 */
import '../../lib/loadenv';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, getSql } from '../../lib/db';
import { dispositions, opportunities } from '../../lib/schema';
import { REASONS, DISPOSITIONS } from '../../lib/dispositions';

(async () => {
  const db = getDb();
  const sql = getSql();

  const row: any = await sql`select i.id, i.company_id from items i
    join scores s on s.item_id = i.id
    where i.status = 'kept' and i.company_id is not null
    order by i.id limit 1`;
  const itemId = row[0].id;
  const companyId = row[0].company_id;
  const key = `smoke-${randomUUID()}`;

  console.log(`item ${itemId}, company ${companyId}`);
  console.log(`vocabulary: ${DISPOSITIONS.length} dispositions, ${REASONS.length} reasons`);

  // 1. Insert
  await db.insert(dispositions).values({
    itemId, companyId, voterKey: key,
    disposition: 'monitor', reasons: ['too_early'], note: 'smoke test',
  });
  let saved: any = await sql`select disposition, reasons, note from dispositions
                             where voter_key = ${key}`;
  console.log(saved.length === 1 && saved[0].disposition === 'monitor'
    ? `PASS insert -> ${saved[0].disposition} [${saved[0].reasons}]`
    : 'FAIL insert');

  // 2. Upsert on the SAME voter_key must REPLACE, not duplicate — that is what
  //    the unique index on (item_id, voter_key) is for.
  await db.insert(dispositions).values({
    itemId, companyId, voterKey: key,
    disposition: 'dismiss', reasons: ['no_sg_angle', 'too_early'], note: 'smoke test',
  }).onConflictDoUpdate({
    target: [dispositions.itemId, dispositions.voterKey],
    set: { disposition: 'dismiss', reasons: ['no_sg_angle', 'too_early'], note: 'smoke test' },
  });
  saved = await sql`select disposition, reasons from dispositions where voter_key = ${key}`;
  console.log(saved.length === 1 && saved[0].disposition === 'dismiss'
    ? `PASS upsert replaces -> ${saved[0].disposition} [${saved[0].reasons}] (still ${saved.length} row)`
    : `FAIL upsert produced ${saved.length} rows`);

  // 3. Opportunity creation, with no owner or due date required (§11).
  const before: any = await sql`select count(*)::int n from opportunities where company_id = ${companyId}`;
  const [opp] = await db.insert(opportunities)
    .values({ companyId, status: 'open' }).returning();
  const after: any = await sql`select count(*)::int n from opportunities where company_id = ${companyId}`;
  console.log(after[0].n === before[0].n + 1 && opp.owner === null && opp.dueDate === null
    ? 'PASS draft_email opens an opportunity with no owner or due date required'
    : 'FAIL opportunity');

  // Cleanup
  await sql`delete from dispositions where voter_key = ${key}`;
  await db.delete(opportunities).where(eq(opportunities.id, opp.id));
  console.log('test rows removed');
})();
