/**
 * Ground-truth cases for CB Insights entity resolution, each one an entity the
 * connector actually returned. The wrong matches are the point: every decoy
 * here comes back with a complete, plausible profile, so a rule that reads
 * convincing and a rule that is right look identical without them.
 *
 * Run: npx tsx tests/cbi-resolve.test.ts
 */
import { resolveQueries, raiseFromHeadline, verifyMatch, toRoundStage, bareDomain } from '../lib/cbi-resolve';

let failed = 0;
function check(pass: boolean, label: string, detail = '') {
  if (pass) { console.log(`  ok    ${label}`); return; }
  failed++;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\nbareDomain');
check(bareDomain('https://www.Foo.com/bar') === 'foo.com', 'strips scheme, www and path');
check(bareDomain('Unknown') === null, 'rejects a non-domain');
check(bareDomain(null) === null, 'null in, null out');

console.log('\nresolveQueries — website first, because a domain has one owner');
check(resolveQueries({ name: 'Sierra', website: 'https://sierra.ai' })[0] === 'sierra.ai',
  'the website leads when we hold one');
check(JSON.stringify(resolveQueries({ name: 'Aslan', sectors: ['defence_software', 'ai_software'] }))
  === JSON.stringify(['Aslan', 'Aslan defence software']),
  'no website: bare name, then the name qualified by sector');
check(resolveQueries({ name: 'Roche Holding AG' })[0] === 'Roche Holding',
  'a legal suffix is dropped — "Roche Holding AG" resolves to nothing');

console.log('\nraiseFromHeadline — the strongest key we hold for a young company');
check(raiseFromHeadline('raised $20.8M (Sam Sabin/Axios)') === 20.8, 'Aslan: $20.8M');
check(raiseFromHeadline('raises €4.3 million to expand') === 4.3, 'Jaipur: EUR 4.3 million');
check(raiseFromHeadline('raises $1.2B at a $10B valuation') === 1200, 'billions scale to millions');
check(raiseFromHeadline('opened an office in Singapore') === null, 'no figure, no claim');

console.log('\nverifyMatch — Aslan, the case that cost us the row');
// Our row had no website, so the headline's round is the only key available.
const aslan = {
  name: 'Aslan',
  scopeReason: 'Aslan, which offers AI agents for the FBI and wider intelligence community ... raised $20.8M (Sam Sabin/Axios)',
};
check(verifyMatch(aslan,
  { url: 'aslanprotects.com', address: { city: 'Washington', country: 'United States' } },
  [20.799999, 2.5]).ok,
  'aslanprotects.com accepted on the $20.8M round');
check(!verifyMatch(aslan, { url: 'aslan.ai', address: { city: 'Bangkok', country: 'Thailand' } }, []).ok,
  'aslan.ai rejected — the Thai finance site shares only the word');

console.log('\nverifyMatch — Jaipur Robotics, rejected once for being Swiss');
// The headline says Swiss; the name says Indian; the company is Swiss.
const jaipur = {
  name: 'Jaipur Robotics',
  scopeReason: 'Swiss startup Jaipur Robotics raises €4.3 million to expand its AI operating system across more waste-to-energy plants',
};
check(verifyMatch(jaipur,
  { url: 'jaipurrobotics.com', address: { city: 'Manno', country: 'Switzerland' } },
  [5, 0.78]).ok,
  'accepted: EUR 4.3M against a $5M round is inside the band');
check(verifyMatch(jaipur, { url: 'jaipurrobotics.com', address: { city: 'Manno', country: 'Switzerland' } }, []).ok,
  'accepted on country alone when no round is known — "Swiss" is in the headline');

console.log('\nverifyMatch — decoys the connector returned for a bare name');
check(!verifyMatch({ name: 'Nio', website: 'nio.com' }, { url: 'nio.med.br', address: { country: 'Brazil' } }, []).ok,
  'Nio: the Campo Grande oncology clinic rejected');
check(verifyMatch({ name: 'Nio', website: 'nio.com' }, { url: 'nio.com', address: { country: 'China' } }, []).ok,
  'Nio: the EV maker accepted on its domain');
check(!verifyMatch({ name: 'XTEND', website: 'xtend.ai' }, { url: 'xtendcu.com', address: { country: 'United States' } }, []).ok,
  'XTEND: the Michigan credit-union firm rejected');
check(!verifyMatch({ name: 'Genspark', website: 'genspark.ai' }, { url: 'genspark.net', address: { country: 'United States' } }, []).ok,
  'Genspark: the Georgia IT-staffing firm rejected');
check(!verifyMatch({ name: 'Everspin', website: 'everspin.com' }, { url: 'everspin.global', address: { country: 'South Korea' } }, []).ok,
  'Everspin: the Korean security firm rejected — one letter of domain apart');
// A name alone can never carry a match, however exactly it agrees.
check(!verifyMatch({ name: 'Sierra', website: 'sierra.ai' }, { url: 'sierracorporation.com', address: { country: 'United States' } }, []).ok,
  'Sierra: the McLean IT firm rejected, though the name matches exactly');

console.log('\ntoRoundStage');
check(toRoundStage('Series B - II') === 'series_b', 'a numbered extension keeps its letter');
check(toRoundStage('Seed VC') === 'seed', 'Seed VC');
check(toRoundStage('Pre-Seed') === 'seed', 'pre-seed stores as seed');
check(toRoundStage('Growth Equity') === null, 'Growth Equity has no equivalent — Harvey stored null');
check(toRoundStage('Secondary Market') === null, 'a secondary is not a round');
check(toRoundStage('Convertible Note - III') === null, 'a note is not a priced round');

console.log(failed ? `\n${failed} case(s) failed\n` : '\nall cases passed\n');
process.exit(failed ? 1 : 0);
