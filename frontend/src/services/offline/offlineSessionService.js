const KEY = 'hs_offline_session';

export function createOfflineSession({ userId, role, deviceId }) {
  const ownerId = String(userId ?? '').trim();
  const accountRole = typeof role === 'string' ? role.trim() : '';
  const device = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!ownerId || !accountRole || !device) {
    throw new Error('A valid account, role, and authorized device are required for offline authorization.');
  }
  const activeDevice = localStorage.getItem('hs_offline_device_id');
  if (activeDevice && activeDevice !== device) {
    throw new Error('Offline authorization does not match this device.');
  }
  if (!activeDevice) localStorage.setItem('hs_offline_device_id', device);
  const data = { version: 2, userId: ownerId, role: accountRole, deviceId: device, createdAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(data));
  return data;
}

export function getOfflineSession() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || obj.version !== 2 || !obj.userId || typeof obj.role !== 'string' ||
        typeof obj.deviceId !== 'string' || !Number.isFinite(obj.createdAt)) return null;
    return obj;
  } catch (error) {
    return null;
  }
}

export function clearOfflineSession() {
  localStorage.removeItem(KEY);
}

const offlineSessionService = { createOfflineSession, getOfflineSession, clearOfflineSession };

export default offlineSessionService;
