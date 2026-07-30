import crypto from 'node:crypto';
import { logger } from './logger.js';

// Fire-and-forget webhook delivery: never blocks email sending on a slow or
// down receiver. Each payload is HMAC-signed (when a secret is configured)
// so the receiver can verify it actually came from here and not a spoofed
// request.
export class WebhookEmitter {
  constructor({ enabled, url, secret } = {}) {
    this.enabled = Boolean(enabled && url);
    this.url = url;
    this.secret = secret;
  }

  emit(event, data) {
    if (!this.enabled) return;
    const payload = JSON.stringify({ event, timestamp: Date.now(), data });
    this._deliver(payload, 1).catch((error) => {
      logger.error('webhook_delivery_failed', { event, error: String(error) });
    });
  }

  async _deliver(payload, attempt) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.secret) {
      headers['X-Webhook-Signature'] = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');
    }

    let res;
    try {
      res = await fetch(this.url, { method: 'POST', headers, body: payload });
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      return this._deliver(payload, attempt + 1);
    }

    if (!res.ok && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      return this._deliver(payload, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(`webhook endpoint responded ${res.status}`);
    }
  }
}
