import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { createEmailingSystem, PRIORITY } from '../src/index.js';

// Proves the open/click tracking pipeline end to end: an email is sent, its
// HTML gets a tracking pixel + rewritten link injected, then we simulate a
// mail client loading the pixel and a user clicking the link, and check the
// stats reflect both.

const dbPath = path.resolve('data', 'tracking-smoke-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbPath + suffix, { force: true });
}

const TRACKING_PORT = 4173;

const system = createEmailingSystem({
  dbPath,
  fromDefault: 'no-reply@example.com',
  servers: [{ name: 'working', customTransport: nodemailer.createTransport({ jsonTransport: true }), maxPerMinute: 1000 }],
  pollIntervalMs: 100,
  batchSize: 5,
  tracking: { enabled: true, baseUrl: `http://localhost:${TRACKING_PORT}`, port: TRACKING_PORT },
});

const TARGET_URL = 'https://example.com/promo?ref=newsletter';

const emailId = system.sendEmail({
  to: 'reader@example.com',
  subject: 'Offre du mois',
  html: `<html><body><p>Salut</p><a href="${TARGET_URL}">Voir l'offre</a></body></html>`,
  priority: PRIORITY.HIGH,
});

await system.start();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500);

const row = system._internal.db.prepare('SELECT tracking_id, html FROM emails WHERE id = ?').get(emailId);
if (!row.tracking_id) throw new Error('Expected a tracking_id to be assigned');
if (!row.html.includes(`/t/o/${row.tracking_id}.png`)) throw new Error('Tracking pixel missing from sent html');
if (!row.html.includes(`/t/c/${row.tracking_id}`)) throw new Error('Tracked link missing from sent html');

const pixelUrl = `http://localhost:${TRACKING_PORT}/t/o/${row.tracking_id}.png`;
const pixelRes = await fetch(pixelUrl);
console.log('pixel request:', pixelRes.status, pixelRes.headers.get('content-type'));

const clickUrl = `http://localhost:${TRACKING_PORT}/t/c/${row.tracking_id}?u=${encodeURIComponent(TARGET_URL)}`;
const clickRes = await fetch(clickUrl, { redirect: 'manual' });
console.log('click request:', clickRes.status, 'Location:', clickRes.headers.get('location'));

await system.stop();

const stats = system.trackingStats();
console.log('\n--- TRACKING STATS ---');
console.log(stats);

const ok =
  pixelRes.status === 200 &&
  pixelRes.headers.get('content-type') === 'image/png' &&
  clickRes.status === 302 &&
  clickRes.headers.get('location') === TARGET_URL &&
  stats.totalSent === 1 &&
  stats.totalOpened === 1 &&
  stats.totalClicks === 1;

if (ok) {
  console.log('\nOK: pixel served, click redirected, stats correctly recorded.');
  process.exit(0);
} else {
  console.error('\nFAIL: unexpected tracking behavior.');
  process.exit(1);
}
