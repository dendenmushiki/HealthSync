export function isQuotaError(error) {
  return error?.name === 'QuotaExceededError' ||
    error?.code === 'QUOTA_EXCEEDED' ||
    error?.code === 22 ||
    /quota|storage/i.test(String(error?.message || ''));
}

export async function getOfflineStorageStatus() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { supported: false, usage: null, quota: null, usedPercent: null, warning: false, critical: false };
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usage = Number(estimate?.usage) || 0;
    const quota = Number(estimate?.quota) || 0;
    const usedPercent = quota > 0 ? Math.round((usage / quota) * 100) : null;
    return {
      supported: true,
      usage,
      quota,
      usedPercent,
      warning: usedPercent !== null && usedPercent >= 80,
      critical: usedPercent !== null && usedPercent >= 90,
    };
  } catch {
    return { supported: false, usage: null, quota: null, usedPercent: null, warning: false, critical: false };
  }
}

export function formatStorageBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

const offlineStorageService = { isQuotaError, getOfflineStorageStatus, formatStorageBytes };
export default offlineStorageService;
