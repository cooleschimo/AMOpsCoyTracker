/**
 * Digest rendering. Brief §10.
 *
 * OUTLOOK IS THE CONSTRAINT, and it is not negotiable: Outlook renders mail
 * through Microsoft Word's HTML engine, so the rules below are hard limits, not
 * style preferences.
 *   - TABLE layout only. No flexbox, no grid, no float.
 *   - INLINE styles only. Outlook strips <style> blocks unreliably.
 *   - Web-safe fonts only. No web fonts.
 *   - Max 600px. Wider is cut off in the reading pane.
 *   - No background images.
 *   - A plaintext alternative always ships alongside.
 *
 * NO VOTING LINKS IN THE EMAIL (§10). Government mail security rewrites and
 * PRE-FETCHES urls, which would fabricate votes the moment the mail is
 * delivered. Every reaction happens on the dashboard, behind a [Review] link
 * that is safe to prefetch because it only opens a page.
 */
import { DETAIL_BUDGET, detailFor } from './placement';
import { EXPORT_CONTROLLED } from './subsectors';
import type { DigestPlan, Placed, Section } from './placement';

export type RenderRow = Placed & {
  title: string;
  url: string;
  why: string;
  source: string;
  potentialContribution: string | null;
  confidence: string | null;
  sectors: string[] | null;
  /** Warm path, when one has been REVIEWED. Never an unreviewed association (§8). */
  warmPath?: string | null;
  /** Which dimensions drive the contribution band — 'high' alone says nothing. */
  contributionDrivers?: string[] | null;
  /**
   * Why-now composed from the company's other scored items as well as this one.
   * `primary` marks the points from the item that surfaced it; the rest are
   * context the scorer could not see from a single item.
   */
  whyPointsMerged?: Array<{ text: string; primary: boolean; sourceType: string }> | null;
  /** Hiring evidence alongside a corporate event — §7 scores that pairing a 3. */
  coOccurrence?: boolean | null;
  /** Singapore's proposition for THIS company, selected from lib/valueprops.ts. */
  proposition?: {
    line: string; status: string; caveat: string | null;
    precedent?: string | null;
    precedentUrl?: string | null;
    /** 'organised_demand' when commercial access is the way into the engagement. */
    framedBy?: string | null;
  } | null;
  /** The model's own reasoning, shown when there is no full argument, so it can be corrected. */
  assessmentRationale?: string | null;
  assessmentConfidence?: string | null;
};

export type RenderInput = {
  weekOf: string;
  coverage: string;
  plan: DigestPlan;
  rows: Map<number, RenderRow>;
  /** Dashboard base, for [Review] links. */
  appBaseUrl: string;
};

const SECTION_TITLES: Partial<Record<Section, string>> = {
  worth_a_conversation: 'WORTH A CONVERSATION',
  new_on_the_radar: 'NEW ON THE RADAR',
  who_we_know: 'WHO WE KNOW',
};

const SECTION_NOTES: Partial<Record<Section, string>> = {
  worth_a_conversation: 'Companies we can argue for, with something happening now.',
  new_on_the_radar: 'Assessed and argued down — shown with the reasoning so you can disagree with it.',
  who_we_know: 'Companies you already know, where something moved this week.',
};

const ORDER: Section[] = ['worth_a_conversation', 'new_on_the_radar', 'who_we_know'];

/**
 * Google News RSS links are redirect wrappers ~400 characters long whose target
 * is base64 inside the path and NOT reliably decodable (Google changed the
 * encoding in 2024 — see lib/news-ingest.ts). They resolve correctly in a
 * browser, so they stay as the href; they are just useless to READ.
 */
export function isWrappedUrl(url: string): boolean {
  // Match the HOST, not the string start — the url carries a protocol prefix.
  return /^https?:\/\/(?:[\w-]+\.)*news\.google\.com\//i.test(url) && url.length > 120;
}

