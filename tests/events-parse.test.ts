/**
 * The parts of event ingestion that run without a model: the edition dates read
 * off a directory banner, and the second-pass rejection of names the extraction
 * prompt lets through.
 *
 * Dates carry the weight here. An exhibitor list scraped in March against last
 * year's banner produces a path to a show that has already happened, and it
 * reads as current on the company page — so each form a conference writes its
 * dates in is pinned by a case.
 *
 * Run: npx tsx tests/events-parse.test.ts
 */
import { parseDateRange, editionDates, plausibleParticipant, directoryLines, withinPlanningWindow, yearFromUrl, linesNamingKnownCompanies } from '../lib/events';
import { normalizeCompanyName } from '../lib/normalize';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${name}\n      expected ${JSON.stringify(want)}\n      got      ${JSON.stringify(got)}`); }
};

// ── Dates, in the forms shows actually write them ────────────────────────────
check('same-month range, en dash',
  parseDateRange('SEMICON West 2026 · July 7–9, 2026 · Phoenix, AZ'),
  { startsOn: '2026-07-07', endsOn: '2026-07-09' });
check('same-month range, hyphen',
  parseDateRange('Automate 2026 | June 8-11, 2026 | Detroit, MI'),
  { startsOn: '2026-06-08', endsOn: '2026-06-11' });
check('range crossing a month boundary',
  parseDateRange('June 30 – July 2, 2026'),
  { startsOn: '2026-06-30', endsOn: '2026-07-02' });
check('range crossing a year boundary',
  parseDateRange('December 29 – January 3, 2026'),
  { startsOn: '2026-12-29', endsOn: '2027-01-03' });
// Shows outside the US put the day first, and the range shares one month name.
// Matching only the tail of it records the last day as the whole show.
check('day-first range',
  parseDateRange('Asia Tech x Singapore — 26 - 28 May 2027 | Singapore'),
  { startsOn: '2027-05-26', endsOn: '2027-05-28' });
check('day-first range, en dash, no spaces',
  parseDateRange('7–9 July 2026'),
  { startsOn: '2026-07-07', endsOn: '2026-07-09' });
check('day-first range crossing a month',
  parseDateRange('30 June – 2 July 2026'),
  { startsOn: '2026-06-30', endsOn: '2026-07-02' });
check('day-first range crossing a year',
  parseDateRange('29 December – 3 January 2027'),
  { startsOn: '2026-12-29', endsOn: '2027-01-03' });
check('day-first single date',
  parseDateRange('12 May 2026, Marina Bay Sands'),
  { startsOn: '2026-05-12', endsOn: '2026-05-12' });
check('month-first single date',
  parseDateRange('Registration opens May 12, 2026'),
  { startsOn: '2026-05-12', endsOn: '2026-05-12' });
check('abbreviated month',
  parseDateRange('Feb. 10–14, 2026'),
  { startsOn: '2026-02-10', endsOn: '2026-02-14' });
check('no date in the line', parseDateRange('Exhibitor Directory A–Z'), null);
check('a year alone is not a date', parseDateRange('© 2026 Semiconductor Equipment'), null);

// The banner is at the top; deadlines and recaps further down are not the
// edition, and taking the first date found anywhere would pick one of them.
check('edition read from the banner, not a later deadline',
  editionDates([
    'Skip to content', 'SEMICON West 2026', 'July 7–9, 2026 · Phoenix, AZ',
    'Exhibitor Directory', 'Housing deadline: June 1, 2026',
  ]),
  { startsOn: '2026-07-07', endsOn: '2026-07-09' });
check('undated directory', editionDates(['Exhibitor list', 'Applied Materials', 'Booth 1423']), null);

// AUSA heads its directory "12 - 14 October" and puts the year only in the URL.
// The other years on the page belong to a "2025 Recap" and an awards link, so
// the URL is the one trustworthy source for it.
check('year taken from the url when the banner omits it',
  editionDates(['Exhibitor List', '12 - 14 October', 'Washington, D.C.', '2025 Recap'], { yearHint: 2026 }),
  { startsOn: '2026-10-12', endsOn: '2026-10-14' });
check('a year hint does not invent a date where none is stated',
  editionDates(['Exhibitor List', 'Washington, D.C.'], { yearHint: 2026 }), null);
check('a date stated in full still wins over the hint',
  editionDates(['SEMICON West 2026', 'July 7–9, 2026'], { yearHint: 2027 }),
  { startsOn: '2026-07-07', endsOn: '2026-07-09' });

const asOf = new Date('2026-09-08T00:00:00Z');
check('edition year read from a portal url', yearFromUrl('https://meetings.ausa.org/annual/2026/exhibitor_exhibitor_list.cfm', asOf), 2026);
check('year read from a portal subdomain', yearFromUrl('https://southeastasia2026.smallworldlabs.com/exhibitors', asOf), 2026);
check('no year in the url', yearFromUrl('https://asiatechxsg.com/sponsors/sponsor-exhibitor-list/', asOf), null);
check('a year far outside the plausible range is not an edition', yearFromUrl('https://example.com/archive/2011/exhibitors', asOf), null);

// ── Planning window ──────────────────────────────────────────────────────────
const today = new Date('2026-03-01T00:00:00Z');
check('a show four months out is worth reading', withinPlanningWindow('2026-07-07', today), true);
check('a show that already started is not', withinPlanningWindow('2026-02-20', today), false);
check('a show two years out is not', withinPlanningWindow('2028-07-07', today), false);
check('an undated edition stands', withinPlanningWindow(null, today), true);

// ── Who is actually a participant ────────────────────────────────────────────
const p = (company: string, person = '') =>
  ({ company, person, personTitle: '', participation: 'exhibitor' as const });

check('a real exhibitor', plausibleParticipant(p('Applied Materials'), 'SEMICON West'), true);
check('an exhibitor with a named speaker', plausibleParticipant(p('Amkor Technology', 'Ana Cheng'), 'SEMICON West'), true);
check('the show echoing its own name', plausibleParticipant(p('SEMICON West'), 'SEMICON West'), false);
check('the show, punctuated differently', plausibleParticipant(p('SEMICON-West'), 'SEMICON West'), false);
check('a media partner', plausibleParticipant(p('EE Times Media Partner'), 'SEMICON West'), false);
check('a supporting association', plausibleParticipant(p('Semiconductor Industry Association'), 'SEMICON West'), false);
check('a job title in the person field', plausibleParticipant(p('Amkor Technology', 'Vice President'), 'SEMICON West'), false);
check('an empty company name', plausibleParticipant(p(''), 'SEMICON West'), false);

// ── Directory text ───────────────────────────────────────────────────────────
// A logo grid names its companies only in the alt attribute.
check('names read out of a logo grid',
  directoryLines('<ul><li><img alt="Applied Materials" src="/l/amat.png"></li><li><img alt="Amkor Technology" src="/l/amkor.png"></li></ul>'),
  ['Applied Materials', 'Amkor Technology']);
check('one entry per line, chrome dropped',
  directoryLines('<div>Home</div><div>Applied Materials<br>Booth 1423</div><div>Applied Materials<br>Booth 1423</div>'),
  ['Applied Materials', 'Booth 1423']);

// ── The prefilter: which lines a model ever sees ─────────────────────────────
// A directory entry is a name plus its furniture, so the match has to find a
// known name inside a line rather than compare whole lines.
//
// The index is keyed by the SAME normaliser the lookup uses. Writing the keys
// out by hand is how this test first failed: "Twelve Labs" normalises to
// "twelve" because `labs` is a stripped suffix, so a hand-written 'twelve labs'
// key is one no window can ever produce. The script builds its index through
// normalizeCompanyName for this reason, and so does this.
const index = new Map<string, { id: number; name: string }>(
  [{ id: 1, name: 'Applied Materials' }, { id: 2, name: 'Motive' }, { id: 3, name: 'Twelve Labs' }]
    .map((c) => [normalizeCompanyName(c.name), c]),
);
const filtered = linesNamingKnownCompanies([
  'Applied Materials · Booth 1423',
  'Acme Fastener Supply · Booth 1424',
  'Motive | Hall 3',
  'Panel: Scaling Advanced Packaging — Dr. Ana Cheng, VP Operations, Twelve Labs',
  'Cookie preferences',
], index);
check('only the lines naming a monitored company go to the model',
  filtered.lines,
  ['Applied Materials · Booth 1423', 'Motive | Hall 3',
   'Panel: Scaling Advanced Packaging — Dr. Ana Cheng, VP Operations, Twelve Labs']);
check('and the companies they named come back',
  filtered.hits.map((h) => h.name).sort(),
  ['Applied Materials', 'Motive', 'Twelve Labs']);

// normalizeCompanyName strips legal and descriptive suffixes from both sides,
// which is what lets a directory's fuller name reach a company held shorter.
check('a suffixed name still matches the company held without one',
  linesNamingKnownCompanies(['Motive Technologies Inc. · Booth 12'], index).lines.length, 1);
check('a directory of nothing we track sends nothing',
  linesNamingKnownCompanies(['Acme Fastener Supply', 'Booth 1424', 'Opt-In'], index).lines.length, 0);
// A two-letter or digit-only window would match half a directory.
check('a short token is not evidence',
  linesNamingKnownCompanies(['AM · Booth 3', '2026'],
    new Map([[normalizeCompanyName('AM'), { id: 9, name: 'AM' }]])).lines.length, 0);

console.log(`\n${pass}/${pass + fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
