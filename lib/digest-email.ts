/**
 * The weekly email. Brief §10.
 *
 * The dashboard is the design; this is that design expressed in what email can
 * render. It reads the same `WeeklyDigest` the page reads, so a company cannot
 * appear in one and not the other, and the card's zones survive the translation:
 * heading with the signal score, the hard facts, the four bands, why now, what
 * Singapore could offer, the possible path.
 *
 * What the medium takes away:
 *   - Outlook renders through Word. Tables and inline styles only; no flexbox,
 *     no grid, no CSS variables, no oklch, no webfonts.
 *   - Hover does not exist, so a band's reasoning is printed under it rather
 *     than waiting behind a tooltip.
 *   - The action zone has no equivalent — a disposition needs a round trip — so
 *     each entry links to its company page and the decision is made there.
 *   - More links reduce clicks (RATIONALE §1), so past the first few entries a
 *     company keeps its heading and one line and the rest waits on the page.
 */
import type { DashboardCompany, WeeklyDigest } from './dashboard-data';
import { DETAIL_BUDGET, detailFor } from './placement';
import { sectorBroadSector, sectorShort } from './subsectors';

/**
 * app/globals.css converted to sRGB hex. Mail clients cannot parse oklch, and
 * a colour that fails to parse falls back to black on white — so the values are
 * resolved here rather than referenced.
 */
const C = {
  page: '#F2F1EE',
  ground: '#FAF9F7',
  card: '#FFFFFF',
  ink: '#0E0D0B',
  muted: '#54534E',
  weak: '#64635F',
  border: '#CFCECA',
  hairline: '#E4E3DF',
  // The dashboard's --primary converted from oklch(0.56 0.075 195), not a blue
  // chosen to look like it. It had drifted to #0060DE, which reads as a
  // different product beside the page it links to.
  primary: '#358282',
  accentBg: '#EFF5F5',
  /** --fresh: something arrived since the reader last looked. */
  fresh: '#38853E',
  secondary: '#EDEDEA',
  caution: '#8B5500',
  cautionSoft: '#F8E9D2',
  confirmed: '#076246',
  plausible: '#8C5E1A',
} as const;

/** The dashboard's stacks, with fallbacks a mail client will actually have. */
const SANS = "font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;";
const SERIF = "font-family: 'Libre Baskerville', Georgia, 'Times New Roman', Times, serif;";
const MONO = "font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;";

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Colour on the broad sector, as the dashboard does it: four hues across
 * twenty-six subsectors would be arbitrary, and the reader is scanning for the
 * family. A family outside these four is deliberately neutral.
 */
const BROAD_COLOUR: Record<string, string> = {
  compute: '#0063C4', industrial: '#0063C4', aerospace: '#0063C4',
  health: '#00753E', defence: '#AF2D18', ai: '#7733B1',
};

/** The two tags, broad then subsector, matching the dashboard's SectorTag. */
function sectorTags(sector: string): string {
  const broad = sectorBroadSector(sector);
  const family = broad ?? sector;
  const colour = BROAD_COLOUR[family] ?? C.muted;
  const tag = (text: string, filled: boolean) =>
    `<span style="${MONO} font-size:11px; text-transform:uppercase; letter-spacing:0.14em; color:${colour};${filled ? '' : ` border:1px solid ${colour}40; padding:1px 5px;`}">${esc(text)}</span>`;
  return broad
    ? `${tag(sectorShort(family), true)}&nbsp;&nbsp;${tag(sectorShort(sector), false)}`
    : tag(sectorShort(family), true);
}

const BAND_COLOUR: Record<string, string> = {
  high: C.confirmed, medium: C.plausible, low: C.weak, unknown: C.weak,
};

/** A Google News wrapper is ~400 opaque characters and says nothing. */
const isWrappedUrl = (u: string) => /news\.google\.com|\/rss\/articles\//.test(u ?? '');

/**
 * The signal score, as the dashboard's badge. A number on its own invites
 * being read as a percentage, so it carries its scale.
 */
/*
 * The score alone, without the scale's wording.
 *
 * "3/3 deciding now" reads as a claim the card has not earned — deciding what,
 * and says who — and the phrase means something only to somebody who already
 * knows the rubric. The number against its scale is honest about being an
 * internal ranking, and the why-now underneath is where the reader finds out
 * what actually happened.
 */
