function ts() {
  return new Date().toISOString();
}

function log(level, msg, meta) {
  const line = { ts: ts(), level, msg, ...(meta ? { meta } : {}) };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
