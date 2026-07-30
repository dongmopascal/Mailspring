const SKIP_PREFIXES = ['mailto:', 'tel:', '#', 'javascript:'];

function shouldSkip(url) {
  const lower = url.toLowerCase();
  return SKIP_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Rewrites <a href="..."> links to go through the click-tracking endpoint and
// appends an invisible open-tracking pixel. Deliberately regex-based rather
// than a full HTML parser: email HTML is simple/known-shape (our own
// templates), so this stays dependency-free.
export function injectTracking(html, { trackingId, baseUrl }) {
  if (!html) return html;

  const withTrackedLinks = html.replace(/href="([^"]+)"/gi, (match, url) => {
    if (shouldSkip(url)) return match;
    const clickUrl = `${baseUrl}/t/c/${trackingId}?u=${encodeURIComponent(url)}`;
    return `href="${clickUrl}"`;
  });

  const pixel = `<img src="${baseUrl}/t/o/${trackingId}.png" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px;" />`;

  if (/<\/body>/i.test(withTrackedLinks)) {
    return withTrackedLinks.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return withTrackedLinks + pixel;
}
