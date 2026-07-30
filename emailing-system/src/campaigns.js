export class CampaignStore {
  constructor(db) {
    this.stmts = {
      insert: db.prepare(`INSERT INTO campaigns (name, created_at) VALUES (?, ?)`),
      list: db.prepare(`SELECT id, name, created_at FROM campaigns ORDER BY created_at DESC`),
      getById: db.prepare(`SELECT id, name, created_at FROM campaigns WHERE id = ?`),
      statsForCampaign: db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
          SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS bounced,
          SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
          SUM(click_count) AS clicks
        FROM emails
        WHERE campaign_id = ?
      `),
      unsubscribedForCampaign: db.prepare(`
        SELECT COUNT(DISTINCT s.email) AS n
        FROM suppressions s
        JOIN emails e ON e.to_address = s.email COLLATE NOCASE
        WHERE e.campaign_id = ? AND s.reason = 'unsubscribe'
      `),
    };
  }

  create(name) {
    const result = this.stmts.insert.run(name, Date.now());
    return Number(result.lastInsertRowid);
  }

  list() {
    return this.stmts.list.all();
  }

  stats(campaignId) {
    const row = this.stmts.statsForCampaign.get(campaignId);
    const total = row.total ?? 0;
    const sent = row.sent ?? 0;
    const bounced = row.bounced ?? 0;
    const opened = row.opened ?? 0;
    const clicks = row.clicks ?? 0;
    const unsubscribed = this.stmts.unsubscribedForCampaign.get(campaignId).n ?? 0;
    return {
      total,
      sent,
      bounced,
      opened,
      clicks,
      unsubscribed,
      openRate: sent ? opened / sent : 0,
      clickRate: sent ? clicks / sent : 0,
      bounceRate: total ? bounced / total : 0,
    };
  }

  listWithStats() {
    return this.list().map((campaign) => ({ ...campaign, stats: this.stats(campaign.id) }));
  }
}
