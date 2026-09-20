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
 * Category decides which finding is named; severity decides the exit code, and
 * the two are answered separately because they disagree. Sorting on severity
 * first buries the categories that matter most: a rejected key reported as a
 * warning, beside a dozen stages that did not run, is a `credential` night
 * reported as `broken` — and `broken` does not say the key will still be
 * rejected tomorrow, which is the one thing that morning needed to know.
 *
 * Exit is the maximum over everything found, so a warn-level verdict still
 * reds the run when something else did. That is the guarantee severity-first
 * was reaching for, without letting it choose the name.
 *
 * Severity still breaks ties WITHIN a category, because two findings can share
 * one and only the louder explains the exit: a feed that has been down for
 * days and seventeen stages that did not run are both `broken`, and naming the
 * feed leaves the morning reading a warning where the error was.
 */
export function worst(found: VerdictReason[]): VerdictReason {
  if (!found.length) {
    return { verdict: 'healthy', what: 'every stage ran', code: 'healthy', exit: 0 };
  }
  const named = [...found].sort((a, b) =>
    (RANK[a.verdict] - RANK[b.verdict]) || (b.exit - a.exit))[0];
  const exit = found.some((f) => f.exit === 1) ? 1 : 0;
  return { ...named, exit };
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
