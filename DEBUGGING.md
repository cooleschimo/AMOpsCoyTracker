# DEBUGGING.md

For the person on call at 11pm when a run has failed. Commands are
copy-pasteable; every SQL statement here has been run against the live database.

The pipeline runs on **GitHub Actions**, not Vercel Cron. Vercel serves the web
app and does no pipeline work. The two halves share only the Neon database, so
a broken pipeline leaves the site up and serving last week's data.

---

## 1. Where to look first

Every stage writes a `runs` row when it starts and updates it when it finishes.
A stage that is still running, or that died without cleaning up, has
`finished_at IS NULL`.

```sql
-- Did the last run finish, and what did each stage do?
select stage,
       started_at at time zone 'Asia/Singapore' as started,
       round(extract(epoch from (finished_at - started_at)))::int as secs,
       tokens_in, tokens_out,
       left(coalesce(error, ''), 80) as error
from runs
order by id desc
limit 20;
```

`secs` null with an old `started_at` means the stage was killed — a runner
timeout, or the job being cancelled. The stage is safe to re-run; nothing is
deleted and every write is idempotent on its natural key.

**Logs.** GitHub → Actions → *pipeline* → the run → the `run` job. Each stage
prints its own counts table at the end. Vercel logs carry only page requests.

**Stage names in `runs` are not the stage names in the workflow.** The runner
knows `score`; the row says `filter_score`. Map them by script:

| runner stage | `runs.stage` | script |
|---|---|---|
| context | `ingest_context` | `ingest-context.ts` |
| discover | `discover_news` | `discover-news.ts` |
| news | `ingest_news` | `ingest-news.ts` |
| sectors | `classify_sectors` | `classify-sectors.ts` |
| websites | `enrich_web` | `enrich-websites.ts` |
| people | `enrich_people` | `enrich-people.ts` |
| bios | *(none)* | `enrich-bios.ts` |
| location | `enrich_location` | `enrich-location.ts` |
| events | `events` | `ingest-events.ts` |
| ats | `ingest_ats` | `ingest-ats.ts` |
| filter | `filter_score` | `filter-score.ts` |
| ambiguous | *(none)* | `adjudicate-ambiguous.ts` |
| rescue | `rescue_mismatch` | `rescue-mismatch.ts` |
| edges | `ingest_edges` | `ingest-edges.ts` |
| score | `score_companies` | `score-companies.ts` |
| assess | `assess` | `assess-companies.ts` |
| review | `review_dashboard` | `review-dashboard.ts` |
| digest | `render_digest` | `render-digest.ts` |

Stages marked *(none)* write no `runs` row, so their failures show only in the
Actions log — check there when one of them is the suspect. `runs` also holds
stage names no current script writes (`adjudicate_ambiguous`, and the one-off
loaders `seed`, `formd`, `portfolios`, `acra`); they are history, and a stale
unfinished row under one of those names is not a stage hanging now.

---

## 2. What kind of night it was

Every run ends with a verdict, in the job summary and as a step annotation.
It is decided from state — run rows, `provider_exhaustion`, `provider_rejected`,
`source_health` — not by matching text in the log, and no model is involved:
these are patterns worth writing down, and a grep against stdout breaks the
first time a message is reworded.

| verdict | means | exit | what to do |
|---|---|---|---|
| `healthy` | every stage ran | 0 | nothing |
| `partial` | the allowance ran out; the rest waits for the caps | 0 | nothing — the backlog carries forward |
| `deadline` | stopped at the time limit | 1 | nothing — the resume step re-dispatches |
| `broken` | work that should have happened did not | 1 | read the reason; §3 below |
| `credential` | a key is rejected, not spent | 1 | replace the key; it will not come back |
| `config` | a required secret is absent | 1 | `gh secret set …` |

`partial` is deliberately green. A run that spends its allowance and skips the
rest is working as designed — each stage is `--limit` capped and picks up next
run — and a red every morning for a quota that resets on its own is a red
nobody reads.

---

## 3. The five failures you will actually see

### a. Daily token cap reached

