import {
  isQuotaError,
  getOfflineStorageStatus,
  formatStorageBytes,
} from './offlineStorageService';

beforeEach(() => {
  jest.clearAllMocks();
});

test('identifies browser quota failures without discarding data', () => {
  expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
  expect(isQuotaError({ code: 'QUOTA_EXCEEDED' })).toBe(true);
  expect(isQuotaError({ message: 'Storage quota exceeded' })).toBe(true);
  expect(isQuotaError({ message: 'Network unavailable' })).toBe(false);
});

test('reports warning and critical storage pressure thresholds', async () => {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: jest.fn().mockResolvedValue({ usage: 85, quota: 100 }) },
  });

  await expect(getOfflineStorageStatus()).resolves.toEqual({
    supported: true,
    usage: 85,
    quota: 100,
    usedPercent: 85,
    warning: true,
    critical: false,
  });

  navigator.storage.estimate.mockResolvedValue({ usage: 91, quota: 100 });
  await expect(getOfflineStorageStatus()).resolves.toMatchObject({
    usedPercent: 91,
    warning: true,
    critical: true,
  });
});

test('formats storage sizes and unavailable estimates safely', async () => {
  expect(formatStorageBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: jest.fn().mockRejectedValue(new Error('Estimate unavailable')) },
  });
  await expect(getOfflineStorageStatus()).resolves.toMatchObject({
    supported: false,
    warning: false,
    critical: false,
  });
});
