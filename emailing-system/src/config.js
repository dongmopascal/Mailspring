import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseServersFromEnv() {
  if (process.env.SMTP_SERVERS) {
    // JSON array: [{"name":"primary","host":"...","port":587,"secure":false,
    //   "auth":{"user":"...","pass":"..."},"maxPerMinute":60}, ...]
    return JSON.parse(process.env.SMTP_SERVERS);
  }
  if (process.env.SMTP_HOST) {
    return [
      {
        name: 'primary',
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
        maxPerMinute: Number(process.env.SMTP_MAX_PER_MINUTE || 60),
      },
    ];
  }
  return [];
}

export function loadConfig(overrides = {}) {
  return {
    dbPath: overrides.dbPath || process.env.EMAILING_DB_PATH || path.join(ROOT, 'data', 'queue.sqlite'),
    fromDefault: overrides.fromDefault || process.env.SMTP_FROM || 'no-reply@example.com',
    servers: overrides.servers || parseServersFromEnv(),
    pollIntervalMs: overrides.pollIntervalMs ?? Number(process.env.WORKER_POLL_MS || 1000),
    batchSize: overrides.batchSize ?? Number(process.env.WORKER_BATCH_SIZE || 10),
    maxAttemptsDefault: overrides.maxAttemptsDefault ?? Number(process.env.MAX_ATTEMPTS || 5),
    backoffBaseMs: overrides.backoffBaseMs ?? Number(process.env.BACKOFF_BASE_MS || 30_000),
    backoffMaxMs: overrides.backoffMaxMs ?? Number(process.env.BACKOFF_MAX_MS || 30 * 60_000),
    circuitBreaker: {
      failureThreshold: overrides.circuitBreaker?.failureThreshold ?? 5,
      cooldownMs: overrides.circuitBreaker?.cooldownMs ?? 60_000,
    },
    templatesDir: overrides.templatesDir || path.join(ROOT, 'templates'),
    // Single HTTP server shared by the open/click-tracking pixel+redirects
    // and the one-click unsubscribe endpoint - one port regardless of which
    // of those features are enabled.
    publicServerPort:
      overrides.publicServerPort ?? Number(process.env.PUBLIC_SERVER_PORT || process.env.TRACKING_PORT || 4000),
    tracking: {
      enabled: overrides.tracking?.enabled ?? process.env.TRACKING_ENABLED === 'true',
      baseUrl: overrides.tracking?.baseUrl || process.env.TRACKING_BASE_URL || 'http://localhost:4000',
    },
    unsubscribe: {
      enabled: overrides.unsubscribe?.enabled ?? process.env.UNSUBSCRIBE_ENABLED === 'true',
      baseUrl:
        overrides.unsubscribe?.baseUrl ||
        process.env.UNSUBSCRIBE_BASE_URL ||
        overrides.tracking?.baseUrl ||
        process.env.TRACKING_BASE_URL ||
        'http://localhost:4000',
      mailto: overrides.unsubscribe?.mailto || process.env.UNSUBSCRIBE_MAILTO || undefined,
    },
    dashboard: {
      enabled: overrides.dashboard?.enabled ?? process.env.DASHBOARD_ENABLED === 'true',
    },
  };
}
