import nodemailer from 'nodemailer';
import { logger } from './logger.js';

// Manages several SMTP servers behind one interface: automatic failover to
// the next healthy server, a per-server circuit breaker (stop hammering a
// server that keeps failing) and a per-server rate limiter (sliding window).
export class SmtpPool {
  constructor(servers, { failureThreshold, cooldownMs }) {
    if (servers.length === 0) {
      throw new Error('SmtpPool requires at least one SMTP server configuration');
    }
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;

    this.servers = servers.map((cfg) => ({
      name: cfg.name,
      maxPerMinute: cfg.maxPerMinute ?? 60,
      transporter: cfg.customTransport ?? nodemailer.createTransport(cfg),
      consecutiveFailures: 0,
      downUntil: 0,
      sentTimestamps: [],
    }));
  }

  _isRateLimited(server, now) {
    const windowStart = now - 60_000;
    server.sentTimestamps = server.sentTimestamps.filter((t) => t > windowStart);
    return server.sentTimestamps.length >= server.maxPerMinute;
  }

  // Returns the first healthy, non-rate-limited server, or null if none
  // currently have capacity (caller should retry shortly).
  pickServer() {
    const now = Date.now();
    for (const server of this.servers) {
      if (server.downUntil > now) continue;
      if (this._isRateLimited(server, now)) continue;
      return server;
    }
    return null;
  }

  recordSuccess(server) {
    server.consecutiveFailures = 0;
    server.sentTimestamps.push(Date.now());
  }

  recordFailure(server) {
    server.consecutiveFailures += 1;
    if (server.consecutiveFailures >= this.failureThreshold) {
      server.downUntil = Date.now() + this.cooldownMs;
      logger.warn('circuit_breaker_open', {
        server: server.name,
        cooldownMs: this.cooldownMs,
        consecutiveFailures: server.consecutiveFailures,
      });
    }
  }

  async send(mailOptions) {
    const server = this.pickServer();
    if (!server) return { ok: false, noCapacity: true };

    try {
      const info = await server.transporter.sendMail(mailOptions);
      this.recordSuccess(server);
      return { ok: true, messageId: info.messageId, serverName: server.name };
    } catch (error) {
      this.recordFailure(server);
      return { ok: false, error, serverName: server.name };
    }
  }

  status() {
    const now = Date.now();
    return this.servers.map((s) => ({
      name: s.name,
      healthy: s.downUntil <= now,
      consecutiveFailures: s.consecutiveFailures,
      sentLastMinute: s.sentTimestamps.filter((t) => t > now - 60_000).length,
      maxPerMinute: s.maxPerMinute,
    }));
  }
}
