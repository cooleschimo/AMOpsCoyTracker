/**
 * Environment access. Brief §3.
 *
 * Secrets reach the code only through here. Scripts load .env.local via dotenv;
 * Vercel and GitHub Actions inject their own. The split deployment keeps them in
 * two places (GitHub repo secrets and Vercel env), so rotation is a two-place
 * operation. See DEBUGGING.md.
 */
export function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Missing required env var ${name}. Set it in .env.local (local), ` +
      `GitHub repo secrets (pipeline), or Vercel project env (web app).`
    );
  }
  return v;
}

export function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

/** DIGEST_TEST_MODE defaults to true, confining all mail to the test recipient. */
export function isTestMode(): boolean {
  return optional('DIGEST_TEST_MODE', 'true').toLowerCase() !== 'false';
}

export const env = {
  databaseUrl: () => required('DATABASE_URL'),
  groqApiKey: () => required('GROQ_API_KEY'),
  groqBaseUrl: () => optional('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
  // llama-3.3-70b-versatile is delisted, so both default to gpt-oss-120b.
  groqModelScoring: () => optional('GROQ_MODEL_SCORING', 'openai/gpt-oss-120b'),
  groqModelDrafting: () => optional('GROQ_MODEL_DRAFTING', 'openai/gpt-oss-120b'),
  resendApiKey: () => required('RESEND_API_KEY'),
  adminToken: () => required('ADMIN_TOKEN'),
  appBaseUrl: () => optional('APP_BASE_URL', 'http://localhost:3000'),
  // SEC requires a descriptive User-Agent: "Name email@domain".
  secUserAgent: () => required('SEC_USER_AGENT'),
  digestTestRecipient: () => required('DIGEST_TEST_RECIPIENT'),
  fewshotEnabled: () => optional('FEWSHOT_ENABLED', 'false').toLowerCase() === 'true',
  // Corporate registries. Absent keys leave those sources unavailable rather
  // than failing a run: EDGAR full-text, ClinicalTrials, USASpending and GLEIF
  // need no key and cover most of what these add.
  openCorporatesKey: () => optional('OPENCORPORATES_API_KEY'),
  usptoKey: () => optional('USPTO_API_KEY'),
};

/**
 * Additional LLM providers and keys, used as FAILOVER when the primary halts
 * on its daily cap. Groq's 200K/day halts a long scoring run at
 * 204 of 651 items, and waiting a day for the reset is the only alternative.
 *
 * Treat every configured key as its own credential with its own terms and
 * entitlement. This is failover, while still honoring the published project
 * and organization limits attached to those credentials.
 *
 * Every provider below speaks the OpenAI chat-completions shape, so lib/llm.ts
 * needs only a base URL, key and model per provider.
 */
export type LlmProviderName = 'groq' | 'gemini' | 'openrouter' | 'mistral';

export type LlmProvider = {
  name: LlmProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Display name; distinguishes several keys on one provider in logs. */
  label?: string;
};

export const DEFAULT_LLM_CHAIN = 'gemini,groq,gemini2,groq2,openrouter,gemini3,groq3,gemini4,groq4';

type KeySlot = { apiKey: string; label: string };

/**
 * Numbered API keys, preserving the suffix in the provider label.
 *
 * Reads BASE_KEY, BASE_KEY_2 ... BASE_KEY_10. Gaps are allowed: if _3 is absent
 * but _4 exists, _4 is still exposed as provider label `base4`, so LLM_CHAIN
 * can name exactly the credential it means.
 */
function numberedKeys(envName: string, baseLabel: string): KeySlot[] {
  const slots: KeySlot[] = [];
  const seen = new Set<string>();
  const add = (apiKey: string, label: string) => {
    if (!apiKey || seen.has(apiKey)) return;
    seen.add(apiKey);
    slots.push({ apiKey, label });
  };

  add(optional(envName), baseLabel);
  for (let i = 2; i <= 10; i++) add(optional(`${envName}_${i}`), `${baseLabel}${i}`);
  return slots;
}

/**
 * Every configured Groq key, in order: GROQ_API_KEY, GROQ_API_KEY_2, ...
 * Duplicates are dropped — the same key twice is not extra capacity, only
 * wasted failover.
 */
function groqKeys(): KeySlot[] {
  return numberedKeys('GROQ_API_KEY', 'groq');
}

/**
 * Every configured Gemini key, in order: GEMINI_API_KEY, GEMINI_API_KEY_2, ...
 * Duplicates are dropped — the same key twice is not extra quota, only wasted
 * failover steps.
 */
function geminiKeys(): KeySlot[] {
  return numberedKeys('GEMINI_API_KEY', 'gemini');
}

/**
 * Every configured OpenRouter key, in order: OPENROUTER_API_KEY, _2, ...
 * The free tier is fifty model requests a day per ACCOUNT, so a second account
 * is a second allowance in exactly the way a second Gemini project is.
 */
function openrouterKeys(): KeySlot[] {
  return numberedKeys('OPENROUTER_API_KEY', 'openrouter');
}

export function llmProviders(): LlmProvider[] {
  const all: LlmProvider[] = [
    ...groqKeys().map(({ apiKey, label }) => ({
      name: 'groq' as const,
      apiKey,
      baseUrl: optional('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
      model: optional('GROQ_MODEL_SCORING', 'openai/gpt-oss-120b'),
      label,
    })),
    // Gemini accepts MULTIPLE KEYS: GEMINI_API_KEY, then GEMINI_API_KEY_2..N.
    // Free-tier quota is per project, so a teammate's key on their own project
    // carries its own allowance; each becomes a separate entry so the failover
    // moves to the next when one is exhausted.
    ...geminiKeys().map(({ apiKey, label }) => ({
      name: 'gemini' as const,
      apiKey,
      baseUrl: optional('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
      // gemini-2.5-flash is closed to new users and 404s with a pointer to
      // this id. gemini-3.5-flash also works.
      model: optional('GEMINI_MODEL', 'gemini-3.6-flash'),
      // NOT 'gemini#2': '#' starts a comment in .env parsing, so a chain
      // string containing it is silently truncated.
      label,
    })),
    ...openrouterKeys().map(({ apiKey, label }) => ({
      name: 'openrouter' as const,
      apiKey,
      baseUrl: optional('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      // ':free' variants cost nothing. Which models carry that suffix changes
      // without notice, so treat this as a value to update rather than a fixed
      // choice — the OpenAI-compatible shape means only the string changes.
      /*
       * A key with credit gets a PAID model; the free keys keep the free alias.
       *
       * `openrouter/free` routes to free models, which carry their own daily
       * cap — 1,000 requests on a funded account, `free-models-per-day-high-
       * balance` — and spend none of the balance. So the one key that could
       * have kept working was capped alongside the seven that could not, and
       * the credit sat untouched.
       *
       * mistral-nemo at $0.019/$0.030 per million is the cheapest model that
       * returned valid JSON for an assessment batch, and the fastest of the
       * candidates at that. OPENROUTER_MODEL_PAID overrides it.
       */
      model: label === 'openrouter' && !optional('OPENROUTER_FREE_ONLY')
        ? optional('OPENROUTER_MODEL_PAID', 'mistralai/mistral-nemo')
        : optional('OPENROUTER_MODEL', 'openrouter/free'),
      label,
    })),
    {
      name: 'mistral',
      apiKey: optional('MISTRAL_API_KEY'),
      baseUrl: optional('MISTRAL_BASE_URL', 'https://api.mistral.ai/v1'),
      model: optional('MISTRAL_MODEL', 'mistral-small-latest'),
    },
    // Deliberately absent, all verified (see PROGRESS §5):
    //   Cerebras      — HTTP 402 on inference for every model; key authenticates
    //                   but the account has no entitlement
    //   Together AI   — no longer free; $5 prepaid minimum for new signups
    //   GitHub Models — HTTP 410 'github_models_retirement_brownout'
  ];
  const withKeys = all.filter((p) => p.apiKey);
  const labelOf = (p: LlmProvider) => (p.label ?? p.name).toLowerCase();
  const byChain = (chain: string): LlmProvider[] => {
    const order = chain.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const picked: LlmProvider[] = [];
    for (const want of order) {
      for (const p of withKeys) {
        if (labelOf(p) === want && !picked.includes(p)) picked.push(p);
      }
    }
    const leftover = withKeys.filter((p) => !picked.includes(p));
    return [...picked, ...leftover];
  };

  /**
   * LLM_CHAIN sets the failover order explicitly, as a comma-separated list of
   * LABELS. The default alternates Gemini/Groq around OpenRouter:
   * gemini, groq, gemini2, groq2, openrouter, gemini3, groq3, gemini4, groq4.
   * No '#' in labels: it starts a comment in .env files and would truncate the
   * chain string. Labels rather than provider names, so several keys on one
   * provider can be placed independently. Anything keyed but not named in the
   * chain is appended after, so adding a key never silently drops it.
   *
   * LLM_PROVIDER remains supported as the older single-name form: it promotes
   * that provider's entries to the front of the default chain.
   */
  const chain = optional('LLM_CHAIN');
  if (chain) return byChain(chain);

  const defaultChain = byChain(DEFAULT_LLM_CHAIN);

  const preferred = optional('LLM_PROVIDER').toLowerCase();
  if (!preferred) return defaultChain;
  const first = defaultChain.filter((p) => p.name === preferred);
  const rest = defaultChain.filter((p) => p.name !== preferred);
  return [...first, ...rest];
}
