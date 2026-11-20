import React, { useContext } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthContext, AuthProvider } from './AuthContext';
import idb from '../services/offline/indexedDbService';
import {
  createOfflineVault,
  getOfflineRecord,
  getOfflineVaultMetadata,
  getPinAttemptStatus,
  hasOfflineVaultSessionUnlock,
  isOfflineVaultUnlocked,
  lockOfflineVault,
  putOfflineRecord,
  unlockOfflineVault,
} from '../services/offline/offlineVaultService';
import {
  clearOfflineSession,
  createOfflineSession,
  getOfflineSession,
  isOfflinePinRequired,
  setOfflinePinRequired,
} from '../services/offline/offlineSessionService';

jest.mock('../services/api/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('../services/auth/authService', () => ({
  __esModule: true,
  login: jest.fn(),
  checkDeviceAuthorization: jest.fn(),
  setAuth: jest.fn((token, user) => {
    globalThis.localStorage.setItem('hs_token', token);
    globalThis.localStorage.setItem('hs_user', JSON.stringify(user));
  }),
  logout: jest.fn(),
  getAuth: jest.fn(() => {
    const token = globalThis.localStorage.getItem('hs_token');
    const rawUser = globalThis.localStorage.getItem('hs_user');
    return { token, user: rawUser ? JSON.parse(rawUser) : null };
  }),
}));

jest.mock('../services/offline/offlineQueueService', () => ({
  __esModule: true,
  migrateLegacyQueue: jest.fn().mockResolvedValue({ migrated: 0, skipped: 0, unowned: 0 }),
}));

jest.mock('../services/offline/deviceIdentityService', () => ({
  __esModule: true,
  verifyDevicePossession: async () => true,
}));

import {
  checkDeviceAuthorization,
  getAuth,
  login as apiLogin,
  setAuth,
} from '../services/auth/authService';
import api from '../services/api/apiClient';

const stores = new Map();
const encodeKey = (key) => JSON.stringify(key);
const getStore = (name) => {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name);
};
const primaryKey = (name, value) => (
  name === 'offlineVaults'
    ? value.userId
    : [value.userId, value.collection, value.recordKey]
);

function AuthControls() {
  const auth = useContext(AuthContext);
  const [passwordChanged, setPasswordChanged] = React.useState(false);
  const [offlineUnlockError, setOfflineUnlockError] = React.useState('');
  return (
    <div>
      <button type="button" onClick={() => auth.login('first', 'CorrectHorseBattery9!')}>Login first</button>
      <button type="button" onClick={() => auth.login('first', 'Legacy9!')}>Login with legacy password</button>
      <button type="button" onClick={() => auth.login('second', 'CorrectHorseBattery9!')}>Login second</button>
      <button type="button" onClick={() => auth.logout({ skipServer: true })}>Logout</button>
      <button type="button" onClick={async () => {
        await auth.completePasswordChange(
          'server-token-first',
          { user_id: 7, role: 'bhw', device_id: 'device-local' },
          'NewCorrectHorseBattery9!'
        );
        setPasswordChanged(true);
      }}>Complete password change</button>
      <button type="button" onClick={() => auth.unlockOfflineAccess('CorrectHorseBattery9!')}>Unlock offline vault</button>
      <button type="button" onClick={() => auth.unlockOfflineAccess('000042')}>Migrate legacy vault</button>
      <button type="button" onClick={async () => {
        try {
          await auth.unlockOfflineAccess('000042');
        } catch (error) {
          setOfflineUnlockError(error.message);
        }
      }}>Unlock with registered PIN</button>
      <button type="button" onClick={async () => {
        try {
          await auth.unlockOfflineAccess('123456');
        } catch (error) {
          setOfflineUnlockError(error.message);
        }
      }}>Try displayed PIN</button>
      <output data-testid="vault-ready">{String(auth.offlineVaultReady)}</output>
      <output data-testid="vault-migration">{String(auth.offlineVaultMigrationRequired)}</output>
      <output data-testid="needs-unlock">{String(auth.offlineVaultNeedsUnlock)}</output>
      <output data-testid="user-id">{String(auth.user?.user_id || '')}</output>
      <output data-testid="cleanup-error">{String(auth.sessionCleanupError || '')}</output>
      <output data-testid="loading">{String(auth.loading)}</output>
      <output data-testid="password-changed">{String(passwordChanged)}</output>
      <output data-testid="offline-unlock-error">{offlineUnlockError}</output>
    </div>
  );
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: require('crypto').webcrypto });
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: { only: (value) => value } });
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: require('util').TextEncoder });
  Object.defineProperty(globalThis, 'TextDecoder', { configurable: true, value: require('util').TextDecoder });
});

