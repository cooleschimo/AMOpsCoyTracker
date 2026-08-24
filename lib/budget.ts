/**
 * Token budget guard. Brief §7.
 *
 * VERIFIED 2026-08-21 (Groq free tier, openai/gpt-oss-120b):
 *   30 RPM · 8K TPM · 1K RPD · 200K TPD
 *
 * The daily TOKEN cap is what binds, and 8K TPM constrains batch size — a
 * 10-15 item batch must stay under 8K tokens including the system prompt.
 *
 * This halts CLEANLY and resumes: it never throws mid-run. A halted stage
 * records progress in runs.counts and the next invocation continues.
 */
export const LIMITS = {
  rpm: 30,
  tpm: 8_000,
  rpd: 1_000,
  tpd: 200_000,
  /** Safety margin: stop at 90% of the daily cap so a final batch cannot overshoot. */
  tpdSoftStop: 180_000,
};

export class Budget {
  tokensIn = 0;
  tokensOut = 0;
  requests = 0;
  halted = false;
  haltReason: string | null = null;

  constructor(private priorTokensToday = 0) {}

  get total() { return this.priorTokensToday + this.tokensIn + this.tokensOut; }

  /** Check BEFORE a call. False means stop cleanly — caller must not throw. */
  canSpend(estimatedTokens: number): boolean {
    if (this.halted) return false;
    if (this.requests >= LIMITS.rpd) {
      this.halt(`daily request cap reached (${LIMITS.rpd})`);
      return false;
    }
    if (this.total + estimatedTokens > LIMITS.tpdSoftStop) {
      this.halt(`daily token cap approached (${this.total}/${LIMITS.tpd}); resumes next run`);
      return false;
    }
    return true;
  }

  record(inTok: number, outTok: number) {
    this.tokensIn += inTok; this.tokensOut += outTok; this.requests++;
  }

  halt(reason: string) { this.halted = true; this.haltReason = reason; }

  summary() {
    return {
      tokens_in: this.tokensIn, tokens_out: this.tokensOut,
      requests: this.requests, halted: this.halted, halt_reason: this.haltReason,
    };
  }
}

/** Rough token estimate (~4 chars/token). Only needs to be right within ~20%. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
