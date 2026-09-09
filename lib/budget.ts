/**
 * Token and request budget, tracked PER PROVIDER. Brief §7.
 *
 * The limits differ in KIND, not only in size, so one shared counter cannot
 * represent them:
 *   Groq free tier          30 RPM · 8K TPM · 1K RPD · 200K TPD — tokens bind
 *   Gemini free tier        20 REQUESTS per day per model — tokens are irrelevant
 *   OpenRouter free models  rate-limited per day, deprioritised when busy
 *
 * Counting Gemini's usage in tokens against Groq's 200K is meaningless, and a
 * shared counter stops a run on one provider's cap while the rest of the chain
 * still has room — quietly, since nothing errors.
 *
 * Exhaustion is therefore a property of a PROVIDER, and the run halts only when
 * every provider in the chain is spent. `Budget.exhausted(name)` is what the
 * failover consults; `halted` means the whole chain is done.
 */
export const LIMITS = {
  rpm: 30,
  tpm: 8_000,
  rpd: 1_000,
  tpd: 200_000,
  /** Safety margin: stop at 90% of the daily cap so a final batch cannot overshoot. */
  tpdSoftStop: 180_000,
};

type ProviderLimit = { tpd?: number; rpd?: number };

function numberedLimits(base: string, limit: ProviderLimit): Record<string, ProviderLimit> {
  return Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [i === 0 ? base : `${base}${i + 1}`, limit]),
  );
}

/**
 * What each provider is actually limited by. A provider absent from here is
 * tracked but never pre-emptively halted — its own 429 is the signal, which is
 * the honest default for a limit we have not verified.
 */
export const PROVIDER_LIMITS: Record<string, ProviderLimit> = {
  ...numberedLimits('groq', { tpd: LIMITS.tpdSoftStop, rpd: LIMITS.rpd }),
  // GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20.
  ...numberedLimits('gemini', { rpd: 20 }),
  /*
   * OpenRouter's free tier is 50 requests a day per account, which its 429
   * names outright: `openrouter_free_tier_daily`. Each key here is on its own
   * account, so each carries its own fifty — five keys, 250 a day.
   *
   * Recorded rather than left unmetered so a spent key is skipped instead of
   * being rediscovered by a 429 on every call. $10 of credit on an account
   * raises that account to 1,000 a day, which is the cheapest capacity
   * available to this pipeline by some distance.
   */
  ...numberedLimits('openrouter', { rpd: 50 }),
  /*
   * The first OpenRouter account carries $10 of credit, which takes it off the
   * free tier: 1,000 free-model requests a day rather than 50, and its key
   * endpoint reports is_free_tier false. Listed after the numbered defaults so
   * it overrides the 50 they set.
   *
   * THIS DEPENDS ON THE BALANCE STAYING ABOVE THE THRESHOLD. Calls to a :free
   * model should not draw it down — that is what free means, and the credit is
   * a threshold rather than a prepayment — but it has not been watched over a
   * real run yet. `npx tsx scripts/dev/openrouter-credit.ts` reads the balance
   * and the tier; if total_usage is climbing, free calls are being billed and
   * this number goes back to 50 when the balance is gone.
   *
   * The cap belongs to the ACCOUNT, so a key inherits whatever its account has.
   * Topping up another account means adding it here too.
   */
  openrouter: { rpd: 1000 },
};

type Spend = { tokensIn: number; tokensOut: number; requests: number; exhausted: string | null };

export class Budget {
  private byProvider = new Map<string, Spend>();
  halted = false;
  haltReason: string | null = null;

  constructor(private priorTokensToday = 0, spentToday: Iterable<[string, string]> = []) {
    // Keys already known spent today, from a previous run. Without this every
    // process starts blind and rediscovers each one with a wasted 429 — twelve
    // of them, on every call, once a day's capacity is mostly gone.
    for (const [name, reason] of spentToday) this.slot(name).exhausted = reason;
  }

  private slot(name: string): Spend {
    let s = this.byProvider.get(name);
    if (!s) { s = { tokensIn: 0, tokensOut: 0, requests: 0, exhausted: null }; this.byProvider.set(name, s); }
    return s;
  }

  get tokensIn() { return [...this.byProvider.values()].reduce((n, s) => n + s.tokensIn, 0); }
  get tokensOut() { return [...this.byProvider.values()].reduce((n, s) => n + s.tokensOut, 0); }
  get requests() { return [...this.byProvider.values()].reduce((n, s) => n + s.requests, 0); }
  get total() { return this.priorTokensToday + this.tokensIn + this.tokensOut; }

  /** Would this provider exceed its own allowance? Checked before each attempt. */
  canSpend(estimatedTokens: number, provider = 'groq'): boolean {
    const s = this.slot(provider);
    if (s.exhausted) return false;
    const lim = PROVIDER_LIMITS[provider];
    if (!lim) return true;                       // unverified limit: let the 429 speak
    if (lim.rpd !== undefined && s.requests >= lim.rpd) {
      this.markExhausted(provider, `request cap reached (${lim.rpd}/day)`);
      return false;
    }
    if (lim.tpd !== undefined && s.tokensIn + s.tokensOut + estimatedTokens > lim.tpd) {
      this.markExhausted(provider, `token cap approached (${s.tokensIn + s.tokensOut}/${lim.tpd})`);
      return false;
    }
    return true;
  }

  record(inTok: number, outTok: number, provider = 'groq') {
    const s = this.slot(provider);
    s.tokensIn += inTok; s.tokensOut += outTok; s.requests++;
  }

  /** Which providers this run found spent, for the next run to start from. */
  spentProviders(): Array<[string, string]> {
    return [...this.byProvider.entries()]
      .filter(([, s]) => s.exhausted)
      .map(([name, s]) => [name, s.exhausted as string]);
  }

  /** A provider is spent. The run continues on the rest of the chain. */
  markExhausted(provider: string, reason: string) {
    this.slot(provider).exhausted = reason;
  }

  exhausted(provider: string): boolean {
    return this.slot(provider).exhausted !== null;
  }

  /** Only true once every provider offered to the run is spent. */
  allExhausted(providers: string[]): boolean {
    return providers.length > 0 && providers.every((p) => this.exhausted(p));
  }

  halt(reason: string) { this.halted = true; this.haltReason = reason; }

  summary() {
    const per: Record<string, unknown> = {};
    for (const [name, s] of this.byProvider) {
      per[name] = { in: s.tokensIn, out: s.tokensOut, requests: s.requests, exhausted: s.exhausted };
    }
    return {
      tokens_in: this.tokensIn, tokens_out: this.tokensOut,
      requests: this.requests, halted: this.halted, halt_reason: this.haltReason,
      per_provider: per,
    };
  }
}

/** Rough token estimate (~4 chars/token). Only needs to be right within ~20%. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
