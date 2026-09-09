/**
 * Single entry point for every model call. Brief §3.
 *
 * Handles model and base URL from env, the per-run token budget tracked in
 * `runs`, RPM throttling, 429 retry with backoff, and one stricter retry on a
 * JSON parse failure before the batch is logged and skipped.
 *
 * One bad response leaves the rest of the run intact: every failure path here
 * returns null and records why, and nothing throws to the caller.
 *
 * Groq gotchas (brief §7, both real):
 *  - Groq expects all properties listed under `required` in a JSON schema.
 *  - Agent-framework wrappers forcing tool_choice: json_tool_call return HTTP
 *    400, so this calls the endpoint directly with fetch.
 */
import { env, llmProviders, type LlmProvider } from './env';
import { Budget, estimateTokens, LIMITS } from './budget';

export type LlmResult<T> = {
  ok: boolean;
  data: T | null;
  raw: string | null;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  model: string;
};

const lastCallTimes = new Map<string, number[]>();

/**
 * RPM throttle, PER KEY.
 *
 * The limit is a property of the key, not of this process: Groq allows 30 a
 * minute per key, so five Groq keys are 150 a minute. One shared counter
 * squeezed all fifteen keys through a single 30 RPM gate and left most of the
 * chain idle — the throttle, not the providers, was the ceiling.
 *
 * Keyed on the label ('groq3'), which is what identifies the key, rather than
 * on the vendor name.
 */
