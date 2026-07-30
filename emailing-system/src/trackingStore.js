export class TrackingStore {
  constructor(db) {
    this.stmts = {
      markOpened: db.prepare(`
        UPDATE emails
        SET opened_at = COALESCE(opened_at, ?), open_count = open_count + 1
        WHERE tracking_id = ?
      `),
      insertClick: db.prepare(`INSERT INTO clicks (tracking_id, url, clicked_at) VALUES (?, ?, ?)`),
      bumpClickCount: db.prepare(`UPDATE emails SET click_count = click_count + 1 WHERE tracking_id = ?`),
      exists: db.prepare(`SELECT 1 FROM emails WHERE tracking_id = ?`),
      campaignStats: db.prepare(`
        SELECT
          COUNT(*) AS total_sent,
          SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS total_opened,
          SUM(click_count) AS total_clicks
        FROM emails
        WHERE status = 'sent' AND tracking_id IS NOT NULL
      `),
    };
  }

  isKnownTrackingId(trackingId) {
    return Boolean(this.stmts.exists.get(trackingId));
  }

  markOpened(trackingId) {
    this.stmts.markOpened.run(Date.now(), trackingId);
  }

  recordClick(trackingId, url) {
    this.stmts.insertClick.run(trackingId, url, Date.now());
    this.stmts.bumpClickCount.run(trackingId);
  }

  campaignStats() {
    const row = this.stmts.campaignStats.get();
    const totalSent = row.total_sent ?? 0;
    const totalOpened = row.total_opened ?? 0;
    const totalClicks = row.total_clicks ?? 0;
    return {
      totalSent,
      totalOpened,
      totalClicks,
      openRate: totalSent ? totalOpened / totalSent : 0,
      clickRate: totalSent ? totalClicks / totalSent : 0,
    };
  }
}
