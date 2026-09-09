/**
 * What each OpenRouter account is actually entitled to, and what it has spent.
 *
 * The daily cap is 50 free-model requests, or 1,000 once an account carries
 * credit. That makes the entitlement a property of the balance, and this is how
 * to see whether the balance is holding: a call to a :free model should not
 * draw it down, but if `usage` climbs then it is being billed and the account
 * drops back to 50 when the credit runs out.
 *
 * Usage: npx tsx scripts/dev/openrouter-credit.ts
 */
import '../../lib/loadenv';
import { llmProviders } from '../../lib/env';

(async () => {
  const keys = llmProviders().filter((p) => p.name === 'openrouter');
  if (!keys.length) return console.log('no OpenRouter keys configured');

  for (const p of keys as Array<{ apiKey: string; label?: string; name: string }>) {
    const label = p.label ?? p.name;
    const head = { Authorization: `Bearer ${p.apiKey}` };
    try {
      const [kr, cr] = await Promise.all([
        fetch('https://openrouter.ai/api/v1/key', { headers: head, signal: AbortSignal.timeout(15000) }),
        fetch('https://openrouter.ai/api/v1/credits', { headers: head, signal: AbortSignal.timeout(15000) }),
      ]);
      const k: any = await kr.json().catch(() => null);
      const c: any = await cr.json().catch(() => null);
      const free = k?.data?.is_free_tier;
      const credits = c?.data?.total_credits ?? 0;
      const used = c?.data?.total_usage ?? 0;
      console.log(
        label.padEnd(13),
        (free === false ? 'PAID  1000/day' : 'free    50/day').padEnd(16),
        `credits ${credits}`.padEnd(14),
        `used ${Number(used).toFixed(4)}`,
        Number(used) > 0 && free === false ? '  <- free calls ARE drawing this down' : '',
      );
    } catch (e) {
      console.log(label.padEnd(13), 'ERROR', (e as Error).message);
    }
  }
})();
