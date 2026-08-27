/**
 * Singapore value proposition per featured company. Brief §10 ("Why EDB" and
 * the condensed opportunity structure), grounded in lib/valueprops.ts.
 *
 * Selection is deterministic rather than a free-text model answer. Every claim
 * in a proposition is something a regional director may repeat to a founder, so
 * it has to be traceable. valueprops.ts already carries publicly-sourced, dated
 * evidence with `fits` / `avoidWhen` lists and a status tier; this module picks
 * from that set and asks the model only to write the sentence. Given a fixed
 * menu and told to name the one it used, it cannot reach for a capability
 * Singapore does not have.
 *
 * The status tier is load-bearing (valueprops.ts):
 *   established — describable as available today
 *   committed   — announced and funded, so described as underway
 *   exploratory — a hypothesis, framed as a question rather than an offer
 * Collapsing those would have EDB promising things that do not exist yet.
 */
import { VALUE_PROPS, type ValueProp } from './valueprops';
import { callJson } from './llm';
import { search } from './search-providers';
import type { Budget } from './budget';

export const PROPOSITION_VERSION = 'prop-v2';

/**
 * Public Singapore precedent in a company's space.
 *
 * A capability claim is stronger when it names something that already happened.
 * "Singapore has a semiconductor ecosystem" is a brochure line; "GlobalFoundries
 * and Micron both run fabs here, and Micron broke ground on a US$24bn NAND fab
 * in January 2026" is a fact a founder can check. valueprops.ts carries the
 * standing evidence; this looks for whether something MORE RECENT or more
 * specific to this company's niche exists in the public record.
 *
 * PUBLIC SOURCES ONLY, and only what a search index already crawled — EDB and
 * agency press releases, government announcements, reported news. Nothing here
 * touches internal material, and the hits are passed to the model as candidate
 * evidence rather than as facts: it is told to use one only if it genuinely
 * fits, and never to cite a figure it cannot date.
 */
export type Precedent = { title: string; url: string; snippet: string };

/**
 * Search for what Singapore has already done in this company's space.
 *
 * Scoped to the SECTOR and the plausible engagement rather than the company
 * name: the question is what precedent an RD could point to, and a company that
 * has never touched Singapore still has a sector that has.
 */
export async function findPrecedent(sectors: string[], engagement: string): Promise<Precedent[]> {
  const sectorTerm = sectors.includes('biotech') ? 'biomedical'
    : sectors.includes('defence_tech') ? 'aerospace defence'
    : sectors.includes('deeptech') ? 'semiconductor'
    : sectors.includes('ai') ? 'artificial intelligence'
    : 'technology';

  /**
   * Site-restricted first. A general query returns US trade schools and vendor
   * blogs — measured — because the sector terms dominate and "Singapore" gets
   * treated as one keyword among many. Restricting to the agencies that publish
   * the precedent is what makes the result usable, and a second unrestricted
   * pass catches reported news the agencies did not publish themselves.
   */
  const queries = [
    `site:edb.gov.sg OR site:a-star.edu.sg OR site:imda.gov.sg OR site:mti.gov.sg ${sectorTerm} investment partnership`,
    `"Singapore" ${sectorTerm} EDB investment announcement facility OR partnership OR "research collaboration"`,
  ];

  const seen = new Set<string>();
  const out: Precedent[] = [];
  for (const q of queries) {
    try {
      // Recent only: older precedent is already carried by valueprops.ts.
      const hits = await search(q, { maxResults: 5, recencyDays: 730 });
      for (const h of hits) {
        // A hit that mentions Singapore nowhere is not precedent, whatever it
        // ranked for. Cheap check, and it removes most of the noise.
        const hay = `${h.title} ${h.description ?? ''} ${h.url}`.toLowerCase();
        if (!/singapore|\.sg\b|a-?star|edb\b/.test(hay)) continue;
        if (seen.has(h.url)) continue;
        seen.add(h.url);
        out.push({ title: h.title, url: h.url, snippet: (h.description ?? '').slice(0, 260) });
      }
    } catch {
      // A failed search must never block the digest. No precedent simply means
      // the proposition rests on valueprops.ts alone, which is already sourced.
    }
    if (out.length >= 4) break;
  }
  return out.slice(0, 4);
}

