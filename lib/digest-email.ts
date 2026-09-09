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
function fact(name: string, value: string): string {
  return `
                <td style="${SANS} font-size:13px; line-height:18px; color:${C.ink}; padding:0 14px 0 0; vertical-align:top;">
                  <span style="${MONO} font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:${C.weak};">${esc(name)}</span><br>
                  <span style="font-weight:600;">${esc(value)}</span>
                </td>`;
}

/**
 * The full entry: the dashboard card, flattened into rows Word will not
 * collapse. Zones are separated by a hairline, in the card's own order.
 */
function fullCard(c: DashboardCompany, appBaseUrl: string): string {
  const a = c.assessment;
  const headlineHref = c.trigger.source.url;

  const facts = [
    ['Total raised', c.fundingTotal],
    ['Valuation', c.valuation?.value ?? 'Unknown'],
    ['Headcount', c.headcount],
    ['Founded', c.founded ? String(c.founded) : 'Unknown'],
  ].filter(([, v]) => v && v !== 'Unknown' && v !== 'unknown');

  const why = c.whyNow.slice(0, 4);

  return `
      <tr>
        <td style="padding:0 0 22px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="width:100%; background-color:${C.card}; border:1px solid ${C.border}; border-left:3px solid ${C.primary};">

            <!-- heading zone -->
            <tr>
              <td style="padding:18px 20px 15px 20px; background-color:${C.accentBg}; border-bottom:1px solid ${C.hairline};">
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
                    No trigger headline here. It said the same thing as the
                    first why-now point directly beneath it, in the publication's
                    words rather than the tool's — two lines for one fact. The
                    source and date stay, since they are what makes the point
                    checkable, and the headline is still one click away.
                  -->
                  <tr>
                    <td colspan="2" style="${SANS} font-size:12px; line-height:17px; color:${C.weak}; padding:5px 0 0 0;">
                      <a href="${esc(headlineHref)}" style="color:${C.primary}; text-decoration:underline;">${esc(c.trigger.source.name)}</a>${c.trigger.source.date ? ` · ${esc(c.trigger.source.date)}` : ''}${c.clusterSize > 1 ? ` · ${c.clusterSize} outlets` : ''}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${facts.length ? `<!-- facts -->
            <tr>
              <td style="padding:14px 20px 12px 20px; border-bottom:1px solid ${C.hairline};">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${facts.map(([n, v]) => fact(n, v)).join('')}</tr></table>
              </td>
            </tr>` : ''}

            <!--
              The four bands as a single line, without their reasoning.
              A sentence under each ran to some seventy words a card, which is
              most of what made the mail long — and it argues a case the reader
              has not yet decided to hear. The bands themselves say where the
              tool landed; the reasoning behind any of them is on the page, one
              click away, where somebody who disagrees is going to go anyway.
            -->
            <tr>
              <td style="padding:12px 20px; border-bottom:1px solid ${C.hairline};">
                <span style="${MONO} font-size:12px; color:${C.weak};">
                  Priority <span style="color:${C.ink}; font-weight:600;">${esc(a.priority)}</span>
                  &nbsp;&middot;&nbsp; SG fit <span style="color:${C.ink}; font-weight:600;">${esc(a.sgFit)}</span>
                  &nbsp;&middot;&nbsp; Value <span style="color:${C.ink}; font-weight:600;">${esc(c.potentialValue.band)}</span>
                  &nbsp;&middot;&nbsp; Confidence <span style="color:${C.ink}; font-weight:600;">${esc(c.potentialValue.confidence)}</span>
                </span>
              </td>
            </tr>

            <!-- evidence -->
            <tr>
              <td style="padding:15px 20px 16px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  ${why.length ? `
                  <tr><td style="${MONO} font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:${C.weak}; padding:0 0 5px 0;">Why now</td></tr>
                  ${why.map((w) => `
                  <tr>
                    <td style="${SANS} font-size:14px; line-height:21px; color:${C.ink}; padding:0 0 5px 12px;">
                      &bull;&nbsp;${esc(w.text)}${w.origin === 'supporting' ? ` <span style="color:${C.weak};">(${esc(w.signalType === 'hiring' ? 'hiring' : 'also reported')})</span>` : ''}
                    </td>
                  </tr>`).join('')}` : ''}

                  ${c.offer ? `
                  <tr>
                    <td style="padding:12px 0 0 0;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.card}; border:1px solid ${C.hairline};">
                        <tr><td style="padding:13px 15px;">
                          <div style="${MONO} font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:${C.weak}; padding-bottom:5px;">Singapore could offer</div>
                          <div style="${SANS} font-size:14px; line-height:21px; color:${C.ink}; font-weight:600;">${esc(c.offer.title)}</div>
                          ${c.offer.precedent ? `<div style="${SANS} font-size:13px; line-height:20px; color:${C.muted}; padding-top:5px;">${esc(c.offer.precedent)}${c.offer.precedentSource?.url ? ` <a href="${esc(c.offer.precedentSource.url)}" style="color:${C.primary};">source</a>` : ''}</div>` : ''}
                          ${c.offer.caveat ? `<div style="${SANS} font-size:12px; line-height:18px; color:${C.caution}; padding-top:5px;">Caveat — ${esc(c.offer.caveat)}</div>` : ''}
                        </td></tr>
                      </table>
                    </td>
                  </tr>` : ''}

                  <tr>
                    <td style="padding:12px 0 0 0;">
                      <div style="${MONO} font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:${C.weak}; padding-bottom:3px;">${c.possiblePathSummary ? 'Possible path' : 'Who to approach'}</div>
                      ${c.possiblePathSummary
                        ? `<div style="${SANS} font-style:italic; font-size:13px; line-height:20px; color:${C.muted};">${esc(c.possiblePathSummary)}</div>`
                        : c.contacts.length
                        ? `<div style="${SANS} font-size:12px; line-height:18px; color:${C.weak}; padding-bottom:3px;">No connection found in the graph, so this is ${esc(c.name)} directly.</div>`
                          + c.contacts.map((p) => `<div style="${SANS} font-size:13px; line-height:20px; color:${C.ink};">
                            <span style="font-weight:600;">${esc(p.name)}</span>${p.title ? ` <span style="color:${C.muted};">· ${esc(p.title)}</span>` : ''}${p.email ? ` · <a href="mailto:${esc(p.email)}" style="color:${C.primary};">${esc(p.email)}</a>` : p.profileUrl ? ` · <a href="${esc(p.profileUrl)}" style="color:${C.primary};">profile</a>` : ''}
                          </div>`).join('')
                        : `<div style="${SANS} font-style:italic; font-size:13px; line-height:20px; color:${C.muted};">No connection and no named contact yet. Nothing public has been scraped for ${esc(c.name)}, which is not the same as nothing existing.</div>`}
                    </td>
                  </tr>

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
 * The compact entry: heading, score and one line. Used once a section is long
 * enough that the reader is scanning — twenty full cases is a wall, and the
 * dashboard is where the rest of the argument lives.
 */
function briefCard(c: DashboardCompany, appBaseUrl: string, withWhy: boolean): string {
  const why = c.whyNow[0]?.text ?? '';
  return `
      <tr>
        <td style="padding:0 0 3px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="width:100%; border-bottom:1px solid ${C.hairline};">
            <tr>
              <td style="padding:11px 2px 11px 0;">
                <div>
                  <a href="${esc(appBaseUrl)}/company/${c.companyId}" style="${SERIF} font-size:17px; color:${C.ink}; text-decoration:underline; text-decoration-color:${C.primary}; text-underline-offset:3px;">${esc(c.name)}</a>
                  &nbsp;${badge(c.trigger.score)}
                </div>
                <div style="${SANS} font-size:14px; line-height:20px; padding-top:3px;">
                  <a href="${esc(c.trigger.source.url)}" style="color:${C.primary}; text-decoration:underline; text-underline-offset:2px;">${esc(c.trigger.headline)}</a>
                </div>
                ${withWhy && why ? `<div style="${SANS} font-size:13px; line-height:19px; color:${C.muted}; padding-top:2px;">${esc(why)}</div>` : ''}
                <div style="${SANS} font-size:12px; line-height:17px; color:${C.weak}; padding-top:3px;">
                  ${esc(c.trigger.source.name)}
                  ${c.checkFirst ? ` · <span style="color:${C.caution};">check first: export control</span>` : ''}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

/*
 * No subtitle, matching the dashboard: the title names the section, and a line
 * explaining what the tool can and cannot argue is the tool talking about
 * itself.
 */
/**
 * How many companies an email section shows at all.
 *
 * The dashboard caps a section at 25 because scrolling a page is cheap, but the
 * same 25 in an inbox is a document — the last send ran to 2,600 words. Eight
 * is a section somebody reads to the end, and the count in the heading still
 * says how many cleared the bar, with the rest one link away.
 */
const EMAIL_SECTION_CAP = 8;

function sectionBlock(
  title: string, list: DashboardCompany[], appBaseUrl: string,
): string {
  if (!list.length) return '';
  const total = list.length;
  list = list.slice(0, EMAIL_SECTION_CAP);
  const cards = list.map((c, i) => {
    const d = detailFor(i);
    return d === 'full' ? fullCard(c, appBaseUrl) : briefCard(c, appBaseUrl, d === 'brief');
  }).join('');

  const more = total > list.length ? `
      <tr>
        <td style="${SANS} font-size:13px; line-height:20px; color:${C.weak}; padding:12px 0 4px 0;">
          ${total - list.length} more cleared the same bar &mdash;
          <a href="${esc(appBaseUrl)}" style="color:${C.primary}; text-decoration:underline;">open the dashboard</a>.
        </td>
      </tr>` : '';

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
          out.push('    Why now:');
          for (const w of c.whyNow.slice(0, 4)) out.push(`      - ${w.text}`);
        }
        if (c.offer) {
          out.push(`    Singapore could offer: ${c.offer.title}`);
          if (c.offer.precedent) out.push(`      Precedent: ${c.offer.precedent}`);
          if (c.offer.caveat) out.push(`      Caveat: ${c.offer.caveat}`);
        }
        if (c.possiblePathSummary) {
          out.push(`    Possible path: ${c.possiblePathSummary}`);
        } else if (c.contacts.length) {
          out.push(`    Who to approach (no connection found, so ${c.name} directly):`);
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
