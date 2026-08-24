# FDI Discovery, Connection and Intelligence Tool

Finds US companies in scope that EDB does not already track, maps who is
connected to them, and emails a weekly digest of what changed.

Three capabilities, in priority order:

1. **Discovery** — companies in scope that are not already tracked
2. **Connection** — for any company: who are the people, who funded them, and
   what path might exist
3. **News** — a weekly digest of what changed

The digest is the visible output. The connection graph is what makes the tool
worth having, because news is a commodity and warm paths are not.

Design documents live in [`design/`](design/) — `BUILD_BRIEF.md` is the spec,
`DESIGN_RATIONALE.md` records why each decision was made.

---

## Architecture

The deployment is **split**, and the two halves share only the database:

| Half | Runs on | Does |
|---|---|---|
| Pipeline | GitHub Actions (`.github/workflows/pipeline.yml`) | fetch, parse, score, assemble |
| Web app | Vercel | dashboard, company view, admin, digest approval |
| Database | Neon Postgres | the seam between them |

**Why not Vercel Cron:** verified 2026-08-21 that Vercel Hobby caps cron at once
per day (±59 min) and functions at 300s hard maximum. Scraping ~34 fund sites and
~112 news feeds does not fit in 300s. GitHub Actions gives 6h jobs and arbitrary
schedules, so pipeline stages are written to complete rather than to bail out.
See `design/BUILD_BRIEF.md` §3a.

**Cost of the split:** two deploy targets, and secrets in two places (GitHub repo
secrets for the pipeline, Vercel env vars for the web app). Rotating a key is a
two-place operation.

---

## Security posture — read this before sharing anything

- **Dashboard access is a shared secret, not authentication.** `/d/[token]`
  is guarded by an unguessable UUID in the URL. Anyone with the link has full
  access. Real auth is out of scope for the MVP (brief §14).
- **Reactions are anonymous.** There is no user table. Votes and dispositions
  are keyed on a per-browser cookie UUID (`voter_key`) that identifies a
  browser, not a person. See `DESIGN_RATIONALE` §7a.
- **`DIGEST_TEST_MODE=true` is the default** and confines all mail to
  `DIGEST_TEST_RECIPIENT`. Nothing sends without an explicit approval click.
- **Nothing is ever emailed to a company.** Drafts appear in the dashboard for
  a human to copy and edit.
- **`companies.notes` stays empty.** It is reserved for EDB-internal account
  history, which must not live on personal infrastructure.

---

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in
npx tsx scripts/preflight.ts   # verifies DB, Groq and SEC connectivity
npm run db:push                # create the schema
npm run seed                   # load 112 companies + 17 exclusions
```

### Accounts needed

| Service | Purpose | Free tier |
|---|---|---|
| [Neon](https://neon.tech) | Postgres | 0.5 GB |
| [Groq](https://console.groq.com) | scoring + drafting | 200K tokens/day |
| [Resend](https://resend.com) | digest email | 100/day |
| [Vercel](https://vercel.com) | web app | Hobby |

SEC EDGAR, ACRA, SBIR, ClinicalTrials, Greenhouse/Lever/Ashby and Google News
need **no keys** — which is why they were chosen.

`SEC_USER_AGENT` must be a real, reachable `"Name email@domain"`. The SEC blocks
IPs that send fake ones.

---

## Running the pipeline

```bash
npx tsx scripts/ingest-formd.ts --days 3        # SEC Form D -> companies, people, roles
npx tsx scripts/ingest-formd.ts --days 1 --dry  # parse and report, write nothing
```

Useful flags: `--limit N` caps filings processed, `--all-states` disables the
west-coast filter, `--dry` skips all writes.

Dev helpers:

```bash
npx tsx scripts/dev/counts.ts        # row counts across the graph
npx tsx scripts/dev/report-step1.ts  # seed + Form D review report
npx tsx scripts/dev/models.ts        # models available on your Groq account
```

---

## Rules the code enforces

These are load-bearing. `DESIGN_RATIONALE.md` explains why each exists.

- **Nothing fetched is ever deleted.** Filters set `status` and `dropped_reason`.
  The dropped set is training data and cannot be rebuilt later.
- **Roles are never deleted.** Departure sets `last_seen`. A person who left two
  years ago and now runs your target company is exactly the path you want.
- **Every graph edge carries `source` and `source_url`.** An unsourced edge is
  worse than no edge, because an RD cannot check it.
- **A Form D director is an association, not a fund relationship.** The filing
  proves a board seat; the person→fund edge needs independent evidence.
- **Form D amounts are never "total raised".** They can cover debt, pooled funds
  and multi-issuer structures, so the security type travels with the amount.
- **An unreviewed path is never called a warm introduction** anywhere in the UI
  or email.
- **Tri-state, not boolean**, for anything the tool cannot verify —
  `account_status` and `sg_match_status` both default to unknown.
- **No LinkedIn access of any kind.** Documented public endpoints only.

---

## Files a non-TypeScript maintainer can edit safely

`lib/valueprops.ts`, `lib/funds.ts`, `lib/rubric.ts`, `data/*.csv` — content and
config, human-maintained.

Handle with care: `lib/llm.ts`, `lib/edgar.ts`, `scripts/*.ts`,
`lib/normalize.ts`. See `DEBUGGING.md`.
