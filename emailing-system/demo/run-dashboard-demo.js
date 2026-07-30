import path from 'node:path';
import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { createEmailingSystem, PRIORITY } from '../src/index.js';

// Standalone demo: no real SMTP server needed (uses nodemailer's built-in
// jsonTransport, which never touches the network). Sends a few campaigns,
// simulates opens/clicks/a bounce/an unsubscribe, then keeps the process
// alive so you can open http://localhost:4000/dashboard in a browser.

const PORT = 4000;
const dbPath = path.resolve('data', 'demo.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbPath + suffix, { force: true });
}

let callCount = 0;
const demoTransport = {
  name: 'Demo',
  version: '1.0.0',
  send(mail, callback) {
    callCount += 1;
    if (mail.data.to === 'bounce@example.com') {
      const err = new Error('550 5.1.1 no such user');
      err.responseCode = 550;
      return callback(err);
    }
    callback(null, { messageId: `<${callCount}@demo>` });
  },
};

const system = createEmailingSystem({
  dbPath,
  fromDefault: 'no-reply@example.com',
  servers: [{ name: 'demo', customTransport: nodemailer.createTransport(demoTransport), maxPerMinute: 1000 }],
  pollIntervalMs: 200,
  tracking: { enabled: true, baseUrl: `http://localhost:${PORT}` },
  unsubscribe: { enabled: true, baseUrl: `http://localhost:${PORT}`, mailto: 'unsubscribe@example.com' },
  dashboard: { enabled: true },
  publicServerPort: PORT,
});

system.sendBulk(
  [{ to: 'alice@example.com' }, { to: 'bob@example.com' }, { to: 'bounce@example.com' }, { to: 'carol@example.com' }],
  {
    subject: 'Offre du mois',
    html: '<html><body><p>Salut !</p><a href="https://example.com/promo">Voir l\'offre</a></body></html>',
    campaignName: 'Campagne demo - Offre du mois',
  }
);

system.sendBulk([{ to: 'dave@example.com' }, { to: 'erin@example.com' }], {
  subject: 'Newsletter',
  html: '<html><body><p>Les news du mois</p><a href="https://example.com/blog">Lire</a></body></html>',
  campaignName: 'Campagne demo - Newsletter',
});

await system.start();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(600);

// Simulate some engagement so the dashboard has non-zero numbers.
const rows = system._internal.db.prepare('SELECT to_address, tracking_id FROM emails WHERE tracking_id IS NOT NULL').all();
for (const row of rows) {
  if (row.to_address === 'alice@example.com' || row.to_address === 'dave@example.com') {
    await fetch(`http://localhost:${PORT}/t/o/${row.tracking_id}.png`);
  }
  if (row.to_address === 'alice@example.com') {
    await fetch(
      `http://localhost:${PORT}/t/c/${row.tracking_id}?u=${encodeURIComponent('https://example.com/promo')}`,
      { redirect: 'manual' }
    );
  }
  if (row.to_address === 'erin@example.com') {
    await fetch(`http://localhost:${PORT}/u/${row.tracking_id}`, { method: 'POST' });
  }
}

console.log(`\nDemo prete. Ouvre http://localhost:${PORT}/dashboard dans ton navigateur.`);
console.log('(Ctrl+C pour arreter le serveur)');
