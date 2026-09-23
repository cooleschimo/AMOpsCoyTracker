/**
 * Issue an invitation to create an account.
 *
 * Registration is invite-only, so this is the only way an account begins. The
 * link is printed rather than emailed: at this scale the person running the
 * tool hands it over directly, and a mail path would be more to get wrong than
 * it saves.
 *
 * Two kinds, and the difference is who the link makes an account for.
 *
 * A BOUND invite names the address at issue. Forwarding it cannot create an
 * account under a different one, so a link that goes astray is spent, not
 * abused. This is the default and what an invite means unless asked otherwise.
 *
 * An OPEN invite (--open) names nobody: the address is chosen at signup, so the
 * account belongs to whoever opens the link. It is for handing seats to people
 * whose addresses are not known in advance, and the trade is real — a leaked
 * link is an account for whoever received it. Single use and the same expiry
 * either way, so a leak costs one seat rather than the batch.
 *
 * Usage: npx tsx scripts/invite.ts <email> [--name "Chimin"] [--admin]
 *        npx tsx scripts/invite.ts --open [--count 11] [--admin]
 */
import '../lib/loadenv';
import { createInvite } from '../lib/session';
import { optional } from '../lib/env';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

(async () => {
  const open = flag('open');
  const email = process.argv[2];
  if (!open && (!email || email.startsWith('--'))) {
    console.error('Usage: npx tsx scripts/invite.ts <email> [--name "Name"] [--admin]');
    console.error('       npx tsx scripts/invite.ts --open [--count 11] [--admin]');
    process.exit(1);
  }

  const role = flag('admin') ? 'admin' : 'member';
  const base = (optional('APP_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');

  if (!open) {
    const token = await createInvite(email, arg('name') ?? null, role);
    console.log(`\ninvite for ${email} (${role})`);
    console.log(`${base}/join/${token}\n`);
    console.log('Single use, expires in 14 days.');
    return;
  }

  const count = Number(arg('count', '1'));
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    console.error('--count must be a whole number between 1 and 100.');
    process.exit(1);
  }

  console.log(`\n${count} open invite${count === 1 ? '' : 's'} (${role})`);
  console.log('Each is single use and expires in 14 days. Whoever opens one');
  console.log('chooses their own address, name and password.\n');
  for (let i = 0; i < count; i++) {
    const token = await createInvite(null, null, role);
    console.log(`${String(i + 1).padStart(2)}. ${base}/join/${token}`);
  }
  console.log('\nHand out one link per person. Anyone holding a link can use it,');
  console.log('so treat them like passwords until they are spent.');
})();
