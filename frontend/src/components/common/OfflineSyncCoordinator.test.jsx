import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { AuthContext } from '../../context/AuthContext';
import OfflineSyncCoordinator from './OfflineSyncCoordinator';
import api from '../../services/api/apiClient';
import syncManager from '../../services/offline/syncManager';

jest.mock('../../services/api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../../services/offline/syncManager', () => ({
  __esModule: true,
  default: { runSync: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(global, 'indexedDB', { configurable: true, value: {} });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});

test('reconnect coordinator renders no banner and still synchronizes authorized offline work', async () => {
  localStorage.setItem('hs_token', 'test-token');
  api.get.mockResolvedValue({ data: { success: true } });
  syncManager.runSync.mockResolvedValue(undefined);

  const { container } = render(
    <AuthContext.Provider value={{ offlineVaultReady: true }}>
      <OfflineSyncCoordinator />
    </AuthContext.Provider>
  );

  expect(container).toBeEmptyDOMElement();
  window.dispatchEvent(new Event('online'));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'));
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