beforeEach(() => {
  stores.clear();
  localStorage.clear();
  lockOfflineVault();
  getAuth.mockImplementation(() => {
    const token = localStorage.getItem('hs_token');
    const rawUser = localStorage.getItem('hs_user');
    return { token, user: rawUser ? JSON.parse(rawUser) : null };
  });
  idb.addToStore = jest.fn(async (name, value) => {
    const key = encodeKey(primaryKey(name, value));
    if (getStore(name).has(key)) throw new Error('Key already exists.');
    getStore(name).set(key, value);
  });
  idb.putToStore = jest.fn(async (name, value) => {
    getStore(name).set(encodeKey(primaryKey(name, value)), value);
  });
  idb.getFromStore = jest.fn(async (name, key) => getStore(name).get(encodeKey(key)));
  idb.getAllFromStore = jest.fn(async (name) => Array.from(getStore(name).values()));
  idb.getAllByIndex = jest.fn(async (name, index, range) => Array.from(getStore(name).values())
    .filter((record) => record.userId === range[0] && record.collection === range[1]));
  idb.deleteFromStore = jest.fn(async (name, key) => getStore(name).delete(encodeKey(key)));
  apiLogin.mockImplementation(async (username) => ({
    success: true,
    data: {
      token: `server-token-${username}`,
    user: {
      user_id: username === 'first' ? 7 : 8,
      role: 'bhw',
      username,
      device_id: 'device-local',
      offline_pin_enrolled: true,
    },
    },
  }));
  checkDeviceAuthorization.mockReset();
  checkDeviceAuthorization.mockResolvedValue(true);
  api.get.mockResolvedValue({
    data: {
      success: true,
      data: { user: { user_id: 7, role: 'bhw', offline_pin_enrolled: true } },
    },
  });
  api.post.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
  lockOfflineVault();
});

test('automatically unlocks a password-wrapped vault after online login', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  render(<AuthProvider><AuthControls /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Login first' }));

  await waitFor(() => expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '7', deviceId: 'device-local' })));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));
  expect(isOfflineVaultUnlocked(7)).toBe(true);
  expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '7', role: 'bhw' }));
  expect(setAuth).toHaveBeenCalledWith('server-token-first', expect.objectContaining({ user_id: 7 }));
  expect(localStorage.getItem('hs_password')).toBeNull();
});

test('prepares an encrypted sync queue on online login when this device has no offline PIN yet', async () => {
  apiLogin.mockResolvedValueOnce({
    success: true,
    data: {
      token: 'server-token-first',
      user: {
        user_id: 7,
        role: 'bhw',
        username: 'first',
        device_id: 'device-local',
        offline_pin_enrolled: false,
      },
    },
  });
  render(<AuthProvider><AuthControls /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Login first' }));

  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));
  expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '7', deviceId: 'device-local' }));
  expect(await getOfflineVaultMetadata(7)).toEqual(expect.objectContaining({
    credentialType: 'password',
    hasOnlinePasswordWrapper: true,
  }));
  await putOfflineRecord(7, 'offlineQueue', 'queued-operation', {
    offlineOperationId: 'queued-operation',
    status: 'PENDING',
  });
  expect(await getOfflineRecord(7, 'offlineQueue', 'queued-operation'))
    .toEqual(expect.objectContaining({ status: 'PENDING' }));
});

