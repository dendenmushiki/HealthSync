import { TextDecoder, TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import {
  createOfflineVault,
  changeOfflineVaultCredential,
  addOfflineVaultPasswordWrapper,
  getOfflineRecord,
  getOfflineRecords,
  getOfflineVaultMetadata,
  getPinAttemptStatus,
  lockOfflineVault,
  isOfflineVaultUnlocked,
  putOfflineRecord,
  unlockOfflineVault,
} from './offlineVaultService';
import { createOfflineSession } from './offlineSessionService';
import idb from './indexedDbService';

jest.mock('./deviceIdentityService', () => ({
  __esModule: true,
  verifyDevicePossession: async () => true,
}));

const stores = new Map();
const keyFor = (key) => JSON.stringify(key);
const recordKey = (name, value) => (name === 'offlineVaults'
  ? value.userId
  : name === 'offlineSecurity' ? value.key : [value.userId, value.collection, value.recordKey]);
const getStore = (name) => {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name);
};

async function storePasswordWrappedVault({ userId, role, credential }) {
  const version = 3;
  const iterations = 600000;
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const material = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(credential),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const wrappingKey = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const rawKey = webcrypto.getRandomValues(new Uint8Array(64));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(JSON.stringify([
    'healthsync-offline-vault',
    version,
    String(userId),
    role,
    'wrapped-key',
  ]));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
    wrappingKey,
    new TextEncoder().encode(JSON.stringify(Array.from(rawKey)))
  );
  await idb.addToStore('offlineVaults', {
    userId: String(userId),
    role,
    version,
    kdf: 'PBKDF2-SHA-256',
    credentialType: 'password',
    iterations,
    salt,
    wrappedKey: { iv, ciphertext },
    createdAt: new Date().toISOString(),
  });
}

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
    const key = recordKey(name, value);
    const encodedKey = keyFor(key);
    if (store.has(encodedKey)) throw new Error('Key already exists.');
    store.set(encodedKey, value);
  });
  idb.putToStore = jest.fn(async (name, value) => {
    const key = recordKey(name, value);
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
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
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

test('unlocks an existing password vault with an account password below the current creation policy', async () => {
  await storePasswordWrappedVault({
    userId: 7,
    role: 'bhw',
    credential: 'Legacy9!',
  });

  await unlockOfflineVault({ userId: 7, credential: 'Legacy9!' });

  expect(isOfflineVaultUnlocked(7)).toBe(true);
});

test('prevents reading records through another account scope', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'FirstAccountPassword9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Account One' });
  await createOfflineVault({ userId: 8, role: 'bhw', credential: 'SecondAccountPassword9!' });
  createOfflineSession({ userId: 8, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(8, 'residents', 'resident-2', { first_name: 'Account Two' });

  await expect(getOfflineRecord(8, 'residents', 'resident-1')).resolves.toBeUndefined();
  await expect(getOfflineRecords(8, 'residents')).resolves.toEqual([{ first_name: 'Account Two' }]);
  await expect(getOfflineVaultMetadata(7)).resolves.toEqual({
    userId: '7',
    role: 'bhw',
    version: 3,
    credentialType: 'password',
    hasOnlinePasswordWrapper: false,
    createdAt: expect.any(String),
  });
});

test('rejects values that cannot be serialized before storing them', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await expect(putOfflineRecord(7, 'residents', 'resident-1', undefined))
    .rejects.toThrow('JSON serializable');
  expect(getStore('offlineData').size).toBe(0);
});

test('preserves profile photos and multipart request bodies inside encrypted records', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
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
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Preserved Record' });

  await changeOfflineVaultCredential({ userId: 7, credential: 'ChangedAccountPassword8!' });
  lockOfflineVault(7);
  await expect(unlockOfflineVault({ userId: 7, credential: 'CorrectHorseBattery9!' }))
    .rejects.toThrow('incorrect');
  await unlockOfflineVault({ userId: 7, credential: 'ChangedAccountPassword8!' });
  await expect(getOfflineRecord(7, 'residents', 'resident-1'))
    .resolves.toEqual({ first_name: 'Preserved Record' });
});

test('supports leading-zero PINs and preserves encrypted records when changing the PIN', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: '000042', credentialType: 'pin' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'PIN Protected Record' });

  lockOfflineVault(7);
  await expect(unlockOfflineVault({ userId: 7, credential: '000000' })).rejects.toThrow('incorrect');
  await unlockOfflineVault({ userId: 7, credential: '000042' });
  await changeOfflineVaultCredential({ userId: 7, credential: '000043', credentialType: 'pin' });

  lockOfflineVault(7);
  await expect(unlockOfflineVault({ userId: 7, credential: '000042' })).rejects.toThrow('incorrect');
  await unlockOfflineVault({ userId: 7, credential: '000043' });
  await expect(getOfflineRecord(7, 'residents', 'resident-1'))
    .resolves.toEqual({ first_name: 'PIN Protected Record' });
});

