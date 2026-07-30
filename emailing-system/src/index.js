import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { Queue, PRIORITY } from './queue.js';
import { SmtpPool } from './smtpPool.js';
import { TemplateRenderer } from './templates.js';
import { Worker } from './worker.js';
import { TrackingStore } from './trackingStore.js';
import { SuppressionList } from './suppressionList.js';
import { CampaignStore } from './campaigns.js';
import { WebhookEmitter } from './webhooks.js';
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
  const trackingStore = new TrackingStore(db);
  const suppressionList = new SuppressionList(db);
  const campaignStore = new CampaignStore(db);
  const webhooks = new WebhookEmitter(config.webhooks);
  const worker = new Worker(queue, smtpPool, suppressionList, webhooks, config);
  let publicServer = null;

  function buildUnsubscribeHeaders(trackingId) {
    const unsubUrl = `${config.unsubscribe.baseUrl}/u/${trackingId}`;
    const targets = config.unsubscribe.mailto ? [`<mailto:${config.unsubscribe.mailto}>`, `<${unsubUrl}>`] : [`<${unsubUrl}>`];
    return {
      'List-Unsubscribe': targets.join(', '),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  function sendEmail({ to, subject, html, text, from, priority = PRIORITY.NORMAL, maxAttempts, campaignId, variant }) {
    if (suppressionList.isSuppressed(to)) {
      logger.warn('email_suppressed', { to });
      return null;
    }

    const needsPublicId = config.tracking.enabled || config.unsubscribe.enabled;
    const trackingId = needsPublicId ? crypto.randomUUID() : undefined;

    let finalHtml = html;
    if (config.tracking.enabled && html) {
      finalHtml = injectTracking(finalHtml, { trackingId, baseUrl: config.tracking.baseUrl });
    }

    const headers = config.unsubscribe.enabled ? buildUnsubscribeHeaders(trackingId) : undefined;

    return queue.enqueue({
      to,
      from: from ?? config.fromDefault,
      subject,
      html: finalHtml,
      text,
      priority,
      maxAttempts,
      trackingId,
      headers,
      campaignId,
      variant,
    });
  }

  function sendTemplate({ to, subject, template, variables, from, priority = PRIORITY.NORMAL, maxAttempts, campaignId, variant }) {
    const html = templates.render(template, variables);
    return sendEmail({ to, subject, html, from, priority, maxAttempts, campaignId, variant });
  }

  // Weighted random pick among A/B variants (weight defaults to 1, i.e. even split).
  function pickVariant(variants) {
    const totalWeight = variants.reduce((sum, v) => sum + (v.weight ?? 1), 0);
    let r = Math.random() * totalWeight;
    for (const v of variants) {
      r -= v.weight ?? 1;
      if (r <= 0) return v;
    }
    return variants[variants.length - 1];
  }

  function sendBulk(
    recipients,
    { subject, template, html, from, priority = PRIORITY.NORMAL, maxAttempts, campaignId, campaignName, variants }
  ) {
    const effectiveCampaignId = campaignId ?? (campaignName ? campaignStore.create(campaignName) : undefined);
    return recipients.map((r) => {
      const recipientVariables = typeof r === 'string' ? {} : r.variables ?? {};
      const to = typeof r === 'string' ? r : r.to;

      const chosen = variants ? pickVariant(variants) : null;
      const effectiveSubject = chosen?.subject ?? subject;
      const effectiveHtml = chosen?.html ?? html;
      const effectiveTemplate = chosen?.template ?? template;
      const variantName = chosen?.name;

      if (effectiveTemplate) {
        return sendTemplate({
          to,
          subject: effectiveSubject,
          template: effectiveTemplate,
          variables: recipientVariables,
          from,
          priority,
          maxAttempts,
          campaignId: effectiveCampaignId,
          variant: variantName,
        });
      }
      return sendEmail({
        to,
        subject: effectiveSubject,
        html: effectiveHtml,
        from,
        priority,
        maxAttempts,
        campaignId: effectiveCampaignId,
        variant: variantName,
      });
    });
  }

  async function start() {
    worker.start();
    const needsServer = config.tracking.enabled || config.unsubscribe.enabled || config.dashboard.enabled;
    if (needsServer && !publicServer) {
      publicServer = await startTrackingServer(trackingStore, suppressionList, campaignStore, webhooks, config.publicServerPort);
    }
    logger.info('emailing_system_started', {
      servers: config.servers.map((s) => s.name),
      tracking: config.tracking.enabled,
      unsubscribe: config.unsubscribe.enabled,
      dashboard: config.dashboard.enabled,
      webhooks: config.webhooks.enabled,
    });
  }

  async function stop() {
    worker.stop();
    if (publicServer) {
      await new Promise((resolve) => publicServer.close(resolve));
      publicServer = null;
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
    isSuppressed: (email) => suppressionList.isSuppressed(email),
    suppressionCount: () => suppressionList.count(),
    createCampaign: (name) => campaignStore.create(name),
    listCampaigns: () => campaignStore.listWithStats(),
    campaignStats: (campaignId) => campaignStore.stats(campaignId),
    campaignVariantStats: (campaignId) => campaignStore.statsByVariant(campaignId),
    _internal: { db, queue, smtpPool, templates, worker, trackingStore, suppressionList, campaignStore },
  };
}
