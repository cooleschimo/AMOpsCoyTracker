# Handover — state, decisions, and what to do next

Written 2026-08-24 at the end of a long session. Read this plus `BLOCKERS.md`
before continuing. The design docs in `design/` are the spec; this file records
what has been **built against them** and which of their rules were **amended**.

---

## 1. Where the build is

Brief §12 build order, actual status:

| step | task | status |
|---|---|---|
| 1 | Repo, Neon, schema, seed | ✅ done |
| 2 | `lib/llm.ts` — budget, throttle, retry, JSON repair | ✅ done |
| 3 | EDGAR Form D → companies + people + roles | ✅ done |
| 4 | Entity resolution + `/admin/merge` | ✅ done |
| 5 | VC portfolio scraping → organizations + investments | ✅ done |
| 6 | ACRA bulk load + resolution → `sg_links` | ✅ done |
| 7 | Warm-path query | ✅ query done; `/company/[id]` view NOT built |
| 8 | Google News + wire RSS | ✅ done — 8,996 items from 121 companies + 2 wires |
| 9 | Filter, cluster, score | ⚠️ cascade done; **288 of 651 heads scored** (free-tier caps) |
| 10 | ATS discovery + source | ✅ done — 71 boards, aggregated to one hiring item per company |
| 11–20 | digest, dashboard, labelling, admin, drafts, edges, events, sector sources, cron, DEBUGGING.md | ❌ not started |

**Extra work not in the brief's numbering**, built because it was needed:

- Company-level assessment (§7a) — `lib/company-rubric.ts`, `scripts/assess-companies.ts`
- Website enrichment — `lib/enrich.ts`, `scripts/enrich-websites.ts`
- People scraping from fund/company team pages — `lib/people-scrape.ts`, `scripts/ingest-people.ts`
- Pluggable web search with failover — `lib/search-providers.ts`
- EDGAR industry → sector mapping — `lib/edgar-industry.ts`
- Manual vendor enrichment — `scripts/load-manual.ts`, `data/manual_enrichment.csv`

---

## 2. Current data

```
companies            2824    (portfolio 2596 · form_d 116 · seed 112)
  with website        629    (was 115 before domain recovery)
people                570
roles                 314    (Form D + company team pages)
affiliations          333    (person → fund, from fund team pages)
organizations         103
investments          2853
sg_links               91
sec_filings           116
company_assessments    31
items               10418    (dropped 9726 · kept 651 · duplicate 41)
scores                492    (item-v1 204 · item-v3 288)
job_snapshots         347    ← WoW baseline; volume trigger goes live next run
job_postings         8507
source_health          67
```

**Scoring is incomplete on purpose.** 363 cluster heads have no `item-v3` score:
all three free LLM tiers were exhausted in one day. `npx tsx
scripts/filter-score.ts --rescore` resumes; it scores only heads missing a score
at the CURRENT `RUBRIC_VERSION`, so it is safe to re-run.

---

## 3. Decisions that changed the design docs

These are amendments the product owner made. **Do not silently revert them.**

1. **`rds` table removed** (RATIONALE §7a). Voting is anonymous; `votes` and
   `dispositions` key on a per-browser `voter_key` cookie UUID, not a person.
   Dashboard access is one shared `DASHBOARD_TOKEN`.
2. **GitHub Actions runs the pipeline, Vercel serves only the web app**
   (BRIEF §3a). Vercel Hobby cron is once-daily with a 300s function cap;
   Actions gives 6h jobs. The two halves share only the Neon database.
3. **`llama-3.3-70b-versatile` is delisted from Groq.** Both model env vars
   point at `openai/gpt-oss-120b`, confirmed present on the account.
4. **LinkedIn: partially un-excluded** (RATIONALE §14, amended). Still never
   fetch linkedin.com ourselves; linkedin.com URLs returned by a third-party
   search index are now permitted. Anything derived from a snippet must be
   written `probable` with its source URL.
5. **SERP resellers permitted.** Serper is wired. The Google v. SerpApi
   litigation is Google's dispute with the reseller, not with its customers;
   the realistic downside is the service disappearing, which the provider
   failover already handles.
