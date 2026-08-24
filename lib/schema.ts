/**
 * Drizzle schema. Brief §4.
 *
 * NON-NEGOTIABLES ENCODED HERE (do not "optimise" these away):
 * - Nothing fetched is ever deleted. items.status + dropped_reason mark state.
 *   The dropped set is training data and cannot be rebuilt later.
 * - Roles are never deleted. A person leaving sets roles.last_seen. Historical
 *   roles are often the MOST valuable edges in the graph.
 * - Every graph edge carries source + source_url. An unsourced edge is worse
 *   than no edge.
 * - Tri-state, never boolean, for facts the tool cannot verify:
 *   account_status and sg_match_status.
 *
 * DEVIATION 2026-08-21: the `rds` table is removed. Reactions are anonymous;
 * voter_key is a per-browser cookie UUID, NOT a person. See DESIGN_RATIONALE §7a.
 */
import {
  pgTable, serial, text, integer, smallint, boolean, date, timestamp,
  numeric, jsonb, uniqueIndex, index, primaryKey,
} from 'drizzle-orm/pg-core';

export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  aliases: text('aliases').array().default([]),
  sectors: text('sectors').array().notNull(),
  hqCity: text('hq_city'),
  hqState: text('hq_state'),
  hqRegion: text('hq_region'),
  website: text('website'),
  cik: text('cik'),
  foundedYear: integer('founded_year'),
  headcountEst: integer('headcount_est'),
  description: text('description'),
  sgApac: text('sg_apac'),
  totalRaised: numeric('total_raised'),
  roundStage: text('round_stage'),
  roundAmountMusd: integer('round_amount_musd'),
  roundValMusd: integer('round_val_musd'),
  roundDate: text('round_date'),
  seedFlags: text('seed_flags').array().default([]),
  valuationEst: numeric('valuation_est'),
  valuationSource: text('valuation_source'),
  // Tri-state on purpose. 'unknown' is the seed default because whether EDB
  // holds the account is internal knowledge this tool cannot verify.
  accountStatus: text('account_status').notNull().default('unknown'),
  accountStatusSource: text('account_status_source'),
  accountStatusReviewedAt: timestamp('account_status_reviewed_at', { withTimezone: true }),
  sgEntity: boolean('sg_entity'),
  sgEntityUen: text('sg_entity_uen'),
  sgMatchStatus: text('sg_match_status'),
  sgEntityStatus: text('sg_entity_status'),
  sgIncorporated: date('sg_incorporated'),
  atsType: text('ats_type'),
  atsSlug: text('ats_slug'),
  discoveredVia: text('discovered_via'),
  /**
   * Scope triage from the EDGAR industry group (lib/edgar-industry.ts).
   *   in_scope     — a sector match, or pending the company-level assessment
   *   out_of_scope — confidently outside the four sectors; PERSISTED, not deleted,
   *                  so "is the filter wrong?" stays answerable (RATIONALE §15.4)
   *   unknown      — seeded companies, which are in scope by construction
   * Never a boolean: 'pending assessment' is a real third state.
   */
  scopeStatus: text('scope_status').default('unknown'),
  scopeReason: text('scope_reason'),
  // RESERVED for EDB-internal account history. Stays empty on personal
  // infrastructure — DESIGN_RATIONALE §14.
  notes: text('notes'),
  normalizedName: text('normalized_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('companies_normalized_name_idx').on(t.normalizedName),
  index('companies_cik_idx').on(t.cik),
]);

export const people = pgTable('people', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [index('people_normalized_name_idx').on(t.normalizedName)]);

export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  orgType: text('org_type'),
  website: text('website'),
  sgPresence: boolean('sg_presence'),
  notes: text('notes'),
}, (t) => [uniqueIndex('organizations_normalized_name_key').on(t.normalizedName)]);

/** person -> company. NEVER deleted; departure sets last_seen. */
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  personId: integer('person_id').references(() => people.id),
  companyId: integer('company_id').references(() => companies.id),
  role: text('role').notNull(),
  roleRaw: text('role_raw'),
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
  firstSeen: date('first_seen'),
  lastSeen: date('last_seen'),
}, (t) => [uniqueIndex('roles_person_company_role_key').on(t.personId, t.companyId, t.role)]);

/** person -> organization. Requires evidence INDEPENDENT of a Form D. */
export const affiliations = pgTable('affiliations', {
  id: serial('id').primaryKey(),
  personId: integer('person_id').references(() => people.id),
  orgId: integer('org_id').references(() => organizations.id),
  role: text('role'),
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
}, (t) => [uniqueIndex('affiliations_person_org_role_key').on(t.personId, t.orgId, t.role)]);

