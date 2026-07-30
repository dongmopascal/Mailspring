import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { createEmailingSystem, PRIORITY } from '../src/index.js';

// This smoke test proves the core pipeline end to end without touching a
// real network: one SMTP server is wired to always fail (to exercise the
// circuit breaker), a second one succeeds (jsonTransport, built into
// nodemailer, never actually connects anywhere) so we can watch automatic
// failover kick in.

const dbPath = path.resolve('data', 'smoke-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbPath + suffix, { force: true });
}

const brokenTransport = {
  name: 'Broken',
  version: '1.0.0',
  send(mail, callback) {
    callback(new Error('ECONNREFUSED (simulated failure)'));
  },
};

const system = createEmailingSystem({
  dbPath,
  fromDefault: 'no-reply@example.com',
  servers: [
    { name: 'primary-broken', customTransport: brokenTransport, maxPerMinute: 1000 },
    { name: 'backup-working', customTransport: nodemailer.createTransport({ jsonTransport: true }), maxPerMinute: 1000 },
  ],
  pollIntervalMs: 150,
  batchSize: 5,
  maxAttemptsDefault: 4,
  backoffBaseMs: 200,
  backoffMaxMs: 800,
  circuitBreaker: { failureThreshold: 2, cooldownMs: 4000 },
});

system.sendEmail({
  to: 'alice@example.com',
  subject: 'Reset de mot de passe',
  html: '<b>Cliquez ici</b>',
  priority: PRIORITY.HIGH,
});

system.sendTemplate({
  to: 'bob@example.com',
  subject: 'Bienvenue',
  template: 'welcome',
  variables: { name: 'Bob', email: 'bob@example.com' },
});

system.sendBulk(['carol@example.com', 'dave@example.com'], {
  subject: 'Newsletter de juillet',
  html: '<p>Les nouveautes du mois</p>',
});

console.log('Jobs enqueued. Starting worker...\n');
system.start();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await sleep(3500);
system.stop();

const stats = system.stats();
const smtpStatus = system.smtpStatus();

console.log('\n--- QUEUE STATS ---');
console.log(stats);
console.log('\n--- SMTP POOL STATUS ---');
console.log(smtpStatus);

const expectedSent = 4;
if (stats.sent === expectedSent && stats.pending === 0 && stats.dead === 0) {
  console.log(`\nOK: ${expectedSent}/${expectedSent} emails delivered via failover, 0 dead, 0 pending.`);
  process.exit(0);
} else {
  console.error('\nFAIL: unexpected final state.');
  process.exit(1);
}
