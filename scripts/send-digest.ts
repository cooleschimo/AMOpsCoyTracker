/**
 * Approve and send the weekly digest. Brief §10, §11, §13.
 *
 * The counterpart to `render-digest.ts`, which writes the draft and deliberately
 * sends nothing. Here a person approves it and it goes out — the two are
 * separate commands because approval is a decision and sending is its
 * consequence, and collapsing them would remove the moment where somebody reads
 * what is about to leave.
 *
 * Test mode is the default everywhere. Unless `DIGEST_TEST_MODE` literally says
 * `false`, every send goes to `DIGEST_TEST_RECIPIENT` and nowhere else, and the
 * mode is recorded on the digest row rather than inferred afterwards.
 *
 * The body is rendered fresh from the current dashboard state rather than
 * stored at approval, so what goes out matches what the dashboard shows. The
 * `digests` row records which items were placed, which is what makes a sent
 * digest reconstructable.
 *
 * Usage:
 *   npx tsx scripts/send-digest.ts --status                 what is saved, and its state
 *   npx tsx scripts/send-digest.ts --approve [--week D]     draft -> approved
 *   npx tsx scripts/send-digest.ts --unapprove [--week D]   approved -> draft
 *   npx tsx scripts/send-digest.ts --send [--week D] [--dry]
 *   npx tsx scripts/send-digest.ts --preview [--week D]     write the mail to out/
 */
import '../lib/loadenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getWeeklyDigest } from '../lib/dashboard-data';
import { renderDigestEmail, renderDigestText } from '../lib/digest-email';
import {
  approveDigest, unapproveDigest, sendDigest, listDigests, getDigest,
  resolveRecipients, digestSubject, fromAddress,
} from '../lib/digest-send';
import { env, isTestMode } from '../lib/env';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/** Monday of the week just finished — the same default render-digest uses. */
function lastWeekMonday(): string {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day) - 7 * 86400_000)
    .toISOString().slice(0, 10);
}

async function renderFor(weekOf: string) {
  const digest = await getWeeklyDigest(undefined, weekOf);
  const base = env.appBaseUrl();
  return {
    html: renderDigestEmail(digest, base),
    text: renderDigestText(digest, base),
    counts: digest.worthAConversation.length + digest.newOnTheRadar.length
      + digest.familiarTerritory.length + digest.monitoring.length,
  };
}

(async () => {
  const weekOf = arg('week', lastWeekMonday())!;

  if (flag('status') || process.argv.length <= 2) {
    const rows = await listDigests();
    const who = resolveRecipients();
    console.log(`mode:   ${isTestMode() ? 'TEST — mail is confined to the test recipient' : 'LIVE'}`);
    console.log(`from:   ${fromAddress()}`);
    console.log(`to:     ${who.ok ? who.why : `UNRESOLVED — ${who.error}`}\n`);
    if (!rows.length) {
      console.log('no digests saved. run: npx tsx scripts/render-digest.ts --save');
      return;
    }
    console.log('week        status     items  approved             sent');
    for (const r of rows) {
      console.log(
        `${r.weekOf}  ${r.status.padEnd(9)}  ${String(r.itemIds.length).padStart(5)}  `
        + `${(r.approvedAt?.toISOString().slice(0, 16) ?? '—').padEnd(19)}  `
        + `${r.sentAt ? `${r.sentAt.toISOString().slice(0, 16)}${r.testMode ? ' (test)' : ''}` : '—'}`,
      );
    }
    return;
  }

  if (flag('preview')) {
    const { html, text, counts } = await renderFor(weekOf);
    mkdirSync('out', { recursive: true });
    writeFileSync(`out/mail-${weekOf}.html`, html);
    writeFileSync(`out/mail-${weekOf}.txt`, text);
    console.log(`subject: ${digestSubject(weekOf, isTestMode())}`);
    console.log(`wrote out/mail-${weekOf}.html and .txt (${counts} companies)`);
    console.log('This is the mail body, not the standalone digest render.');
    return;
  }

  if (flag('approve')) {
    const res = await approveDigest(weekOf, 'admin_cli');
    if (!res.ok) { console.error(`cannot approve: ${res.error}`); process.exit(1); }
    console.log(`${weekOf} is approved (${res.row?.itemIds.length ?? 0} items). Send with --send.`);
    return;
  }

  if (flag('unapprove')) {
    const res = await unapproveDigest(weekOf);
    if (!res.ok) { console.error(`cannot unapprove: ${res.error}`); process.exit(1); }
    console.log(`${weekOf} is back to draft.`);
    return;
  }

  if (flag('send')) {
    const dry = flag('dry');
    const row = await getDigest(weekOf);
    if (!row) { console.error(`no digest saved for ${weekOf}`); process.exit(1); }

    const { html, text, counts } = await renderFor(weekOf);
    const subject = digestSubject(weekOf, isTestMode());
    const res = await sendDigest({ weekOf, subject, html, text, dryRun: dry });

    if (!res.ok) { console.error(`not sent: ${res.error}`); process.exit(1); }
    if (dry) {
      console.log(`DRY RUN — nothing sent.`);
      console.log(`  would send "${subject}"`);
      console.log(`  to ${res.to?.join(', ')}${res.testMode ? '  (test mode)' : ''}`);
      console.log(`  ${counts} companies, ${(html.length / 1024).toFixed(1)} KB`);
      return;
    }
    console.log(`sent "${subject}"`);
    console.log(`  to ${res.to?.join(', ')}${res.testMode ? '  (test mode)' : ''}`);
    if (res.providerId) console.log(`  provider id ${res.providerId}`);
    return;
  }

  console.log('nothing to do. --status | --preview | --approve | --unapprove | --send [--dry]');
})();