function badge(score: number): string {
  const strong = score >= 3;
  return `<span style="${MONO} font-size:12px; font-weight:600; color:${strong ? C.primary : C.muted}; background-color:${strong ? C.accentBg : C.secondary}; border:1px solid ${strong ? C.primary : C.border}; border-radius:3px; padding:2px 7px; white-space:nowrap;">${score}/3</span>`;
}

/** One band and the reasoning that would have been a hover on the page. */
function band(name: string, value: string, reason?: string): string {
  const v = (value ?? 'unknown').toLowerCase();
  return `
                <tr>
                  <td style="${SANS} font-size:13px; line-height:19px; padding:0 0 6px 0;">
                    <span style="${MONO} font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:${C.weak};">${esc(name)}</span>
                    &nbsp;<span style="font-weight:600; color:${BAND_COLOUR[v] ?? C.weak};">${esc(value ?? 'unknown')}</span>
                    ${reason ? `<br><span style="color:${C.muted};">${esc(reason)}</span>` : ''}
                  </td>
                </tr>`;
}

/** A hard fact about the company, as the dashboard's FactGrid. */
/**
 * The full entry: the dashboard card, flattened into rows Word will not
 * collapse. Zones are separated by a hairline, in the card's own order.
 */
/**
 * `rank` is the company's position in its section, and it decides how much
 * evidence the card carries. The first three in each section are what an RD
 * reads properly, so they get everything the scorer found; the rest get enough
 * to recognise and a link to the page.
 */