test('restores the online session but leaves a vault without a remembered session key locked', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  localStorage.setItem('hs_offline_device_id', 'device-local');
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'offlineQueue', 'queued-operation', {
    offlineOperationId: 'queued-operation',
    status: 'PENDING',
  });
  localStorage.setItem('hs_token', 'stored-token');
  localStorage.setItem('hs_user', JSON.stringify({
    user_id: 7,
    role: 'bhw',
    device_id: 'device-local',
    offline_pin_enrolled: true,
  }));
  lockOfflineVault(7);

  expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '7', role: 'bhw' }));
  expect(isOfflinePinRequired(7)).toBe(false);
  expect(getAuth()).toEqual(expect.objectContaining({
    token: 'stored-token',
    user: expect.objectContaining({ user_id: 7 }),
  }));
  render(<AuthProvider><AuthControls /></AuthProvider>);

  await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
  expect(localStorage.getItem('hs_token')).toBe('stored-token');
  expect(screen.getByTestId('user-id')).toHaveTextContent('7');
  expect(screen.getByTestId('needs-unlock')).toHaveTextContent('false');
  expect(screen.getByTestId('vault-ready')).toHaveTextContent('false');
  expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '7', role: 'bhw' }));
  expect(isOfflineVaultUnlocked(7)).toBe(false);
  expect(getStore('offlineData').size).toBe(1);
  await expect(getOfflineRecord(7, 'offlineQueue', 'queued-operation'))
    .rejects.toThrow('Unlock offline access');
});

test('keeps the encrypted offline queue unlocked after an online browser refresh', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  localStorage.setItem('hs_offline_device_id', 'device-local');
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await createOfflineVault({
    userId: 7,
    role: 'bhw',
    credential: 'CorrectHorseBattery9!',
    onlinePassword: 'CorrectHorseBattery9!',
  });
  await putOfflineRecord(7, 'offlineQueue', 'queued-operation', {
    offlineOperationId: 'queued-operation',
    status: 'PENDING',
  });
  localStorage.setItem('hs_token', 'stored-token');
  localStorage.setItem('hs_user', JSON.stringify({
    user_id: 7,
    role: 'bhw',
    device_id: 'device-local',
    offline_pin_enrolled: true,
  }));
  lockOfflineVault(7, { preserveSessionUnlock: true });

  render(<AuthProvider><AuthControls /></AuthProvider>);

  await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));
  expect(api.get).toHaveBeenCalledWith('/auth/me');
  expect(isOfflineVaultUnlocked(7)).toBe(true);
  await expect(getOfflineRecord(7, 'offlineQueue', 'queued-operation'))
    .resolves.toEqual(expect.objectContaining({ status: 'PENDING' }));
});

test('requires PIN unlock after refreshing offline instead of restoring the tab session key', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  sessionStorage.clear();
  localStorage.setItem('hs_offline_device_id', 'device-local');
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await createOfflineVault({
    userId: 7,
    role: 'bhw',
    credential: '000042',
    credentialType: 'pin',
  });
  localStorage.setItem('hs_token', 'stored-token');
  localStorage.setItem('hs_user', JSON.stringify({
    user_id: 7,
    role: 'bhw',
    device_id: 'device-local',
    offline_pin_enrolled: true,
  }));
  lockOfflineVault(7, { preserveSessionUnlock: true });

  render(<AuthProvider><AuthControls /></AuthProvider>);

  await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
  expect(screen.getByTestId('vault-ready')).toHaveTextContent('false');
  expect(hasOfflineVaultSessionUnlock({
    userId: 7,
    role: 'bhw',
    deviceId: 'device-local',
  })).toBe(false);
  expect(isOfflineVaultUnlocked(7)).toBe(false);
});

test('allows local PIN unlock when the backend cannot confirm device status', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  localStorage.setItem('hs_offline_device_id', 'device-local');
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await createOfflineVault({
    userId: 7,
    role: 'bhw',
    credential: '000042',
    credentialType: 'pin',
  });
  await putOfflineRecord(7, 'offlineQueue', 'queued-operation', {
    offlineOperationId: 'queued-operation',
    status: 'PENDING',
  });
  lockOfflineVault(7);
  localStorage.setItem('hs_token', 'stored-token');
  localStorage.setItem('hs_user', JSON.stringify({
    user_id: 7,
    role: 'bhw',
    device_id: 'device-local',
    offline_pin_enrolled: true,
  }));
  checkDeviceAuthorization.mockRejectedValue(new Error('Network Error'));

  render(<AuthProvider><AuthControls /></AuthProvider>);
  await waitFor(() => expect(checkDeviceAuthorization).toHaveBeenCalled());
  expect(isOfflineVaultUnlocked(7)).toBe(false);
  await waitFor(() => expect(screen.getByTestId('needs-unlock')).toHaveTextContent('true'));
  expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '7', deviceId: 'device-local' }));

  fireEvent.click(screen.getByRole('button', { name: 'Unlock with registered PIN' }));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));
  expect(isOfflineVaultUnlocked(7)).toBe(true);
  await expect(getOfflineRecord(7, 'offlineQueue', 'queued-operation'))
    .resolves.toEqual(expect.objectContaining({ status: 'PENDING' }));
});

