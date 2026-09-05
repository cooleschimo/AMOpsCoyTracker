/**
 * Merge one company into another, and record that it happened.
 *
 * The companion to §7b's review: that pass PROPOSES a merge, this one performs
 * it, and the two are separate on purpose. A merge deletes a row and moves
 * every reference to it, so a model being wrong about "same company" would
 * quietly destroy the evidence for the row it was wrong about.
 *
 * `normalized_name` cannot catch the merges this handles. "Nvidia-backed
 * Lambda" normalises to "nvidia backed lambda", which collides with nothing, so
 * the unique index never fires — the descriptive prefix survives normalisation
 * and the duplicate looks like a new company all the way through.
 *
 * The surviving row keeps its own fields and gains only what it was missing: a
 * duplicate discovered from a headline has no website or location, and the
 * canonical row's are better than nothing but never worth overwriting.
 *
 * Usage: npx tsx scripts/merge-company.ts --keep <id> --drop <id> [--dry]
 *        npx tsx scripts/merge-company.ts --from-review [--dry]
 */
import '../lib/loadenv';
import { eq } from 'drizzle-orm';
import { getDb, getSql, withRetry } from '../lib/db';
import { companyReviews, runs } from '../lib/schema';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/**
 * Every table pointing at a company. A missed one leaves an orphan row whose
 * foreign key names a company that no longer exists.
 */
const REFS: Array<[string, string]> = [
  ['company_edges', 'from_company_id'], ['company_edges', 'to_company_id'],
  ['dispositions', 'company_id'], ['drafts', 'company_id'],
  ['event_participants', 'company_id'], ['investments', 'company_id'],
  ['item_companies', 'company_id'], ['items', 'company_id'],
  ['opportunities', 'company_id'], ['path_reviews', 'company_id'],
  ['roles', 'company_id'], ['sec_filings', 'company_id'],
  ['job_postings', 'company_id'], ['job_snapshots', 'company_id'],
  ['monitoring', 'company_id'], ['company_signals', 'company_id'],
  ['company_assessments', 'company_id'],
  // The review's own rows, including one row's claim that another is its
  // duplicate — the merge deletes the company that claim points at.
  ['company_reviews', 'company_id'], ['company_reviews', 'duplicate_of_id'],
];

/** Fields worth taking from the row being dropped, but only where the survivor has none. */
const FILLABLE = ['website', 'hq_city', 'hq_state', 'hq_region', 'description', 'cik'] as const;

async function merge(keep: number, drop: number, dry: boolean): Promise<boolean> {
  const sql = getSql();
  const [k]: any = await sql`select * from companies where id = ${keep}`;
  const [d]: any = await sql`select * from companies where id = ${drop}`;
  if (!k) { console.warn(`  no company #${keep}`); return false; }
  if (!d) { console.warn(`  no company #${drop}`); return false; }
  if (keep === drop) { console.warn('  keep and drop are the same row'); return false; }

  console.log(`  "${d.name}" (#${drop}) -> "${k.name}" (#${keep})`);

  let moved = 0;
  for (const [t, c] of REFS) {
    if (dry) continue;
    try {
      // Tagged templates, not sql.unsafe with positional params: the HTTP
      // driver accepts the latter and silently applies nothing.
      // Counted before the update: `returning` does not survive an interpolated
      // table name, so the row count has to be asked for separately.
      const [n]: any = await sql`select count(*)::int n from ${sql.unsafe(t)}
                                 where ${sql.unsafe(c)} = ${drop}`;
      await sql`update ${sql.unsafe(t)} set ${sql.unsafe(c)} = ${keep}
                where ${sql.unsafe(c)} = ${drop}`;
      moved += Number(n?.n ?? 0);
    } catch {
      // A unique key on the child means the survivor already has that row, so
      // the duplicate's copy is redundant rather than lost.
      try { await sql`delete from ${sql.unsafe(t)} where ${sql.unsafe(c)} = ${drop}`; } catch { /* reported by the delete below */ }
    }
  }

  if (!dry) {
    /*
     * sg_links is polymorphic and carries no foreign key, so it is moved by
     * hand rather than through REFS — and only the rows whose subject is a
     * company, since an organization can share an id with one.
     */
    try {
      await sql`update sg_links set subject_id = ${keep}
                where subject_type = 'company' and subject_id = ${drop}`;
    } catch { /* a unique key means the survivor already holds it */ }

    const fill: string[] = [];
    for (const f of FILLABLE) if (!k[f] && d[f]) fill.push(f);
    for (const f of fill) {
      await sql`update companies set ${sql.unsafe(f)} = ${d[f]} where id = ${keep}`;
    }
    if (fill.length) console.log(`    filled from the duplicate: ${fill.join(', ')}`);

    // Aliases keep the name that arrived, so the same headline shape matches
    // the surviving row next time rather than creating the duplicate again.
    const aliases = [...new Set([...(k.aliases ?? []), d.name, ...(d.aliases ?? [])])]
      .filter((a: string) => a && a !== k.name);
    await sql`update companies set aliases = ${aliases} where id = ${keep}`;

    await sql`delete from companies where id = ${drop}`;
    console.log(`    ${moved} rows moved, alias kept, #${drop} deleted`);
  }
  return true;
}

(async () => {
  const db = getDb();
  const dry = flag('dry');
  const fromReview = flag('from-review');

  const [run] = await db.insert(runs).values({ stage: 'merge_company' }).returning();
  const counts = { merged: 0, failed: 0 };

  try {
    if (fromReview) {
      const sql = getSql();
      const pending: any = await sql`
        select cr.id, cr.company_id, cr.duplicate_of_id
        from company_reviews cr
        where cr.verdict = 'duplicate' and cr.duplicate_of_id is not null
          and cr.resolved_at is null`;
      console.log(`${pending.length} proposed merge${pending.length === 1 ? '' : 's'} from the review\n`);

      for (const p of pending) {
        const ok = await merge(Number(p.duplicate_of_id), Number(p.company_id), dry);
        ok ? counts.merged++ : counts.failed++;
        if (ok && !dry) {
          await withRetry(() => db.update(companyReviews)
            .set({ resolvedAt: new Date(), resolution: 'merged' })
            .where(eq(companyReviews.id, Number(p.id))));
        }
      }
    } else {
      const keep = Number(arg('keep', '0'));
      const drop = Number(arg('drop', '0'));
      if (!keep || !drop) {
        console.error('need --keep <id> --drop <id>, or --from-review');
        process.exit(1);
      }
      const ok = await merge(keep, drop, dry);
      ok ? counts.merged++ : counts.failed++;
    }
  } finally {
    await db.update(runs).set({ finishedAt: new Date(), counts }).where(eq(runs.id, run.id));
  }

  console.log(`\ncounts: ${JSON.stringify(counts)}`);
  if (dry) console.log('DRY RUN — nothing written');
})();
