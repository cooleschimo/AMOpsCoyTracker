# Signal tracker

Watches ~3,300 US companies for signs they are making a location decision,
judges what it finds against a fixed set of criteria, and publishes a weekly
shortlist with every claim carrying the source it came from.

Built for investment promotion — the problem of finding foreign companies worth
approaching before they have chosen where to go. The same shape applies to any
task where the useful signal is a few dozen items inside ninety thousand.

```
90,047 news items collected  ->  12,852 kept  ->  ~30 companies surfaced a week
```

The digest is the visible output. The connection graph behind it — who works
where, who funded whom, which companies are tied to each other — is the part
that is hard to buy, because news is a commodity and a warm introduction is not.

---

## Architecture

Two halves that share only a database:

| Half | Runs on | Does |
|---|---|---|
| Pipeline | GitHub Actions | fetch, filter, score, assess, render |
| Web app | Vercel | dashboard, company pages, graph, digest approval |
| Database | Neon Postgres | the seam |

**Why the split.** Vercel Hobby caps functions at 300 seconds and cron at once
daily. Reading ~112 news feeds and ~34 fund sites does not fit in 300 seconds,
so the pipeline runs as a scheduled Actions job with a six-hour ceiling and the
web app does no pipeline work. The cost is two deploy targets and secrets in two
places; rotating a key is a two-place operation.

**Why Postgres and not a queue.** Every stage is idempotent on a natural key and
writes its own `runs` row. A stage that dies is re-run, not resumed, which
removes the need for any coordination beyond the database.

---

## The pipeline

Nineteen stages in four phases, one command, in dependency order:

```
GATHER   context -> discover -> news
ENRICH   sectors -> websites -> people_funds -> people_companies -> bios
         -> location -> events -> ats
JUDGE    filter -> ambiguous -> rescue -> edges -> score -> assess
PUBLISH  review -> digest
```

```bash
npx tsx scripts/weekly.ts              # everything
npx tsx scripts/weekly.ts --daily      # skips events, review, digest
npx tsx scripts/weekly.ts --only score # one stage
npx tsx scripts/weekly.ts --from filter
```

A stage that fails does not stop the run — a news source timing out should not
cost the week's judgment — and the summary names what failed. Every stage is
capped with `--limit` and picks up its backlog next run, so one run cannot drain
the day's model allowance.

Ordering is load-bearing in two places. Discovery runs before the per-company
news search, because the search only asks about companies already in the table;
running news first meant a company found on Tuesday was judged on the single
headline that surfaced it. Sector classification runs before website resolution,
because the same-name check reads the sector — it is what separates a defence-AI
company called Aslan from a Thai finance site at `aslan.ai`.

---

## How judgment works

Cheap deterministic filters first, a model only where a rule cannot decide.
Of 90,047 items collected, 12,852 survive:

1. Canonicalise the URL, strip tracking parameters, exact dedupe
2. Domain blocklist
3. Pattern drop — "10 best…", "startups to watch", "stocks to buy"
4. Company match — the name or an alias must appear in the title or snippet
5. Recency — older than 10 days
6. Near-duplicate clustering; only the cluster head is scored

Nothing is deleted. Every dropped item keeps its row and a `dropped_reason`, so
a filter that starts over-dropping is visible immediately rather than silently
shrinking the input.

**Where the model earns its place.** Some tracked companies are named after
ordinary words — Sierra, Harvey, Clay, Ring, Motion. Rules settle most cases by
corroboration: does the domain, the HQ city, or a sector term appear alongside
the name? What survives is genuinely undecidable by rule:

> *"Update on Harvey's Post-Training Effort"* — only the name. Is the company.
>
> *"Man dies in crash near Harvey, North Dakota"* — only the name. Is not.

Beyond disambiguation the model scores two axes per company (is a location
decision open, is there an opening to propose into), writes an accumulative
assessment, and extracts structured facts — locations, sectors, company-to-company
relationships — out of prose.

Model calls go through a failover chain across three providers and fifteen keys,
because every provider here is on a free tier with its own daily cap. A spent key
is marked exhausted and skipped rather than retried; the chain rotates its
starting point so no single account carries a whole stage.

---

## Rules the code enforces

These are deliberate and load-bearing.

- **Nothing fetched is deleted.** Filters set `status` and `dropped_reason`.
- **Roles are never deleted.** Departure sets `last_seen` — someone who left two
  years ago and now runs a target company is exactly the path worth having.
- **Every graph edge carries `source` and `source_url`.** An unsourced edge is
  worse than none, because it cannot be checked before acting on it.
- **An unreviewed path is never called a warm introduction.** Graph structure
  proposes an association; a person confirms it.
- **Tri-state, never boolean**, for anything the tool cannot verify.
- **Amounts from regulatory filings are never presented as "total raised"** —
  the security type travels with the figure.
- **The model may cite only a URL it was given**, and picks propositions from a
  fixed list rather than inventing them.

---

## Setup

Requires Node 20+ and a Postgres database.

```bash
npm install
cp .env.example .env.local        # fill in — see below
npm run db:push                   # create the schema
npx tsx scripts/preflight.ts      # verify DB, model providers and endpoints
npx tsx scripts/load-exclusions.ts
npm run dev
```

`preflight.ts` checks each credential and endpoint in turn and prints a pass or
fail line for each, so a misconfigured key is visible before a run rather than
four stages in.

### Services

