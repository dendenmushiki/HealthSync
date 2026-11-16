const KEY = 'hs_offline_session';

export function createOfflineSession({ userId, role, expiresHours = 24 }) {
  const ownerId = String(userId ?? '').trim();
  const accountRole = typeof role === 'string' ? role.trim() : '';
  if (!ownerId || !accountRole || !Number.isFinite(expiresHours) || expiresHours <= 0) {
    throw new Error('A valid account and role are required for offline authorization.');
  }
  const now = Date.now();
  const data = { userId: ownerId, role: accountRole, createdAt: now, expiresAt: now + expiresHours * 3600 * 1000 };
  localStorage.setItem(KEY, JSON.stringify(data));
  return data;
}

export function getOfflineSession() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || !obj.userId || typeof obj.role !== 'string' ||
        !Number.isFinite(obj.createdAt) || !Number.isFinite(obj.expiresAt) ||
        obj.expiresAt <= Date.now()) {
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

const offlineSessionService = { createOfflineSession, getOfflineSession, clearOfflineSession };

export default offlineSessionService;
