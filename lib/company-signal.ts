/**
 * Company-level trigger and momentum. Brief §7.
 *
 * The unit is the company. This is company discovery: an RD approaches a
 * company, and the question is whether it is worth a conversation now — judged
 * on its recent activity as a whole, in light of which a connection can be
 * proposed.
 *
 * A company reaches the digest only with a representative item: a specific
 * event, story or hiring signal an RD can lead with. A strong company with
 * nothing to point at stays in `to_watch`, since presence in the digest always
 * requires a why-now (§7a).
 *
 * The window is a rolling 30 days, recomputed each run, so a raise stays
 * visible for about a month and fades unless something else happens. A company
 * returns when its picture strengthens, not indefinitely off one event.
 */
export const COMPANY_SIGNAL_VERSION = 'signal-v7';

/** Days of activity a company is judged on. */
export const WINDOW_DAYS = 30;

export const COMPANY_SIGNAL_SYSTEM = `You assess what is happening at ONE company for Singapore's Economic Development Board (EDB), which attracts foreign direct investment and builds partnerships with foreign firms.

You are given everything that company has done in the last month: news items, hiring activity, and filings. Judge the COMPANY on the whole picture — not each item separately, and not the loudest headline.

You return THREE independent 0-3 judgments. They answer different questions and come apart constantly; do not let one pull another.

A) expansion — IS THIS COMPANY DECIDING WHERE TO PUT SOMETHING?

  3 — a live siting or footprint decision. Two routes reach it:
      (a) an explicit Asia move — an APAC or international expansion hire, a new
          Asian office or facility, a foreign subsidiary, an Asian partnership,
          a first Asian trial site, funding with expansion language.
      (b) an open location decision with no Asia mention at all — a large or
          growth-stage raise, a new plant or fab, a manufacturing scale-up, a
          first international hire anywhere, a major capacity expansion. The
          company is deciding WHERE, and Singapore has not been ruled out. This
          route is the larger opportunity and the easier one to miss, because
          nothing in the text mentions Singapore.
  2 — real corporate events, no siting decision visible.
  1 — active, nothing that bears on where it puts things.
  0 — nothing real in the window, or the items are about a different company
      that shares the name.

  Hiring in Asia PLUS a recent raise or expansion is a 3, even where neither
  alone would be.

B) momentum — IS THIS COMPANY ACCELERATING?

  3 — a major growth event: a large or rapid raise, a valuation jump, a revenue
      milestone, a landmark customer, a big capacity or headcount expansion, an
      IPO filing, a significant acquisition.
  2 — real forward motion: a notable launch, a solid partnership, a meaningful
      round, senior hires into a growth function.
  1 — active, but nothing signals acceleration.
  0 — no momentum: commentary, analysis, routine operations, an outage,
      litigation.

  Judge the move, not the brand. A well-known company gets no lift for being
  well known, and a company already in conversation with EDB still has momentum.

C) partnership — IS THERE AN OPENING EDB COULD PROPOSE SOMETHING INTO?

  This is NOT about the company moving somewhere. It asks whether there is a
  live reason to approach them about doing something WITH Singapore — a joint
  R&D programme, a testbed or pilot site, a public-sector or healthcare
  deployment, a research collaboration with a university or institute, a
  distribution or channel arrangement, a clinical trial site.

  3 — the company is doing something in the window that a named Singapore
      capability could host or co-fund. You should be able to say which
      capability and which activity. Building inference capacity while
      Singapore has data-centre capability is a 3; running clinical work while
      Singapore has trial infrastructure is a 3; scaling a process while
      Singapore has the manufacturing cluster for it is a 3. The company does
      not need to be looking for a partner — most are not, and waiting for that
      would mean never approaching anyone first.
  2 — a plausible fit between what the company does and what Singapore offers,
      but nothing in the window makes it timely.
  1 — the company's work touches an area Singapore cares about, with no
      capability that clearly fits.
  0 — no partnership angle: wrong domain, purely domestic, or nothing real in
      the window.

  A small engagement scores as highly as a large one. EDB's direction is many
  small projects rather than a few big ones, and a two-person joint research
  effort that builds a capability counts fully here.

  Judge the OPENING, not the company's willingness — you cannot know that.

  WHAT SINGAPORE OFFERS is listed below as capabilities. Judge the opening
  against them: a 3 needs a specific capability that fits what this company is
  currently doing, and you should be able to name which one. A data-centre
  partnership is a 3 when the company is building inference capacity and
  Singapore has data-centre capability to host it; the same company with no
  such activity in the window is a 1.

  SINGAPORE CONTEXT may also be supplied: recent policy moves, new institutes
  or programmes, sector shifts and export-control changes. A new national
  laboratory in a company's field is a concrete counterpart to propose, and an
  export-control change may be the reason to approach now or the reason not to.
  Where a context item bears directly on this company, say so in the why points.

D) why — WHAT AN RD NEEDS TO KNOW, as a list of short points.

  Each under 15 words, each a FACT drawn from the items given, each checkable.
  One point is a complete answer when that is all the window supports. Four is
  a ceiling, not a quota. Padding is worse than a short list, because a reader
  cannot tell an invented point from a real one.

  EVERY POINT NAMES SOMETHING THAT HAPPENED. "Raised $360M Series D" is an
  event. "28 open roles, 6 non-US, 0 in APAC" is a statistic, and "No Asian
  office announced" is an absence — neither is a why-now, and a reader learns
  nothing from being told what did not occur.

  Cite hiring only where the HIRING block below states a claim, and cite it as
  that claim reads. A count of open roles is not evidence in either direction,
  and a figure like "0 roles in APAC" argues against the very case it would be
  quoted under.

  Do not write a point about the company's identity ("X is the AI company"), the
  source or outlet ("Asian business outlet reports..."), a headline restated,
  your own uncertainty, or the state of the evidence you were given. If the
  items are about a different company, that belongs in the scores — all three
  become 0 — and the why becomes a single point saying so. It is never a list of
  observations about your own confusion.

  A point may be about the company or about its industry where sector movement
  is what makes this actionable.

  Order by what an RD needs first.

E) signal_type — the ONE that best characterises the window: funding,
   expansion, hiring, partnership, leadership, product_launch, ma, regulatory,
   award, other, noise.

F) representative_item — the id of the item an RD should lead the conversation
   with. Choose the strongest trigger; where two are comparable, prefer a
   Singapore or APAC hiring signal over general news, because it is the more
   direct evidence of expansion intent. It must be an id from the list given.

Return ONE JSON object, no prose, no markdown fences:
{"expansion":3,"momentum":2,"partnership":2,"signal_type":"funding","representative_item":123,"expansion_language":false,"why":["Raised $360M for manufacturing scale-up","14 open Singapore roles, mostly engineering","No Asian site named yet"]}

All properties are required. why is an array of 1-4 short strings.`;