```
halted: daily token cap approached (178579/200000); resumes next run
```

**Self-heals.** `lib/budget.ts` stops at 180K of the 200K Groq daily cap so a
final batch cannot overshoot. The stage wrote everything it got to before
stopping; the rest is picked up next run, strongest signal first.

Do nothing. If it happens every day, the backlog is growing faster than the
allowance — add a key (`GROQ_API_KEY_2`, `_3`, …) or lower a stage's `--limit`
in `lib/stages.ts`.

### b. Every provider exhausted

```
halted: every provider exhausted: gemini, groq, gemini2, groq2, openrouter, ...
```

**Self-heals** if it is the daily quota; **does not** if a key was revoked.

The run tells them apart itself. A rejected credential is recorded in
`provider_rejected` and reported as `verdict: credential`, which exits 1 and
annotates the job; a spent cap is `verdict: partial` and stays green. If you
want to check a key by hand anyway:

```bash
npx tsx scripts/dev/models.ts
```

This lists the models the first working provider offers. Output means the key
authenticates and the allowance is intact; an error means the key is dead or
spent. Gemini's quota is **per model per project**, so switching model in
`lib/env.ts` frees more allowance than adding keys.

(`scripts/dev/test-providers.ts` checks the *search* providers, not the LLM
ones — a different failure.)

### c. A malformed LLM response

The batch is dropped, the run continues, and the count shows as
`failed_chunks` or `failed_batches` in the stage's own table. **Self-heals** —
the items keep their status and are read again next run.

A `failed_batches` equal to the batch count means the response shape changed,
not one bad reply. Re-run the stage with `--dry` and read what comes back:

```bash
npx tsx scripts/weekly.ts --only score          # the stage, writing nothing
npx tsx scripts/dev/models.ts                   # is the provider even up?
```

### d. A source feed changed shape or went down

Symptom: a fetch stage finishes fast with a zero count for one source. Nothing
errors, because a dead source is not a failed run.

```bash
npx tsx scripts/dev/health.ts
```

`source_health` tracks consecutive failures per source. A source at zero for
days has changed shape or died — the fix is in `lib/news-sources.ts`, and the
existing entries carry notes about which hosts refuse what.

### e. Postgres connection limit

```
Failed query: insert into "job_postings" ...
```

Neon closes idle connections aggressively. `withRetry` in `lib/db.ts` handles
the transient case; a query that fails after retries is usually a real
constraint violation rather than a connection problem. Read the rest of the
error — the constraint name is in it.

---

## 4. Re-running one stage by hand

Locally, which is the usual case:

```bash
npx tsx scripts/weekly.ts --only score            # one stage
npx tsx scripts/weekly.ts --from filter           # that stage and everything after
npx tsx scripts/weekly.ts --daily                 # the daily set
npx tsx scripts/ingest-edges.ts --limit 200 --dry # one script, nothing written
```

`--dry` is honoured by every stage that writes. Use it first.

From GitHub: Actions → *pipeline* → **Run workflow** → pick a mode.

Over HTTP, against a deployment (§12a). `ADMIN_TOKEN`, not the dashboard token:

```bash
# What stages exist
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<host>/api/dev/score | jq

# Run one, writing nothing
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<host>/api/dev/score?dry=1" | jq

# Run one for real
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<host>/api/dev/score | jq
```

The response carries `ok`, `exitCode`, `timedOut`, `ms` and the tail of the
stage's output. A stage longer than the platform's function cap (300s on Vercel
Hobby) returns `timedOut: true` — that is the platform, not the stage failing.
Run those locally.

---

## 5. Pipeline health in one query

```sql
select started_at::date as day,
       stage,
       count(*) as runs,
       count(*) filter (where error is not null) as failed,
       count(*) filter (where finished_at is null) as unfinished,
       sum(tokens_in + tokens_out) as tokens,
       max(left(error, 60)) as last_error
from runs
where started_at > now() - interval '7 days'
group by 1, 2
order by 1 desc, 2;
```

