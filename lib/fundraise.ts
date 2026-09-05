/**
 * Reading a fundraise out of a headline.
 *
 * The early-stage section needs to know what round a company just raised and
 * how big it is. `companies.round_stage` and `companies.valuation_est` answer
 * that when they are populated, but they are stored fields filled from seed
 * research and hand-checked CSVs — 55% have a valuation, 70% a round — and a
 * rule that reads them silently guesses for the rest.
 *
 * The headline usually says it outright:
 *
 *   "Etched Raises $700M at $21B Valuation and Completes 1st Customer Delivery"
 *   "Hadrian Raises $1.37B Series D, Valuing Automated Defense Manufacturer at $7.87B"
 *   "Neros Raises $250M At $2.5B As The Army Bets On A Million Drones"
 *
 * So the news is read first and the stored field is the fallback, which is the
 * right way round: the item is this week's evidence, where the stored field is
 * whenever someone last looked.
 *
 * Nothing here guesses. A headline that does not state a round returns null for
 * the round, and the caller decides what to do about not knowing — which is not
 * the same as deciding the answer is zero.
 */

export type Fundraise = {
  /** Normalised round label, e.g. 'series_b'. Null when the headline omits it. */
  round: string | null;
  /** Amount raised, in USD. Null when the headline omits it. */
  amountUsd: number | null;
  /** Post-money valuation, in USD. Null when the headline omits it. */
  valuationUsd: number | null;
};

/**
 * A company going public, which is a financing event the round vocabulary has
 * no word for.
 *
 * Kept narrow on purpose. Four hundred headlines mentioning "IPO" in a four
 * month window contain twelve where a company is actually listing; the rest are
 * market commentary, share prices and "ahead of its IPO" — and treating those
 * as events would hand discovery a stream of stock tickers.
 *
 * So the company has to be the SUBJECT of the listing: it files, prices,
 * completes, begins trading, or goes public. A headline merely mentioning an
 * IPO is not one.
 */
const GOING_PUBLIC =
  /\b(to go public|goes public|going public|files? to go public|files? for (an? )?ipo|filed for (an? )?ipo|prices? (its )?ipo|completes? (its )?ipo|launches? (its )?ipo|begins? trading|to list on|lists? on|debuts? on (the )?(nasdaq|nyse|stock)|via (an? )?spac|spac (deal|merger)|direct listing)\b/i;

/**
 * Headlines that name an IPO without being about one happening: a share price,
 * a market wrap, a piece written before a listing. These outnumber the real
 * events by about thirty to one.
 */
const IPO_COMMENTARY =
  /\b(ahead of|await|awaits|investors await|what investors|stock (hits|falls|rises|jumps|gains|drops)|52-week|futures|shares? (fall|rise|jump|slide|gain|drop)|lackluster|inducement grant|listing rule|post-ipo|since (its )?ipo|ipo market|ipo window|ipo pipeline|could ipo|may ipo|might ipo|eyes? (an? )?ipo|weighs? (an? )?ipo|considers? (an? )?ipo)\b/i;

/** Whether a headline is a company actually going public. */
export function isGoingPublic(title: string, snippet?: string | null): boolean {
  const text = `${title} ${snippet ?? ''}`;
  if (IPO_COMMENTARY.test(text)) return false;
  return GOING_PUBLIC.test(text);
}

const MULTIPLIER: Record<string, number> = {
  k: 1e3, m: 1e6, b: 1e9, bn: 1e9, t: 1e12,
  thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12,
};

