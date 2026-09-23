/**
 * Drizzle schema. Brief §4.
 *
 * Four properties the tables encode deliberately:
 * - Everything fetched is retained; items.status and dropped_reason carry the
 *   state instead. The dropped set is training data and cannot be rebuilt later.
 * - A departure sets roles.last_seen rather than removing the row, since a
 *   historical role is often the most valuable edge in the graph.
 * - Every graph edge carries source + source_url, so a claim can be checked.
 * - familiarity and sg_match_status carry more than two states, because the
 *   tool cannot verify either and a boolean would hide the state that says
 *   nobody has checked.
 *
 * There is no `rds` table. Reactions are anonymous and voter_key is a
 * per-browser cookie UUID rather than a person (DESIGN_RATIONALE §7a).
 */
import { sql } from 'drizzle-orm';
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
  /**
   * Where the location came from, so a reader can tell a filed address from a
   * guess. 'researched' and 'form_d' are hand-checked or filed; 'news' is the model's
   * reading of a headline — often right, never checked, and the reason
   * Implantica arrived as San Diego. 'manual' is a person's correction and
   * outranks every automatic source.
   */
  hqSource: text('hq_source'),
  website: text('website'),
  cik: text('cik'),
  foundedYear: integer('founded_year'),
  headcountEst: integer('headcount_est'),
  description: text('description'),
  /**
   * One line on what the company does, for the dashboard card.
   *
   * Separate from `description`, which is the raw capture — a scraped meta tag
   * or a search snippet, written by enrich-websites as a side effect of
   * resolving a domain. That text is often about the wrong entity (a Rolls-Royce
   * chauffeur hire service, a Tesla fan blog) and far too long to sit under a
   * company name. Keeping both means a bad generation can be re-run against the
   * evidence that produced it rather than having overwritten it.
   */
  oneLiner: text('one_liner'),
  sgApac: text('sg_apac'),
  /**
   * USD MILLIONS, like round_amount_musd below it — not dollars, despite the
   * name carrying no suffix. Every writer divides before storing: load-manual,
   * load-funding (whose CSV columns are amount_usd and valuation_usd) and
   * discover-news (whose headline parser yields dollars).
   *
   * Worth stating, because the column held both scales at once: a raw
   * 60000000000 and a 2500 sat side by side, and nothing in a numeric column
   * says which one a figure is on. lib/dashboard-data.ts scales back up for
   * money(), which formats dollars.
   */
  totalRaised: numeric('total_raised'),
  roundStage: text('round_stage'),
  roundAmountMusd: integer('round_amount_musd'),
  roundValMusd: integer('round_val_musd'),
  roundDate: text('round_date'),
  seedFlags: text('seed_flags').array().default([]),
  /** USD millions. See total_raised above. */
  valuationEst: numeric('valuation_est'),
  valuationSource: text('valuation_source'),
  /**
   * How well EDB knows this company — no_status | known | in_conversation |
   * not_known. See lib/familiarity.ts.
   *
   * Replaced an account-status field: whether EDB holds an account is
   * commercially sensitive and belongs in the systems that own it, while how
   * well a company is known is a judgment an RD can make from memory and is the
   * part that bears on ranking. 'no_status' is the default and is deliberately
   * distinct from 'not_known' — nobody having said is not the same as someone
   * having checked.
   */
  familiarity: text('familiarity').notNull().default('no_status'),
  familiaritySource: text('familiarity_source'),
  familiarityReviewedAt: timestamp('familiarity_reviewed_at', { withTimezone: true }),
  sgEntity: boolean('sg_entity'),
  sgEntityUen: text('sg_entity_uen'),
  sgMatchStatus: text('sg_match_status'),
  sgEntityStatus: text('sg_entity_status'),
  sgIncorporated: date('sg_incorporated'),
  /**
   * CB Insights entity id, stored on a match confirmed against a second
   * attribute. Resolving by name returned the wrong company outright several
   * times — a 1996 life-sciences firm for Cognition, a Norwich community-app
   * builder for Zipline — each with a complete and plausible profile attached.
   * Once the id is known, a later pull addresses the entity directly and the
   * question does not arise again.
   */
  cbiOrgId: integer('cbi_org_id'),
  atsType: text('ats_type'),
  atsSlug: text('ats_slug'),
  /**
   * When discovery last looked for a board and found none.
   *
   * A company with no ATS costs about seven probes and a careers-page read to
   * establish that, and without a record it is re-established every night. The
   * stage takes the first 250 companies by id, so the same failures were also
   * what the window was spent on — companies further down the table were never
   * reached at all.
   *
   * Null means never looked, which is not the same as looked and found
   * nothing: the first is due, the second waits out ATS_RETRY_DAYS. A company
   * that later starts posting is found when that expires.
   */
  atsMissingAt: timestamp('ats_missing_at', { withTimezone: true }),
  discoveredVia: text('discovered_via'),
  /**
   * Scope triage from the EDGAR industry group (lib/edgar-industry.ts).
   *   in_scope     — a sector match, or pending the company-level assessment
   *   out_of_scope — confidently outside the four sectors; the row is kept so
   *                  "is the filter wrong?" stays answerable (RATIONALE §15.4)
   *   unknown      — nothing has judged it either way, which is not a verdict
   * Tri-state, because 'pending assessment' is a real third state.
   */
  scopeStatus: text('scope_status').default('unknown'),
  scopeReason: text('scope_reason'),
  // Reserved for EDB-internal account history. Stays empty on personal
  // infrastructure — DESIGN_RATIONALE §14.
  notes: text('notes'),
  normalizedName: text('normalized_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  /*
   * Unique, not merely indexed. Without it `onConflictDoNothing` has no
   * conflict to detect, so every discovery run that saw a company again
   * inserted it again — 105 duplicated names before this was noticed, and each
   * one splits a company's items, signals and scores across two rows.
   */
  uniqueIndex('companies_normalized_name_key').on(t.normalizedName),
  index('companies_cik_idx').on(t.cik),
]);

