/**
 * Check the design docs against what the code actually does.
 *
 * The docs are the spec and the code is the build; when they drift, the next
 * person trusts the wrong one. This does not prove they agree — only a reader
 * can do that — but it catches the cheap failure: a table, column, module or
 * concept that exists in code and appears nowhere in the docs.
 *
 * Run: npx tsx scripts/dev/doc-sync.ts
 */
import { readFileSync, readdirSync } from 'node:fs';

const brief = readFileSync('design/BUILD_BRIEF.md', 'utf8');
const rationale = readFileSync('design/DESIGN_RATIONALE.md', 'utf8');
const docs = `${brief}\n${rationale}`;
const schema = readFileSync('lib/schema.ts', 'utf8');

let missing = 0;
const check = (label: string, present: boolean, note = '') => {
  if (!present) { missing++; console.log(`MISSING  ${label}${note ? ` — ${note}` : ''}`); }
};

// --- Tables in the schema should appear somewhere in the docs ---------------
console.log('== tables ==');
const tables = [...schema.matchAll(/pgTable\('([a-z_]+)'/g)].map((m) => m[1]);
for (const t of tables) check(`table ${t}`, docs.includes(t));

// --- Columns that carry a design decision ----------------------------------
console.log('\n== decision-bearing columns ==');
for (const col of [
  'momentum', 'contribution_drivers', 'account_status', 'dropped_reason',
  'match_status', 'source_url', 'rubric_version', 'voter_key',
]) check(`column ${col}`, docs.includes(col));

// --- Library modules that encode a rule ------------------------------------
console.log('\n== modules ==');
for (const f of readdirSync('lib')) {
  if (!f.endsWith('.ts')) continue;
  // Plumbing needs no mention; these are the files that hold judgment.
  if (!['rubric.ts', 'company-rubric.ts', 'valueprops.ts', 'placement.ts',
        'proposition.ts', 'cluster.ts', 'ats.ts', 'job-signal.ts',
        'accounts.ts', 'blocklist.ts', 'events.ts'].includes(f)) continue;
  check(`lib/${f}`, docs.includes(f));
}

// --- Concepts the build depends on -----------------------------------------
console.log('\n== concepts ==');
const concepts: Array<[string, RegExp]> = [
  ['two routes to a 3', /route \(a\)|route \(b\)/i],
  ['momentum as a second axis', /momentum/i],
  ['discovery vs trending sections', /worth a conversation[\s\S]{0,400}trending/i],
  ['account status ranked on in discovery', /account status[\s\S]{0,200}(rank|exclud)/i],
  ['value proposition selected not invented', /selected, not invented|picks (exactly )?one by id/i],
  ['precedent searched and stated', /precedent/i],
  ['organised demand proposition', /organised_demand|organised demand/i],
  ['ATS aggregated per company', /aggregated into one hiring-pattern item|one hiring item per company/i],
  ['materiality floor on hiring', /materiality floor/i],
  ['key-term clustering', /key terms/i],
  ['no internal team routing', /no routing to internal teams|names no team/i],
  ['why-now as points', /two or three short points|short points, not a sentence/i],
];
for (const [name, re] of concepts) check(name, re.test(docs));

console.log(missing ? `\n${missing} gaps` : '\nno gaps found');