export const investments = pgTable('investments', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').references(() => organizations.id),
  companyId: integer('company_id').references(() => companies.id),
  round: text('round'),
  isLead: boolean('is_lead'),
  announcedDate: date('announced_date'),
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
}, (t) => [uniqueIndex('investments_org_company_round_key').on(t.orgId, t.companyId, t.round)]);

/**
 * Discovery guard list. Discovery MUST check candidates against this table
 * (name + aliases) and tag rather than add — without it, Form D and news
 * discovery re-import exited companies from stale references (~15% stale rate
 * measured in the seed research).
 */
export const excludedCompanies = pgTable('excluded_companies', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  aliases: text('aliases').array().default([]),
  reason: text('reason').notNull(),
  asOf: date('as_of'),
  detail: text('detail'),
}, (t) => [index('excluded_normalized_name_idx').on(t.normalizedName)]);

/**
 * company -> company. For UNDIRECTED relations store ONE row with
 * from_company_id < to_company_id and query (from = :x OR to = :x).
 * Storing both directions duplicates paths and inflates every warm-path result.
 */
export const companyEdges = pgTable('company_edges', {
  id: serial('id').primaryKey(),
  fromCompanyId: integer('from_company_id').references(() => companies.id),
  toCompanyId: integer('to_company_id').references(() => companies.id),
  relation: text('relation').notNull(),
  directed: boolean('directed').notNull(),
  announcedDate: date('announced_date'),
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
}, (t) => [uniqueIndex('company_edges_from_to_relation_key').on(t.fromCompanyId, t.toCompanyId, t.relation)]);

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  startsOn: date('starts_on'),
  endsOn: date('ends_on'),
  city: text('city'),
  url: text('url'),
  sectors: text('sectors').array(),
});

export const eventParticipants = pgTable('event_participants', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id').references(() => events.id),
  companyId: integer('company_id').references(() => companies.id),
  personId: integer('person_id').references(() => people.id),
  participation: text('participation').notNull(),
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
}, (t) => [uniqueIndex('event_participants_key').on(t.eventId, t.companyId, t.personId, t.participation)]);

/**
 * Anything connecting an entity to Singapore.
 * A registration is NOT operational presence: match_status, entity status and
 * incorporation date travel together so a struck-off shelf entity and a live
 * subsidiary are not flattened into sg_entity = true.
 */
export const sgLinks = pgTable('sg_links', {
  id: serial('id').primaryKey(),
  subjectType: text('subject_type').notNull(),
  subjectId: integer('subject_id').notNull(),
  linkType: text('link_type').notNull(),
  matchStatus: text('match_status'),
  detail: text('detail'),
  sourceUrl: text('source_url'),
  foundAt: timestamp('found_at', { withTimezone: true }).defaultNow(),
}, (t) => [index('sg_links_subject_idx').on(t.subjectType, t.subjectId)]);

/** News and signals. Rows are NEVER deleted — filters set status + dropped_reason. */
export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  url: text('url').notNull(),
  canonicalUrl: text('canonical_url').notNull().unique(),
  title: text('title').notNull(),
  snippet: text('snippet'),
  source: text('source').notNull(),
  sourceType: text('source_type').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow(),
  companyId: integer('company_id').references(() => companies.id),
  clusterId: integer('cluster_id'),
  status: text('status').notNull(),
  droppedReason: text('dropped_reason'),
  runId: integer('run_id'),
}, (t) => [
  index('items_status_idx').on(t.status),
  index('items_company_idx').on(t.companyId),
]);

/**
 * UNIQUE (item_id, rubric_version) is load-bearing: rescoring under a new
 * rubric PRESERVES old scores. You need both to know whether a change helped.
 */
export const scores = pgTable('scores', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').references(() => items.id, { onDelete: 'cascade' }),
  score: smallint('score').notNull(),
  signalType: text('signal_type').notNull(),
  sectors: text('sectors').array(),
  region: text('region'),
  expansionLanguage: boolean('expansion_language').default(false),
  why: text('why').notNull(),
  rubricVersion: text('rubric_version').notNull(),
  model: text('model').notNull(),
  fewshotUsed: boolean('fewshot_used').default(false),
  scoredAt: timestamp('scored_at', { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex('scores_item_rubric_key').on(t.itemId, t.rubricVersion)]);

/** Company-level assessment. Cached per company, refreshed monthly — NOT per item. */
export const companyAssessments = pgTable('company_assessments', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id),
  targetPriority: text('target_priority'),
  singaporeFit: text('singapore_fit'),
  potentialContribution: text('potential_contribution'),
  confidence: text('confidence'),
  rationale: text('rationale'),
  model: text('model'),
  rubricVersion: text('rubric_version'),
  assessedAt: timestamp('assessed_at', { withTimezone: true }).defaultNow(),
}, (t) => [index('company_assessments_company_idx').on(t.companyId)]);

