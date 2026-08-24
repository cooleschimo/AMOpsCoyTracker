/**
 * Single entry point for EVERY model call. Brief §3.
 *
 * Must handle (all required by the brief):
 *  - model + base URL from env
 *  - per-run token budget tracked in `runs`
 *  - RPM throttling
 *  - 429 retry with backoff
 *  - JSON parse failure retried ONCE with a stricter instruction, then logged
 *    and skipped
 *
 * THE HARD RULE: one bad response must NEVER kill a run. Every failure path
 * here returns null and records why; nothing throws to the caller.
 *
 * Groq gotchas (brief §7, both real):
 *  - Groq expects ALL properties listed under `required` in a JSON schema.
 *  - Agent-framework wrappers forcing tool_choice: json_tool_call return HTTP
 *    400 — so this calls the endpoint directly with fetch.
 */
import { env } from './env';
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

/** RPM throttle: never more than LIMITS.rpm calls in any rolling 60s. */
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
};

async function rawCall(opts: CallOpts, stricter: boolean): Promise<{ text: string; inTok: number; outTok: number } | { error: string }> {
  const model = opts.model ?? env.groqModelScoring();
  const url = `${env.groqBaseUrl()}/chat/completions`;
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

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.groqApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        // Respect Retry-After when present; otherwise exponential backoff.
        const ra = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60_000, 2 ** attempt * 2_000);
        console.warn(`[llm] 429 (attempt ${attempt + 1}/${maxRetries + 1}); backing off ${Math.round(waitMs / 1000)}s`);
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
      return { text, inTok, outTok };
    } catch (e) {
      const waitMs = Math.min(30_000, 2 ** attempt * 1_000);
      console.warn(`[llm] network error: ${(e as Error).message}; retrying in ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  return { error: `exhausted ${maxRetries + 1} attempts` };
}

/**
 * Call the model and parse JSON.
 * Never throws. On any failure returns ok:false with the reason recorded.
 */
export async function callJson<T = unknown>(opts: CallOpts): Promise<LlmResult<T>> {
  const model = opts.model ?? env.groqModelScoring();
  const budget = opts.budget;
  const est = estimateTokens(opts.system + opts.user) + 800;

  if (budget && !budget.canSpend(est)) {
    return { ok: false, data: null, raw: null, error: `budget halted: ${budget.haltReason}`, tokensIn: 0, tokensOut: 0, model };
  }

  // Attempt 1
  let res = await rawCall(opts, false);
  if ('error' in res) {
    return { ok: false, data: null, raw: null, error: res.error, tokensIn: 0, tokensOut: 0, model };
  }
  budget?.record(res.inTok, res.outTok);

  let candidate = extractJson(res.text);
  if (candidate) {
    try {
      return { ok: true, data: JSON.parse(candidate) as T, raw: res.text, error: null, tokensIn: res.inTok, tokensOut: res.outTok, model };
    } catch { /* fall through to the single stricter retry */ }
  }

  // Attempt 2: retried ONCE with a stricter instruction, per the brief.
  console.warn('[llm] JSON parse failed; one stricter retry');
  if (budget && !budget.canSpend(est)) {
    return { ok: false, data: null, raw: res.text, error: 'malformed JSON; budget halted before retry', tokensIn: res.inTok, tokensOut: res.outTok, model };
  }
  const res2 = await rawCall(opts, true);
  if ('error' in res2) {
    return { ok: false, data: null, raw: res.text, error: `malformed JSON; retry failed: ${res2.error}`, tokensIn: res.inTok, tokensOut: res.outTok, model };
  }
  budget?.record(res2.inTok, res2.outTok);

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
export async function listModels(): Promise<string[]> {
  const res = await fetch(`${env.groqBaseUrl()}/models`, {
    headers: { Authorization: `Bearer ${env.groqApiKey()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j?.data ?? []).map((m: { id: string }) => m.id).sort();
}
