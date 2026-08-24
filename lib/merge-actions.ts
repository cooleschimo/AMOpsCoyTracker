/**
 * Merge execution. Brief §6.
 *
 * A merge repoints edges and marks the losing row as merged. The row itself
 * stays, so a merge that later turns out to be wrong can still be diagnosed
 * from what it left behind.
 */
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from './db';
import { people, roles, affiliations, companies, organizations, entityMerges, investments } from './schema';

export type MergeInput = {
  entityType: 'company' | 'person' | 'organization';
  keptId: number;
  mergedId: number;
  decision: 'merged' | 'distinct' | 'unsure';
  signals?: string[];
  score?: number;
  note?: string;
  decidedBy?: string;
};

export async function recordDecision(input: MergeInput) {
  const db = getDb();

  // Record the decision first, whatever it is. A "these are different" verdict
  // is as valuable as a merge: it stops the pair being re-surfaced weekly.
  await db.insert(entityMerges).values({
    entityType: input.entityType,
    keptId: input.keptId,
    mergedId: input.mergedId,
    decision: input.decision,
    signals: input.signals ?? [],
    score: input.score != null ? String(input.score) : null,
    note: input.note ?? null,
    decidedBy: input.decidedBy ?? 'admin',
  }).onConflictDoNothing();

  if (input.decision !== 'merged') return { repointed: 0 };

  let repointed = 0;

  if (input.entityType === 'person') {
    // Repoint role edges, skipping any that would violate the unique constraint.
    const moving = await db.select().from(roles).where(eq(roles.personId, input.mergedId));
    for (const r of moving) {
      const clash = await db.select({ id: roles.id }).from(roles)
        .where(and(eq(roles.personId, input.keptId), eq(roles.companyId, r.companyId!), eq(roles.role, r.role)))
        .limit(1);
      if (clash.length) {
        // Keep the earlier first_seen and later last_seen across the pair.
        await db.update(roles).set({
          firstSeen: sql`least(${roles.firstSeen}, ${r.firstSeen})`,
          lastSeen: sql`greatest(${roles.lastSeen}, ${r.lastSeen})`,
        }).where(eq(roles.id, clash[0].id));
        await db.update(roles).set({ personId: null, roleRaw: sql`${roles.roleRaw} || ' (merged duplicate)'` })
          .where(eq(roles.id, r.id));
      } else {
        await db.update(roles).set({ personId: input.keptId }).where(eq(roles.id, r.id));
      }
      repointed++;
    }
    const affs = await db.select().from(affiliations).where(eq(affiliations.personId, input.mergedId));
    for (const a of affs) {
      const clash = await db.select({ id: affiliations.id }).from(affiliations)
        .where(and(eq(affiliations.personId, input.keptId), eq(affiliations.orgId, a.orgId!), eq(affiliations.role, a.role!)))
        .limit(1);
      if (!clash.length) await db.update(affiliations).set({ personId: input.keptId }).where(eq(affiliations.id, a.id));
      repointed++;
    }
    // Marked rather than removed, so the merge stays traceable.
    await db.update(people)
      .set({ name: sql`${people.name} || ' [merged into #' || ${input.keptId} || ']'` })
      .where(eq(people.id, input.mergedId));
  }

  if (input.entityType === 'company') {
    for (const t of [roles, investments] as const) {
      const rows = await db.select({ id: (t as typeof roles).id }).from(t as typeof roles)
        .where(eq((t as typeof roles).companyId, input.mergedId));
      for (const r of rows) {
        await db.update(t as typeof roles).set({ companyId: input.keptId }).where(eq((t as typeof roles).id, r.id));
        repointed++;
      }
    }
    await db.update(companies)
      .set({ scopeStatus: 'merged', scopeReason: `merged into company #${input.keptId}` })
      .where(eq(companies.id, input.mergedId));
  }

  if (input.entityType === 'organization') {
    const rows = await db.select({ id: investments.id }).from(investments)
      .where(eq(investments.orgId, input.mergedId));
    for (const r of rows) {
      await db.update(investments).set({ orgId: input.keptId }).where(eq(investments.id, r.id));
      repointed++;
    }
    await db.update(organizations)
      .set({ notes: sql`coalesce(${organizations.notes},'') || ' [merged into #' || ${input.keptId} || ']'` })
      .where(eq(organizations.id, input.mergedId));
  }

  return { repointed };
}