/** "$1.37B", "$700 million", "US$250m" -> a number. */
function money(raw: string): number | null {
  const m = raw.match(/(?:us\s*)?\$\s*([\d,]+(?:\.\d+)?)\s*(k|m|bn|b|t|thousand|million|billion|trillion)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = m[2] ? MULTIPLIER[m[2].toLowerCase()] ?? 1 : 1;
  return n * mult;
}

const ROUND_RE =
  /\b(pre[-\s]?seed|seed|series\s+([a-j])(?:\s*[-–]?\s*(?:ii|2|extension|ext))?|growth|late[-\s]stage|bridge|mezzanine)\b/i;

/**
 * The round, normalised to the vocabulary in lib/scope.ts ROUND_STAGES so a
 * parsed round and a stored one compare directly.
 */
export function parseRound(text: string): string | null {
  const m = text.match(ROUND_RE);
  if (!m) return null;
  const whole = m[1].toLowerCase();
  if (/pre[-\s]?seed/.test(whole)) return 'seed';
  if (whole === 'seed') return 'seed';
  if (m[2]) {
    const ext = /\b(ii|2|extension|ext)\b/i.test(m[0]) ? '_ext' : '';
    return `series_${m[2].toLowerCase()}${ext}`;
  }
  if (/growth|late/.test(whole)) return 'growth';
  return null;
}

/**
 * Read a fundraise from a headline. Returns null when the headline is not about
 * one — "residents raise concerns over planned facility" is not a funding round,
 * and neither is a fundraiser for fire victims.
 */
export function parseFundraise(title: string, snippet?: string | null): Fundraise | null {
  const text = `${title} ${snippet ?? ''}`;

  // "raise" has to be about money. These are the shapes that are not.
  if (/\braise[sd]?\s+(concerns?|questions?|doubts?|awareness|the\s+alarm|eyebrows)/i.test(text)) return null;
  if (/\bfundraiser\b/i.test(text) && !/\bseries\s+[a-j]\b/i.test(text)) return null;

  const goingPublic = isGoingPublic(title, snippet);

  const isRaise =
    /\b(raise[sd]?|raising|secure[sd]?|closes?|closed|lands?|nets?|banks?)\b[^.]{0,40}\$/i.test(text)
    || /\bseries\s+[a-j]\b/i.test(text)
    || /\b(funding|investment)\s+round\b/i.test(text)
    || /\bvaluation\b/i.test(text)
    || goingPublic;
  if (!isRaise) return null;

  // 'ipo' rather than a letter: a listing is not a lettered round, and calling
  // it one would put it in the early-stage bucket that lib/placement.ts reads.
  const round = goingPublic ? 'ipo' : parseRound(text);

  /**
   * Valuation and amount are both dollar figures, so which is which comes from
   * the words around them: "at $21B valuation" and "valuing … at $7.87B" mark a
   * valuation, and the amount is the figure attached to the raise itself.
   */
  const valMatch = text.match(
    /(?:at|valu(?:ation|ing|ed)(?:\s+(?:the\s+)?\w+){0,4}?\s+at)\s+((?:us\s*)?\$\s*[\d,.]+\s*(?:k|m|bn|b|t|thousand|million|billion|trillion)?)/i,
  ) ?? text.match(/((?:us\s*)?\$\s*[\d,.]+\s*(?:k|m|bn|b|t|billion|million)?)\s+valuation\b/i);
  const valuationUsd = valMatch ? money(valMatch[1]) : null;

  const amtMatch = text.match(
    /\b(?:raise[sd]?|raising|secure[sd]?|closes?|closed|lands?|nets?|banks?|round\s+of)\s+((?:us\s*)?\$\s*[\d,.]+\s*(?:k|m|bn|b|t|thousand|million|billion|trillion)?)/i,
  );
  let amountUsd = amtMatch ? money(amtMatch[1]) : null;

  // A single figure with no cue is the amount, not the valuation — a headline
  // naming one number about a raise is naming what was raised.
  if (amountUsd === null && valuationUsd === null) {
    const first = text.match(/(?:us\s*)?\$\s*[\d,.]+\s*(?:k|m|bn|b|t|thousand|million|billion|trillion)?/i);
    amountUsd = first ? money(first[0]) : null;
  }
  // The same figure cannot be both.
  if (amountUsd !== null && amountUsd === valuationUsd) amountUsd = null;

  if (round === null && amountUsd === null && valuationUsd === null) return null;
  return { round, amountUsd, valuationUsd };
}