test('adds an online password wrapper without replacing the offline PIN wrapper', async () => {
  await createOfflineVault({
    userId: 7,
    role: 'bhw',
    credential: '000042',
    credentialType: 'pin',
  });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'offlineQueue', 'queued-operation', { table: 'adult_bmi_records' });

  lockOfflineVault(7);
  await unlockOfflineVault({ userId: 7, credential: '000042' });
  await addOfflineVaultPasswordWrapper({ userId: 7, credential: 'CorrectHorseBattery9!' });
  expect(await getOfflineVaultMetadata(7)).toEqual(expect.objectContaining({
    credentialType: 'pin',
    hasOnlinePasswordWrapper: true,
  }));

  lockOfflineVault(7);
  await unlockOfflineVault({
    userId: 7,
    credential: 'CorrectHorseBattery9!',
    credentialType: 'online-password',
  });
  await expect(getOfflineRecord(7, 'offlineQueue', 'queued-operation'))
    .resolves.toEqual({ table: 'adult_bmi_records' });

  lockOfflineVault(7);
  await unlockOfflineVault({ userId: 7, credential: '000042' });
  await expect(getOfflineRecord(7, 'offlineQueue', 'queued-operation'))
    .resolves.toEqual({ table: 'adult_bmi_records' });
});

test('preserves PIN-vault access when wrapping an existing account password below current policy', async () => {
  await createOfflineVault({
    userId: 7,
    role: 'bhw',
    credential: '000042',
    credentialType: 'pin',
  });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'offlineQueue', 'queued-operation', { table: 'adult_bmi_records' });

  lockOfflineVault(7);
  await unlockOfflineVault({ userId: 7, credential: '000042' });
  await addOfflineVaultPasswordWrapper({ userId: 7, credential: 'Legacy9!' });

  lockOfflineVault(7);
  await unlockOfflineVault({
    userId: 7,
    credential: 'Legacy9!',
    credentialType: 'online-password',
  });
  await expect(getOfflineRecord(7, 'offlineQueue', 'queued-operation'))
    .resolves.toEqual({ table: 'adult_bmi_records' });
});

test('creates an online password wrapper from an existing account password below current policy', async () => {
  await createOfflineVault({
    userId: 7,
    role: 'bhw',
    credential: '000042',
    credentialType: 'pin',
    onlinePassword: 'Legacy9!',
  });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });

  lockOfflineVault(7);
  await unlockOfflineVault({
    userId: 7,
    credential: 'Legacy9!',
    credentialType: 'online-password',
  });

  expect(isOfflineVaultUnlocked(7)).toBe(true);
});

test('rejects malformed PINs and locks after five incorrect attempts', async () => {
  await expect(createOfflineVault({ userId: 7, role: 'bhw', credential: '12345', credentialType: 'pin' }))
    .rejects.toThrow('exactly six digits');
  await expect(createOfflineVault({ userId: 7, role: 'bhw', credential: '12a456', credentialType: 'pin' }))
    .rejects.toThrow('exactly six digits');

  await createOfflineVault({ userId: 7, role: 'bhw', credential: '000042', credentialType: 'pin' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  lockOfflineVault(7);
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(unlockOfflineVault({ userId: 7, credential: '000000' })).rejects.toThrow('PIN is incorrect');
    }
    await expect(unlockOfflineVault({ userId: 7, credential: '000042' })).rejects.toThrow('Too many incorrect PIN attempts');
    expect(await idb.getFromStore('offlineSecurity', 'pin-attempts:7')).toEqual({
      key: 'pin-attempts:7',
      failures: 0,
      lockedUntil: now + 15 * 60 * 1000,
    });
  } finally {
    jest.restoreAllMocks();
  }
});

test('reports the existing local PIN attempt and lockout status', async () => {
  await idb.putToStore('offlineSecurity', {
    key: 'pin-attempts:7',
    failures: 3,
    lockedUntil: 0,
  });
  await expect(getPinAttemptStatus(7)).resolves.toEqual({
    attemptsRemaining: 2,
    lockedUntil: 0,
  });

  const lockedUntil = Date.now() + 15 * 60 * 1000;
  await idb.putToStore('offlineSecurity', {
    key: 'pin-attempts:7',
    failures: 0,
    lockedUntil,
  });
  await expect(getPinAttemptStatus(7)).resolves.toEqual({
    attemptsRemaining: 0,
    lockedUntil,
  });
});

test('requires a valid account grant and rejects role metadata tampering', async () => {
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await putOfflineRecord(7, 'residents', 'resident-1', { first_name: 'Authorized' });

  localStorage.setItem('hs_offline_session', JSON.stringify({
    userId: '7',
    role: 'bhw',
    createdAt: Date.now() - 2000,
    expiresAt: Date.now() - 1000,
  }));
  await expect(getOfflineRecord(7, 'residents', 'resident-1'))
    .rejects.toThrow('authorization is unavailable for this account and device');

  const vault = await idb.getFromStore('offlineVaults', '7');
  await idb.putToStore('offlineVaults', { ...vault, role: 'admin' });
  lockOfflineVault(7);
  createOfflineSession({ userId: 7, role: 'admin', deviceId: 'device-local' });
  await expect(unlockOfflineVault({ userId: 7, credential: 'CorrectHorseBattery9!' }))
    .rejects.toThrow('offline vault is damaged');
});
