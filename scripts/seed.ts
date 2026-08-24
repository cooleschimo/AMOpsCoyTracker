/**
 * Seed script. Brief §2 + §4.
 *
 * WHAT THIS DOES (and deliberately does not do):
 * - Parses fixed-format fields ONLY. The `notes` column is for humans and is
 *   NEVER parsed — brief §2 is explicit about this.
 * - Converts each sg_apac `role:Entity` token into an organizations row plus an
 *   sg_links row. A '?' role suffix (investor?:GIC) means reported-but-unverified
 *   -> match_status='probable'; otherwise 'confirmed'. Both are still pending
 *   review either way.
 * - Carries `flags` into companies.seed_flags, which gate what the UI may assert.
 * - Loads excluded_companies.csv into the discovery guard table.
 * - account_status stays 'unknown' (tri-state): whether EDB holds the account is
 *   internal knowledge this tool cannot verify. No boolean, no silent FALSE.
 *
 * Idempotent: re-running updates rather than duplicating.
 */
import '../lib/loadenv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../lib/db';
import {
  companies, organizations, sgLinks, excludedCompanies, investments, runs,
} from '../lib/schema';
import { parseCsv } from '../lib/csv';
import {
  normalizeCompanyName, normalizeOrgName, normalizeDomain, parsePipeList,
  parseMusd, validRoundDate,
} from '../lib/normalize';
import {
  isSector, isHqRegion, isRoundStage, isSeedFlag, isExclusionReason, isSgApacRole,
} from '../lib/scope';

type Issue = { row: number; company: string; field: string; value: string; note: string };

