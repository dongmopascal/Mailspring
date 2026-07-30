import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { Queue, PRIORITY } from './queue.js';
import { SmtpPool } from './smtpPool.js';
import { TemplateRenderer } from './templates.js';
import { Worker } from './worker.js';
import { TrackingStore } from './trackingStore.js';
import { injectTracking } from './tracking.js';
import { startTrackingServer } from './trackingServer.js';
import { logger } from './logger.js';

export { PRIORITY };

export function createEmailingSystem(overrides = {}) {
  const config = loadConfig(overrides);
  if (config.servers.length === 0) {
    throw new Error(
      'No SMTP server configured. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS, ' +
        'SMTP_SERVERS (JSON array), or pass { servers: [...] } to createEmailingSystem().'
    );
  }

  const db = openDb(config.dbPath);
  const queue = new Queue(db, config);
  const smtpPool = new SmtpPool(config.servers, config.circuitBreaker);
  const templates = new TemplateRenderer(config.templatesDir);
  const worker = new Worker(queue, smtpPool, config);
  const trackingStore = new TrackingStore(db);
  let trackingServer = null;

  function sendEmail({ to, subject, html, text, from, priority = PRIORITY.NORMAL, maxAttempts }) {
    let finalHtml = html;
    let trackingId;
    if (config.tracking.enabled && html) {
      trackingId = crypto.randomUUID();
      finalHtml = injectTracking(html, { trackingId, baseUrl: config.tracking.baseUrl });
    }
    return queue.enqueue({
      to,
      from: from ?? config.fromDefault,
      subject,
      html: finalHtml,
      text,
      priority,
      maxAttempts,
      trackingId,
    });
  }

  function sendTemplate({ to, subject, template, variables, from, priority = PRIORITY.NORMAL, maxAttempts }) {
    const html = templates.render(template, variables);
    return sendEmail({ to, subject, html, from, priority, maxAttempts });
  }

  function sendBulk(recipients, { subject, template, html, from, priority = PRIORITY.NORMAL, maxAttempts }) {
    return recipients.map((r) => {
      const variables = typeof r === 'string' ? {} : r.variables ?? {};
      const to = typeof r === 'string' ? r : r.to;
      if (template) {
        return sendTemplate({ to, subject, template, variables, from, priority, maxAttempts });
      }
      return sendEmail({ to, subject, html, from, priority, maxAttempts });
    });
  }

  async function start() {
    worker.start();
    if (config.tracking.enabled && !trackingServer) {
      trackingServer = await startTrackingServer(trackingStore, config.tracking.port);
    }
    logger.info('emailing_system_started', {
      servers: config.servers.map((s) => s.name),
      tracking: config.tracking.enabled,
    });
  }

  async function stop() {
    worker.stop();
    if (trackingServer) {
      await new Promise((resolve) => trackingServer.close(resolve));
      trackingServer = null;
    }
  }

  return {
    config,
    sendEmail,
    sendTemplate,
    sendBulk,
    start,
    stop,
    stats: () => queue.getStats(),
    smtpStatus: () => smtpPool.status(),
    trackingStats: () => trackingStore.campaignStats(),
    _internal: { db, queue, smtpPool, templates, worker, trackingStore },
  };
}
