/**
 * Preflight: verify every credential and endpoint before a real run.
 * Run: npx tsx scripts/preflight.ts
 */
import '../lib/loadenv';

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

  await check('LLM provider chain', async () => {
    const { llmProviders } = await import('../lib/env');
    const labels = llmProviders().map((p) => p.label ?? p.name);
    return labels.length ? `OK - ${labels.join(' -> ')}` : 'WARN - no LLM providers configured';
  });

  await check('Groq key(s) + model', async () => {
    const { listModels } = await import('../lib/llm');
    const { env, llmProviders } = await import('../lib/env');
    const want = env.groqModelScoring();
    const groqProviders = llmProviders().filter((p) => p.name === 'groq');
    if (!groqProviders.length) throw new Error('No Groq key configured');

    const summaries = await Promise.all(groqProviders.map(async (p) => {
      const models = await listModels(p);
      const label = p.label ?? p.name;
      const ok = models.includes(want);
      return {
        ok,
        message: ok
          ? `${label}: ${models.length} models; '${want}' available`
          : `${label}: '${want}' NOT in account list. Available: ${models.slice(0, 8).join(', ')}`,
      };
    }));
    const prefix = summaries.every((s) => s.ok) ? 'OK' : 'WARN';
    return `${prefix} - ${summaries.map((s) => s.message).join('; ')}`;
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