6. **CB Insights permitted** (RATIONALE §14, corrected). Their hosted MCP
   server documents a `client_credentials` grant for programmatic access, so
   both interactive and pipeline use are sanctioned by the vendor.
7. **Enums widened to match seed data**: `series_<X>_ext` (e.g. `series_b_ext`),
   and `non_west_coast_hq` added to the exclusion-reason enum.

---

## 3b. Amendments made during the step 8/9/10 session (2026-08-24)

1. **ATS emits ONE aggregated hiring item per company, not one per posting.**
   §5.5 says "emit a synthetic item for any non-US posting"; taken literally
   that made every job listing a candidate digest line — 231 for Databricks
   alone — and fed the scorer uniform batches, the condition behind the
   anchoring failure in §4. Postings stay in `job_postings` with their URLs so
   every number remains checkable. RATIONALE §4 updated.
2. **The item rubric no longer infers sectors.** It was tagging a web-search
   company `biotech` and adding `deeptech` to most AI firms. The company record
   is research-verified; the model now copies it.
3. **A materiality floor on hiring items** (`hiringItemIsMaterial`). "1 open
   APAC role" scored a 3 in the first run. Now needs a Singapore role, ≥2 APAC
   roles, or a director-level APAC hire — mirroring §5.5's floor on the volume
   trigger.
4. **The 0-3 rubric was widened to two routes to a 3** (`item-v3`). Route (a) is
   explicit Asia intent; route (b) is an OPEN LOCATION DECISION at a company
   with traction and no Asian commitment yet — a large raise, a new plant, a
   first international hire. The product owner's point: AM Ops exists to attract
   companies that have not decided, not only to detect those already going.
   `expansion_language: false` on a 3 is what an untapped prospect looks like.
5. **Multi-provider LLM failover** in `lib/llm.ts`. A daily-cap 429 moves to the
   next provider instead of sleeping; a malformed response does not.

---

## 3c. Open calibration issues — decide before building the digest

1. **Clustering is too strict.** 13 companies produced multiple score-3 items
   for ONE event (Perplexity ×6 on the same Nvidia deal, Castelion ×6). The 0.7
   Jaccard threshold is what RATIONALE §5 warned would need calibrating. A
   digest built on this would repeat itself.
2. **`dropped_blocked_domain` is structurally 0** for news. Google News wraps
   every link on `news.google.com`, so the publisher domain is never in the URL.
   `blockedSourceName()` matches `items.source` instead and drops 615 — but the
   domain stage stays inert for that feed.
3. **61% of items dropped as stale.** Google returns ~100 items per company
   regardless of age; only ~950 fell inside the 10-day window. Confirm 10 days
   is right before treating the drop rate as a problem.
4. **50 of 121 companies have no ATS board.** Slug guessing from name and domain
   found 71. The rest need their careers page located by hand or by search —
   a one-time backfill, since `companies.ats_slug` is cached.

---

## 4. Bugs found by testing, and what they teach

Each of these looked fine until checked against live data. Expect more of the same.

- **EDGAR daily index dates are `YYYYMMDD`, not `YYYY-MM-DD`.** The parser
  silently returned zero rows.
- **ACRA name matching took five attempts.** Neither string length nor
  dictionary membership identifies a "distinctive" name — `decagon` and
  `parallel` are ordinary words; `anthropic` and `perplexity` are real words
  that are unmistakable company names. What works is **collision count**: how
  many registry entities share the identity. `tests/acra-match.test.ts` has 21
  hand-verified cases; **run it after touching `lib/acra.ts`**.
- **45 of 71 ACRA links were false positives** before that fix (HADRIAN KHOO — a
  person — for Hadrian; N K CHIN CHEST & MEDICAL CLINIC for Noah Medical).
  Purged and re-run.
- **Portfolio pages already contain company websites**, in sibling elements
  rather than the same anchor. Reading them recovered 514 domains with zero API
  calls. Check the page structure before reaching for a search API.