export const drafts = pgTable('drafts', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').references(() => items.id, { onDelete: 'cascade' }),
  companyId: integer('company_id').references(() => companies.id),
  roleTarget: text('role_target'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  angle: text('angle'),
  warmPath: text('warm_path'),
  model: text('model').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const digests = pgTable('digests', {
  id: serial('id').primaryKey(),
  weekOf: date('week_of').notNull().unique(),
  itemIds: integer('item_ids').array().notNull(),
  status: text('status').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  testMode: boolean('test_mode').notNull(),
});

/**
 * Anonymous. voter_key is a per-browser cookie UUID, not a person.
 * Dedupes repeat clicks; identity is deliberately not recorded (§7a).
 */
export const votes = pgTable('votes', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').references(() => items.id, { onDelete: 'cascade' }),
  voterKey: text('voter_key').notNull(),
  vote: smallint('vote').notNull(),
  labelSource: text('label_source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex('votes_item_voter_key').on(t.itemId, t.voterKey)]);

export const secFilings = pgTable('sec_filings', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id),
  formType: text('form_type').notNull(),
  filedAt: date('filed_at'),
  // As filed. NOT cumulative venture funding — can cover debt, pooled funds and
  // multi-issuer structures. Never display as "total raised" without security type.
  amount: numeric('amount'),
  securityType: text('security_type'),
  accessionNumber: text('accession_number'),
  url: text('url'),
}, (t) => [uniqueIndex('sec_filings_company_form_filed_key').on(t.companyId, t.formType, t.filedAt)]);

export const itemCompanies = pgTable('item_companies', {
  itemId: integer('item_id').references(() => items.id, { onDelete: 'cascade' }).notNull(),
  companyId: integer('company_id').references(() => companies.id).notNull(),
  role: text('role'),
}, (t) => [primaryKey({ columns: [t.itemId, t.companyId] })]);

/** Anonymous, as votes. Structured reasons are what make this feedback not noise. */
export const dispositions = pgTable('dispositions', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').references(() => items.id, { onDelete: 'cascade' }),
  companyId: integer('company_id').references(() => companies.id),
  voterKey: text('voter_key').notNull(),
  disposition: text('disposition').notNull(),
  reasons: text('reasons').array().default([]),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex('dispositions_item_voter_key').on(t.itemId, t.voterKey)]);

export const opportunities = pgTable('opportunities', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id),
  owner: text('owner'),
  status: text('status').notNull(),
  nextAction: text('next_action'),
  dueDate: date('due_date'),
  outcome: text('outcome'),
  outcomeReason: text('outcome_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [index('opportunities_company_idx').on(t.companyId)]);

/**
 * Institutional memory about connections. The point is NOT to tell an RD what
 * they know — it is that the NEXT person who hits the same fund or person sees
 * that someone has confirmed access, and who.
 * An unreviewed path is an ASSOCIATION and must never be shown as a warm intro.
 */
export const pathReviews = pgTable('path_reviews', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id),
  pathKind: text('path_kind').notNull(),
  viaPersonId: integer('via_person_id').references(() => people.id),
  viaOrgId: integer('via_org_id').references(() => organizations.id),
  status: text('status').notNull().default('unreviewed'),
  confirmedBy: text('confirmed_by'),
  internalOwner: text('internal_owner'),
  doNotUse: boolean('do_not_use').default(false),
  note: text('note'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, (t) => [index('path_reviews_company_idx').on(t.companyId)]);

export const runs = pgTable('runs', {
  id: serial('id').primaryKey(),
  stage: text('stage').notNull(),
  weekOf: date('week_of'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  counts: jsonb('counts'),
  tokensIn: integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
  error: text('error'),
}, (t) => [index('runs_stage_started_idx').on(t.stage, t.startedAt)]);

/** Source health. Scrapers fail silently; a source returning zero for three weeks must be visible. */
export const sourceHealth = pgTable('source_health', {
  id: serial('id').primaryKey(),
  source: text('source').notNull(),
  sourceType: text('source_type'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastCount: integer('last_count'),
  trailingAvg: numeric('trailing_avg'),
  status: text('status'),
  note: text('note'),
}, (t) => [uniqueIndex('source_health_source_key').on(t.source)]);
