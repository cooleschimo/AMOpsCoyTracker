/**
 * What kind of night it was. Brief §2a.
 *
 * DEBUGGING.md §2 names the failures that actually occur. Recognising them is a
 * pattern match, not an investigation, and the patterns are stable enough to
 * write down — so they are written down here rather than left for a person to
 * make every morning, or for a model to make less reliably at the cost of the
 * allowance that is usually the thing in question.
 *
 * Read from state, not from the log. The resume step already asks the database
 * which stage to restart from rather than parsing stdout, and for the same
 * reasons: a message gets reworded, a grep matches the workflow echoing its own
 * script, and a process killed before it printed leaves nothing to match. Every
 * verdict below is decided from a row someone already wrote.
 *
 * `partial` is the one that earns its keep. A run that spends its allowance and
 * skips the rest is working as designed — each stage is `--limit` capped and
 * the backlog carries to the next run — and reporting it as failure is a red
 * every morning that says nothing, which is a red nobody reads.
 */

/** Ordered worst-first: a run that is several of these is reported as the worst. */
export type Verdict =
  | 'config'      // a credential or setting is absent; nothing can run
  | 'credential'  // a key is rejected, not spent; it is not coming back on its own
  | 'broken'      // work that should have happened did not, and nothing excuses it
  | 'deadline'    // stopped at the time limit with stages left; resume picks it up
  | 'partial'     // did the half it could afford; the rest waits for the caps to reset
  | 'healthy';

export type VerdictReason = {
  verdict: Verdict;
  /** One line, for the workflow annotation and the step summary. */
  what: string;
  /** Stable slug for anything that wants to branch without matching prose. */
  code: string;
  /** Exit 1 only for the ones a person must act on. */
  exit: 0 | 1;
};

const RANK: Record<Verdict, number> = {
  config: 0, credential: 1, broken: 2, deadline: 3, partial: 4, healthy: 5,
};

/**
 * The worst of what was found, or healthy when nothing was.
 *
 * Severity first, category second. Two findings can share a category and not a
 * severity — a dead feed and a dozen stages that never ran are both `broken` —
 * and the one that decided the exit code is the one the verdict has to name,
 * or the summary explains a red morning with a warning.
 */
export function worst(found: VerdictReason[]): VerdictReason {
  if (!found.length) {
    return { verdict: 'healthy', what: 'every stage ran', code: 'healthy', exit: 0 };
  }
  return [...found].sort((a, b) =>
    (b.exit - a.exit) || (RANK[a.verdict] - RANK[b.verdict]))[0];
}

/**
 * A key that authenticates but has no allowance left, told apart from one that
 * is rejected outright.
 *
 * lib/llm.ts already draws this line at the call — 401, 403 and Gemini's 400
 * "Invalid Auth key." mean the credential is wrong — and deliberately keeps a
 * rejected key out of provider_exhaustion, because a dead key has not spent
 * anything. The reason text it writes is what survives to be read here.
 */
const REJECTED = /invalid auth|api key not valid|invalid api key|unauthenticated|bad credential|\b40[13]\b|revoked/i;

export function isRejection(reason: string): boolean {
  return REJECTED.test(reason);
}
