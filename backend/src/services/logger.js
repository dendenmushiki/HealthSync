function safeMeta(meta) {
  if (!meta) return undefined;
  if (meta instanceof Error) {
    return { message: meta.message, stack: meta.stack };
  }
  return meta;
}

function log(level, message, meta) {
  const payload = { timestamp: new Date().toISOString(), level, message };
  const m = safeMeta(meta);
  if (m !== undefined) payload.meta = m;
  // write structured JSON to stderr for errors, stdout otherwise
  const out = JSON.stringify(payload);
  if (level === 'error') console.error(out);
  else console.log(out);
}

module.exports = {
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};
