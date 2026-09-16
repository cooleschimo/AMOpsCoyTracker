/**
 * Render the weekly email from the dashboard's own data.
 *
 * Reads getWeeklyDigest() — the same call the page makes — so the email is the
 * dashboard expressed in what mail clients render, not a second design that has
 * to be kept in step by hand.
 *
 * Usage: npx tsx scripts/render-email.ts [--out out] [--base http://localhost:3111]
 */
import '../lib/loadenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getWeeklyDigest } from '../lib/dashboard-data';
import { renderDigestEmail, renderDigestText } from '../lib/digest-email';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

(async () => {
  const outDir = arg('out', 'out');
  const base = arg('base', process.env.APP_BASE_URL ?? 'http://localhost:3111');

  // A preview of the members' email, so it reads the members' digest.
  const d = await getWeeklyDigest(undefined, undefined, { withOffer: true, withInternal: true });
  const total = d.worthAConversation.length + d.newOnTheRadar.length
    + d.newOnTheRadar.length + d.whoWeKnow.length + d.monitoring.length;
  if (!total) {
    console.log('Nothing placed this week. Run the weekly first.');
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const week = d.weekLabel.replace(/[^0-9A-Za-z]+/g, '-').toLowerCase();
  const html = `${outDir}/email-${week}.html`;
  const text = `${outDir}/email-${week}.txt`;
  writeFileSync(html, renderDigestEmail(d, base));
  writeFileSync(text, renderDigestText(d, base));

  console.log(`${d.weekLabel} — ${d.coverage}\n`);
  console.log(`  worth a conversation  ${d.worthAConversation.length}`);
  
  console.log(`  early-stage finds     ${d.newOnTheRadar.length}`);
  console.log(`  who we know           ${d.whoWeKnow.length}`);
  console.log(`  monitoring            ${d.monitoring.length}`);
  console.log(`\nwrote ${html}`);
  console.log(`wrote ${text}`);
  console.log(`\nLinks point at ${base} — nothing is sent by this script.`);
})();
