const CACHE_TTL_MS = 45000;
const cache = new Map();

function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.generatedAtMs >= CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function set(key, data) {
  cache.set(key, { generatedAtMs: Date.now(), data });
}

function clear() {
  cache.clear();
}

module.exports = { get, set, clear };
