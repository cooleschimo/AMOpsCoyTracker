/**
 * Issue an invitation to create an account.
 *
 * Registration is invite-only, so this is the only way an account begins. The
 * link is printed rather than emailed: at this scale the person running the
 * tool hands it over directly, and a mail path would be more to get wrong than
 * it saves.
 *
 * Usage: npx tsx scripts/invite.ts <email> [--name "Chimin"] [--admin]
 */
import '../lib/loadenv';
import { createInvite } from '../lib/session';
import { optional } from '../lib/env';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

(async () => {
  const email = process.argv[2];
  if (!email || email.startsWith('--')) {
    console.error('Usage: npx tsx scripts/invite.ts <email> [--name "Name"] [--admin]');
    process.exit(1);
  }
  const name = arg('name') ?? null;
  const role = process.argv.includes('--admin') ? 'admin' : 'member';
  const token = await createInvite(email, name, role);
  const base = optional('APP_BASE_URL') ?? 'http://localhost:3000';
  console.log(`\ninvite for ${email} (${role})`);
  console.log(`${base.replace(/\/$/, '')}/join/${token}\n`);
  console.log('Single use, expires in 14 days.');
})();
