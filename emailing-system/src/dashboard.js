function pct(ratio) {
  return `${(ratio * 100).toFixed(1)}%`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderDashboardHtml(campaigns, { suppressionCount }) {
  const rows = campaigns
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${new Date(c.created_at).toLocaleString('fr-FR')}</td>
        <td>${c.stats.sent} / ${c.stats.total}</td>
        <td>${c.stats.opened} (${pct(c.stats.openRate)})</td>
        <td>${c.stats.clicks} (${pct(c.stats.clickRate)})</td>
        <td>${c.stats.bounced} (${pct(c.stats.bounceRate)})</td>
        <td>${c.stats.unsubscribed}</td>
      </tr>`
    )
    .join('');

  const emptyRow = `<tr><td colspan="7" style="text-align:center;color:#888;">Aucune campagne pour l'instant</td></tr>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Dashboard emailing</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; font-size: 0.9rem; }
  th { background: #f5f5f5; }
  .summary { margin-top: 1rem; color: #555; font-size: 0.9rem; }
</style>
</head>
<body>
  <h1>Dashboard des campagnes</h1>
  <table>
    <thead>
      <tr>
        <th>Campagne</th>
        <th>Créée le</th>
        <th>Envoyés</th>
        <th>Ouverts</th>
        <th>Clics</th>
        <th>Bounces</th>
        <th>Désinscrits</th>
      </tr>
    </thead>
    <tbody>
      ${campaigns.length ? rows : emptyRow}
    </tbody>
  </table>
  <p class="summary">Adresses en liste de suppression (toutes campagnes confondues) : ${suppressionCount}</p>
</body>
</html>`;
}
