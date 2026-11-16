const KEY = 'hs_offline_session';

export function createOfflineSession({ userId, role, expiresHours = 24 }) {
  const now = Date.now();
  const data = { userId, role, createdAt: now, expiresAt: now + expiresHours * 3600 * 1000 };
  localStorage.setItem(KEY, JSON.stringify(data));
  return data;
}

export function getOfflineSession() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (Date.now() > obj.expiresAt) {
      localStorage.removeItem(KEY);
      return null;
    }
    return obj;
  } catch (err) {
    return null;
  }
}

export function clearOfflineSession() {
  localStorage.removeItem(KEY);
}

export default { createOfflineSession, getOfflineSession, clearOfflineSession };
