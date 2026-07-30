import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { createEmailingSystem } from '../src/index.js';

// Proves campaigns are tracked end to end: sendBulk groups recipients under
// one campaign, opens/clicks/bounces/unsubscribes roll up into per-campaign
// stats, and the /dashboard page renders them.

const dbPath = path.resolve('data', 'dashboard-smoke-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbPath + suffix, { force: true });
}

const PORT = 4175;

let callCount = 0;
const mixedTransport = {
  name: 'Mixed',
  version: '1.0.0',
  send(mail, callback) {
    callCount += 1;
    if (mail.data.to === 'bounced@example.com') {
      const err = new Error('550 5.1.1 no such user');
      err.responseCode = 550;
      return callback(err);
    }
    callback(null, { messageId: `<${callCount}@test>` });
  },
};

const system = createEmailingSystem({
  dbPath,
  fromDefault: 'no-reply@example.com',
  servers: [{ name: 'mixed', customTransport: nodemailer.createTransport(mixedTransport), maxPerMinute: 1000 }],
  pollIntervalMs: 100,
  batchSize: 10,
  tracking: { enabled: true, baseUrl: `http://localhost:${PORT}` },
  dashboard: { enabled: true },
  publicServerPort: PORT,
});

const ids = system.sendBulk(
  [
    { to: 'opener@example.com' },
    { to: 'silent@example.com' },
    { to: 'bounced@example.com' },
  ],
  {
    subject: 'Offre du mois',
    html: '<html><body><a href="https://example.com/promo">Voir</a></body></html>',
    campaignName: 'Campagne Juillet',
  }
);

await system.start();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500);

// Simulate "opener@example.com" opening the email.
const openerRow = system._internal.db
  .prepare("SELECT tracking_id FROM emails WHERE to_address = 'opener@example.com'")
  .get();
await fetch(`http://localhost:${PORT}/t/o/${openerRow.tracking_id}.png`);

await sleep(200);

const dashboardRes = await fetch(`http://localhost:${PORT}/dashboard`);
const dashboardHtml = await dashboardRes.text();

await system.stop();

const campaigns = system.listCampaigns();
console.log('campaigns:', JSON.stringify(campaigns, null, 2));
console.log('dashboard status:', dashboardRes.status);

const campaign = campaigns[0];
const stats = campaign?.stats;

const ok =
  campaigns.length === 1 &&
  campaign.name === 'Campagne Juillet' &&
  stats.total === 3 &&
  stats.sent === 2 &&
  stats.bounced === 1 &&
  stats.opened === 1 &&
  dashboardRes.status === 200 &&
  dashboardHtml.includes('Campagne Juillet') &&
  dashboardHtml.includes('Dashboard des campagnes');

if (ok) {
  console.log('\nOK: campaign stats correct (3 total, 2 sent, 1 bounced, 1 opened), dashboard renders them.');
  process.exit(0);
} else {
  console.error('\nFAIL: unexpected campaign/dashboard behavior.');
  process.exit(1);
}
