import http from 'node:http';
import { logger } from './logger.js';

const TRANSPARENT_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const UNSUBSCRIBE_PAGE =
  "<html><body><p>Vous avez bien ete desinscrit(e). Vous ne recevrez plus d'emails de notre part.</p></body></html>";

export function createTrackingServer(trackingStore, suppressionList) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    const openMatch = url.pathname.match(/^\/t\/o\/([^/]+)\.png$/);
    if (openMatch) {
      const trackingId = openMatch[1];
      if (trackingStore.isKnownTrackingId(trackingId)) {
        trackingStore.markOpened(trackingId);
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': TRANSPARENT_PIXEL.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(TRANSPARENT_PIXEL);
      return;
    }

    const clickMatch = url.pathname.match(/^\/t\/c\/([^/]+)$/);
    if (clickMatch) {
      const trackingId = clickMatch[1];
      const target = url.searchParams.get('u');
      if (!target) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing target url');
        return;
      }
      if (trackingStore.isKnownTrackingId(trackingId)) {
        trackingStore.recordClick(trackingId, target);
      }
      res.writeHead(302, { Location: target });
      res.end();
      return;
    }

    // One-click unsubscribe (RFC 8058): mail clients hit this with either a
    // plain GET (user clicked a link) or a POST with
    // "List-Unsubscribe=One-Click" (automated, triggered by the
    // List-Unsubscribe-Post header) - both are treated the same way here.
    const unsubMatch = url.pathname.match(/^\/u\/([^/]+)$/);
    if (unsubMatch && (req.method === 'GET' || req.method === 'POST')) {
      const trackingId = unsubMatch[1];
      const email = trackingStore.getRecipient(trackingId);
      if (email) {
        suppressionList.add(email, 'unsubscribe');
        logger.info('email_unsubscribed', { trackingId, email });
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(UNSUBSCRIBE_PAGE);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
}

export function startTrackingServer(trackingStore, suppressionList, port) {
  const server = createTrackingServer(trackingStore, suppressionList);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      logger.info('tracking_server_started', { port });
      resolve(server);
    });
  });
}