- **Batch anchoring in LLM scoring**: a batch of entirely unrecognised companies
  made the model answer "unknown" for all of them, including one it identified
  correctly when mixed with familiar names. `lib/company-rubric.ts` has an
  explicit independence instruction. **Watch for this in step 9 scoring.**
  *Outcome:* `scripts/filter-score.ts` interleaves items across companies so no
  batch is one company's news, and warns on any batch returning a single
  distinct score. Zero uniform batches across 46 batches.
- **A per-minute rate limit read as a daily cap.** `lib/llm.ts` decided a 429
  meant "provider exhausted, fail over" by pattern-matching the error prose,
  and the pattern included the bare word `quota`. Google's PER-MINUTE message
  is "Quota exceeded for metric: ...generate_content_free_tier_requests,
  limit: 20 ... Please retry in 45s" — so every rate limit was misread as
  exhaustion and each Gemini key was abandoned after ONE 429 instead of waiting
  45 seconds. Symptom: 28 "gemini exhausted" events in a single run, a second
  key appearing to burn out in ~6 batches, and 24 items failing on a Cerebras
  402 at the end of the chain. Neither key was ever near its limit — Gemini
  free tier is 20 RPM / ~9,000 RPD, i.e. ~108,000 items/day at 12 per request.
  **Neither the prose nor the retry delay distinguishes the two cases.** Google
  returns a SHORT `retryDelay` (~21s) even on a DAILY quota, so "short delay
  means wait" is also wrong. The reliable discriminator is the structured
  `quotaId` in the QuotaFailure detail:
  `GenerateRequestsPerDayPerProjectPerModel-FreeTier` (daily, fail over) vs
  `...PerMinute...` (wait). `lib/llm.ts` now parses that.

  **Corrected 2026-08-24:** an earlier reading of this bug concluded the keys
  were never exhausted and capacity was ample. That was wrong — the daily quota
  on gemini-3.6-flash really is 20 requests, and both keys really were spent.
  The misclassification bug was real, but it was hiding a genuine cap, not
  inventing one.

- **Same-name-different-company is the main false-positive risk.**
  AMPLIFICA HOLDINGS (biotech) matched both a US marketing agency and a Chilean
  logistics firm, each serving a real page. Absence of a contradiction is not
  evidence; `lib/enrich.ts` now requires positive industry corroboration.

---

## 5. Verified external facts (do not re-trust the brief on these)

| claim | reality, verified 2026-08-24 |
|---|---|
| Vercel Hobby cron | once per day, ±59 min; 300s function cap |
| Groq free tier | 30 RPM · 8K TPM · 1K RPD · 200K TPD on gpt-oss-120b |
| SEC EDGAR | 10 req/s limit; daily index date is `YYYYMMDD` |
| Google News RSS | works, 100 items per company query |
| Business Wire | only via `feed.businesswire.com`; the `www` host 403s |
| PR Newswire | works, 20 items |
| GlobeNewswire | **connection failure on 4 URL variants — disabled** |
| Greenhouse / Ashby | work, no keys |
| Lever | works; 404s are companies not using Lever, not a broken API |
| ACRA | CKAN `datastore_search`; all 27 letter-datasets enumerated |
| Brave Search | **free tier killed Feb 2026**, card now required |
| Bing Web Search | **retired Aug 2025**, returns 410 |
| Google CSE | **closed to new customers Jan 2026** |
| Self-hosted SearXNG | blocked within minutes from residential IPs — don't |

**LLM providers, verified 2026-08-24.** The chain in `lib/env.ts:llmProviders()`
skips any provider without a key, so a dead one can be left configured harmlessly.
Default order is `gemini, gemini2, groq, openrouter, groq2`: both Gemini keys
first, primary Groq next, OpenRouter next, and the second Groq key as the last
resort.

