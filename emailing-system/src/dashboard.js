function pct(ratio) {
  return `${(ratio * 100).toFixed(1)}%`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderVariantSection(campaign) {
  if (!campaign.variants.length) return '';

  const bestOpenRate = Math.max(...campaign.variants.map((v) => v.openRate));

  const rows = campaign.variants
    .map((v) => {
      const isBest = v.openRate === bestOpenRate && bestOpenRate > 0;
      return `
      <tr>
        <td>${escapeHtml(v.variant)}${isBest ? ' <em>(meilleur taux d\'ouverture)</em>' : ''}</td>
        <td>${v.sent} / ${v.total}</td>
        <td>${v.opened} (${pct(v.openRate)})</td>
        <td>${v.clicks} (${pct(v.clickRate)})</td>
        <td>${v.bounced} (${pct(v.bounceRate)})</td>
      </tr>`;
    })
    .join('');

  return `
  <div class="variants">
    <h3>Test A/B — ${escapeHtml(campaign.name)}</h3>
    <table>
      <thead>
        <tr>
          <th>Variante</th>
          <th>Envoyés</th>
          <th>Ouverts</th>
          <th>Clics</th>
          <th>Bounces</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
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

  const variantSections = campaigns.map(renderVariantSection).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Dashboard emailing</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h3 { font-size: 1.05rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; font-size: 0.9rem; }
  th { background: #f5f5f5; }
  .summary { margin-top: 1rem; color: #555; font-size: 0.9rem; }
  .variants em { color: #2a7a2a; font-style: normal; font-size: 0.8rem; }
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
  ${variantSections}
</body>
</html>`;
}
