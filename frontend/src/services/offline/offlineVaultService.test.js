import { TextDecoder, TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import {
  createOfflineVault,
  changeOfflineVaultCredential,
  getOfflineRecord,
  getOfflineRecords,
  getOfflineVaultMetadata,
  lockOfflineVault,
  isOfflineVaultUnlocked,
  putOfflineRecord,
  unlockOfflineVault,
} from './offlineVaultService';
import { createOfflineSession } from './offlineSessionService';
import idb from './indexedDbService';

const stores = new Map();
const keyFor = (key) => JSON.stringify(key);
const getStore = (name) => {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name);
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    configurable: true,
    value: { only: (value) => value },
  });
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });
  Object.defineProperty(globalThis, 'TextDecoder', { configurable: true, value: TextDecoder });
});

beforeEach(() => {
  stores.clear();
  localStorage.clear();
  idb.addToStore = jest.fn(async (name, value) => {
    const store = getStore(name);
    const key = name === 'offlineVaults' ? value.userId : [value.userId, value.collection, value.recordKey];
    const encodedKey = keyFor(key);
    if (store.has(encodedKey)) throw new Error('Key already exists.');
    store.set(encodedKey, value);
  });
  idb.putToStore = jest.fn(async (name, value) => {
    const key = name === 'offlineVaults' ? value.userId : [value.userId, value.collection, value.recordKey];
    getStore(name).set(keyFor(key), value);
  });
  idb.getFromStore = jest.fn(async (name, key) => getStore(name).get(keyFor(key)));
  idb.getAllByIndex = jest.fn(async (name, index, range) => Array.from(getStore(name).values())
    .filter((record) => record.userId === range[0] && record.collection === range[1]));
  idb.deleteFromStore = jest.fn(async (name, key) => getStore(name).delete(keyFor(key)));
  lockOfflineVault();
});

test('encrypts account-scoped records and requires the account password to unlock them', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Sensitive Name' });

  const [envelope] = Array.from(getStore('offlineData').values());
  expect(JSON.stringify(envelope)).not.toContain('Sensitive Name');
  expect(envelope.recordKey).not.toBe('resident-1');

  lockOfflineVault(7);
  await expect(getOfflineRecord(7, 'residents', 'resident-1'))
    .rejects.toThrow('Unlock offline access');
  await expect(unlockOfflineVault({ userId: 7, credential: 'IncorrectPassword999!' }))
    .rejects.toThrow('incorrect');
  await unlockOfflineVault({ userId: 7, credential: 'CorrectHorseBattery9!' });
  expect(isOfflineVaultUnlocked(7)).toBe(true);
  await expect(getOfflineRecord(7, 'residents', 'resident-1'))
    .resolves.toEqual({ first_name: 'Sensitive Name' });
});

test('prevents reading records through another account scope', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'FirstAccountPassword9!' });
  createOfflineSession({ userId: 7, role: 'bhw' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Account One' });
  await createOfflineVault({ userId: 8, role: 'bhw', credential: 'SecondAccountPassword9!' });
  createOfflineSession({ userId: 8, role: 'bhw' });
  await putOfflineRecord(8, 'residents', 'resident-2', { first_name: 'Account Two' });

  await expect(getOfflineRecord(8, 'residents', 'resident-1')).resolves.toBeUndefined();
  await expect(getOfflineRecords(8, 'residents')).resolves.toEqual([{ first_name: 'Account Two' }]);
  await expect(getOfflineVaultMetadata(7)).resolves.toEqual({
    userId: '7',
    role: 'bhw',
    version: 3,
    createdAt: expect.any(String),
  });
});

test('rejects values that cannot be serialized before storing them', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw' });
  await expect(putOfflineRecord(7, 'residents', 'resident-1', undefined))
    .rejects.toThrow('JSON serializable');
  expect(getStore('offlineData').size).toBe(0);
});

test('preserves profile photos and multipart request bodies inside encrypted records', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw' });
  const photo = new File(['private image bytes'], 'resident.png', { type: 'image/png' });
  const formData = new FormData();
  formData.append('photo', photo);
  await putOfflineRecord(7, 'offlineQueue', 'photo-change', { photo, request: { data: formData } });

  const record = await getOfflineRecord(7, 'offlineQueue', 'photo-change');
  expect(record.photo).toBeInstanceOf(File);
  const photoText = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(record.photo);
  });
  expect(photoText).toBe('private image bytes');
  expect(record.request.data).toBeInstanceOf(FormData);
  expect(record.request.data.get('photo')).toBeInstanceOf(File);
});

test('rejects credentials that violate password policy and refuses to replace an existing vault', async () => {
  await expect(createOfflineVault({ userId: 7, role: 'bhw', credential: 'short' }))
    .rejects.toThrow('HealthSync password requirements');
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  await expect(createOfflineVault({ userId: 7, role: 'bhw', credential: 'AnotherAccountPassword8!' }))
    .rejects.toThrow('already exists');
});

test('re-wraps the data key after a password change without losing encrypted records', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Preserved Record' });

  await changeOfflineVaultCredential({ userId: 7, credential: 'ChangedAccountPassword8!' });
  lockOfflineVault(7);
  await expect(unlockOfflineVault({ userId: 7, credential: 'CorrectHorseBattery9!' }))
    .rejects.toThrow('incorrect');
  await unlockOfflineVault({ userId: 7, credential: 'ChangedAccountPassword8!' });
  await expect(getOfflineRecord(7, 'residents', 'resident-1'))
    .resolves.toEqual({ first_name: 'Preserved Record' });
});

test('requires a valid account grant and rejects role metadata tampering', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Authorized' });

  localStorage.setItem('hs_offline_session', JSON.stringify({
    userId: '7',
    role: 'bhw',
    createdAt: Date.now() - 2000,
    expiresAt: Date.now() - 1000,
  }));
  await expect(getOfflineRecord(7, 'residents', 'resident-1'))
    .rejects.toThrow('authorization is unavailable or expired');

  const vault = await idb.getFromStore('offlineVaults', '7');
  await idb.putToStore('offlineVaults', { ...vault, role: 'admin' });
  lockOfflineVault(7);
  createOfflineSession({ userId: 7, role: 'admin' });
  await expect(unlockOfflineVault({ userId: 7, credential: 'CorrectHorseBattery9!' }))
    .rejects.toThrow('offline vault is damaged');
});