| provider | reality |
|---|---|
| Groq `openai/gpt-oss-120b` | works; 200K tok/day. Multiple keys are supported as `GROQ_API_KEY`, `GROQ_API_KEY_2`, ... and appear as `groq`, `groq2`, ... in failover logs. Spends ~43% of output on internal reasoning, which is billed — 3,013 output tokens on a 12-item batch |
| Google AI Studio `gemini-3.6-flash` | works, and is **~5× cheaper per item** (611 output tokens on the same batch). But the free-tier quota is **20 requests PER DAY** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, quotaValue 20) ≈ 240 items/key/day at 12 per batch — NOT the 9,000 RPD published for older Flash models. `gemini-2.5-flash` is closed to new users |
| Gemini quota is **per model per project** | so `gemini-flash-latest` and `gemini-3.1-flash-lite` have their own separate allowances on the SAME key, and both had headroom when 3.6-flash was spent. Switching model is a bigger lever than adding keys |
| OpenRouter `openrouter/free` | works. An auto-router over whatever is currently free — `deepseek-chat-v3.1:free` was withdrawn within an hour of being configured, so pin the router, not a model |
| Cerebras | **402 Payment Required** on inference for every model, including `gpt-oss-120b` and `gemma-4-31b`. The key authenticates (`GET /models` → 200); it is a billing entitlement, not a bad key or model id |
| Together AI | **no longer free** — trial credits withdrawn for new signups, $5 prepaid minimum |
| GitHub Models | **HTTP 410 `github_models_retirement_brownout`** on every endpoint — being retired, not worth wiring |
| Mistral | endpoint live (401 without a key); never keyed, so untested here |

**Free tiers close constantly.** Within this build: Brave (Feb 2026), Bing
(Aug 2025), Google CSE (Jan 2026), GitHub Models (retiring), Together
(prepaid), Cerebras (gated), plus one OpenRouter model withdrawn mid-session.
Every provider is OpenAI-compatible and selected by a string precisely so
replacing one is a config change.

---

## 6. Immediate next steps

1. **Step 8 + 10 together** — news ingestion into `items` AND ATS job boards.
   Do both before scoring: the co-occurrence rule ("an APAC job posting plus a
   recent raise is a 3") needs both signal types to exist, or the step 9 review
   gives a misleading picture.
2. **Step 9** — filter, cluster, score. **This is the agreed stopping point**:
   show the product owner real scored headlines (score, signal type, sector,
   `why`) plus per-stage drop counts, before building the digest.
3. Then: `/company/[id]` view (step 7's UI half), digest, dashboard.

**Sources still unbuilt**, with a caveat: the brief calls SBIR the *primary*
discovery route for `defence_tech` and ClinicalTrials *primary* for `biotech`,
yet §12 schedules both at step 18 and lists them first in the cut list. If those
sectors matter, promote them. IPOS trademarks and EDB press releases appear in
§5.4 but are **not scheduled anywhere** in §12.

---

## 7. Operational notes

- **Run scripts with `npx tsx scripts/<name>.ts`.** Long ones exceed the 2-minute
  tool timeout — run them backgrounded and poll.
- **`lib/loadenv.ts` exists because `dotenv/config` reads `.env` only.** Scripts
  that skip it see no config, which looks exactly like a missing credential.
- **CB Insights is a claude.ai connector**, not a repo `.mcp.json`. Adding one
  creates a duplicate, unapproved server entry. Its tools load at session start.
- **Search providers**: `SEARCH_PROVIDER` picks the first choice; the chain
  fails over automatically on quota/auth errors. All five work. There is a hard
  3,000-request ceiling per process against runaway billing.
- **Dev helpers** in `scripts/dev/` — `counts.ts`, `health.ts`, `paths-report.ts`,
  `report-step1.ts`, `test-providers.ts`, `check-merges.ts`.

---

## 8. Rules the code enforces — do not optimise these away

- Nothing fetched is ever deleted; filters set `status` + `dropped_reason`.
- Roles are never deleted; departure sets `last_seen`.
- Every graph edge carries `source` **and** `source_url`.
- A Form D director is an association, not a fund relationship.
- Form D amounts are never "total raised" — security type travels with them.
- An unreviewed path is never called a warm introduction.
- Tri-state, not boolean, for `account_status` and `sg_match_status`.
- LLM batches of 10–15; one malformed response must never kill a run.
