import { logger } from './logger.js';

export class Worker {
  constructor(queue, smtpPool, { pollIntervalMs, batchSize }) {
    this.queue = queue;
    this.smtpPool = smtpPool;
    this.pollIntervalMs = pollIntervalMs;
    this.batchSize = batchSize;
    this._timer = null;
    this._running = false;
  }

  start() {
    if (this._timer) return;
    const tick = async () => {
      if (this._running) return;
      this._running = true;
      try {
        await this._processBatch();
      } catch (err) {
        logger.error('worker_tick_error', { error: String(err) });
      } finally {
        this._running = false;
      }
    };
    this._timer = setInterval(tick, this.pollIntervalMs);
    tick();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _processBatch() {
    const jobs = this.queue.claimBatch(this.batchSize);
    for (const job of jobs) {
      const mailOptions = {
        from: job.from_address,
        to: job.to_address,
        subject: job.subject,
        html: job.html ?? undefined,
        text: job.text ?? undefined,
      };

      const result = await this.smtpPool.send(mailOptions);

      if (result.ok) {
        this.queue.markSent(job.id, { messageId: result.messageId, smtpServer: result.serverName });
        logger.info('email_sent', { id: job.id, to: job.to_address, server: result.serverName });
        continue;
      }

      if (result.noCapacity) {
        this.queue.releaseWithoutPenalty(job.id);
        continue;
      }

      const outcome = this.queue.markFailed(job.id, {
        error: result.error?.message ?? String(result.error),
        currentAttempts: job.attempts,
        maxAttempts: job.max_attempts,
      });
      logger.warn('email_send_failed', {
        id: job.id,
        to: job.to_address,
        server: result.serverName,
        dead: outcome.dead,
        attempts: outcome.attempts,
        retryInMs: outcome.retryInMs,
      });
    }
  }
}