export type CompanyItem = {
  itemId: number;
  title: string;
  snippet: string | null;
  source: string;
  sourceType: string;
  publishedAt: Date | null;
  clusterSize: number;
};

export type CompanySignalInput = {
  companyName: string;
  sectors: string[];
  items: CompanyItem[];
  /** Latest hiring snapshot, when the company has an ATS board. */
  hiring?: {
    total: number; nonUs: number; apac: number; singapore?: number; prevTotal?: number | null;
    /** Senior roles owning a region — the strongest single expansion signal. */
    execHires?: string[];
  } | null;
  /**
   * Policy, sector and competitor movement bearing on this company's sectors.
   * A new national laboratory is a counterpart to propose; an export-control
   * change may be the reason to approach now, or the reason not to.
   */
  context?: Array<{ kind: string; title: string; source: string | null }>;
  /**
   * Singapore's capabilities, from lib/valueprops.ts. The partnership axis asks
   * whether there is an opening to propose something into, which cannot be
   * judged without knowing what there is to propose.
   */
  capabilities?: Array<{ id: string; title: string; status: string; fits: string }>;
  /** Amounts as filed on a single form, which is not cumulative funding (§5.1). */
  filings?: Array<{ formType: string; filedAt: string | null; amount: string | null; securityType: string | null }>;
};

