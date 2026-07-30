import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { Queue, PRIORITY } from './queue.js';
import { SmtpPool } from './smtpPool.js';
import { TemplateRenderer } from './templates.js';
import { Worker } from './worker.js';
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

  function sendEmail({ to, subject, html, text, from, priority = PRIORITY.NORMAL, maxAttempts }) {
    return queue.enqueue({
      to,
      from: from ?? config.fromDefault,
      subject,
      html,
      text,
      priority,
      maxAttempts,
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

  return {
    config,
    sendEmail,
    sendTemplate,
    sendBulk,
    start: () => {
      worker.start();
      logger.info('emailing_system_started', { servers: config.servers.map((s) => s.name) });
    },
    stop: () => worker.stop(),
    stats: () => queue.getStats(),
    smtpStatus: () => smtpPool.status(),
    _internal: { db, queue, smtpPool, templates, worker },
  };
}