async function throttle(who: string) {
  const now = Date.now();
  const times = (lastCallTimes.get(who) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= LIMITS.rpm) {
    const waitMs = 60_000 - (now - times[0]) + 250;
    console.warn(`[llm] ${who} RPM throttle: waiting ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  times.push(Date.now());
  lastCallTimes.set(who, times);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strip markdown fences and prose around a JSON object. */
function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  const open = raw[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return raw.slice(start, i + 1); }
  }
  return null;
}

type CallOpts = {
  system: string;
  user: string;
  model?: string;
  budget?: Budget;
  /** JSON Schema. Groq requires every property listed in `required`. */
  schema?: Record<string, unknown>;
  /** Ask the provider for JSON mode. Set by callJson; not for callers to pass. */
  json?: boolean;
  maxRetries?: number;
  temperature?: number;
  /**
   * gpt-oss models emit internal reasoning before the answer, and it is billed.
   * Reasoning runs roughly 40% of all output tokens at the default setting and
   * about half that at 'low', which is the difference between a 200K daily cap
   * covering a few hundred items and a few thousand. Classification against a
   * fixed rubric does not need deep reasoning.
   * Groq accepts only low | medium | high — 'none' is a 400.
   */
  reasoningEffort?: 'low' | 'medium' | 'high';
};

type RawOk = { text: string; inTok: number; outTok: number; model: string };
type RawErr = { error: string; exhausted?: boolean; transient?: boolean };

async function rawCall(opts: CallOpts, stricter: boolean, provider: LlmProvider): Promise<RawOk | RawErr> {
  // opts.model only overrides within the PRIMARY provider; a fallback provider
  // uses its own model, since a Groq model id is meaningless to Gemini.
  const model = provider.name === 'groq' ? (opts.model ?? provider.model) : provider.model;
  const url = `${provider.baseUrl}/chat/completions`;
  const maxRetries = opts.maxRetries ?? 3;

  const system = stricter
    ? `${opts.system}\n\nCRITICAL: Respond with ONE valid JSON object and nothing else. No markdown fences, no commentary, no trailing text.`
    : opts.system;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: opts.user }],
    temperature: opts.temperature ?? 0.2,
  };
  /**
   * JSON mode whenever the caller wants JSON back.
   *
   * This used to key off `opts.schema`, which is optional — so a caller that
   * described its shape in the system prompt rather than passing a schema got
   * free-form text and was left to `extractJson` guessing. That is what emptied
   * an assessment run: 14 of 15 batches failed as "malformed JSON after
   * stricter retry", 154 companies unassessed, and an exit code of 0 over the
   * top of it. `json` is set by callJson for every call it makes.
   */
  if (opts.schema || opts.json) body.response_format = { type: 'json_object' };
  // Only the gpt-oss family accepts this parameter; sending it elsewhere 400s.
  if (opts.reasoningEffort && /gpt-oss/i.test(model)) body.reasoning_effort = opts.reasoningEffort;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await throttle(provider.label ?? provider.name);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        const detail = await res.text().catch(() => '');
        // A DAILY cap is not a rate limit: backing off cannot clear it, so the
        // caller moves to the next provider. A PER-MINUTE limit is the
        // opposite — waiting is exactly right.
        //
        // NEITHER the prose NOR the retry delay distinguishes them reliably:
        //  - matching the word 'quota' misreads every Google 429 (their
        //    per-minute message also says "Quota exceeded");
        //  - Google returns a SHORT retryDelay (~21s) even on a DAILY quota,
        //    so a small delay does not mean "wait and it clears".
        // The machine-readable discriminator is the structured quotaId, e.g.
        //   GenerateRequestsPerDayPerProjectPerModel-FreeTier   (daily)
        //   GenerateRequestsPerMinutePerProjectPerModel-FreeTier (per-minute)
        // gemini-3.6-flash's free tier is TWENTY requests PER DAY per project,
        // not per minute — ~240 items/key/day at 12 per request. A newer Flash
        // model does not carry the 9,000 RPD figure published for older ones.
        const quotaIds = [...detail.matchAll(/"quotaId":\s*"([^"]+)"/g)].map((m) => m[1]);
        const perDayQuota = quotaIds.some((q) => /PerDay/i.test(q));
        const perMinuteQuota = quotaIds.some((q) => /PerMinute/i.test(q));
        const perDayProse = /per day|\bdaily\b|\bTPD\b|\bRPD\b|tokens per day/i.test(detail);

        if (perDayQuota || (!perMinuteQuota && perDayProse)) {
          return {
            error: `daily cap on ${provider.label ?? provider.name}: ${(quotaIds[0] ?? detail.slice(0, 120))}`,
            exhausted: true,
          };
        }
        const ra = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60_000, 2 ** attempt * 2_000);
        console.warn(`[llm] ${provider.label ?? provider.name} 429 (attempt ${attempt + 1}/${maxRetries + 1}); backing off ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 500) {
        const waitMs = Math.min(30_000, 2 ** attempt * 1_000);
        console.warn(`[llm] ${res.status} server error; retrying in ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        /**
         * JSON mode refusing its own generation. Groq validates the response
         * against `response_format` and 400s with `json_validate_failed` when
         * the model produced something that did not conform, rather than
         * returning the text for us to fix.
         *
         * That is a bad roll of the dice on one generation, not a bad request:
         * the identical prompt succeeds on a retry. Falling through to the
         * caller would spend a whole batch of companies on it.
         */
        if (res.status === 400 && /json_validate_failed/.test(detail)) {
          const waitMs = Math.min(10_000, 2 ** attempt * 500);
          console.warn(`[llm] ${provider.label ?? provider.name} rejected its own JSON (attempt ${attempt + 1}/${maxRetries + 1}); retrying in ${Math.round(waitMs / 1000)}s`);
          await sleep(waitMs);
          continue;
        }
        return { error: `HTTP ${res.status}: ${detail.slice(0, 300)}` };
      }

      const json = await res.json();
      const text: string = json?.choices?.[0]?.message?.content ?? '';
      const inTok: number = json?.usage?.prompt_tokens ?? estimateTokens(system + opts.user);
      const outTok: number = json?.usage?.completion_tokens ?? estimateTokens(text);
      opts.budget?.record(inTok, outTok, provider.label ?? provider.name);
      return { text, inTok, outTok, model };
    } catch (e) {
      const waitMs = Math.min(30_000, 2 ** attempt * 1_000);
      console.warn(`[llm] ${provider.label ?? provider.name} network error: ${(e as Error).message}; retrying in ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  /*
   * Out of attempts, which is NOT the same as out of capacity.
   *
   * A 503 or a dropped socket exhausts the retries here, and returning
   * `exhausted: true` told the failover to mark the provider spent for the rest
   * of the run — so one bad minute at Gemini barred it from every later call,
   * and the run walked the rest of the chain short a provider. Only a real
   * capacity signal (a daily cap, an auth failure) should retire a key; a
   * transient fault should cost this call and nothing more.
   *
   * `transient` still moves to the next provider for THIS call — the work has
   * to go somewhere — without recording the provider as finished.
   */
  return {
    error: `exhausted ${maxRetries + 1} attempts on ${provider.label ?? provider.name}`,
    exhausted: true,
    transient: true,
  };
}

/**
 * Try each configured provider in turn. FAILOVER IS FOR CAPACITY EXHAUSTION
 * ONLY — a malformed response or a bad request is not retried elsewhere,
 * because a second provider would fail the same way.
 *
 * Every result carries the model that produced it, and callers persist it
 * (scores.model). Rows from one run can therefore differ in model, which is
 * recorded rather than hidden: scores from different models are not strictly
 * comparable, and the column is what makes that visible.
 */
/**
 * Where the next call starts in the chain.
 *
 * Walking from the top every time spends the first provider's whole allowance
 * before the second is touched, which wastes the chain in two ways: the early
 * keys hit their cap while the later ones idle, and every call pays the cost of
 * re-checking providers that are already spent. One OpenRouter key sitting last
 * still out-produced any single Groq key, because it only ever saw the
 * overflow.
 *
 * Starting each call one place further along spreads the load evenly. The order
 * itself is unchanged, so failover still walks the whole chain from wherever it
 * begins, and an exhausted provider is still skipped rather than retried — the
 * rotation decides where to START, never whether to try.
 */
let rotation = 0;

async function callWithFailover(opts: CallOpts, stricter: boolean): Promise<RawOk | RawErr> {
  const chain = llmProviders();
  if (!chain.length) return { error: 'no LLM provider configured (set GROQ_API_KEY or another provider key)' };

  // Rotate the starting point, then walk the whole chain from there.
  const start = rotation++ % chain.length;
  const providers = [...chain.slice(start), ...chain.slice(0, start)];

  const names = providers.map((p) => p.label ?? p.name);
  let last: RawErr = { error: 'no provider attempted' };
  for (const p of providers) {
    const who = p.label ?? p.name;
    // Skip a provider already spent, and one whose own allowance this call
    // would exceed — both are reasons to move down the chain, not to stop.
    if (opts.budget?.exhausted(who)) continue;
    if (opts.budget && !opts.budget.canSpend(estimateTokens(opts.system + opts.user) + 800, who)) continue;
    const res = await rawCall(opts, stricter, p);
    if (!('error' in res)) return res;
    last = res;
    if (!res.exhausted) return res;   // a real error: do not mask it by retrying elsewhere

    /*
     * Record the exhaustion, so the next call skips this provider instead of
     * rediscovering it.
     *
     * Without this the budget only knows what its own counters saw, and a
     * provider whose daily cap the API itself reported was retried from the top
     * on every subsequent call. In a 212-company run that meant two spent keys
     * were re-attempted hundreds of times — one of them burning thirty seconds
     * of backoff each pass — while six configured keys further down the chain
     * were never reached at all.
     */
    // A transient fault moves the call along without retiring the provider: it
    // may well answer the next one.
    if (!res.transient) opts.budget?.markExhausted(who, res.error);
    if (providers.length > 1) {
      console.warn(`[llm] ${who} ${res.transient ? 'failed this call' : 'exhausted'}; trying next provider`);
    }
  }
  // Only now is the run genuinely out of capacity.
  if (opts.budget?.allExhausted(names)) {
    opts.budget.halt(`every provider exhausted: ${names.join(', ')}`);
  }
  return last;
}

/**
 * Call the model and parse JSON. Any failure returns ok:false with the reason
 * recorded rather than throwing.
 */
export async function callJson<T = unknown>(opts: CallOpts): Promise<LlmResult<T>> {
  let model = opts.model ?? env.groqModelScoring();
  const budget = opts.budget;

  // No pre-emptive gate here: whether capacity exists is a per-provider
  // question that callWithFailover answers as it walks the chain. A single
  // check against one provider's cap is what halted runs while others had room.
  if (budget?.halted) {
    return { ok: false, data: null, raw: null, error: `budget halted: ${budget.haltReason}`, tokensIn: 0, tokensOut: 0, model };
  }

  // Every call through here parses the response as JSON, so ask the provider
  // for JSON mode rather than leaving it to the system prompt to request.
  opts = { ...opts, json: true };

  // Attempt 1
  let res = await callWithFailover(opts, false);
  if ('error' in res) {
    return { ok: false, data: null, raw: null, error: res.error, tokensIn: 0, tokensOut: 0, model };
  }
  model = res.model;

  let candidate = extractJson(res.text);
  if (candidate) {
    try {
      return { ok: true, data: JSON.parse(candidate) as T, raw: res.text, error: null, tokensIn: res.inTok, tokensOut: res.outTok, model };
    } catch { /* fall through to the single stricter retry */ }
  }

  // Attempt 2: one stricter instruction, per the brief.
  console.warn('[llm] JSON parse failed; one stricter retry');
  if (budget?.halted) {
    return { ok: false, data: null, raw: res.text, error: 'malformed JSON; budget halted before retry', tokensIn: res.inTok, tokensOut: res.outTok, model };
  }
  const res2 = await callWithFailover(opts, true);
  if ('error' in res2) {
    return { ok: false, data: null, raw: res.text, error: `malformed JSON; retry failed: ${res2.error}`, tokensIn: res.inTok, tokensOut: res.outTok, model };
  }
  model = res2.model;

  candidate = extractJson(res2.text);
  if (candidate) {
    try {
      return { ok: true, data: JSON.parse(candidate) as T, raw: res2.text, error: null, tokensIn: res.inTok + res2.inTok, tokensOut: res.outTok + res2.outTok, model };
    } catch { /* logged and skipped below */ }
  }

  // Logged and skipped. The caller continues with the rest of the run.
  console.error('[llm] malformed JSON after stricter retry; skipping this batch');
  return {
    ok: false, data: null, raw: res2.text,
    error: 'malformed JSON after stricter retry (logged and skipped)',
    tokensIn: res.inTok + res2.inTok, tokensOut: res.outTok + res2.outTok, model,
  };
}

/** Connectivity + model availability probe. Used by scripts/check-llm.ts. */
export async function listModels(provider?: Pick<LlmProvider, 'apiKey' | 'baseUrl'>): Promise<string[]> {
  const res = await fetch(`${provider?.baseUrl ?? env.groqBaseUrl()}/models`, {
    headers: { Authorization: `Bearer ${provider?.apiKey ?? env.groqApiKey()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j?.data ?? []).map((m: { id: string }) => m.id).sort();
}