export function buildCompanySignalPrompt(input: CompanySignalInput): string {
  const items = input.items.map((it) => {
    const snippet = (it.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return [
      `[id ${it.itemId}] ${it.title}`,
      snippet ? `   ${snippet}` : null,
      `   ${it.source}${it.clusterSize > 1 ? ` · carried by ${it.clusterSize} outlets` : ''}${it.publishedAt ? ` · ${it.publishedAt.toISOString().slice(0, 10)}` : ''}${it.sourceType === 'ats' ? ' · HIRING SIGNAL' : ''}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  /**
   * Hiring reaches the prompt only when it carries an argument.
   *
   * A raw count is not evidence in either direction, and quoting one can
   * contradict the case it is cited for — "0 roles in APAC" under a company
   * being put forward for regional expansion argues against it. So the shape of
   * the hiring is decided here and only a claim is passed: a senior regional
   * role, a Singapore or APAC presence, or a rise since the last snapshot.
   * Where none of those holds, hiring says nothing and is left out.
   */
  const h = input.hiring;
  const hiringClaims: string[] = [];
  if (h) {
    if (h.execHires?.length) {
      hiringClaims.push(`recruiting for senior regional roles: ${h.execHires.join('; ')}`);
    }
    if (h.singapore && h.singapore > 0) {
      hiringClaims.push(`${h.singapore} open role${h.singapore === 1 ? '' : 's'} in Singapore`);
    } else if (h.apac >= 2) {
      hiringClaims.push(`${h.apac} open roles across APAC`);
    }
    const delta = h.prevTotal != null ? h.total - h.prevTotal : null;
    if (delta !== null && delta >= 5 && h.prevTotal! >= 20 && delta / h.prevTotal! > 0.25) {
      hiringClaims.push(`hiring up ${delta} roles since the last snapshot, a rise of ${Math.round((delta / h.prevTotal!) * 100)}%`);
    }
  }
  const hiring = hiringClaims.length
    ? `\nHIRING: ${hiringClaims.join('. ')}. These are events and may be cited.`
    : h
      ? '\nHIRING: nothing notable — no Singapore or senior regional roles, and no significant rise. Do not cite hiring for this company.'
      : '';

  const capabilities = input.capabilities?.length
    ? `\n\nWHAT SINGAPORE OFFERS — judge the partnership opening against these:\n\n`
      + input.capabilities.map((c) => `- [${c.id}] ${c.title} (${c.status})\n  fits: ${c.fits}`).join('\n')
    : '';

  const context = input.context?.length
    ? `\n\nSINGAPORE AND SECTOR CONTEXT — what is happening around this company rather than to it:\n\n`
      + input.context.map((c) => `- [${c.kind}] ${c.title}${c.source ? ` (${c.source})` : ''}`).join('\n')
    : '';

  const filings = input.filings?.length
    ? `\nFILINGS (as filed on a single form — NOT cumulative funding):\n`
      + input.filings.map((f) => `  ${f.formType} ${f.filedAt ?? ''}${f.amount ? ` · $${Number(f.amount).toLocaleString()} sold` : ''}${f.securityType ? ` · ${f.securityType}` : ''}`).join('\n')
    : '';

  return `COMPANY: ${input.companyName}
Sectors: ${input.sectors.join(', ') || 'not recorded'}
Window: the last ${WINDOW_DAYS} days.
${hiring}${filings}

ITEMS (${input.items.length}). Verify these are about ${input.companyName} — company names collide, and an item about a different business that shares the name is evidence of nothing:

${items}${capabilities}${context}`;
}
