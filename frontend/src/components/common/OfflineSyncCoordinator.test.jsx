import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { AuthContext } from '../../context/AuthContext';
import OfflineSyncCoordinator from './OfflineSyncCoordinator';
import api from '../../services/api/apiClient';
import syncManager from '../../services/offline/syncManager';
import networkService from '../../services/offline/networkService';

jest.mock('../../services/api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../../services/offline/syncManager', () => ({
  __esModule: true,
  default: { runSync: jest.fn() },
}));

jest.mock('../../services/offline/networkService', () => ({
  __esModule: true,
  default: { healthCheck: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(global, 'indexedDB', { configurable: true, value: {} });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  networkService.healthCheck.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

test('reconnect coordinator verifies the backend before synchronizing authorized offline work', async () => {
  localStorage.setItem('hs_token', 'test-token');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  api.get.mockResolvedValue({ data: { success: true } });
  syncManager.runSync.mockResolvedValue(undefined);

  const { container } = render(
    <AuthContext.Provider value={{ offlineVaultReady: true }}>
      <OfflineSyncCoordinator />
    </AuthContext.Provider>
  );

  expect(container).toBeEmptyDOMElement();
  window.dispatchEvent(new Event('online'));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'));
  expect(networkService.healthCheck).toHaveBeenCalled();
  await waitFor(() => expect(syncManager.runSync).toHaveBeenCalledTimes(1));
});

test('automatically starts sync when the signed-in owner vault becomes ready while online', async () => {
  localStorage.setItem('hs_token', 'test-token');
  api.get.mockResolvedValue({ data: { success: true } });
  syncManager.runSync.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });

  const { rerender } = render(
    <AuthContext.Provider value={{ offlineVaultReady: false }}>
      <OfflineSyncCoordinator />
    </AuthContext.Provider>
  );
  expect(syncManager.runSync).not.toHaveBeenCalled();

  rerender(
    <AuthContext.Provider value={{ offlineVaultReady: true }}>
      <OfflineSyncCoordinator />
    </AuthContext.Provider>
  );

  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'));
  await waitFor(() => expect(syncManager.runSync).toHaveBeenCalledTimes(1));
});

test('does not synchronize until the actual backend is reachable', async () => {
  localStorage.setItem('hs_token', 'test-token');
  networkService.healthCheck.mockResolvedValue(false);

  render(
    <AuthContext.Provider value={{ offlineVaultReady: true }}>
      <OfflineSyncCoordinator />
    </AuthContext.Provider>
  );

  await waitFor(() => expect(networkService.healthCheck).toHaveBeenCalled());
  expect(api.get).not.toHaveBeenCalled();
  expect(syncManager.runSync).not.toHaveBeenCalled();
});

test('rechecks backend availability and synchronizes when the server returns', async () => {
  jest.useFakeTimers();
  localStorage.setItem('hs_token', 'test-token');
  networkService.healthCheck
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true);
  api.get.mockResolvedValue({ data: { success: true } });
  syncManager.runSync.mockResolvedValue(undefined);

  const { unmount } = render(
    <AuthContext.Provider value={{ offlineVaultReady: true }}>
      <OfflineSyncCoordinator />
    </AuthContext.Provider>
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(syncManager.runSync).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(20000);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(networkService.healthCheck).toHaveBeenCalledTimes(2);
  expect(syncManager.runSync).toHaveBeenCalledTimes(1);
  unmount();
  jest.useRealTimers();
});