export const people = pgTable('people', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  /**
   * Title and bio from a public search result, never a direct fetch of a
   * profile site. Anything derived from a snippet is `probable` and carries its
   * source, so the page can say where it came from rather than asserting it.
   */
  title: text('title'),
  bio: text('bio'),
  bioSource: text('bio_source'),
  bioSourceUrl: text('bio_source_url'),
  bioStatus: text('bio_status'),
  /**
   * Profile URL a search index returned. Storing the link is not a fetch of the
   * site, and §14 permits URLs from a third-party crawl; nothing here reads the
   * page behind it.
   */
  profileUrl: text('profile_url'),
  /**
   * Contact details read from a public source. The source url travels with them
   * and is verified against what the search returned, so a plausible-looking
   * address assembled from a naming pattern cannot reach the record.
   *
   * A contact ages fast, which is the other reason the source is kept.
   */
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  contactSourceUrl: text('contact_source_url'),
  contactFoundAt: timestamp('contact_found_at', { withTimezone: true }),
  bioFetchedAt: timestamp('bio_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [index('people_normalized_name_idx').on(t.normalizedName)]);

export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  orgType: text('org_type'),
  website: text('website'),
  sgPresence: boolean('sg_presence'),
  /**
   * Where the fund itself sits. A fund with a Singapore or APAC office is
   * reachable directly rather than through a portfolio company, which makes it
   * a shorter path than any of its investments.
   */
  hqCity: text('hq_city'),
  hqCountry: text('hq_country'),
  apacOffice: text('apac_office'),
  foundedYear: integer('founded_year'),
  description: text('description'),
  cbiOrgId: integer('cbi_org_id'),
  infoSource: text('info_source'),
  infoAsOf: date('info_as_of'),
  notes: text('notes'),
}, (t) => [uniqueIndex('organizations_normalized_name_key').on(t.normalizedName)]);

/** person -> company. A departure sets last_seen; the row stays. */
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

/** person -> organization. Requires evidence independent of a Form D. */
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
 * Discovery guard list. Discovery checks candidates against this table (name +
 * aliases) and tags them rather than adding them. Stale references keep exited
 * companies circulating — around 15% of the hand-researched list was stale —
 * so without the check they get re-imported from Form D and news.
 *
 * Loaded by scripts/load-exclusions.ts.
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
 * company -> company. An undirected relation is one row with
 * from_company_id < to_company_id, queried as (from = :x OR to = :x). Storing
 * both directions duplicates paths and inflates every warm-path result.
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
 * A registration is not operational presence, so match_status, entity status
 * and incorporation date travel together and a struck-off shelf entity stays
 * distinguishable from a live subsidiary.
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

