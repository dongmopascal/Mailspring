import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { createEmailingSystem } from '../src/index.js';

// Proves webhook delivery end to end: a tiny receiver server captures every
// POST, verifies the HMAC signature, and we check that sent/bounced/opened/
// clicked/unsubscribed events all arrive with the right shape.

const dbPath = path.resolve('data', 'webhooks-smoke-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbPath + suffix, { force: true });
}

const RECEIVER_PORT = 4176;
const SERVER_PORT = 4177;
const SECRET = 'test-webhook-secret';

const receivedEvents = [];
const receiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const expectedSig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const signatureValid = req.headers['x-webhook-signature'] === expectedSig;
    const parsed = JSON.parse(body);
    receivedEvents.push({ ...parsed, signatureValid });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((resolve) => receiver.listen(RECEIVER_PORT, resolve));

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
  tracking: { enabled: true, baseUrl: `http://localhost:${SERVER_PORT}` },
  unsubscribe: { enabled: true, baseUrl: `http://localhost:${SERVER_PORT}` },
  publicServerPort: SERVER_PORT,
  webhooks: { enabled: true, url: `http://localhost:${RECEIVER_PORT}/hook`, secret: SECRET },
});

system.sendEmail({
  to: 'opener@example.com',
  subject: 'Test',
  html: '<html><body><a href="https://example.com/promo">Voir</a></body></html>',
});
system.sendEmail({ to: 'bounced@example.com', subject: 'Test', html: '<p>hi</p>' });

await system.start();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(400);

const openerRow = system._internal.db
  .prepare("SELECT tracking_id FROM emails WHERE to_address = 'opener@example.com'")
  .get();

await fetch(`http://localhost:${SERVER_PORT}/t/o/${openerRow.tracking_id}.png`);
await fetch(`http://localhost:${SERVER_PORT}/t/c/${openerRow.tracking_id}?u=${encodeURIComponent('https://example.com/promo')}`, {
  redirect: 'manual',
});
await fetch(`http://localhost:${SERVER_PORT}/u/${openerRow.tracking_id}`, { method: 'POST' });

await sleep(500);

await system.stop();
await new Promise((resolve) => receiver.close(resolve));

console.log('received events:', receivedEvents.map((e) => e.event));

const eventTypes = receivedEvents.map((e) => e.event);
const allSigned = receivedEvents.every((e) => e.signatureValid);

const ok =
  eventTypes.includes('email.sent') &&
  eventTypes.includes('email.bounced') &&
  eventTypes.includes('email.opened') &&
  eventTypes.includes('email.clicked') &&
  eventTypes.includes('email.unsubscribed') &&
  allSigned;

if (ok) {
  console.log('\nOK: all 5 event types received with valid HMAC signatures.');
  process.exit(0);
} else {
  console.error('\nFAIL: missing event types or invalid signature.', { eventTypes, allSigned });
  process.exit(1);
}
