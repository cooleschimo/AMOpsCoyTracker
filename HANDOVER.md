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
| 7 | Warm-path query + `/company/[id]` view | ✅ done |
| 8 | Google News + wire RSS | ✅ done — 8,996 items from 121 companies + 2 wires |
| 9 | Filter, cluster, score | ✅ done — 451 cluster heads, two axes (`score` + `momentum`) |
| 10 | ATS discovery + source | ✅ done — 71 boards, aggregated to one hiring item per company |
| 11 | Digest render + placement | ✅ render done (`out/digest-*.html` + `.txt`); approval and send NOT built |
| 11 (UI) | `/item/[id]` review page + dispositions | ✅ done |
| — | `/admin/accounts` — account status by hand | ✅ done |
| 12–20 | dashboard, labelling, admin stats, drafts, edges, events, sector sources, cron, DEBUGGING.md | ❌ not started |

**A second agent is working on the dashboard, monitoring and disposition
actions.** `design/LOVABLE_PROMPT.md` is theirs. Coordinate before editing
`lib/dispositions.ts`, `lib/placement.ts`, `app/item/`, or the digest sections.

**Extra work not in the brief's numbering**, built because it was needed:

- Placement and digest render — `lib/placement.ts`, `scripts/render-digest.ts`
- Digest render, Outlook-safe — `lib/digest-render.ts`, `scripts/render-digest.ts`
- Singapore value propositions per item — `lib/proposition.ts`, drawing on
  `lib/valueprops.ts` and a site-restricted precedent search