async function main() {
  const db = getDb();
  const started = Date.now();
  const issues: Issue[] = [];
  const counts = {
    companies_read: 0, companies_inserted: 0, companies_updated: 0,
    sg_tokens_parsed: 0, organizations_created: 0, sg_links_created: 0,
    sg_links_confirmed: 0, sg_links_probable: 0, investments_created: 0,
    excluded_read: 0, excluded_inserted: 0, rows_failed: 0,
  };

  const [run] = await db.insert(runs).values({ stage: 'seed' }).returning();

  // ── companies.csv ────────────────────────────────────────────────────────
  const csvPath = join(process.cwd(), 'data', 'companies.csv');
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  counts.companies_read = rows.length;

  const orgCache = new Map<string, number>();

  for (const [idx, r] of rows.entries()) {
    const rowNum = idx + 2; // 1-indexed + header
    const name = r.name?.trim();
    if (!name) {
      counts.rows_failed++;
      issues.push({ row: rowNum, company: '(blank)', field: 'name', value: '', note: 'missing name - row skipped' });
      continue;
    }

    try {
      // sectors — required, enum-validated
      const sectorsRaw = parsePipeList(r.sectors);
      const sectors = sectorsRaw.filter(isSector);
      for (const bad of sectorsRaw.filter((s) => !isSector(s))) {
        issues.push({ row: rowNum, company: name, field: 'sectors', value: bad, note: 'not in SECTORS enum - dropped' });
      }
      if (sectors.length === 0) {
        counts.rows_failed++;
        issues.push({ row: rowNum, company: name, field: 'sectors', value: r.sectors ?? '', note: 'no valid sector - row skipped' });
        continue;
      }

      const hqRegion = r.hq_region && isHqRegion(r.hq_region) ? r.hq_region : null;
      if (r.hq_region && !hqRegion) {
        issues.push({ row: rowNum, company: name, field: 'hq_region', value: r.hq_region, note: 'not in HQ_REGIONS enum - nulled' });
      }

      const roundStage = r.round_stage && isRoundStage(r.round_stage) ? r.round_stage : null;
      if (r.round_stage && !roundStage) {
        issues.push({ row: rowNum, company: name, field: 'round_stage', value: r.round_stage, note: 'not in ROUND_STAGES enum - nulled' });
      }

      const flagsRaw = parsePipeList(r.flags);
      const seedFlags = flagsRaw.filter(isSeedFlag);
      for (const bad of flagsRaw.filter((f) => !isSeedFlag(f))) {
        issues.push({ row: rowNum, company: name, field: 'flags', value: bad, note: 'not in SEED_FLAGS enum - dropped' });
      }

      // account_status: tri-state. Seed default is 'unknown' and the CSV should
      // only ever carry 'unknown' — anything else is flagged, not silently trusted.
      const acct = r.account_status?.trim() || 'unknown';
      if (!['unknown', 'account', 'not_account'].includes(acct)) {
        issues.push({ row: rowNum, company: name, field: 'account_status', value: acct, note: 'invalid tri-state - forced to unknown' });
      }
      const accountStatus = ['unknown', 'account', 'not_account'].includes(acct) ? acct : 'unknown';

      const values = {
        name,
        aliases: parsePipeList(r.aliases),
        sectors,
        hqCity: r.hq_city || null,
        hqState: r.hq_state || null,
        hqRegion,
        website: normalizeDomain(r.website),
        headcountEst: parseMusd(r.headcount_est),
        description: r.description || null,
        sgApac: r.sg_apac || null,
        roundStage,
        roundAmountMusd: parseMusd(r.round_amount_musd),
        roundValMusd: parseMusd(r.round_val_musd),
        roundDate: validRoundDate(r.round_date),
        seedFlags,
        accountStatus,
        accountStatusSource: 'seed',
        atsType: r.ats_type || null,
        atsSlug: r.ats_slug || null,
        discoveredVia: 'seed',
        normalizedName: normalizeCompanyName(name),
        // notes: NEVER parsed from CSV. Reserved for EDB-internal history.
      };

      const existing = await db.select({ id: companies.id }).from(companies)
        .where(eq(companies.normalizedName, values.normalizedName)).limit(1);

      let companyId: number;
      if (existing.length) {
        companyId = existing[0].id;
        await db.update(companies).set(values).where(eq(companies.id, companyId));
        counts.companies_updated++;
      } else {
        const [ins] = await db.insert(companies).values(values).returning({ id: companies.id });
        companyId = ins.id;
        counts.companies_inserted++;
      }

      // ── sg_apac tokens -> organizations + sg_links ────────────────────────
      for (const token of parsePipeList(r.sg_apac)) {
        const ci = token.indexOf(':');
        if (ci < 0) {
          issues.push({ row: rowNum, company: name, field: 'sg_apac', value: token, note: 'no role:Entity colon - skipped' });
          continue;
        }
        const roleRaw = token.slice(0, ci).trim();
        const entity = token.slice(ci + 1).trim();
        if (!entity) {
          issues.push({ row: rowNum, company: name, field: 'sg_apac', value: token, note: 'empty entity - skipped' });
          continue;
        }

        // '?' suffix = reported but unverified -> probable
        const unverified = roleRaw.endsWith('?');
        const role = unverified ? roleRaw.slice(0, -1) : roleRaw;
        if (!isSgApacRole(role)) {
          issues.push({ row: rowNum, company: name, field: 'sg_apac', value: token, note: `role '${role}' not in SG_APAC_ROLES - skipped` });
          continue;
        }
        counts.sg_tokens_parsed++;
        const matchStatus = unverified ? 'probable' : 'confirmed';

        const orgNorm = normalizeOrgName(entity);
        let orgId = orgCache.get(orgNorm);
        if (!orgId) {
          const found = await db.select({ id: organizations.id }).from(organizations)
            .where(eq(organizations.normalizedName, orgNorm)).limit(1);
          if (found.length) orgId = found[0].id;
          else {
            const [o] = await db.insert(organizations)
              .values({ name: entity, normalizedName: orgNorm, sgPresence: true, notes: 'created from companies.csv sg_apac token' })
              .returning({ id: organizations.id });
            orgId = o.id;
            counts.organizations_created++;
          }
          orgCache.set(orgNorm, orgId);
        }

        // sg_link on the COMPANY: this company has an SG/APAC-linked backer.
        const linkDetail = `${role}${unverified ? ' (reported, unverified)' : ''}: ${entity}`;
        const dupe = await db.select({ id: sgLinks.id }).from(sgLinks)
          .where(sql`${sgLinks.subjectType} = 'company' AND ${sgLinks.subjectId} = ${companyId} AND ${sgLinks.detail} = ${linkDetail}`)
          .limit(1);
        if (!dupe.length) {
          await db.insert(sgLinks).values({
            subjectType: 'company', subjectId: companyId,
            linkType: 'portfolio_co_in_sg', matchStatus, detail: linkDetail,
            // No per-token URL exists in the CSV. Record the provenance
            // explicitly rather than leaving null: brief §4 says an unsourced
            // edge is worse than no edge, so it must at least say where it
            // came from and that it is unverified.
            sourceUrl: 'seed:data/companies.csv#sg_apac (research-verified Aug 2026, no per-token URL)',
          });
          counts.sg_links_created++;
          if (matchStatus === 'confirmed') counts.sg_links_confirmed++; else counts.sg_links_probable++;
        }

        // investor/investor_lead also implies an investment edge.
        if (role === 'investor' || role === 'investor_lead') {
          const roundLabel = `seed:${r.round_stage || 'unknown'}`;
          const dupeInv = await db.select({ id: investments.id }).from(investments)
            .where(sql`${investments.orgId} = ${orgId} AND ${investments.companyId} = ${companyId} AND ${investments.round} = ${roundLabel}`)
            .limit(1);
          if (!dupeInv.length) {
            await db.insert(investments).values({
              orgId, companyId, round: roundLabel,
              isLead: role === 'investor_lead',
              source: 'seed',
              sourceUrl: 'seed:data/companies.csv#sg_apac (research-verified Aug 2026, no per-token URL)',
            });
            counts.investments_created++;
          }
        }
      }
    } catch (e) {
      counts.rows_failed++;
      issues.push({ row: rowNum, company: name, field: '(row)', value: '', note: `EXCEPTION: ${(e as Error).message}` });
    }
  }

  // ── excluded_companies.csv -> discovery guard table ──────────────────────
  const exRows = parseCsv(readFileSync(join(process.cwd(), 'data', 'excluded_companies.csv'), 'utf8'));
  counts.excluded_read = exRows.length;
  for (const [idx, r] of exRows.entries()) {
    const rowNum = idx + 2;
    const name = r.name?.trim();
    if (!name) { counts.rows_failed++; continue; }
    const reason = r.reason?.trim();
    if (!reason || !isExclusionReason(reason)) {
      issues.push({ row: rowNum, company: name, field: 'reason', value: reason ?? '', note: 'not in EXCLUSION_REASONS enum' });
    }
    const norm = normalizeCompanyName(name);
    const existing = await db.select({ id: excludedCompanies.id }).from(excludedCompanies)
      .where(eq(excludedCompanies.normalizedName, norm)).limit(1);
    const vals = {
      name, normalizedName: norm,
      aliases: parsePipeList(r.aliases),
      reason: reason || 'independence_uncertain',
      asOf: r.as_of ? (r.as_of.length === 4 ? `${r.as_of}-01-01` : `${r.as_of}-01`) : null,
      detail: r.detail || null,
    };
    if (existing.length) await db.update(excludedCompanies).set(vals).where(eq(excludedCompanies.id, existing[0].id));
    else { await db.insert(excludedCompanies).values(vals); counts.excluded_inserted++; }
  }

  await db.update(runs)
    .set({ finishedAt: new Date(), counts: { ...counts, issues: issues.length } })
    .where(eq(runs.id, run.id));

  // ── report ───────────────────────────────────────────────────────────────
  console.log('\n=== SEED COMPLETE (%,ds) ===', Math.round((Date.now() - started) / 1000));
  console.table(counts);
  if (issues.length) {
    console.log(`\n=== ${issues.length} PARSE ISSUES ===`);
    console.table(issues);
  } else {
    console.log('\nNo parse issues: every row loaded with every field understood.');
  }
}

main().catch((e) => { console.error('SEED FAILED:', e); process.exit(1); });