export type PropositionInput = {
  companyName: string;
  sectors: string[];
  /** The engagement the company assessment judged plausible — the anchor. */
  assessmentRationale: string | null;
  singaporeFit: string | null;
  targetPriority: string | null;
  /** The trigger this week. A proposition with no why-now is not ready (§10). */
  triggerTitle: string;
  triggerWhy: string;
  /** Public Singapore precedent, from findPrecedent(). Optional. */
  precedent?: Precedent[];
};

export type Proposition = {
  /** id from VALUE_PROPS — never free text, so the claim stays traceable. */
  propId: string;
  propTitle: string;
  status: ValueProp['status'];
  /** One or two sentences an RD could say out loud. */
  line: string;
  /** What is NOT being claimed, when an avoidWhen applies. Honesty beats polish. */
  caveat: string | null;
  /**
   * What the precedent IS, in one sentence. A bare url makes a reader open a
   * page to find out whether it is relevant; the sentence is the claim and the
   * url is how it gets checked.
   */
  precedent: string | null;
  /** The public precedent cited, if the model used one. Always checkable. */
  precedentUrl: string | null;
  /**
   * Set when the substance proposition is carried by a commercial argument —
   * only ever 'organised_demand'. Recorded separately so the digest can show
   * that the hook is revenue and the goal is something else, rather than
   * leaving a reader to guess which half is the offer.
   */
  framedBy: string | null;
};

/**
 * Candidate props for a company, before the model chooses.
 * Sector-matched plus cross-sector, which is what valuePropsForPrompt does —
 * repeated here because we need the objects, not the prompt text.
 */
export function candidateProps(sectors: string[]): ValueProp[] {
  const s = sectors ?? [];
  return VALUE_PROPS.filter(
    (v) => v.sectors.some((x) => s.includes(x)) || v.sectors.includes('cross_sector'),
  );
}

const SYSTEM = `You write the Singapore value proposition line for one company in an internal EDB digest.

You are given a MENU of Singapore's value propositions. Every one carries public, dated evidence. You must PICK EXACTLY ONE from the menu and name its id. You may not invent a proposition, a programme, a figure or a capability that is not on the menu.

HARD RULES:
- Pick ONE as the substance. A line listing several reads as a brochure.

- ONE EXCEPTION, used SPARINGLY: [organised_demand] may be paired with a second
  proposition as the commercial justification for it. This applies where the
  company's own activity shows it needs reference customers or a regulated
  proving ground, and a specific institutional buyer can be named. It is not a
  default framing — most propositions stand on capability alone, and attaching a
  commercial hook to every one makes the digest read as a sales script. Where it
  genuinely is the shape of the deal, name the substance proposition in prop_id
  and set framed_by to "organised_demand".
  Use this ONLY where Singapore buyers in this field are ALREADY ADOPTING comparable
  technology, not merely interested. Reachable is not the same as ready: offering to
  convene end users in a field where local operators are still watching produces a
  pilot that never starts and burns the relationship, because the company staffed
  against a market that was not there. If you cannot name a specific institutional
  buyer and say what it is already doing, do not pair — pick the substance
  proposition alone.
- Tie it to the TRIGGER — what just happened at this company. If you cannot connect the proposition to the trigger, say so in the caveat rather than forcing it.
- STATUS DISCIPLINE. 'established' may be described as available. 'committed' must be described as underway or planned, never as available today. 'exploratory' must be framed as a question, never as an offer.
- NEVER PITCH COST. Singapore is a high-cost location by design and the recipient knows it. The argument is capability, trust, capital, regulatory speed, ecosystem density.
- If an 'avoid when' condition on your chosen proposition plausibly applies to this company, SAY SO in the caveat. An honest caveat is more useful than a clean line — a regional director who repeats a claim that does not hold looks foolish in front of a founder.
- Cite at most ONE piece of evidence, and only if directly relevant. Never cite a figure you cannot date.
- Never name grant schemes, incentive quantums or programme budgets.
- Aim at real activity — engineering, pilot production, deployment, research — not a holding entity.
- The line is at most 40 words. It is a prompt for a conversation, not the conversation.

- WRITE IN THE THIRD PERSON, for a colleague reading about the company. "Singapore's semiconductor ecosystem could support Etched's ASIC design work" — never "your Series D" or "tap Singapore's". This is an internal briefing note, not an outreach email; a line addressed to the company reads as a draft someone forgot to rewrite.

RECENT PUBLIC PRECEDENT may also be supplied — things Singapore has already done in this space, from public news and government announcements. Use ONE only if it genuinely strengthens the line for THIS company. Ignore anything off-topic, undated or promotional. An unused precedent is a normal outcome; a forced one is worse than none.

If you use one, STATE WHAT IT IS in the precedent field — a single sentence naming what happened, who was involved and roughly when, so a reader knows the precedent without opening the link. "Rolls-Royce and EDB partnered to build aerospace engineering capability in Singapore" is useful; a bare url is not. Return its url in precedent_url so the claim stays checkable.

Return ONE JSON object, no prose, no markdown fences:
{"prop_id":"<exact id from the menu>","framed_by":"<organised_demand, or empty string>","line":"<= 40 words","caveat":"<= 20 words, or empty string if none applies","precedent":"<one sentence naming what happened, or empty string>","precedent_url":"<url you cited, or empty string>"}`;

