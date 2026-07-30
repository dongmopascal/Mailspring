import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { createEmailingSystem, PRIORITY } from '../src/index.js';

// Proves that a permanent SMTP rejection (5xx) bounces immediately instead of
// burning through retries, and that the recipient is auto-suppressed so
// later sends to the same address are skipped without hitting SMTP at all.

const dbPath = path.resolve('data', 'bounce-smoke-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbPath + suffix, { force: true });
}

let attemptsSeen = 0;
const hardBounceTransport = {
  name: 'HardBounce',
  version: '1.0.0',
  send(mail, callback) {
    attemptsSeen += 1;
    const err = new Error('550 5.1.1 The email account does not exist');
    err.responseCode = 550;
    callback(err);
  },
};

const system = createEmailingSystem({
  dbPath,
  fromDefault: 'no-reply@example.com',
  servers: [{ name: 'bouncer', customTransport: nodemailer.createTransport(hardBounceTransport), maxPerMinute: 1000 }],
  pollIntervalMs: 100,
  batchSize: 5,
  maxAttemptsDefault: 5, // deliberately high: a bounce must NOT consume this budget
  backoffBaseMs: 100,
  backoffMaxMs: 500,
});

const emailId = system.sendEmail({
  to: 'nobody@example.com',
  subject: 'Test bounce',
  html: '<p>hello</p>',
  priority: PRIORITY.HIGH,
});

await system.start();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(600);

await system.stop();

const stats = system.stats();
console.log('--- QUEUE STATS ---', stats);
console.log('attemptsSeen (should be exactly 1):', attemptsSeen);
console.log('isSuppressed(nobody@example.com):', system.isSuppressed('nobody@example.com'));

// A second send to the same (now-suppressed) address must be skipped.
const secondId = system.sendEmail({
  to: 'nobody@example.com',
  subject: 'Should be skipped',
  html: '<p>hello again</p>',
});
console.log('second sendEmail result (should be null):', secondId);

const statsAfter = system.stats();
console.log('--- QUEUE STATS AFTER SECOND SEND ---', statsAfter);

const ok =
  attemptsSeen === 1 &&
  stats.dead === 1 &&
  stats.pending === 0 &&
  system.isSuppressed('nobody@example.com') === true &&
  secondId === null &&
  statsAfter.dead === 1; // unchanged: the second send never got enqueued

if (ok) {
  console.log('\nOK: hard bounce died after 1 attempt, recipient suppressed, later sends skipped.');
  process.exit(0);
} else {
  console.error('\nFAIL: unexpected bounce handling behavior.');
  process.exit(1);
}
