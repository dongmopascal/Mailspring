import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { createEmailingSystem } from '../src/index.js';

// Proves A/B testing end to end: sendBulk splits recipients across named
// variants, each email is tagged with its variant, and per-variant stats
// (computed from simulated opens) correctly identify which one performed
// better. Also checks the dashboard renders the comparison table.

const dbPath = path.resolve('data', 'ab-testing-smoke-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbPath + suffix, { force: true });
}

const PORT = 4178;

const system = createEmailingSystem({
  dbPath,
  fromDefault: 'no-reply@example.com',
  servers: [{ name: 'working', customTransport: nodemailer.createTransport({ jsonTransport: true }), maxPerMinute: 1000 }],
  pollIntervalMs: 100,
  batchSize: 20,
  tracking: { enabled: true, baseUrl: `http://localhost:${PORT}` },
  dashboard: { enabled: true },
  publicServerPort: PORT,
});

// 20 recipients so the ~50/50 split has room to land close to even.
const recipients = Array.from({ length: 20 }, (_, i) => ({ to: `user${i}@example.com` }));

system.sendBulk(recipients, {
  campaignName: 'Test A/B - Objet',
  variants: [
    { name: 'A - Objet direct', subject: 'Votre facture est prete', html: '<p>Facture A</p>' },
    { name: 'B - Objet urgence', subject: 'Action requise: facture en attente', html: '<p>Facture B</p>' },
  ],
});

await system.start();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500);

const rows = system._internal.db.prepare('SELECT to_address, tracking_id, variant FROM emails').all();
const countA = rows.filter((r) => r.variant === 'A - Objet direct').length;
const countB = rows.filter((r) => r.variant === 'B - Objet urgence').length;
console.log(`split: A=${countA} B=${countB} (total ${rows.length})`);

// Simulate variant A performing much better: open 4/5 of A's emails,
// 1/10 of B's - deterministic (no randomness) so the test never flakes.
let aIndex = 0;
let bIndex = 0;
for (const row of rows) {
  const isA = row.variant === 'A - Objet direct';
  const shouldOpen = isA ? aIndex++ % 5 !== 0 : bIndex++ % 10 === 0;
  if (shouldOpen) {
    await fetch(`http://localhost:${PORT}/t/o/${row.tracking_id}.png`);
  }
}

await sleep(200);

const dashboardRes = await fetch(`http://localhost:${PORT}/dashboard`);
const dashboardHtml = await dashboardRes.text();

await system.stop();

const campaigns = system.listCampaigns();
const campaign = campaigns[0];
console.log('variant stats:', JSON.stringify(campaign.variants, null, 2));

const variantA = campaign.variants.find((v) => v.variant === 'A - Objet direct');
const variantB = campaign.variants.find((v) => v.variant === 'B - Objet urgence');

const ok =
  rows.length === 20 &&
  countA > 0 &&
  countB > 0 &&
  countA + countB === 20 &&
  campaign.variants.length === 2 &&
  variantA.openRate > variantB.openRate && // A was simulated to perform better
  dashboardHtml.includes('Test A/B') &&
  dashboardHtml.includes("meilleur taux d'ouverture");

if (ok) {
  console.log(`\nOK: split ${countA}/${countB}, variant A openRate=${variantA.openRate} > variant B openRate=${variantB.openRate}, dashboard shows the comparison.`);
  process.exit(0);
} else {
  console.error('\nFAIL: unexpected A/B testing behavior.');
  process.exit(1);
}