function fullCard(c: DashboardCompany, appBaseUrl: string, rank = 0): string {
  const a = c.assessment;
  const headlineHref = c.trigger.source.url;

  const facts = [
    ['Total raised', c.fundingTotal],
    ['Valuation', c.valuation?.value ?? 'Unknown'],
    ['Headcount', c.headcount],
    ['Founded', c.founded ? String(c.founded) : 'Unknown'],
  ].filter(([, v]) => v && v !== 'Unknown' && v !== 'unknown');

  const why = c.whyNow.slice(0, rank < 3 ? 6 : 3);

  return `
      <tr>
        <td style="padding:0 0 22px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="width:100%; background-color:${C.card}; border:1px solid ${C.border}; border-left:3px solid ${C.primary};">

            <!-- heading zone -->
            <tr>
              <td style="padding:13px 20px 12px 20px; background-color:${C.accentBg}; border-bottom:1px solid ${C.hairline};">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td>
                      ${sectorTags(c.sector)}${c.hq ? ` <span style="${SANS} font-size:12px; color:${C.weak};">· ${esc(c.hq)}</span>` : ''}
                    </td>
                    <td align="right" style="white-space:nowrap;">${badge(c.trigger.score)}</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="${SERIF} font-size:22px; line-height:28px; color:${C.ink}; padding:8px 0 0 0;">
                      <a href="${esc(appBaseUrl)}/company/${c.companyId}" style="color:${C.ink}; text-decoration:underline; text-decoration-color:${C.primary}; text-underline-offset:3px;">${esc(c.name)}</a>
                    </td>
                  </tr>
                  <!--
                    The headline sits with the name, because together they are
                    the whole of what a reader needs to decide whether to keep
                    going: who, and what just happened. The why-now points below
                    then add what the headline does not say.
                  -->
                  <tr>
                    <td colspan="2" style="${SERIF} font-style:italic; font-size:16px; line-height:23px; padding:6px 0 0 0;">
                      <a href="${esc(headlineHref)}" style="color:${C.primary}; text-decoration:underline; text-underline-offset:2px;">${esc(c.trigger.headline)}</a>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="${SANS} font-size:12px; line-height:17px; color:${C.weak}; padding:5px 0 0 0;">
                      <a href="${esc(headlineHref)}" style="color:${C.primary}; text-decoration:underline;">${esc(c.trigger.source.name)}</a>${c.trigger.source.date ? ` · ${esc(c.trigger.source.date)}` : ''}${c.clusterSize > 1 ? ` · ${c.clusterSize} outlets` : ''}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!--
              Facts and bands on one line rather than two banded rows.
              Eight short values were taking two full-width strips and a divider
              between them, which is most of a card's height spent on numbers a
              reader takes in at a glance. Run together they read as one line of
              context under the headline, and the card loses a third of its
              depth without losing a value.
            -->
            <tr>
              <td style="padding:10px 20px; border-bottom:1px solid ${C.hairline};">
                <span style="${MONO} font-size:12px; line-height:20px; color:${C.weak};">
                  ${facts.map(([n, v]) => `${esc(n)} <span style="color:${C.ink}; font-weight:600;">${esc(String(v))}</span>`).join('&nbsp;&nbsp;·&nbsp;&nbsp;')}
                  ${facts.length ? '&nbsp;&nbsp;·&nbsp;&nbsp;' : ''}Priority <span style="color:${C.ink}; font-weight:600;">${esc(a.priority)}</span>
                  &nbsp;&nbsp;·&nbsp;&nbsp; SG fit <span style="color:${C.ink}; font-weight:600;">${esc(a.sgFit)}</span>
                  &nbsp;&nbsp;·&nbsp;&nbsp; Value <span style="color:${C.ink}; font-weight:600;">${esc(c.potentialValue.band)}</span>
                  &nbsp;&nbsp;·&nbsp;&nbsp; Confidence <span style="color:${C.ink}; font-weight:600;">${esc(c.potentialValue.confidence)}</span>
                </span>
              </td>
            </tr>

            <!-- evidence -->
            <tr>
              <td style="padding:11px 20px 13px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  ${why.length > 1 ? `
                  <tr><td style="${MONO} font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:${C.weak}; padding:0 0 5px 0;">Also this week</td></tr>
                  <!--
                    From the SECOND point on. The first is the headline in the
                    tool's own words — "Locked in $15B credit line" under a
                    headline that already says Anthropic locked in a $15 billion
                    credit line — so printing it beneath the headline says the
                    same thing twice. What follows is what the headline does not
                    carry: the compute deals, the walked-away acquisition, the
                    hiring.
                  -->
                  ${why.slice(1).map((w) => `
                  <tr>
                    <td style="${SANS} font-size:14px; line-height:21px; color:${C.ink}; padding:0 0 5px 12px;">
                      ${esc(w.text)}
                    </td>
                  </tr>`).join('')}` : ''}

                  <!--
                    No 'Singapore could offer' here. It is the tool's pitch
                    rather than the week's news, it repeats across cards because
                    the menu is fixed, and a reader who has not yet decided the
                    company is worth a call has no use for the offer. It stays
                    on the page, where somebody who has decided will find it.
                  -->

                  ${c.possiblePathSummary || c.contacts.length ? `
                  <!--
                    Only when there is somebody. The block used to print a
                    paragraph explaining that nothing had been found, which is a
                    sentence about the tool rather than about the company, on
                    every card that had no path — and most do.
                  -->
                  <tr>
                    <td style="padding:12px 0 0 0;">
                      <div style="${MONO} font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:${C.weak}; padding-bottom:3px;">${c.possiblePathSummary ? 'Possible path' : 'Who to approach'}</div>
                      ${c.possiblePathSummary
                        ? `<div style="${SANS} font-style:italic; font-size:13px; line-height:20px; color:${C.muted};">${esc(c.possiblePathSummary)}</div>`
                        : c.contacts.map((p) => `<div style="${SANS} font-size:13px; line-height:20px; color:${C.ink};">
                            <span style="font-weight:600;">${esc(p.name)}</span>${p.title ? ` <span style="color:${C.muted};">· ${esc(p.title)}</span>` : ''}${p.email ? ` · <a href="mailto:${esc(p.email)}" style="color:${C.primary};">${esc(p.email)}</a>` : p.profileUrl ? ` · <a href="${esc(p.profileUrl)}" style="color:${C.primary};">profile</a>` : ''}
                          </div>`).join('')}
                    </td>
                  </tr>` : ''}

                  ${c.checkFirst ? `
                  <tr>
                    <td style="padding:12px 0 0 0;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.cautionSoft};">
                        <tr><td style="${SANS} font-size:13px; line-height:19px; color:${C.caution}; padding:9px 13px;">
                          <b>Check first</b> — ${esc(c.checkFirst)}
                        </td></tr>
                      </table>
                    </td>
                  </tr>` : ''}

                  <tr>
                    <td style="${SANS} font-size:13px; line-height:19px; padding:14px 0 0 0; border-top:1px solid ${C.hairline};">
                      <a href="${esc(appBaseUrl)}/company/${c.companyId}" style="color:${C.primary}; text-decoration:none; font-weight:600;">Open the case &rarr;</a>
                      <span style="color:${C.weak};"> &nbsp;draft, monitor or dismiss on the dashboard</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

/**
 * The compact entry, written to sit in one cell of a two-column grid.
 *
 * These companies cleared the same bar as the ones above them and were being
 * reduced to a name and a headline, which is less than the scorer actually
 * found — several carry three or four signals. Two columns is what buys the
 * room to print them: a full-width card wastes most of a 780px line on an
 * entry this short, where a pair side by side fills it.
 *
 * Outlook renders through Word, so the grid is a table with two cells per row
 * rather than anything that would need flexbox, and a narrow client collapses
 * it to one column on its own.
 */
function briefCard(c: DashboardCompany, appBaseUrl: string, withWhy: boolean): string {
  const why = c.whyNow.slice(1, withWhy ? 4 : 2);
  return `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="width:100%; border:1px solid ${C.hairline};">
              <tr>
                <td style="padding:12px 14px;" valign="top">
                  <div>
                    <a href="${esc(appBaseUrl)}/company/${c.companyId}" style="${SERIF} font-size:16px; color:${C.ink}; text-decoration:underline; text-decoration-color:${C.primary}; text-underline-offset:3px;">${esc(c.name)}</a>
                    &nbsp;${badge(c.trigger.score)}
                  </div>
                  <div style="${SANS} font-style:italic; font-size:13px; line-height:19px; color:${C.primary}; padding-top:4px;">
                    <a href="${esc(c.trigger.source.url)}" style="color:${C.primary}; text-decoration:underline;">${esc(c.trigger.headline)}</a>
                  </div>
                  ${why.map((w) => `<div style="${SANS} font-size:13px; line-height:19px; color:${C.muted}; padding-top:3px;">${esc(w.text)}</div>`).join('')}
                  <div style="${SANS} font-size:12px; line-height:17px; color:${C.weak}; padding-top:5px;">
                    ${esc(c.trigger.source.name)}${c.hq ? ` · ${esc(c.hq)}` : ''}${c.checkFirst ? ` · <span style="color:${C.caution};">check first</span>` : ''}
                  </div>
                </td>
              </tr>
            </table>`;
}

/** Lay the compact entries out two to a row. */
function briefGrid(list: DashboardCompany[], appBaseUrl: string, firstIsBrief: number): string {
  const rows: string[] = [];
  for (let i = 0; i < list.length; i += 2) {
    const pair = list.slice(i, i + 2);
    rows.push(`
      <tr>
        <td style="padding:0 0 10px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="50%" valign="top" style="padding-right:5px;">${briefCard(pair[0]!, appBaseUrl, i < firstIsBrief)}</td>
              <td width="50%" valign="top" style="padding-left:5px;">${pair[1] ? briefCard(pair[1], appBaseUrl, i + 1 < firstIsBrief) : ''}</td>
            </tr>
          </table>
        </td>
      </tr>`);
  }
  return rows.join('');
}

/*
 * No subtitle, matching the dashboard: the title names the section, and a line
 * explaining what the tool can and cannot argue is the tool talking about
 * itself.
 */
/**
 * The mail is a US list.
 *
 * EDB attracts investment INTO Singapore from American companies, so a Japanese
 * or European firm is context rather than something to act on this week — and
 * on the last run they were more than half of what went out, which is a lot of
 * an RD's attention spent on companies nobody was going to call. They stay on
 * the dashboard, under their own geography tab.
 */
const isUs = (c: DashboardCompany) => c.geography === 'west_coast' || c.geography === 'other_us';

function sectionBlock(
  title: string, list: DashboardCompany[], appBaseUrl: string,
): string {
  list = list.filter(isUs);
  if (!list.length) return '';
  const total = list.length;
  // The full cases run down the page; everything after them goes two to a row.
  const fulls = list.filter((_, i) => detailFor(i) === 'full');
  const rest = list.slice(fulls.length);
  const cards = fulls.map((c, i) => fullCard(c, appBaseUrl, i)).join('')
    + briefGrid(rest, appBaseUrl, DETAIL_BUDGET.brief - fulls.length);

  const more = '';

  return `
      <tr>
        <td style="padding:34px 0 14px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td style="${SERIF} font-size:20px; line-height:26px; color:${C.ink};">${esc(title)}
              <span style="${MONO} font-size:12px; color:${C.weak};">&nbsp;${total}</span>
            </td></tr>
          </table>
        </td>
      </tr>${cards}${more}`;
}

export function renderDigestEmail(d: WeeklyDigest, appBaseUrl: string): string {
  /*
   * Two sections, not five.
   *
   * An inbox is read standing up, and the two that answer "what should I do
   * this week" are the companies the tool can argue for and the early-stage
   * finds. Who-we-know and monitoring are reference — worth having on the
   * dashboard, but they lengthened the mail without changing what anyone did
   * next, and RATIONALE §1 is that length is the failure mode here.
   *
   * Each section tapers by itself: the first few carry the full case, the next
   * few a heading and a line, and the tail a single line. Both lists are ranked,
   * so tapering spends the reader's attention where the evidence is strongest.
   *
   * 'Early-stage finds' rendered newOnTheRadar a second time under a different
   * name, so every radar company appeared twice in the same mail.
   */
  const body =
    sectionBlock('Worth a conversation', d.worthAConversation, appBaseUrl)
    + sectionBlock('New on the radar', d.newOnTheRadar, appBaseUrl);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FDI signals — ${esc(d.weekLabel)}</title>
</head>
<body style="margin:0; padding:0; background-color:${C.card};">
  <!-- 780px table layout. Outlook renders through Word: no flexbox, no grid.
       680 wasted a desktop window and 900 ran wider than a line stays readable;
       this sits between, wide enough that a company's facts hold one line.
       White throughout, because a tinted ground reads as a marketing mailer in
       an inbox where every other message is on white. -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.card};">
    <tr>
      <td align="center" style="padding:26px 12px 40px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="780" style="width:780px; max-width:780px; background-color:${C.card};">
          <tr>
            <td style="padding:32px 30px 0 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="${SERIF} font-size:30px; line-height:38px; color:${C.ink};">This week</td></tr>
                <tr><td style="${SANS} font-size:13px; line-height:20px; color:${C.muted}; padding:6px 0 0 0;">
                  ${esc(d.weekLabel)} &middot; ${esc(d.coverage)}
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 30px 10px 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${body}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 30px 30px 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="${SANS} font-size:12px; line-height:18px; color:${C.weak}; padding:18px 0 0 0; border-top:1px solid ${C.border};">
                  Bands and scores are the tool&rsquo;s judgment, not a measurement, and the reasoning under each says how it got there.
                  Correcting one on the dashboard is what the next week is scored against.
                  <br><a href="${esc(appBaseUrl)}" style="color:${C.primary};">Open the dashboard</a>
                </td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plaintext, same order and same content, for clients that refuse HTML. */
export function renderDigestText(d: WeeklyDigest, appBaseUrl: string): string {
  const out: string[] = [`THIS WEEK — ${d.weekLabel}`, d.coverage, ''];

  const section = (title: string, list: DashboardCompany[]) => {
    if (!list.length) return;
    out.push(title.toUpperCase(), '-'.repeat(60));
    list.forEach((c, i) => {
      const detail = detailFor(i);
      out.push(`  ${c.name} — signal ${c.trigger.score}/3`);
      out.push(isWrappedUrl(c.trigger.source.url)
        ? `    (${c.trigger.source.name} — open via the company page below)`
        : `    ${c.trigger.source.url}`);

      if (detail === 'full') {
        const a = c.assessment;
        out.push(`    Priority ${a.priority} · SG fit ${a.sgFit} · Value ${c.potentialValue.band} · Confidence ${c.potentialValue.confidence}`);
        if (c.whyNow.length) {
          for (const w of c.whyNow.slice(1)) out.push(`      - ${w.text}`);
        }
        // The offer is on the page, not here — see the note in the html card.
        if (c.possiblePathSummary) {
          out.push(`    Possible path: ${c.possiblePathSummary}`);
        } else if (c.contacts.length) {
          out.push(`    Who to approach:`);
          for (const p of c.contacts) {
            out.push(`      - ${p.name}${p.title ? ` · ${p.title}` : ''}${p.email ? ` · ${p.email}` : p.profileUrl ? ` · ${p.profileUrl}` : ''}`);
          }
        }
        if (c.checkFirst) out.push(`    Check first: ${c.checkFirst}`);
      } else if (detail === 'brief' && c.whyNow[0]) {
        out.push(`    ${c.whyNow[0].text}`);
      }
      out.push(`    ${appBaseUrl}/company/${c.companyId}`);
      out.push('');
    });
    if (list.length > DETAIL_BUDGET.full) {
      out.push(`  The first ${DETAIL_BUDGET.full} carry the full case. The rest cleared the same bar —`);
      out.push(`  open ${appBaseUrl} for the argument on any of them.`, '');
    }
  };

  section('Worth a conversation', d.worthAConversation);
  section('New on the radar', d.newOnTheRadar);

  out.push('', 'Bands and scores are the tool’s judgment, not a measurement.');
  out.push(`Correct one on the dashboard: ${appBaseUrl}`);
  return out.join('\n');
}
