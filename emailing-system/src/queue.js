export const PRIORITY = { HIGH: 10, NORMAL: 0 };

export class Queue {
  constructor(db, { maxAttemptsDefault, backoffBaseMs, backoffMaxMs }) {
    this.db = db;
    this.maxAttemptsDefault = maxAttemptsDefault;
    this.backoffBaseMs = backoffBaseMs;
    this.backoffMaxMs = backoffMaxMs;

    this.stmts = {
      insert: db.prepare(`
        INSERT INTO emails
          (tracking_id, to_address, from_address, subject, html, text, headers_json, priority, status,
           attempts, max_attempts, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
      `),
      claimable: db.prepare(`
        SELECT id FROM emails
        WHERE status = 'pending' AND next_attempt_at <= ?
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      `),
      markSending: db.prepare(`UPDATE emails SET status = 'sending', updated_at = ? WHERE id = ?`),
      getById: db.prepare(`SELECT * FROM emails WHERE id = ?`),
      markSent: db.prepare(`
        UPDATE emails SET status = 'sent', message_id = ?, smtp_server = ?, updated_at = ? WHERE id = ?
      `),
      markRetry: db.prepare(`
        UPDATE emails
        SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `),
      markDead: db.prepare(`
        UPDATE emails
        SET status = 'dead', attempts = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `),
      requeue: db.prepare(`
        UPDATE emails SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE id = ?
      `),
      statsByStatus: db.prepare(`SELECT status, COUNT(*) as n FROM emails GROUP BY status`),
    };
  }

  enqueue({ to, from, subject, html, text, priority = PRIORITY.NORMAL, maxAttempts, trackingId, headers }) {
    const now = Date.now();
    const result = this.stmts.insert.run(
      trackingId ?? null,
      to,
      from,
      subject,
      html ?? null,
      text ?? null,
      headers ? JSON.stringify(headers) : null,
      priority,
      maxAttempts ?? this.maxAttemptsDefault,
      now,
      now,
      now
    );
    return Number(result.lastInsertRowid);
  }

  claimBatch(limit) {
    const now = Date.now();
    const rows = this.stmts.claimable.all(now, limit);
    const claimed = [];
    for (const row of rows) {
      this.stmts.markSending.run(Date.now(), row.id);
      claimed.push(this.stmts.getById.get(row.id));
    }
    return claimed;
  }

  markSent(id, { messageId, smtpServer }) {
    this.stmts.markSent.run(messageId ?? null, smtpServer ?? null, Date.now(), id);
  }

  backoffFor(attempts) {
    const delay = this.backoffBaseMs * 2 ** (attempts - 1);
    return Math.min(delay, this.backoffMaxMs);
  }

  markFailed(id, { error, currentAttempts, maxAttempts }) {
    const attempts = currentAttempts + 1;
    const now = Date.now();
    if (attempts >= maxAttempts) {
      this.stmts.markDead.run(attempts, String(error), now, id);
      return { dead: true, attempts };
    }
    const delay = this.backoffFor(attempts);
    this.stmts.markRetry.run(attempts, now + delay, String(error), now, id);
    return { dead: false, attempts, retryInMs: delay };
  }

  // A permanent SMTP rejection (5xx): no point retrying, mark dead right away.
  markBounced(id, { error, currentAttempts }) {
    const attempts = currentAttempts + 1;
    this.stmts.markDead.run(attempts, String(error), Date.now(), id);
    return { dead: true, attempts, bounced: true };
  }

  // Puts a job back to pending without counting it as a failed attempt.
  // Used when no SMTP capacity is available (rate limit / circuit open).
  releaseWithoutPenalty(id, delayMs = 2000) {
    this.stmts.requeue.run(Date.now() + delayMs, Date.now(), id);
  }

  getStats() {
    const rows = this.stmts.statsByStatus.all();
    const stats = { pending: 0, sending: 0, sent: 0, dead: 0 };
    for (const r of rows) stats[r.status] = r.n;
    return stats;
  }
}
