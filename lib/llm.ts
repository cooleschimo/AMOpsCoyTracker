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

let lastCallTimes: number[] = [];

/** RPM throttle: at most LIMITS.rpm calls in any rolling 60s. */
async function throttle() {
  const now = Date.now();
  lastCallTimes = lastCallTimes.filter((t) => now - t < 60_000);
  if (lastCallTimes.length >= LIMITS.rpm) {
    const waitMs = 60_000 - (now - lastCallTimes[0]) + 250;
    console.warn(`[llm] RPM throttle: waiting ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  lastCallTimes.push(Date.now());
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
type RawErr = { error: string; exhausted?: boolean };

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
  if (opts.schema) body.response_format = { type: 'json_object' };
  // Only the gpt-oss family accepts this parameter; sending it elsewhere 400s.
  if (opts.reasoningEffort && /gpt-oss/i.test(model)) body.reasoning_effort = opts.reasoningEffort;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await throttle();
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
  return { error: `exhausted ${maxRetries + 1} attempts on ${provider.label ?? provider.name}`, exhausted: true };
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
async function callWithFailover(opts: CallOpts, stricter: boolean): Promise<RawOk | RawErr> {
  const providers = llmProviders();
  if (!providers.length) return { error: 'no LLM provider configured (set GROQ_API_KEY or another provider key)' };

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
    opts.budget?.markExhausted(who, res.error);
    if (providers.length > 1) console.warn(`[llm] ${who} exhausted; trying next provider`);
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
