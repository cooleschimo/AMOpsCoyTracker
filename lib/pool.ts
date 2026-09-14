/**
 * Run work several items at a time. Brief §3.
 *
 * Every rate limit in this pipeline is per KEY — lib/llm.ts throttles per key
 * for that reason — so twenty-two keys carry twenty-two separate allowances. A
 * stage that awaits one call at a time uses one of them and leaves the rest
 * idle, which is why scoring took eighty-six minutes against a forty-five
 * minute budget while most of the chain sat unused.
 *
 * A fixed pool rather than a chunked split: each worker takes the next item as
 * it frees up, so one slow call does not hold a whole chunk behind it.
 *
 * Kept well below the key count. Every worker walks the same chain in the same
 * order, so more workers than keys would queue them behind the first few rather
 * than spread them out, and a burst large enough to trip a provider costs more
 * than it saves.
 */

/** The default width. Four against twenty-two keys leaves room to spare. */
export const DEFAULT_WORKERS = 4;

/**
 * Read a --workers flag, falling back to the default.
 *
 * Every stage takes the same flag so a slow run can be widened without
 * remembering which name each script chose.
 */
export function workersFromArgs(argv: string[] = process.argv): number {
  const i = argv.indexOf('--workers');
  const raw = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_WORKERS;
}

/**
 * Apply `run` to every item, at most `width` at a time.
 *
 * `stop` is checked before each item is taken, so a halted budget ends the
 * stage promptly instead of after every worker has finished what it holds.
 *
 * Errors are not caught here. A stage that wants to log and continue should do
 * that inside `run`, which is where it knows what a failure means; letting one
 * escape stops the pool, which is right for a fault that would repeat.
 */
export async function pool<T>(
  items: readonly T[],
  width: number,
  run: (item: T, index: number) => Promise<void>,
  stop?: () => boolean,
): Promise<void> {
  let next = 0;
  const workers = Math.max(1, Math.min(width, items.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      if (stop?.()) return;
      const i = next++;
      if (i >= items.length) return;
      await run(items[i] as T, i);
    }
  }));
}

/** Split a list into batches of `size`, for stages that call per batch. */
export function batched<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}