/** News and signals. Filters set status + dropped_reason; rows are retained. */
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
  /**
   * Context items carry no company: a tariff change or a Singapore budget
   * commitment bears on a whole sector. `contextKind` marks them so the
   * company-match filter lets them through, and `sectors` says who they bear on.
   */
  contextKind: text('context_kind'),
  sectors: text('sectors').array(),
  clusterId: integer('cluster_id'),
  status: text('status').notNull(),
  droppedReason: text('dropped_reason'),
  runId: integer('run_id'),
}, (t) => [
  index('items_status_idx').on(t.status),
  index('items_company_idx').on(t.companyId),
  /*
   * The dashboard counts a cluster's members once per row it shows. Without
   * this that count scanned the whole items table each time — 363 rows became
   * 363 scans of ninety thousand, and the page took ten seconds to answer a
   * filter click that now takes under two.
   */
  index('items_cluster_id_idx').on(t.clusterId),
]);

/**
 * UNIQUE (item_id, rubric_version) is load-bearing: rescoring under a new rubric
 * preserves the old scores, and both are needed to tell whether a change helped.
 */
export const scores = pgTable('scores', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').references(() => items.id, { onDelete: 'cascade' }),
  score: smallint('score').notNull(),
  signalType: text('signal_type').notNull(),
  sectors: text('sectors').array(),
  region: text('region'),
  expansionLanguage: boolean('expansion_language').default(false),
  /**
   * How fast the company is moving, 0-3, judged independently of `score`.
   *
   * `score` asks "is a location decision in play?"; momentum asks "is this
   * company accelerating?". They come apart constantly — a company tripling
   * revenue has high momentum and no location decision — and the dashboard's
   * two sections rank on different ones: discovery on the company axis,
   * trending on momentum.
   *
   * Nullable because scores written before item-v4 have no momentum judgment,
   * and a missing value must not read as zero.
   */
  momentum: smallint('momentum'),
  why: text('why').notNull(),
  rubricVersion: text('rubric_version').notNull(),
  model: text('model').notNull(),
  fewshotUsed: boolean('fewshot_used').default(false),
  scoredAt: timestamp('scored_at', { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex('scores_item_rubric_key').on(t.itemId, t.rubricVersion)]);

/**
 * Company-level trigger and momentum over a rolling window. Brief §7.
 *
 * The UNIT IS THE COMPANY: this is company discovery, and an RD approaches a
 * company rather than an article. Scoring per item gave one underlying reality
 * several inconsistent answers, and left the model padding when an item
 * supported a single fact.
 *
 * `representative_item_id` is what keeps §7a's why-now rule intact — a company
 * reaches the digest only with a specific event to lead with. A strong company
 * with nothing to point at stays held back.
 *
 * UNIQUE on (company_id, week_of, signal_version) so a re-run replaces the
 * week's judgment while earlier weeks and earlier versions survive — the same
 * contract as scores.rubric_version.
 */
export const companySignals = pgTable('company_signals', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id).notNull(),
  /** Monday of the week this was computed for. */
  weekOf: date('week_of').notNull(),
  /** Is the company deciding where to put something — an Asia move, or an open siting decision. */
  expansion: smallint('expansion').notNull(),
  /** Is the company accelerating. */
  momentum: smallint('momentum').notNull(),
  /** Is there an opening EDB could propose into — joint R&D, a testbed, a deployment. */
  partnership: smallint('partnership').notNull(),
  signalType: text('signal_type').notNull(),
  expansionLanguage: boolean('expansion_language').default(false),
  /** Points, ' · ' joined. 1-4, as many as the window supports. */
  why: text('why').notNull(),
  /**
   * The item each why point came from, positionally aligned with `why`.
   *
   * A company's points are drawn from several of its items — a raise, a hiring
   * aggregate, a partnership — and each was checked against its own item. One
   * source for the whole list would cite a funding article for a claim about
   * job postings, so the digest and dashboard need per-point provenance to keep
   * every point separately checkable (§10).
   */
  whyItemIds: integer('why_item_ids').array().default([]),
  /** The item an RD leads with. Null if the model named one we did not offer. */
  representativeItemId: integer('representative_item_id').references(() => items.id, { onDelete: 'set null' }),
  itemsConsidered: integer('items_considered'),
  windowDays: integer('window_days'),
  signalVersion: text('signal_version').notNull(),
  model: text('model').notNull(),
  scoredAt: timestamp('scored_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('company_signals_company_week_version_key').on(t.companyId, t.weekOf, t.signalVersion),
  index('company_signals_week_idx').on(t.weekOf),
]);