export function buildPropositionPrompt(input: PropositionInput, props: ValueProp[]): string {
  const menu = props.map((v) =>
    `[${v.id}] (${v.status.toUpperCase()}) ${v.title}\n` +
    `${v.description}\n` +
    `Fits: ${v.fits.join('; ')}\n` +
    `Avoid when: ${v.avoidWhen.join('; ')}`,
  ).join('\n\n');

  const precedent = input.precedent?.length
    ? `\n\nRECENT PUBLIC PRECEDENT (use at most one, only if it fits):\n\n${
        input.precedent.map((p) => `- ${p.title}\n  ${p.snippet}\n  ${p.url}`).join('\n')}`
    : '';

  return `COMPANY: ${input.companyName}
Sectors: ${input.sectors.join(', ') || 'not recorded'}
Assessment: ${input.targetPriority ?? 'unassessed'} priority, Singapore fit ${input.singaporeFit ?? 'unassessed'}
${input.assessmentRationale ? `Plausible engagement already identified: ${input.assessmentRationale}` : ''}

TRIGGER THIS WEEK: ${input.triggerTitle}
Why it surfaced: ${input.triggerWhy}

MENU OF SINGAPORE VALUE PROPOSITIONS — pick exactly one:

${menu}${precedent}`;
}

/**
 * Write the proposition for one company. Returns null rather than a guess when
 * the model fails or picks something not on the menu — a missing line is
 * honest, a fabricated one is not.
 */
export async function writeProposition(
  input: PropositionInput,
  opts: { budget?: Budget; model?: string } = {},
): Promise<Proposition | null> {
  const props = candidateProps(input.sectors);
  if (!props.length) return null;

  const res = await callJson<{
    prop_id: string; framed_by?: string; line: string; caveat: string;
    precedent?: string; precedent_url?: string;
  }>({
    system: SYSTEM,
    user: buildPropositionPrompt(input, props),
    budget: opts.budget,
    model: opts.model,
    temperature: 0.2,
  });
  if (!res.ok || !res.data) return null;

  // The id MUST be one we offered. A model that invents an id has invented a
  // capability, which is the failure this whole module exists to prevent.
  const chosen = props.find((p) => p.id === res.data!.prop_id);
  if (!chosen) return null;

  const line = String(res.data.line ?? '').trim();
  if (!line) return null;

  // Only accept a precedent url we actually supplied: a model returning a url
  // of its own has invented a source, which is the failure this guards against.
  const cited = String(res.data.precedent_url ?? '').trim();
  const precedentUrl = cited && (input.precedent ?? []).some((p) => p.url === cited) ? cited : null;

  // Only organised_demand may frame another proposition, and never itself.
  const framedRaw = String(res.data.framed_by ?? '').trim();
  const framedBy = framedRaw === 'organised_demand' && chosen.id !== 'organised_demand'
    ? 'organised_demand' : null;

  // The sentence and the url travel together: a precedent nobody can state is
  // not a precedent, and a statement nobody can check is not evidence.
  const precedentText = String(res.data.precedent ?? '').trim() || null;

  return {
    propId: chosen.id,
    propTitle: chosen.title,
    status: chosen.status,
    line,
    caveat: String(res.data.caveat ?? '').trim() || null,
    precedent: precedentUrl ? precedentText : null,
    precedentUrl: precedentText ? precedentUrl : null,
    framedBy,
  };
}

/** How a status should be spoken about, for the UI to render alongside the line. */
export const STATUS_NOTE: Record<ValueProp['status'], string> = {
  established: 'available now',
  committed: 'announced and funded, not yet delivered',
  exploratory: 'a hypothesis, not an offer',
};
