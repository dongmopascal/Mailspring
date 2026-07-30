import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { createEmailingSystem } from '../src/index.js';

// Proves one-click unsubscribe end to end: the sent email carries a
// List-Unsubscribe / List-Unsubscribe-Post header pointing at our own
// server, hitting that URL suppresses the recipient, and further sends to
// that address are then skipped.

const dbPath = path.resolve('data', 'unsubscribe-smoke-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbPath + suffix, { force: true });
}

const PORT = 4174;

const system = createEmailingSystem({
  dbPath,
  fromDefault: 'no-reply@example.com',
  servers: [{ name: 'working', customTransport: nodemailer.createTransport({ jsonTransport: true }), maxPerMinute: 1000 }],
  pollIntervalMs: 100,
  batchSize: 5,
  tracking: { enabled: false },
  unsubscribe: { enabled: true, baseUrl: `http://localhost:${PORT}`, mailto: 'unsubscribe@example.com' },
  publicServerPort: PORT,
});

const RECIPIENT = 'subscriber@example.com';

const emailId = system.sendEmail({
  to: RECIPIENT,
  subject: 'Newsletter',
  html: '<p>Contenu de la newsletter</p>',
});

await system.start();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(300);

const row = system._internal.db.prepare('SELECT tracking_id, headers_json FROM emails WHERE id = ?').get(emailId);
if (!row.tracking_id) throw new Error('Expected a tracking_id even with pixel/click tracking disabled');

const headers = JSON.parse(row.headers_json ?? '{}');
console.log('headers on sent email:', headers);
const hasListUnsubscribe =
  headers['List-Unsubscribe']?.includes(`/u/${row.tracking_id}`) && headers['List-Unsubscribe']?.includes('mailto:unsubscribe@example.com');
const hasOneClick = headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click';

const unsubUrl = `http://localhost:${PORT}/u/${row.tracking_id}`;
const unsubRes = await fetch(unsubUrl, { method: 'POST' });
console.log('unsubscribe request:', unsubRes.status);

await system.stop();

const suppressedAfter = system.isSuppressed(RECIPIENT);
console.log('isSuppressed after unsubscribe:', suppressedAfter);

const secondId = system.sendEmail({ to: RECIPIENT, subject: 'Encore une newsletter', html: '<p>...</p>' });
console.log('second sendEmail result (should be null):', secondId);

const ok = hasListUnsubscribe && hasOneClick && unsubRes.status === 200 && suppressedAfter === true && secondId === null;

if (ok) {
  console.log('\nOK: List-Unsubscribe header present, one-click unsubscribe suppressed the recipient.');
  process.exit(0);
} else {
  console.error('\nFAIL: unexpected unsubscribe behavior.');
  process.exit(1);
}