- Account status by hand — `lib/accounts.ts`, `/admin/accounts`
- Snippet repair — `scripts/clean-snippets.ts`
- Doc-vs-code audit — `scripts/dev/doc-sync.ts`

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
company_assessments   258    (company-v1 → v4; queried by version)
items               10418    (dropped 9726 · kept 451 · duplicate 241)
scores               1494    (item-v1 → v5; queried by version)
job_snapshots         347    ← WoW baseline; volume trigger goes live next run
job_postings         8507
source_health          67
dispositions            1
digests                 0    ← render works; nothing saved or sent
```

**Current versions:** `item-v5` (adds `momentum`, two routes to a 3, why-now as
points) and `company-v4` (engagement-based Singapore fit, contribution drivers).
Both are queried by version, so earlier judgments survive for comparison.

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

## 3b. Amendments to the design, all reflected in `design/`

The docs are the spec and are current. `npx tsx scripts/dev/doc-sync.ts` checks
that every table, decision-bearing column, judgment-holding module and design
concept appears in them; it reports no gaps.

1. **Sections answer questions; signals are the evidence.** The digest is
   *worth a conversation* / *new on the radar* / *trending* / *monitoring*, not
   a block per signal type. A Singapore job posting is a reason a company
   appears, not a category.
2. **Two scoring axes.** `score` asks whether a location decision is open, by
   either explicit Asia intent or an open location decision at a company with
   traction and no Asia mention. `momentum` asks whether the company is moving
   fast. Trending ranks on momentum; discovery on the trigger plus the company
   assessment.
3. **Account status is ranked on in discovery, ignored in trending.** An
   existing account is not a discovery; a fast-moving company EDB already meets
   is exactly where a joint project becomes possible.
4. **Singapore fit is judged against a plausible engagement**, not whole-company
   relocation, and `potential_contribution` names the one or two dimensions its
   band rests on.
5. **The value proposition is selected from `lib/valueprops.ts`, never invented**,
   with a site-restricted search for public precedent. The model may cite only a
   url it was given.
6. **ATS emits one aggregated hiring item per company**, characterised by
   function and seniority, with a materiality floor mirroring §5.5's volume
   floor. Individual postings stay in `job_postings`.
7. **No internal team routing.** The tool has no knowledge of EDB's org
   structure and a plausible wrong team is worse than no line.

## 3c. Open calibration issues

1. **`dropped_blocked_domain` is structurally 0** for news. Google News wraps
   every link on `news.google.com`, so the publisher domain is never in the URL.
   `blockedSourceName()` matches `items.source` instead and drops 615 — the
   domain stage stays inert for that feed and always will.
2. **61% of items dropped as stale.** Google returns ~100 items per company
   regardless of age; only ~950 fell inside the 10-day window. Confirm 10 days
   is right before treating the drop rate as a problem.
3. **50 of 121 companies have no ATS board.** Slug guessing from name and domain
   found 71. The rest need their careers page located by hand or by search — a
   one-time backfill, since `companies.ats_slug` is cached.
4. **The volume trigger has never fired.** 347 snapshots exist but the
   week-over-week comparison needs a second ATS run. It goes live then.
5. **Seed companies have no people.** All 314 roles attach to Form D companies,
   so warm paths are thin for exactly the companies that matter most. §8 ranks
   person-mediated paths highest, and there are none for the seed list.
6. **The token budget halts the run before the provider chain is consulted** —
   see BLOCKERS §8. Worked around with `LLM_CHAIN`; the accounting needs to be
   per provider.

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

- **A feed's markup came back after the tags were stripped.** `tagText` stripped
  HTML and then decoded entities, so a description carrying escaped markup —
  Google News nests an escaped `<ol>` of related articles in every one — had its
  tags resurrected after the stripper had run. 8,967 of 10,418 snippets were
  stored as raw markup, and the snippet goes into the SCORING PROMPT, so the
  model was reading `<a href="https://news.google.com/rss/...">` as evidence
  about a company. **Decode first, strip second, repeat until stable.**
  `scripts/clean-snippets.ts` repaired the stored rows.

- **A digest link nobody can open.** Google News RSS links are ~400-character
  redirect wrappers whose target is base64 in the path and not reliably
  decodable. They resolve in a browser but are useless to read, so plaintext
  names the publisher instead. Separately, hard-paywalled sources now rank below
  open ones when choosing a cluster head — checking the claim is the point, and
  a report an RD cannot open cannot be checked. That moved 12 paywalled heads
  down to 7, the rest being Bloomberg stories with no open alternative.

- **A vendor lookup resolves a name, not a company.** Backfilling from CB
  Insights by company name returned, alongside the right answers: a 1996
  Massachusetts life-sciences SaaS firm for "Cognition" (the AI coding company),
  a Buenos Aires swimwear brand for "Chroma" (the vector database), and a
  Georgia IT-training provider for "GenSpark" (the AI search company). Each came
  back with a full funding history that would have loaded cleanly and read as
  fact. The vendor is not at fault — it returns the best match for a string and
  lists alternates — but a name is not an identity. **Check the description
  against what the company actually does before loading a vendor row**, and
  prefer the vendor's own id once a match is confirmed.

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

## 5b. Sources verified but not built

Probed 2026-08-26. Keys are in `.env.local`; nothing calls these yet.

| source | status |
|---|---|
| EDGAR full-text (`efts.sec.gov`) | works, no key — **built** in `lib/entry-signals.ts` |
| ClinicalTrials.gov v2 | works, no key — **built**; filter out Singapore institutions or local hospital trials swamp the result |
| USASpending | works, no key |
| GLEIF | works, no key |
| Hacker News (Algolia) | works, no key |
| OpenCorporates | 401 without a key; free tier is ODbL share-alike — see `design/OPENCORPORATES_OBLIGATIONS.md` |
| USPTO / TSDR | 401; a key becomes mandatory October 2026 |
| SBIR awards API | **403 to server requests on both documented endpoints.** The brief calls SBIR the primary discovery route for `defence_tech`, so this is a real gap. USASpending may cover federal awards instead |

---

## 6. Immediate next steps

1. **Events (step 17)** — the one digest section with no data behind it.
   `events` and `event_participants` are empty. Parsing conference speaker and
   exhibitor lists answers a question RDs actually have: *who from our list will
   be at SEMICON West, and can we get a meeting?* Nobody is working on it.
2. **Approval and send (step 11's other half)** — the render works and writes to
   `out/`; nothing saves a digest row or sends. §13 requires testing the Outlook
   render against a real address, which needs the send path first.
3. **Second ATS run** — brings the volume trigger live.
4. **ATS slug backfill** for the 50 unresolved companies.

**Sources still unbuilt**, with a caveat: the brief calls SBIR the *primary*
discovery route for `defence_tech` and ClinicalTrials *primary* for `biotech`,
yet §12 schedules both at step 18 and lists them first in the cut list. If those
sectors matter, promote them. IPOS trademarks and EDB press releases appear in
§5.4 but are **not scheduled anywhere** in §12.

**The 7 topic queries in `lib/news-sources.ts` are built but never run.** They
are the untargeted discovery channel — company-directed news can only ever
confirm companies already on the list.

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
