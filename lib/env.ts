/**
 * Environment access. Brief §3.
 *
 * NEVER hardcode secrets. Scripts load .env.local via dotenv; Vercel and
 * GitHub Actions inject their own. Secrets live in TWO places under the split
 * deployment (GitHub repo secrets + Vercel env) — rotation is a two-place
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

/** DIGEST_TEST_MODE defaults TRUE. All mail goes to the test recipient until explicitly changed. */
export function isTestMode(): boolean {
  return optional('DIGEST_TEST_MODE', 'true').toLowerCase() !== 'false';
}

export const env = {
  databaseUrl: () => required('DATABASE_URL'),
  groqApiKey: () => required('GROQ_API_KEY'),
  groqBaseUrl: () => optional('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
  // VERIFIED 2026-08-21: llama-3.3-70b-versatile is delisted; both default to gpt-oss-120b.
  groqModelScoring: () => optional('GROQ_MODEL_SCORING', 'openai/gpt-oss-120b'),
  groqModelDrafting: () => optional('GROQ_MODEL_DRAFTING', 'openai/gpt-oss-120b'),
  resendApiKey: () => required('RESEND_API_KEY'),
  adminToken: () => required('ADMIN_TOKEN'),
  dashboardToken: () => required('DASHBOARD_TOKEN'),
  appBaseUrl: () => optional('APP_BASE_URL', 'http://localhost:3000'),
  // SEC requires a descriptive User-Agent: "Name email@domain".
  secUserAgent: () => required('SEC_USER_AGENT'),
  digestTestRecipient: () => required('DIGEST_TEST_RECIPIENT'),
  fewshotEnabled: () => optional('FEWSHOT_ENABLED', 'false').toLowerCase() === 'true',
};