test('does not allow local PIN unlock after the backend confirms device revocation', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  localStorage.setItem('hs_offline_device_id', 'device-local');
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await createOfflineVault({
    userId: 7,
    role: 'bhw',
    credential: '000042',
    credentialType: 'pin',
  });
  lockOfflineVault(7);
  localStorage.setItem('hs_token', 'stored-token');
  localStorage.setItem('hs_user', JSON.stringify({
    user_id: 7,
    role: 'bhw',
    device_id: 'device-local',
    offline_pin_enrolled: true,
  }));
  checkDeviceAuthorization.mockRejectedValue({
    response: { status: 403, data: { errorCode: 'DEVICE_REVOKED' } },
  });

  render(<AuthProvider><AuthControls /></AuthProvider>);
  await waitFor(() => expect(checkDeviceAuthorization).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Unlock with registered PIN' }));

  await waitFor(() => expect(screen.getByTestId('offline-unlock-error'))
    .toHaveTextContent('Device authorization could not be verified.'));
  expect(isOfflineVaultUnlocked(7)).toBe(false);
});

test('preserves the PIN inactivity lock across refresh without deleting queue data', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  localStorage.setItem('hs_offline_device_id', 'device-local');
  await createOfflineVault({
    userId: 7,
    role: 'bhw',
    credential: '000042',
    credentialType: 'pin',
  });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'offlineQueue', 'queued-operation', {
    offlineOperationId: 'queued-operation',
    status: 'PENDING',
  });
  localStorage.setItem('hs_token', 'stored-token');
  localStorage.setItem('hs_user', JSON.stringify({
    user_id: 7,
    role: 'bhw',
    device_id: 'device-local',
    offline_pin_enrolled: true,
  }));
  setOfflinePinRequired(7, true);
  lockOfflineVault(7);

  expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '7', role: 'bhw' }));
  expect(isOfflinePinRequired(7)).toBe(true);
  expect(getAuth()).toEqual(expect.objectContaining({
    token: 'stored-token',
    user: expect.objectContaining({ user_id: 7 }),
  }));
  render(<AuthProvider><AuthControls /></AuthProvider>);

  await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
  await waitFor(() => expect(screen.getByTestId('needs-unlock')).toHaveTextContent('true'));
  expect(screen.getByTestId('user-id')).toHaveTextContent('7');
  expect(screen.getByTestId('needs-unlock')).toHaveTextContent('true');
  expect(localStorage.getItem('hs_token')).toBe('stored-token');
  expect(getStore('offlineData').size).toBe(1);

  fireEvent.click(screen.getByRole('button', { name: 'Migrate legacy vault' }));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));
  expect(localStorage.getItem('hs_offline_pin_required:7')).toBeNull();
});

test('does not validate a displayed PIN as an account password for a password-wrapped vault', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  localStorage.setItem('hs_offline_device_id', 'device-local');
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'offlineQueue', 'queued-operation', {
    offlineOperationId: 'queued-operation',
    status: 'PENDING',
  });
  localStorage.setItem('hs_token', 'stored-token');
  localStorage.setItem('hs_user', JSON.stringify({
    user_id: 7,
    role: 'bhw',
    device_id: 'device-local',
    offline_pin_enrolled: true,
  }));
  setOfflinePinRequired(7, true);
  lockOfflineVault(7);

  render(<AuthProvider><AuthControls /></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId('needs-unlock')).toHaveTextContent('true'));
  fireEvent.click(screen.getByRole('button', { name: 'Try displayed PIN' }));

  await waitFor(() => expect(screen.getByTestId('offline-unlock-error'))
    .toHaveTextContent('password-protected, not PIN-protected'));
  await expect(getPinAttemptStatus(7)).resolves.toEqual({ attemptsRemaining: 5, lockedUntil: 0 });
  expect(screen.getByTestId('vault-ready')).toHaveTextContent('false');
  expect(getStore('offlineData').size).toBe(1);
});