| Service | Purpose | Free tier |
|---|---|---|
| [Neon](https://neon.tech) | Postgres | 0.5 GB |
| [Groq](https://console.groq.com) | scoring, assessment | 200K tokens/day |
| [Google AI Studio](https://aistudio.google.com) | failover | per-model daily cap |
| [OpenRouter](https://openrouter.ai) | failover | 50 requests/day |
| [Resend](https://resend.com) | digest email | 100/day |
| [Vercel](https://vercel.com) | web app | Hobby |

SEC EDGAR, ACRA, ClinicalTrials, Greenhouse, Lever, Ashby and Google News need
no keys, which is why they were chosen as primary sources.

`SEC_USER_AGENT` must be a real, reachable `"Name email@domain"` — the SEC
blocks IPs sending fake ones.

### Environment

`DATABASE_URL` and one model key are the minimum. Everything else degrades
gracefully: a provider without a key is skipped, a search provider without a key
falls through to the next.

```
DATABASE_URL           Postgres connection string
GROQ_API_KEY           primary model provider  (_2, _3, _4 for more allowance)
GEMINI_API_KEY         failover                (_2, _3, _4)
OPENROUTER_API_KEY     failover
LLM_CHAIN              explicit failover order, comma-separated labels
SEC_USER_AGENT         "Name email@domain" — required by the SEC
RESEND_API_KEY         digest email
ADMIN_TOKEN            bearer credential for /api/admin and /api/dev, which
                       scripts call without a browser. Web access is a session:
                       an account or a guest, never a shared secret.
DIGEST_TEST_MODE       defaults true; confines all mail to the test recipient
```

---

## Backfilling from CB Insights

Funding history, investors and people can be backfilled from CB Insights. The
data is licensed to the account that pulls it, so no exports are committed here
— each user generates their own, and `data/*_cbi.csv` is gitignored.

Two access routes:

- **Interactive.** The hosted MCP server, authenticated over OAuth. Nothing to
  configure in this repo beyond registering the server with your MCP client.
- **Programmatic.** `CBI_CLIENT_ID` and `CBI_CLIENT_SECRET` in `.env.local`, via
  the `client_credentials` grant, using the same credentials as their API.

The flow, once you have results saved:

```bash
npx tsx scripts/dev/cbi-extract.ts <result.json>   # -> data/investors_cbi.csv, data/funding_cbi.csv
npx tsx scripts/load-funding.ts [--dry]
npx tsx scripts/load-funds.ts  --file data/funds_cbi.csv  [--dry]
npx tsx scripts/load-people.ts --file data/people_cbi.csv [--dry]
```

Every loader takes `--dry`, which parses and reports without writing.

**Resolve by domain, not by name.** A name lookup returns whichever company the
vendor matched first: querying "Cognition" returned a 1996 life-sciences firm and
"Chroma" a Buenos Aires swimwear brand, each with a complete funding history that
would have loaded cleanly and read as fact. `lib/cbi-resolve.ts` resolves on
domain for this reason. The vendor also holds no market cap or headcount for
listed companies at any preset, so those are read from filings instead.

---

## Operations

`DEBUGGING.md` covers where to look when a run fails: the five failures that
actually occur with their log signatures, how to re-run a stage by hand, and a
single query for pipeline health over the last week.

```bash
npx tsx scripts/dev/counts.ts      # row counts across the graph
npx tsx scripts/dev/health.ts      # source health
npx tsx scripts/dev/models.ts      # models your provider account offers
npx tsx tests/acra-match.test.ts   # run after touching entity matching
npx tsx tests/cbi-resolve.test.ts
npx tsx tests/events-parse.test.ts
```

Tests are hand-run rather than a suite. Each pins behaviour that took several
attempts to get right — entity matching against a company registry, vendor
lookups resolving to the wrong company, and conference date parsing, where
"26 - 28 May 2027" parsed as a single day and silently lost the start date on
every non-US show.

---

## Safe to edit

`lib/rubric.ts`, `lib/company-rubric.ts`, `lib/valueprops.ts`, `lib/funds.ts`,
`lib/news-sources.ts`, `lib/blocklist.ts`, `lib/stages.ts`, `data/*.csv` —
content and configuration. Scoring changes want a `RUBRIC_VERSION` bump, since
`scores` is unique on `(item_id, rubric_version)` and old scores survive for
comparison.

Handle with care: `lib/llm.ts` (provider failover and quota parsing),
`lib/db.ts`, `lib/acra.ts` (entity matching — run its test), `lib/placement.ts`
(which company appears where), `middleware.ts` (the auth gate).

---

## Access model

Everyone signs in, and a session is the only way in. **An account** —
invite-only, email and password — identifies a person: what they monitor and
dismiss is attributed to them and visible to the team. **A guest** clicks
"Continue as a guest" and gets a session with no account behind it.

A guest reads what has already been scored and assessed: the week, companies,
people, investors, items and the connection graph. They cannot act on any card,
and cannot see monitoring, dismissals, the unassessed backlog, or what Singapore
could offer a company.

There is no shared URL secret. `DASHBOARD_TOKEN` is gone: it admitted anyone
holding a link, and could only be revoked by rotating it for everyone. A guest
session is one row, expires in seven days, and can be dropped on its own.
`ADMIN_TOKEN` survives only as a bearer credential for the machine-facing
routes under `/api/admin` and `/api/dev`, which scripts call without a browser;
`/admin` pages now key on an account's `admin` role. `DIGEST_TEST_MODE` defaults to true and confines every send to the
test recipient; the mode is stored on each digest row, so a rehearsal is still
distinguishable from a real send a fortnight later.