/** Company-level assessment. Cached per company and refreshed monthly. */
export const companyAssessments = pgTable('company_assessments', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id),
  targetPriority: text('target_priority'),
  singaporeFit: text('singapore_fit'),
  potentialContribution: text('potential_contribution'),
  /**
   * Whether the company already operates in Asia — offices, entities, staff,
   * customers. A firm with a Tokyo office is a different conversation from one
   * with none, and ACRA sees only Singapore.
   */
  apacFootprint: text('apac_footprint'),
  apacFootprintDetail: text('apac_footprint_detail'),
  /**
   * Has this company opened international sites before. A company that has
   * expanded once tends to expand again, which is why OCO and Frenger both
   * screen on it.
   */
  priorExpansions: text('prior_expansions'),
  priorExpansionsDetail: text('prior_expansions_detail'),
  /**
   * Revenue and profit trajectory, runway. Free sources give almost none of
   * this for private companies, so 'unknown' is the common and honest answer;
   * `financialSource` records where a figure came from when one exists.
   */
  financialHealth: text('financial_health'),
  financialHealthDetail: text('financial_health_detail'),
  financialSource: text('financial_source'),
  financialAsOf: date('financial_as_of'),
  /**
   * What changed since the previous assessment and why. Each week revises the
   * standing judgment rather than replacing it, so this is the record of how a
   * company moved from medium to high.
   */
  revisionNote: text('revision_note'),
  /** How many prior assessments this one builds on. */
  revisionOf: integer('revision_of'),
  /**
   * Which one or two dimensions drive the contribution band — capex, R&D,
   * regional HQ, skilled jobs, capability, spillovers.
   *
   * A band alone is not readable: "high" is only meaningful once a reader knows
   * high in what. Stored as an array so the digest can name them and the stats
   * page can count which dimensions actually recur.
   */
  contributionDrivers: text('contribution_drivers').array().default([]),
  confidence: text('confidence'),
  rationale: text('rationale'),
  /**
   * Why each band landed where it did, one per band.
   *
   * A band on its own is not something a reader can argue with — "priority:
   * high" gives them nothing to correct. The dashboard shows these on the band
   * itself, so the judgment and its reasoning travel together and an RD can see
   * exactly what to push back on.
   *
   * The confidence reason is the load-bearing one: it names what specifically
   * is uncertain, which is what turns a hedge into something actionable.
   */
  priorityReason: text('priority_reason'),
  singaporeFitReason: text('singapore_fit_reason'),
  contributionReason: text('contribution_reason'),
  confidenceReason: text('confidence_reason'),
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
 * People with an account. DESIGN_RATIONALE §7a is superseded here: identity was
 * deliberately absent while the tool had four readers and one shared link, and
 * the cost named there — "the dashboard cannot show a person their own past
 * reactions across devices" — is exactly what a team needs back.
 *
 * Registration is invite-only. The dashboard link is shared, so open signup
 * would hand an account to anyone holding it; an invite is the one path in.
 *
 * `passwordHash` is scrypt with a per-row salt, stored as `salt:hash`. No
 * dependency: node:crypto has scrypt, and a password library would be more
 * surface than the thing it replaces.
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  /** Shown beside what they monitor, so a team can see who is looking at what. */
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** 'member' or 'admin'. A guest has no row here at all. */
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (t) => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`)]);

/**
 * A logged-in browser. The token is the cookie value, and the row is the
 * server's record of it — deleting the row ends the session, which a signed
 * cookie alone could not do.
 */
export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  token: text('token').notNull(),
  /**
   * Null for a guest.
   *
   * A guest session admits a browser without naming a person: it is what the
   * shared DASHBOARD_TOKEN used to do, except each one is its own row, expires
   * on its own, and can be revoked alone rather than by rotating a secret
   * everybody shares. `currentUser()` returns null for these, which is what
   * every guest restriction already keys on.
   */
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('sessions_token_key').on(t.token),
  index('sessions_user_idx').on(t.userId),
]);

/**
 * An invitation to create an account. Single use: `usedAt` is stamped when the
 * account is made, and a used or expired invite opens nothing.
 *
 * The email is fixed at issue rather than chosen at signup, so forwarding an
 * invite cannot create an account under a different address.
 *
 * An OPEN invite is the exception, and it is one on purpose. `email` is null,
 * the address is chosen at signup, and the link therefore makes an account for
 * whoever opens it — so a forwarded one is an account for the person it was
 * forwarded to. It exists for handing links to people whose addresses are not
 * known in advance, and the person issuing it is accepting that trade; a link
 * that leaks costs the seat it was meant for.
 *
 * Everything else is unchanged: single use, the same expiry, the same password
 * rules. A bound invite is still bound.
 */
export const invites = pgTable('invites', {
  id: serial('id').primaryKey(),
  token: text('token').notNull(),
  /** Null on an open invite, where the address is chosen at signup. */
  email: text('email'),
  name: text('name'),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, (t) => [uniqueIndex('invites_token_key').on(t.token)]);

/**
 * A pending password reset.
 *
 * Separate from `invites` deliberately: the lifetimes differ by two orders of
 * magnitude and the two mean different things, so sharing a table would let a
 * reset link create an account or an invite change a password.
 *
 * Single use, and redeeming one ends every session for that user — a password
 * changed because someone else may know it has to log that someone out, not
 * merely re-issue a cookie for the person who changed it.
 */
export const passwordResets = pgTable('password_resets', {
  id: serial('id').primaryKey(),
  token: text('token').notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('password_resets_token_key').on(t.token),
  index('password_resets_user_idx').on(t.userId),
]);

/**
 * Failed authentication attempts, for rate limiting.
 *
 * Only failures are recorded, and only enough to count them: a scope, a subject
 * and a time. No password, no token, no outcome detail — a table built to stop
 * guessing should not itself become a thing worth stealing.
 *
 * The subject is an email for the per-account limit and a client address for
 * the per-source limit. Both are needed: counting only by email lets one
 * attacker work through a list of addresses unimpeded, and counting only by
 * address lets a botnet spread the same guesses across many of them.
 *
 * Rows age out rather than accumulating — anything past the window is deleted
 * on the next check, so the table stays the size of recent activity.
 */
export const authAttempts = pgTable('auth_attempts', {
  id: serial('id').primaryKey(),
  /** 'login:email', 'login:ip', 'forgot:ip', 'join:ip'. */
  scope: text('scope').notNull(),
  subject: text('subject').notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('auth_attempts_lookup_idx').on(t.scope, t.subject, t.attemptedAt)]);

/**
 * Anonymous. voter_key is a per-browser cookie UUID, not a person: it dedupes
 * repeat clicks, and identity is deliberately not recorded (§7a).
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
  // As filed, which can cover debt, pooled funds and multi-issuer structures
  // rather than cumulative venture funding. Display it with the security type.
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

/** Anonymous, as votes. The structured reasons are what make this useful. */
export const dispositions = pgTable('dispositions', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').references(() => items.id, { onDelete: 'cascade' }),
  companyId: integer('company_id').references(() => companies.id),
  voterKey: text('voter_key').notNull(),
  /** Who reacted, once they have an account. Null for pre-account rows. */
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  disposition: text('disposition').notNull(),
  reasons: text('reasons').array().default([]),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex('dispositions_item_voter_key').on(t.itemId, t.voterKey)]);

/**
 * Companies an RD chose to monitor (§11a). Their later activity surfaces in the
 * monitoring section rather than competing for a discovery slot.
 *
 * Removal sets `removedAt` rather than deleting the row: how long a company sat
 * monitored without being promoted is evidence about the company assessment,
 * and a deleted row cannot say that.
 */
export const monitoring = pgTable('monitoring', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id).notNull(),
  voterKey: text('voter_key').notNull(),
  /**
   * Who is watching, once they have an account. Null for rows written before
   * accounts existed, and for a browser that never signed in — the voter key
   * still dedupes those, they just cannot be attributed to a person.
   */
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** The item that prompted the monitor, for the "why is this here" line. */
  itemId: integer('item_id').references(() => items.id, { onDelete: 'set null' }),
  note: text('note'),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('monitoring_company_voter_key').on(t.companyId, t.voterKey),
  index('monitoring_company_idx').on(t.companyId),
]);

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
 * Institutional memory about connections: the next person who hits the same fund
 * or person sees that someone has already confirmed access, and who.
 * An unreviewed path is an association, and shows as one.
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

/** Source health. Scrapers fail quietly, so a source returning zero for three weeks surfaces here. */
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

/**
 * Entity-merge decisions. Brief §6: automated resolution reaches ~80% and the
 * last 20% needs a human.
 *
 * Both outcomes are recorded. A "these are different" decision stops the same
 * pair being re-surfaced every week, and it is evidence about where resolution
 * is weak.
 */
export const entityMerges = pgTable('entity_merges', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(),      // company | person | organization
  keptId: integer('kept_id').notNull(),
  mergedId: integer('merged_id').notNull(),
  decision: text('decision').notNull(),           // merged | distinct | unsure
  signals: text('signals').array().default([]),
  score: numeric('score'),
  note: text('note'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex('entity_merges_pair_key').on(t.entityType, t.keptId, t.mergedId)]);

/**
 * Weekly ATS job-board snapshots. Brief §5.5, step 10.
 *
 * One row per company per run, holding the job count and the APAC/non-US
 * breakdown. The week-over-week volume trigger needs a prior count to compare
 * against, which is what this table stores.
 *
 * Snapshots are kept so the trailing series distinguishes a genuine hiring ramp
 * from a one-week blip, and so there is evidence for RATIONALE §15.2, which
 * flags the APAC-posting hypothesis as untested.
 */
export const jobSnapshots = pgTable('job_snapshots', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id).notNull(),
  atsType: text('ats_type').notNull(),
  atsSlug: text('ats_slug').notNull(),
  totalJobs: integer('total_jobs').notNull(),
  nonUsJobs: integer('non_us_jobs').notNull().default(0),
  apacJobs: integer('apac_jobs').notNull().default(0),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).defaultNow(),
  runId: integer('run_id'),
}, (t) => [
  index('job_snapshots_company_idx').on(t.companyId, t.snapshotAt),
]);

/**
 * Individual postings that generated a signal, kept so an RD can check the claim
 * — brief §15: "graph edges without source_url are worthless". A digest line
 * saying "posted a Singapore role" links to the posting it came from.
 */
export const jobPostings = pgTable('job_postings', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id).notNull(),
  externalId: text('external_id').notNull(),
  atsType: text('ats_type').notNull(),
  title: text('title').notNull(),
  location: text('location'),
  url: text('url').notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  isNonUs: boolean('is_non_us').default(false),
  isApac: boolean('is_apac').default(false),
  firstSeen: timestamp('first_seen', { withTimezone: true }).defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('job_postings_company_external_key').on(t.companyId, t.atsType, t.externalId),
  index('job_postings_company_idx').on(t.companyId),
]);

/**
 * The dashboard's own quality check. Brief §7b.
 *
 * Everything upstream judges a company on its own: the extractor names it from
 * one headline, the scorer reads its window, the assessor rates it. Nothing
 * looks at the finished set and asks whether these are really thirty-four
 * distinct companies with defensible evidence.
 *
 * That is where the failures actually show. Lambda reached the dashboard three
 * times — as itself, as "Nvidia-backed Lambda" and as "Neocloud Lambda" — and
 * no per-company check could have caught it, because each row was individually
 * fine. "Defense startup" collected 88 stories about a dozen different
 * companies and looked, in isolation, like a company with strong momentum.
 *
 * So the review runs last, over the placed set, and is cheap for the same
 * reason: thirty-odd companies rather than three thousand.
 *
 * A verdict never edits a company. `duplicate_of` proposes a merge and `drop`
 * proposes a removal; both wait for a person, because an automatic merge on a
 * model's say-so would silently destroy the row it was wrong about.
 */
export const companyReviews = pgTable('company_reviews', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id).notNull(),
  /** Monday of the week reviewed, matching company_signals.week_of. */
  weekOf: date('week_of').notNull(),
  /** ok | malformed_name | duplicate | weak_evidence | not_a_company */
  verdict: text('verdict').notNull(),
  /** Where the model would merge this row, when the verdict is 'duplicate'. */
  duplicateOfId: integer('duplicate_of_id').references(() => companies.id),
  /** A cleaner name, when the one on the row is a headline fragment. */
  suggestedName: text('suggested_name'),
  /** One sentence a person can act on without re-reading the evidence. */
  reason: text('reason'),
  /** Whether the dashboard should hold this company back pending review. */
  hideFromDashboard: boolean('hide_from_dashboard').default(false),
  /** Set when a person has acted on it, so a verdict is raised once. */
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolution: text('resolution'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow(),
  rubricVersion: text('rubric_version').notNull(),
  model: text('model'),
}, (t) => [
  uniqueIndex('company_reviews_company_week_key').on(t.companyId, t.weekOf, t.rubricVersion),
  index('company_reviews_week_idx').on(t.weekOf),
]);