One row per stage per day. `unfinished > 0` on an old day is a killed stage;
`failed > 0` with `runs > failed` means it retried and got through.

---

## 6. TypeScript for Python readers

Only what this codebase uses.

**`async`/`await`** works like Python's, but every `async` function returns a
Promise and **an un-awaited Promise runs anyway** — it does not wait to be
scheduled. A missing `await` is a race, not a no-op.

```ts
const rows = await sql`select 1`;              // await like Python
const [a, b] = await Promise.all([f(), g()]);  // asyncio.gather
const rs = await Promise.allSettled([f(), g()]);
// rs[0] is {status:'fulfilled', value} or {status:'rejected', reason} —
// it never throws, so check .status before reading .value
```

**`?.` and `??`**

```ts
c.hq?.city          // None-safe attribute access; undefined if hq is null
a ?? b              // b only when a is null/undefined — 0 and '' keep their value
a || b              // b when a is falsy — 0, '', false all fall through. Rarely what you want
```

**Destructuring** — tuple unpacking that also works on objects:

```ts
const { name, id } = company;        // name = company.name
const [first, ...rest] = list;       // first, *rest = list
```

**Comprehensions** are methods:

```python
[f(x) for x in xs if p(x)]           # Python
```
```ts
xs.filter(p).map(f)                  // TypeScript
xs.reduce((acc, x) => acc + x, 0)    // sum()
```

**Reading a stack trace.** Start at the top frame whose path is in this repo —
`lib/`, `scripts/`, `app/`. Frames inside `node_modules/` are the library doing
what you asked; they tell you *what* broke, rarely *why*. `at async main
(/…/scripts/foo.ts:42:15)` is the line you want.

**Types are erased at runtime.** A value typed `string` can be `undefined` if it
came from the database or JSON. The types describe intent, not a guarantee.

---

## 7. What is safe to touch

**Edit freely** — data and config, no control flow:

| file | what it holds |
|---|---|
| `lib/rubric.ts` | per-item scoring rubric. Bump `RUBRIC_VERSION` when you change it |
| `lib/company-rubric.ts` | the company axis, with its own version |
| `lib/valueprops.ts` | Singapore capabilities the model may cite. It may cite nothing else |
| `lib/blocklist.ts` | domains and patterns dropped before scoring |
| `lib/news-sources.ts` | feeds, with notes on which hosts refuse what |
| `lib/funds.ts` | the fund list |
| `lib/subsectors.ts` | sector and subsector labels |
| `lib/stages.ts` | stage order, timeouts, `--limit` values |

Rescoring under a new `RUBRIC_VERSION` keeps the old scores — `scores` is unique
on `(item_id, rubric_version)`, so you can compare before and after.

**Change carefully** — a small edit breaks the run:

| file | why |
|---|---|
| `lib/llm.ts` | provider failover and quota parsing. The daily-vs-per-minute discriminator is the structured `quotaId`, not the error prose |
| `lib/db.ts` | connection handling and `withRetry` |
| `lib/acra.ts` | entity matching. **Run `npx tsx tests/acra-match.test.ts` after any change** — 45 of 71 links were false positives before the collision-count fix |
| `lib/placement.ts` | which company appears in which section |
| `lib/enrich.ts` | entity resolution; a wrong match writes a false company |
| `middleware.ts` | the auth gate on every page |

**Tests are hand-run:**

```bash
npx tsx tests/acra-match.test.ts
npx tsx tests/events-parse.test.ts
```

---

## 8. Secrets live in two places

GitHub repo secrets (the pipeline) and Vercel project env (the web app).
Rotating a key is a **two-place operation**; changing one leaves the other
authenticating with a dead key until it next runs.

`lib/loadenv.ts` exists because `dotenv/config` reads `.env` only, not
`.env.local`. A script that skips it sees no config, which looks exactly like a
missing credential.

---

## 9. Scheduled runs stop after 60 days

GitHub disables scheduled workflows after 60 days of repository inactivity. The
symptom is no runs at all and no failure anywhere. Push any commit, or press
**Run workflow**, to re-enable.