/** Escape for HTML attribute and text contexts. */
function esc(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Export-control flag. DESIGN_RATIONALE §14.
 *
 * ITAR/EAR-controlled US defence companies may be legally unable to site
 * engineering abroad regardless of how interested they are, so this is a
 * check to run BEFORE a regional director invests effort — not a reason to
 * drop the company. It is phrased as exposure to verify, because the tool
 * cannot know a given company's actual control status.
 */
export function exportControlFlag(sectors: string[] | null): string | null {
  return (sectors ?? []).some((s) => EXPORT_CONTROLLED.includes(s))
    ? 'US export controls (ITAR/EAR) may limit siting engineering abroad — verify before investing effort'
    : null;
}

/**
 * The why-now is stored as ' · '-joined points. Splitting it back out lets the
 * render show them as a list — a reader scanning fourteen items takes points
 * faster than a sentence, and the points are separately checkable.
 * A row written before the rubric asked for points is a single point, which
 * renders correctly as a one-item list.
 */
export function whyPoints(why: string): string[] {
  return (why ?? '').split(' · ').map((w) => w.trim()).filter(Boolean);
}

/**
 * A capability that is announced but not yet delivered needs saying so, because
 * an RD describing it as available would be wrong. One that exists today needs
 * no note.
 */
export function statusNote(status: string): string | null {
  if (/not yet delivered|announced and funded|committed/i.test(status)) {
    return 'not yet delivered — describe as planned';
  }
  if (/hypothesis|exploratory/i.test(status)) return 'a hypothesis, not an offer';
  return null;
}

/**
 * The palette from design/LOVABLE_PROMPT.md, so the Monday email and the
 * dashboard read as one tool. Colour carries meaning only — the accent marks
 * what is interactive, the warning tone marks a caveat, and nothing is coloured
 * for decoration.
 *
 * Inter first with a full fallback stack: a mail client that lacks it drops to
 * a neutral grotesque rather than a serif, and no client is asked to fetch a
 * webfont.
 */
const C = {
  page: '#F0EFEC',      // the surround, a shade darker than the sheet
  sheet: '#FAFAF9',     // warm off-white the content sits on
  ink: '#1A1A18',       // near-black
  body: '#3A3A36',      // body copy, softer than headings
  muted: '#6E6E68',     // labels and secondary lines
  faint: '#93938C',     // sources, timestamps
  rule: '#E2E0DA',      // hairline
  accent: '#3A5A78',    // muted blue: links only
  warn: '#7A5C2E',      // caveats and export-control notes
} as const;

const FONT = "font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;";

/**
 * A compact row: company, headline, one line of why. Used once a section is
 * long enough that the reader is scanning rather than reading — the argument
 * for each of twenty companies is a wall, and the dashboard is where the
 * detail belongs.
 */
function briefHtml(r: RenderRow, appBaseUrl: string, withWhy: boolean): string {
  const why = whyPoints(r.why)[0] ?? r.why;
  return `
        <tr>
          <td style="padding:0 0 14px 0;">
            <div style="${FONT} font-size:14px; line-height:20px; color:#1A1A18;">
              <span style="font-weight:600;">${esc(r.companyName)}</span>
              &nbsp;<a href="${esc(r.url)}" style="color:#3A5A78; text-decoration:none;">${esc(r.title)}</a>
            </div>
            ${withWhy && why ? `<div style="${FONT} font-size:13px; line-height:19px; color:#3A3A36; padding-top:1px;">${esc(why)}</div>` : ''}
            <div style="${FONT} font-size:12px; line-height:17px; color:#93938C; padding-top:2px;">
              ${esc(r.source)}${exportControlFlag(r.sectors) ? ' &nbsp;·&nbsp; <span style="color:#7A5C2E;">export control — check first</span>' : ''}
              &nbsp;·&nbsp;
              <a href="${esc(appBaseUrl)}/item/${r.itemId}" style="color:#3A5A78; text-decoration:underline;">Review</a>
            </div>
          </td>
        </tr>`;
}

function itemHtml(r: RenderRow, appBaseUrl: string): string {
  // "high" on its own is not a readable claim — name what it is high in, and
  // mark the whole thing as the model's estimate rather than a measurement.
  const drivers = (r.contributionDrivers ?? []).filter(Boolean);
  // Confidence is shown only when it is LOW. Marking every line as a model
  // judgement adds a caveat to each item to flag the occasional weak one; the
  // reader already knows the tool made the call.
  const lowConfidence = (r.confidence ?? '').toLowerCase() === 'low';
  const contribution = r.potentialContribution && r.potentialContribution !== 'unknown'
    ? `${esc(r.potentialContribution)}${drivers.length ? ` (${esc(drivers.join(', '))})` : ''}`
      + (lowConfidence ? ` <span style="color:#7A5C2E;">— thin evidence</span>` : '')
    : 'not assessed';

  // Rows, not divs. Every line is its own <tr> so Word cannot collapse them.
  const line = (label: string, value: string) => `
              <tr>
                <td style="${FONT} font-size:13px; line-height:19px; color:#3A3A36; padding:1px 0;">
                  <span style="color:#6E6E68;">${esc(label)}</span> ${value}
                </td>
              </tr>`;

  return `
        <tr>
          <td style="padding:0 0 26px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
              <tr>
                <td style="${FONT} font-size:16px; line-height:22px; color:#1A1A18; font-weight:600; padding:0;">
                  ${esc(r.companyName)}
                </td>
              </tr>
              <tr>
                <td style="${FONT} font-size:14px; line-height:21px; padding:1px 0 6px 0;">
                  <a href="${esc(r.url)}" style="color:#3A5A78; text-decoration:none;" title="Opens ${esc(r.source)} via Google News">${esc(r.title)}</a>
                </td>
              </tr>
              ${(r.whyPointsMerged?.length ?? 0) > 0
                ? `<tr><td style="${FONT} font-size:13px; line-height:19px; color:#3A3A36; padding:1px 0;">
                    <span style="color:#6E6E68;">Why now:</span></td></tr>`
                  + r.whyPointsMerged!.map((w) => `<tr><td style="${FONT} font-size:13px; line-height:19px; color:${w.primary ? '#333333' : '#555555'}; padding:0 0 0 14px;">&bull;&nbsp;${esc(w.text)}${w.primary ? '' : ` <span style="color:#93938C;">(${w.sourceType === 'ats' ? 'hiring' : 'also reported'})</span>`}</td></tr>`).join('')
                  + (r.coOccurrence ? `<tr><td style="${FONT} font-size:12px; line-height:18px; color:#3A5A78; padding:2px 0 0 14px;">Hiring and a corporate event in the same window.</td></tr>` : '')
                : whyPoints(r.why).length > 1
                ? `<tr><td style="${FONT} font-size:13px; line-height:19px; color:#3A3A36; padding:1px 0;">
                    <span style="color:#6E6E68;">Why now:</span></td></tr>`
                  + whyPoints(r.why).map((w) => `<tr><td style="${FONT} font-size:13px; line-height:19px; color:#3A3A36; padding:0 0 0 14px;">&bull;&nbsp;${esc(w)}</td></tr>`).join('')
                : line('Why now:', esc(r.why))}
              ${r.section !== 'new_on_the_radar' ? line('Why EDB:',
                  `${esc(String(r.targetPriority ?? 'unassessed'))} priority · Singapore fit ${esc(String(r.singaporeFit ?? 'unassessed'))}${r.familiarity === 'in_conversation' ? ' · already in conversation' : ''}`
                  + (r.assessmentRationale ? `<br><span style="color:#3A3A36;">${esc(r.assessmentRationale)}</span>` : ''))
                : ''}
              ${r.section !== 'new_on_the_radar' && r.proposition ? line('Singapore could offer:',
                  `${esc(r.proposition.line)}${statusNote(r.proposition.status) ? ` <span style="color:#7A5C2E;">${esc(statusNote(r.proposition.status)!)}</span>` : ''}${r.proposition.framedBy === 'organised_demand' ? ` <span style="color:#6E6E68;">Route in: access to Singapore end users is the commercial case that makes this worth their time.</span>` : ''}${r.proposition.precedent ? ` <span style="color:#3A3A36;">Precedent: ${esc(r.proposition.precedent)}${r.proposition.precedentUrl ? ` <a href="${esc(r.proposition.precedentUrl)}" style="color:#3A5A78;">source</a>` : ''}</span>` : ''}${r.proposition.caveat ? ` <span style="color:#7A5C2E;">Caveat: ${esc(r.proposition.caveat)}</span>` : ''}`)
                : ''}
              ${r.section === 'new_on_the_radar' && r.assessmentRationale ? line('Not yet a priority because:',
                  `${esc(r.assessmentRationale)}${(r.assessmentConfidence ?? '').toLowerCase() === 'low' ? ' <span style="color:#7A5C2E;">— thin evidence, correct it if it is wrong</span>' : ''}`)
                : ''}
              ${r.section === 'new_on_the_radar' && !r.assessmentRationale ? line('Assessment:',
                  '<span style="color:#93938C;">not yet assessed \u2014 shown because the trigger is strong</span>')
                : ''}
              ${r.section !== 'new_on_the_radar' && r.warmPath ? line('Possible path:', esc(r.warmPath)) : ''}
              ${r.section !== 'new_on_the_radar' ? line('Potential value:', contribution) : ''}
              ${exportControlFlag(r.sectors) ? line('Check first:', esc(exportControlFlag(r.sectors)!)) : ''}
              <tr>
                <td style="${FONT} font-size:12px; line-height:18px; color:#93938C; padding:4px 0 0 0;">
                  ${esc(r.source)}
                  &nbsp;·&nbsp;
                  <a href="${esc(appBaseUrl)}/item/${r.itemId}" style="color:#3A5A78; text-decoration:underline;">Review</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

export function renderHtml(input: RenderInput): string {
  const { plan, rows, appBaseUrl } = input;

  let body = '';
  for (const sec of ORDER) {
    const items = plan.sections[sec].map((p) => rows.get(p.itemId)).filter(Boolean) as RenderRow[];
    if (!items.length) continue;
    body += `
        <tr>
          <td style="padding:34px 0 12px 0; border-top:1px solid #E2E0DA;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="${FONT} font-size:11px; letter-spacing:1.4px; text-transform:uppercase; color:#6E6E68; font-weight:600;">
                ${esc(SECTION_TITLES[sec] ?? sec)}
              </td></tr>
              <tr><td style="${FONT} font-size:13px; line-height:19px; color:#93938C; padding:4px 0 0 0;">
                ${esc(SECTION_NOTES[sec] ?? '')}
              </td></tr>
            </table>
          </td>
        </tr>${items.map((r, i) => {
          const d = detailFor(i);
          return d === 'full' ? itemHtml(r, appBaseUrl) : briefHtml(r, appBaseUrl, d === 'brief');
        }).join('')}${items.length > DETAIL_BUDGET.full ? `
        <tr>
          <td style="${FONT} font-size:12px; line-height:18px; color:#93938C; padding:2px 0 6px 0;">
            The first ${DETAIL_BUDGET.full} carry the full case. The rest cleared the same bar &mdash;
            <a href="${esc(appBaseUrl)}" style="color:#3A5A78; text-decoration:underline;">open the dashboard</a> for the argument on any of them.
          </td>
        </tr>` : ''}`;
  }

  // The exploration slot is SUBTLY tagged (§10) — present, labelled, not sold.
  if (plan.exploration) {
    const r = rows.get(plan.exploration.itemId);
    if (r) {
      body += `
        <tr>
          <td style="padding:34px 0 12px 0; border-top:1px solid #E2E0DA;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="${FONT} font-size:11px; letter-spacing:1.4px; text-transform:uppercase; color:#93938C; font-weight:600;">One to consider</td></tr>
              <tr><td style="${FONT} font-size:13px; line-height:19px; color:#93938C; padding:4px 0 0 0;">
                Outside the usual ranking, included so the list does not go blind to a category.
              </td></tr>
            </table>
          </td>
        </tr>${itemHtml(r, appBaseUrl)}`;
    }
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FDI signals — week of ${esc(input.weekOf)}</title>
</head>
<body style="margin:0; padding:0; background-color:#F0EFEC;">
  <!-- 640px table layout. Outlook renders through Word: no flexbox, no grid. -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F0EFEC;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:640px; max-width:640px; background-color:#FAFAF9;">
          <tr>
            <td style="padding:34px 34px 0 34px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="${FONT} font-size:22px; line-height:29px; color:#1A1A18; font-weight:600; letter-spacing:-0.2px;">
                  FDI signals
                </td></tr>
                <tr><td style="${FONT} font-size:13px; line-height:19px; color:#6E6E68; padding:3px 0 0 0;">
                  Week of ${esc(input.weekOf)}
                </td></tr>
                <tr><td style="${FONT} font-size:13px; line-height:19px; color:#93938C; padding:9px 0 0 0;">
                  ${esc(input.coverage)}
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 34px 24px 34px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${body}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 34px 30px 34px; border-top:1px solid #E2E0DA;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="${FONT} font-size:11px; line-height:17px; color:#93938C; padding:14px 0 0 0;">
                  Reactions are recorded on the dashboard, not in this email.
                  Sources are linked on every item; figures carry their source and date.
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

/** Plaintext alternative. §10 requires one; some government clients show only this. */
export function renderText(input: RenderInput): string {
  const { plan, rows, appBaseUrl } = input;
  const out: string[] = [
    `FDI SIGNALS — week of ${input.weekOf}`,
    input.coverage,
    '',
  ];

  /** The compact form, matching briefHtml: name, headline, one line of why. */
  const briefBlock = (r: RenderRow, withWhy: boolean) => {
    out.push(`  ${r.companyName} — ${r.title}`);
    if (withWhy) {
      const why = whyPoints(r.why)[0] ?? r.why;
      if (why) out.push(`    ${why}`);
    }
    out.push(`    ${r.source} · ${appBaseUrl}/item/${r.itemId}`);
    out.push('');
  };

  const block = (r: RenderRow) => {
    out.push(`  ${r.companyName} — ${r.title}`);
    // A Google News wrapper is ~400 opaque characters. Printing it inline makes
    // the plaintext unreadable, and it tells the reader nothing about where the
    // link goes. Name the publisher instead and keep the link on the Review
    // page, which resolves it. Direct publisher URLs are printed as-is.
    out.push(isWrappedUrl(r.url) ? `    (${r.source} — open via Review link below)` : `    ${r.url}`);
    if (r.whyPointsMerged?.length) {
      out.push('    Why now:');
      for (const w of r.whyPointsMerged) {
        out.push(`      - ${w.text}${w.primary ? '' : ` (${w.sourceType === 'ats' ? 'hiring' : 'also reported'})`}`);
      }
      if (r.coOccurrence) out.push('      Hiring and a corporate event in the same window.');
    } else if (whyPoints(r.why).length > 1) {
      const pts = whyPoints(r.why);
      out.push('    Why now:');
      for (const w of pts) out.push(`      - ${w}`);
    } else {
      out.push(`    Why now: ${r.why}`);
    }

    if (r.section === 'who_we_know') {
    }

    // The full opportunity structure belongs only to the tier the tool can
    // argue for. A lighter entry that borrowed it would imply a case that has
    // not been made.
    if (r.section !== 'new_on_the_radar') {
      out.push(`    Why EDB: ${r.targetPriority ?? 'unassessed'} priority · Singapore fit ${r.singaporeFit ?? 'unassessed'}${r.familiarity === 'in_conversation' ? ' · already in conversation' : ''}`);
      if (r.assessmentRationale) out.push(`      ${r.assessmentRationale}`);
      if (r.proposition) {
        const note = statusNote(r.proposition.status);
        out.push(`    Singapore could offer: ${r.proposition.line}${note ? ` (${note})` : ''}`);
        if (r.proposition.framedBy === 'organised_demand') {
          out.push('      Route in: access to Singapore end users is the commercial case that makes this worth their time');
        }
        if (r.proposition.precedent) {
          out.push(`      Precedent: ${r.proposition.precedent}`);
          if (r.proposition.precedentUrl) out.push(`        ${r.proposition.precedentUrl}`);
        }
        if (r.proposition.caveat) out.push(`      Caveat: ${r.proposition.caveat}`);
      }
      if (r.warmPath) out.push(`    Possible path: ${r.warmPath}`);
      const dr = (r.contributionDrivers ?? []).filter(Boolean);
      const thin = (r.confidence ?? '').toLowerCase() === 'low';
      out.push(r.potentialContribution && r.potentialContribution !== 'unknown'
        ? `    Potential value: ${r.potentialContribution}${dr.length ? ` (${dr.join(', ')})` : ''}${thin ? ' — thin evidence' : ''}`
        : '    Potential value: not assessed');
    }

    // Expose the judgment rather than dressing it up: a regional director
    // correcting this reasoning is worth more than a better-phrased guess.
    if (r.section === 'new_on_the_radar') {
      out.push(r.assessmentRationale
        ? `    Not yet a priority because: ${r.assessmentRationale}`
        : '    Assessment: not yet assessed — shown because the trigger is strong');
      if (r.assessmentRationale && (r.assessmentConfidence ?? '').toLowerCase() === 'low') {
        out.push('      (thin evidence — correct it if it is wrong)');
      }
    }
    const flag = exportControlFlag(r.sectors);
    if (flag) out.push(`    Check first: ${flag}`);
    out.push(`    ${r.source} · Review: ${appBaseUrl}/item/${r.itemId}`);
    out.push('');
  };

  for (const sec of ORDER) {
    const items = plan.sections[sec].map((p) => rows.get(p.itemId)).filter(Boolean) as RenderRow[];
    if (!items.length) continue;
    out.push(`${SECTION_TITLES[sec] ?? sec}`);
    out.push('-'.repeat(60));
    items.forEach((r, i) => {
      const d = detailFor(i);
      if (d === 'full') block(r); else briefBlock(r, d === 'brief');
    });
    if (items.length > DETAIL_BUDGET.full) {
      out.push(`  The first ${DETAIL_BUDGET.full} carry the full case. The rest cleared the same bar —`);
      out.push(`  open ${appBaseUrl} for the argument on any of them.`);
      out.push('');
    }
  }

  if (plan.exploration) {
    const r = rows.get(plan.exploration.itemId);
    if (r) {
      out.push('ONE TO CONSIDER');
      out.push('-'.repeat(60));
      out.push('Outside the usual ranking, included so the list does not go blind to a category.');
      out.push('');
      block(r);
    }
  }

  out.push('Reactions are recorded on the dashboard, not in this email.');
  return out.join('\n');
}
