/**
 * Preflight: verify every credential and endpoint before a real run.
 * Run: npx tsx scripts/preflight.ts
 */
import 'dotenv/config';

async function main() {
  const results: Array<[string, string]> = [];
  const check = async (name: string, fn: () => Promise<string>) => {
    try { results.push([name, await fn()]); }
    catch (e) { results.push([name, `FAIL: ${(e as Error).message}`]); }
  };

  await check('DATABASE_URL', async () => {
    const { getSql } = await import('../lib/db');
    const rows = await getSql()`select count(*)::int as n from information_schema.tables where table_schema='public'`;
    return `OK - ${rows[0].n} tables in public schema`;
  });

  await check('GROQ_API_KEY + model', async () => {
    const { listModels } = await import('../lib/llm');
    const { env } = await import('../lib/env');
    const models = await listModels();
    const want = env.groqModelScoring();
    return models.includes(want)
      ? `OK - ${models.length} models; '${want}' available`
      : `WARN - '${want}' NOT in account list. Available: ${models.slice(0, 8).join(', ')}`;
  });

  await check('SEC EDGAR', async () => {
    const { fetchDailyIndex } = await import('../lib/edgar');
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
    const idx = await fetchDailyIndex(d);
    return `OK - ${idx.length} Form D entries for ${d.toISOString().slice(0, 10)}`;
  });

  console.log('\n=== PREFLIGHT ===');
  for (const [k, v] of results) console.log(`${v.startsWith('FAIL') ? '✗' : v.startsWith('WARN') ? '!' : '✓'} ${k}: ${v}`);
  if (results.some(([, v]) => v.startsWith('FAIL'))) process.exit(1);
}
main();
