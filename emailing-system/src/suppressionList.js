export class SuppressionList {
  constructor(db) {
    this.stmts = {
      insert: db.prepare(`INSERT OR IGNORE INTO suppressions (email, reason, created_at) VALUES (?, ?, ?)`),
      check: db.prepare(`SELECT reason FROM suppressions WHERE email = ?`),
      count: db.prepare(`SELECT COUNT(*) AS n FROM suppressions`),
    };
  }

  isSuppressed(email) {
    return Boolean(this.stmts.check.get(email));
  }

  add(email, reason) {
    this.stmts.insert.run(email, reason, Date.now());
  }

  count() {
    return this.stmts.count.get().n;
  }
}
