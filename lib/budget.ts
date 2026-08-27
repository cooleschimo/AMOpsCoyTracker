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

/**
 * What each provider is actually limited by. A provider absent from here is
 * tracked but never pre-emptively halted — its own 429 is the signal, which is
 * the honest default for a limit we have not verified.
 */
export const PROVIDER_LIMITS: Record<string, { tpd?: number; rpd?: number }> = {
  groq: { tpd: LIMITS.tpdSoftStop, rpd: LIMITS.rpd },
  groq2: { tpd: LIMITS.tpdSoftStop, rpd: LIMITS.rpd },
  // GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20.
  gemini: { rpd: 20 },
  gemini2: { rpd: 20 },
  gemini3: { rpd: 20 },
};

type Spend = { tokensIn: number; tokensOut: number; requests: number; exhausted: string | null };

export class Budget {
  private byProvider = new Map<string, Spend>();
  halted = false;
  haltReason: string | null = null;

  constructor(private priorTokensToday = 0) {}

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
