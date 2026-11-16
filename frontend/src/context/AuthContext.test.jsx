import React, { useContext } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthContext, AuthProvider } from './AuthContext';
import idb from '../services/offline/indexedDbService';
import {
  createOfflineVault,
  getOfflineRecord,
  isOfflineVaultUnlocked,
  lockOfflineVault,
  putOfflineRecord,
  unlockOfflineVault,
} from '../services/offline/offlineVaultService';
import {
  clearOfflineSession,
  createOfflineSession,
  getOfflineSession,
} from '../services/offline/offlineSessionService';

jest.mock('../services/auth/authService', () => ({
  __esModule: true,
  login: jest.fn(),
  setAuth: jest.fn((token, user) => {
    globalThis.localStorage.setItem('hs_token', token);
    globalThis.localStorage.setItem('hs_user', JSON.stringify(user));
  }),
  logout: jest.fn(),
  getAuth: jest.fn(() => ({
    token: globalThis.localStorage.getItem('hs_token'),
    user: JSON.parse(globalThis.localStorage.getItem('hs_user') || 'null'),
  })),
}));

jest.mock('../services/offline/offlineQueueService', () => ({
  __esModule: true,
  migrateLegacyQueue: jest.fn().mockResolvedValue({ migrated: 0, skipped: 0, unowned: 0 }),
}));

import { login as apiLogin, setAuth } from '../services/auth/authService';

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
  return (
    <div>
      <button type="button" onClick={() => auth.login('first', 'CorrectHorseBattery9!')}>Login first</button>
      <button type="button" onClick={() => auth.login('second', 'CorrectHorseBattery9!')}>Login second</button>
      <button type="button" onClick={() => auth.logout({ skipServer: true })}>Logout</button>
      <button type="button" onClick={() => auth.completePasswordChange(
        'server-token-first',
        { user_id: 7, role: 'bhw' },
        'NewCorrectHorseBattery9!'
      )}>Complete password change</button>
      <output data-testid="vault-ready">{String(auth.offlineVaultReady)}</output>
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
      user: { user_id: username === 'first' ? 7 : 8, role: 'bhw', username },
    },
  }));
});

afterEach(() => {
  lockOfflineVault();
});

test('creates an encrypted account vault after online login without persisting the password', async () => {
  render(<AuthProvider><AuthControls /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Login first' }));

  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));
  expect(isOfflineVaultUnlocked(7)).toBe(true);
  expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '7', role: 'bhw' }));
  expect(setAuth).toHaveBeenCalledWith('server-token-first', expect.objectContaining({ user_id: 7 }));
  expect(localStorage.getItem('hs_password')).toBeNull();
});

test('locks the prior account on account switch and preserves stored encrypted records on logout', async () => {
  render(<AuthProvider><AuthControls /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Login first' }));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));

  const { putOfflineRecord } = require('../services/offline/offlineVaultService');
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Preserved' });

  fireEvent.click(screen.getByRole('button', { name: 'Login second' }));
  await waitFor(() => expect(isOfflineVaultUnlocked(8)).toBe(true));
  expect(isOfflineVaultUnlocked(7)).toBe(false);
  expect(getOfflineSession()).toEqual(expect.objectContaining({ userId: '8', role: 'bhw' }));

  fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('false'));
  expect(getStore('offlineData').size).toBe(1);
  await expect(getOfflineRecord(7, 'residents', 'resident-1')).rejects.toThrow('Unlock offline access');
});

test('rewraps an existing vault after a required password change without granting early offline access', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Preserved' });
  lockOfflineVault(7);
  clearOfflineSession();
  apiLogin.mockImplementationOnce(async () => ({
    success: true,
    data: {
      token: 'server-token-first',
      user: { user_id: 7, role: 'bhw', username: 'first', must_change_password: true },
    },
  }));

  render(<AuthProvider><AuthControls /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Login first' }));
  await waitFor(() => expect(isOfflineVaultUnlocked(7)).toBe(true));
  expect(getOfflineSession()).toBeNull();
  expect(screen.getByTestId('vault-ready')).toHaveTextContent('false');

  fireEvent.click(screen.getByRole('button', { name: 'Complete password change' }));
  await waitFor(() => expect(screen.getByTestId('vault-ready')).toHaveTextContent('true'));
  lockOfflineVault(7);
  await unlockOfflineVault({ userId: 7, credential: 'NewCorrectHorseBattery9!' });
  expect(await getOfflineRecord(7, 'residents', 'resident-1')).toEqual({ first_name: 'Preserved' });
});