test('migrates a PIN-only vault once, then restores the owner queue automatically without exposing it to another account', async () => {
  await createOfflineVault({
    userId: 7,
    role: 'bhw',
    credential: '000042',
    credentialType: 'pin',
  });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'offlineQueue', 'adult-bmi-operation', {
    table: 'adult_bmi_records',
    offlineOperationId: 'adult-bmi-operation',
  });
  lockOfflineVault(7);
  clearOfflineSession();

  render(<AuthProvider><AuthControls /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Login with legacy password' }));
  await waitFor(() => expect(screen.getByTestId('vault-migration')).toHaveTextContent('true'));
  expect(screen.getByTestId('vault-ready')).toHaveTextContent('false');
  expect(await getOfflineVaultMetadata(7)).toEqual(expect.objectContaining({
    credentialType: 'pin',
    hasOnlinePasswordWrapper: false,
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Migrate legacy vault' }));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));
  expect(screen.getByTestId('vault-migration')).toHaveTextContent('false');
  expect(await getOfflineVaultMetadata(7)).toEqual(expect.objectContaining({
    credentialType: 'pin',
    hasOnlinePasswordWrapper: true,
  }));
  expect(await getOfflineRecord(7, 'offlineQueue', 'adult-bmi-operation'))
    .toEqual(expect.objectContaining({ offlineOperationId: 'adult-bmi-operation' }));

  fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
  await waitFor(() => expect(getOfflineSession()).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Login with legacy password' }));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));
  expect(screen.getByTestId('vault-migration')).toHaveTextContent('false');
  expect(await getOfflineRecord(7, 'offlineQueue', 'adult-bmi-operation'))
    .toEqual(expect.objectContaining({ offlineOperationId: 'adult-bmi-operation' }));

  fireEvent.click(screen.getByRole('button', { name: 'Login second' }));
  await waitFor(() => expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '8' })));
  expect(isOfflineVaultUnlocked(7)).toBe(false);
  await expect(getOfflineRecord(8, 'offlineQueue', 'adult-bmi-operation'))
    .rejects.toThrow('Unlock offline access');
  expect(getStore('offlineData').size).toBe(1);
});

test('locks the prior account on account switch and preserves stored encrypted records on logout', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  render(<AuthProvider><AuthControls /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Login first' }));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));

  const { putOfflineRecord } = require('../services/offline/offlineVaultService');
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Preserved' });

  fireEvent.click(screen.getByRole('button', { name: 'Login second' }));
  await waitFor(() => expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '8' })));
  expect(isOfflineVaultUnlocked(7)).toBe(false);
  expect(screen.getByTestId('vault-ready')).toHaveTextContent('false');

  fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
  await waitFor(() => {
    expect(screen.getByTestId('vault-ready')).toHaveTextContent('false');
    expect(getOfflineSession()).toBeNull();
  });
  expect(getStore('offlineData').size).toBe(1);
  await expect(getOfflineRecord(7, 'residents', 'resident-1')).rejects.toThrow('Unlock offline access');
});

test('rewraps a legacy vault after a required password change without issuing a PIN grant', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Preserved' });
  lockOfflineVault(7);
  clearOfflineSession();
  apiLogin.mockImplementationOnce(async () => ({
    success: true,
    data: {
      token: 'server-token-first',
      user: {
        user_id: 7, role: 'bhw', username: 'first', must_change_password: true,
        device_id: 'device-local', offline_pin_enrolled: false,
      },
    },
  }));

  render(<AuthProvider><AuthControls /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Login first' }));
  await waitFor(() => expect(isOfflineVaultUnlocked(7)).toBe(true));
  expect(getOfflineSession()).toBeNull();
  expect(screen.getByTestId('vault-ready')).toHaveTextContent('false');

  fireEvent.click(screen.getByRole('button', { name: 'Complete password change' }));
  await waitFor(() => expect(screen.getByTestId('password-changed')).toHaveTextContent('true'));
  expect(screen.getByTestId('vault-ready')).toHaveTextContent('false');
  lockOfflineVault(7);
  await unlockOfflineVault({ userId: 7, credential: 'NewCorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  expect(await getOfflineRecord(7, 'residents', 'resident-1')).toEqual({ first_name: 'Preserved' });
});
