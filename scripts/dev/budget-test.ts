import '../../lib/loadenv';
import { Budget } from '../../lib/budget';
(async () => {
  const b = new Budget();
  // Gemini: 20 requests/day. The 21st must be refused for gemini only.
  for (let i = 0; i < 20; i++) b.record(500, 100, 'gemini');
  console.log('gemini after 20 requests, canSpend:', b.canSpend(2000, 'gemini'), '(expect false)');
  console.log('groq unaffected, canSpend:', b.canSpend(2000, 'groq'), '(expect true)');
  console.log('run halted?', b.halted, '(expect false — groq still has room)');
  // Exhaust groq too
  b.markExhausted('groq', 'test');
  console.log('all exhausted [gemini, groq]:', b.allExhausted(['gemini','groq']), '(expect true)');
  console.log('openrouter (no declared limit):', b.canSpend(2000, 'openrouter'), '(expect true — its 429 is the signal)');
  console.log('\nper-provider summary:', JSON.stringify(b.summary().per_provider));
})();
