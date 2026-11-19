import idb from './indexedDbService';
import { getOfflineSession } from './offlineSessionService';
import { verifyDevicePossession } from './deviceIdentityService';

const VAULT_VERSION = 3;
const PBKDF2_ITERATIONS = 600000;
const BLOB_MARKER = '__healthsync_offline_blob_v1__';
const memoryKeys = new Map();

function getCrypto() {
  if (typeof window === 'undefined' || !window.crypto?.subtle || !window.crypto?.getRandomValues ||
      typeof window.TextEncoder !== 'function' || typeof window.TextDecoder !== 'function') {
    throw new Error('Secure offline storage is unavailable in this browser.');
  }
  return window.crypto;
}

function encodeText(value) {
  return new window.TextEncoder().encode(value);
}

function normalizeUserId(userId) {
  if (typeof userId !== 'string' && typeof userId !== 'number') {
    throw new Error('A signed-in account is required for offline storage.');
  }
  if (typeof userId === 'number' && !Number.isFinite(userId)) {
    throw new Error('A signed-in account is required for offline storage.');
  }
  const value = String(userId ?? '').trim();
  if (!value) throw new Error('A signed-in account is required for offline storage.');
  return value;
}

function validateCredential(credential, credentialType) {
  if (typeof credential !== 'string') {
    throw new Error('Enter a valid offline unlock credential.');
  }
  getCrypto();
  const valid = credentialType === 'pin'
    ? /^\d{6}$/.test(credential)
    : Array.from(credential).length >= 18 && /[A-Z]/.test(credential) &&
        /\d/.test(credential) && /[^A-Za-z0-9\s]/.test(credential) &&
        encodeText(credential).byteLength <= 72;
  if (!valid) throw new Error(credentialType === 'pin'
    ? 'PIN must contain exactly six digits.'
    : 'The offline credential must meet the HealthSync password requirements.');
}

function validateUnlockCredential(credential, credentialType) {
  if (credentialType === 'pin') {
    validateCredential(credential, 'pin');
    return;
  }
  if (typeof credential !== 'string' || !credential) {
    throw new Error('Enter a valid offline unlock credential.');
  }
  getCrypto();
  if (encodeText(credential).byteLength > 72) {
    throw new Error('The offline unlock credential is too long.');
  }
}

function createRandomBytes(length) {
  return getCrypto().getRandomValues(new Uint8Array(length));
}

async function deriveKey(credential, salt, iterations) {
  const crypto = getCrypto();
  const material = await crypto.subtle.importKey(
    'raw',
    encodeText(credential),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function wrappedKeyAad(userId, role) {
  return encodeText(JSON.stringify(['healthsync-offline-vault', VAULT_VERSION, userId, role, 'wrapped-key']));
}

function onlinePasswordWrappedKeyAad(userId, role) {
  return encodeText(JSON.stringify(['healthsync-offline-vault', VAULT_VERSION, userId, role, 'online-password-wrapped-key']));
}

function recordAad(userId, collection, recordKey) {
  return encodeText(JSON.stringify(['healthsync-offline-data', VAULT_VERSION, userId, collection, recordKey]));
}

function readBlobBytes(blob) {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  if (typeof window.FileReader !== 'function') {
    throw new Error('This browser cannot securely store offline file data.');
  }
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Unable to read offline file data.'));
    reader.readAsArrayBuffer(blob);
  });
}

async function encodeOfflineValue(value, active = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toJSON();
  if (typeof window.Blob === 'function' && value instanceof window.Blob) {
    const bytes = await readBlobBytes(value);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return {
      [BLOB_MARKER]: true,
      data: window.btoa(binary),
      name: typeof window.File === 'function' && value instanceof window.File ? value.name : null,
      lastModified: typeof window.File === 'function' && value instanceof window.File ? value.lastModified : null,
      type: value.type,
    };
  }
  if (typeof window.FormData === 'function' && value instanceof window.FormData) {
    const entries = [];
    for (const [key, item] of value.entries()) {
      entries.push([key, await encodeOfflineValue(item, active)]);
    }
    return { [BLOB_MARKER]: 'form-data', entries };
  }
  if (active.has(value)) throw new Error('Offline data must not contain circular references.');
  active.add(value);
  let encoded;
  if (Array.isArray(value)) {
    encoded = [];
    for (const item of value) encoded.push(await encodeOfflineValue(item, active));
  } else {
    encoded = {};
    for (const [key, item] of Object.entries(value)) {
      encoded[key] = await encodeOfflineValue(item, active);
    }
  }
  active.delete(value);
  return encoded;
}

function decodeOfflineValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (value[BLOB_MARKER] === 'form-data') {
    const formData = new window.FormData();
    for (const [key, item] of value.entries) formData.append(key, decodeOfflineValue(item));
    return formData;
  }
  if (value[BLOB_MARKER] === true) {
    const binary = window.atob(value.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const blob = new window.Blob([bytes], { type: value.type || '' });
    if (value.name && typeof window.File === 'function') {
      return new window.File([blob], value.name, { type: value.type || '', lastModified: value.lastModified || 0 });
    }
    return blob;
  }
  if (Array.isArray(value)) return value.map(decodeOfflineValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeOfflineValue(item)]));
}

async function encryptValue(key, value, additionalData) {
  const serialized = await serializeOfflineValue(value);
  if (typeof serialized !== 'string') throw new Error('Offline data must be JSON serializable.');
  const iv = createRandomBytes(12);
  const ciphertext = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
    key,
    encodeText(serialized)
  );
  return { iv, ciphertext };
}

async function serializeOfflineValue(value) {
  return JSON.stringify(await encodeOfflineValue(value));
}

export async function offlineValuesEqual(first, second) {
  const [serializedFirst, serializedSecond] = await Promise.all([
    serializeOfflineValue(first),
    serializeOfflineValue(second),
  ]);
  return serializedFirst === serializedSecond;
}

async function decryptValue(key, envelope, additionalData) {
  const plaintext = await getCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv: envelope.iv, additionalData, tagLength: 128 },
    key,
    envelope.ciphertext
  );
  return decodeOfflineValue(JSON.parse(new window.TextDecoder().decode(plaintext)));
}

function publicVaultMetadata(vault) {
  return vault ? {
    userId: vault.userId,
    role: vault.role,
    version: vault.version,
    credentialType: vault.credentialType || 'password',
    hasOnlinePasswordWrapper: Boolean(vault.onlinePasswordWrappedKey),
    createdAt: vault.createdAt,
  } : null;
}

export async function getOfflineVaultMetadata(userId) {
  const ownerId = normalizeUserId(userId);
  return publicVaultMetadata(await idb.getFromStore('offlineVaults', ownerId));
}

export async function getPinAttemptStatus(userId) {
  const ownerId = normalizeUserId(userId);
  const attempts = await idb.getFromStore('offlineSecurity', `pin-attempts:${ownerId}`);
  const lockedUntil = Number(attempts?.lockedUntil) || 0;
  const activeLockout = lockedUntil > Date.now();
  const failures = Math.min(5, Math.max(0, Number(attempts?.failures) || 0));
  return {
    attemptsRemaining: activeLockout ? 0 : 5 - failures,
    lockedUntil: activeLockout ? lockedUntil : 0,
  };
}

function normalizeRole(role) {
  if (typeof role !== 'string' || !role.trim()) {
    throw new Error('An authorized account role is required for offline storage.');
  }
  return role.trim();
}

async function importDataKeys(rawKey) {
  const crypto = getCrypto();
  const [key, indexKey] = await Promise.all([
    crypto.subtle.importKey('raw', rawKey.subarray(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
    crypto.subtle.importKey('raw', rawKey.subarray(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  ]);
  return { key, indexKey };
}

async function getStorageRecordKey(indexKey, userId, collection, recordKey) {
  const digest = await getCrypto().subtle.sign(
    'HMAC',
    indexKey,
    encodeText(JSON.stringify(['healthsync-offline-index', VAULT_VERSION, userId, collection, recordKey]))
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createOfflineVault({
  userId,
  role,
  credential,
  credentialType = 'password',
  onlinePassword,
}) {
  const ownerId = normalizeUserId(userId);
  const accountRole = normalizeRole(role);
  if (!['pin', 'password'].includes(credentialType)) throw new Error('The offline credential type is not supported.');
  validateCredential(credential, credentialType);
  if (onlinePassword !== undefined) validateUnlockCredential(onlinePassword, 'password');
  if (await idb.getFromStore('offlineVaults', ownerId)) {
    throw new Error('An offline vault already exists for this account on this device.');
  }

  const salt = createRandomBytes(16);
  const wrappingKey = await deriveKey(credential, salt, PBKDF2_ITERATIONS);
  const rawKey = createRandomBytes(64);
  let retainedInMemory = false;
  try {
    const { key, indexKey } = await importDataKeys(rawKey);
    const wrappedKey = await encryptValue(wrappingKey, Array.from(rawKey), wrappedKeyAad(ownerId, accountRole));
    const vault = {
      userId: ownerId,
      role: accountRole,
      version: VAULT_VERSION,
      kdf: 'PBKDF2-SHA-256',
      credentialType,
      iterations: PBKDF2_ITERATIONS,
      salt,
      wrappedKey,
      ...(onlinePassword !== undefined ? {
        onlinePasswordSalt: createRandomBytes(16),
        onlinePasswordIterations: PBKDF2_ITERATIONS,
      } : {}),
      createdAt: new Date().toISOString(),
    };
    if (onlinePassword !== undefined) {
      const onlinePasswordKey = await deriveKey(
        onlinePassword,
        vault.onlinePasswordSalt,
        vault.onlinePasswordIterations
      );
      vault.onlinePasswordWrappedKey = await encryptValue(
        onlinePasswordKey,
        Array.from(rawKey),
        onlinePasswordWrappedKeyAad(ownerId, accountRole)
      );
    }
    await idb.addToStore('offlineVaults', vault);
    memoryKeys.set(ownerId, { key, indexKey, rawKey, role: accountRole });
    retainedInMemory = true;
    return publicVaultMetadata(vault);
  } finally {
    if (!retainedInMemory) rawKey.fill(0);
  }
}

export async function unlockOfflineVault({ userId, credential, credentialType: requestedCredentialType }) {
  const ownerId = normalizeUserId(userId);
  const vault = await idb.getFromStore('offlineVaults', ownerId);
  if (!vault) throw new Error('Offline access has not been set up for this account on this device.');
  if (vault.version !== VAULT_VERSION || vault.kdf !== 'PBKDF2-SHA-256' || vault.iterations !== PBKDF2_ITERATIONS) {
    throw new Error('The offline vault format is not supported.');
  }
  const credentialType = requestedCredentialType || vault.credentialType || 'password';
  if (!['pin', 'password', 'online-password'].includes(credentialType)) {
    throw new Error('The offline credential type is not supported.');
  }
  const isOnlinePassword = credentialType === 'online-password';
  if (isOnlinePassword && (!vault.onlinePasswordWrappedKey || !vault.onlinePasswordSalt)) {
    throw new Error('This offline vault has not been prepared for automatic online restoration.');
  }
  validateUnlockCredential(credential, credentialType);
  if (credentialType === 'pin') {
    const grant = getOfflineSession();
    if (!grant || String(grant.userId) !== ownerId || grant.role !== vault.role ||
        !(await verifyDevicePossession(grant.deviceId))) {
      throw new Error('This device is not authorized to unlock offline data.');
    }
    const attemptKey = `pin-attempts:${ownerId}`;
    const attempts = await idb.getFromStore('offlineSecurity', attemptKey);
    if (attempts?.lockedUntil > Date.now()) {
      const minutes = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
      throw new Error(`Too many incorrect PIN attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
  }

  const wrappingKey = isOnlinePassword
    ? await deriveKey(credential, vault.onlinePasswordSalt, vault.onlinePasswordIterations)
    : await deriveKey(credential, vault.salt, vault.iterations);
  let rawKey;
  const credentialLabel = credentialType === 'pin' ? 'PIN' : 'account password';
  try {
    rawKey = await decryptValue(
      wrappingKey,
      isOnlinePassword ? vault.onlinePasswordWrappedKey : vault.wrappedKey,
      isOnlinePassword ? onlinePasswordWrappedKeyAad(ownerId, vault.role) : wrappedKeyAad(ownerId, vault.role)
    );
  } catch (error) {
    if (credentialType === 'pin') {
      const attemptKey = `pin-attempts:${ownerId}`;
      const previous = await idb.getFromStore('offlineSecurity', attemptKey);
      const failures = (previous?.lockedUntil > Date.now() ? 0 : previous?.failures || 0) + 1;
      await idb.putToStore('offlineSecurity', {
        key: attemptKey,
        failures: failures >= 5 ? 0 : failures,
        lockedUntil: failures >= 5 ? Date.now() + 15 * 60 * 1000 : 0,
      });
    }
    throw new Error(`The ${credentialLabel} is incorrect or the offline vault is damaged.`);
  }
  if (!Array.isArray(rawKey) || rawKey.length !== 64 || !vault.role) {
    throw new Error(`The ${credentialLabel} is incorrect or the offline vault is damaged.`);
  }

  const keyBytes = new Uint8Array(rawKey);
  rawKey.fill(0);
  let retainedInMemory = false;
  try {
    if (credentialType === 'pin') {
      await idb.putToStore('offlineSecurity', { key: `pin-attempts:${ownerId}`, failures: 0, lockedUntil: 0 });
    }
    const { key, indexKey } = await importDataKeys(keyBytes);
    memoryKeys.get(ownerId)?.rawKey.fill(0);
    memoryKeys.set(ownerId, { key, indexKey, rawKey: keyBytes, role: vault.role });
    retainedInMemory = true;
    return publicVaultMetadata(vault);
  } finally {
    if (!retainedInMemory) keyBytes.fill(0);
  }
}

export async function addOfflineVaultPasswordWrapper({ userId, credential }) {
  const ownerId = normalizeUserId(userId);
  validateUnlockCredential(credential, 'password');
  const { rawKey, role } = getUnlockedKey(ownerId);
  const vault = await idb.getFromStore('offlineVaults', ownerId);
  if (!vault || vault.version !== VAULT_VERSION) throw new Error('The offline vault format is not supported.');

  const onlinePasswordSalt = createRandomBytes(16);
  const onlinePasswordIterations = PBKDF2_ITERATIONS;
  const onlinePasswordKey = await deriveKey(credential, onlinePasswordSalt, onlinePasswordIterations);
  const onlinePasswordWrappedKey = await encryptValue(
    onlinePasswordKey,
    Array.from(rawKey),
    onlinePasswordWrappedKeyAad(ownerId, role)
  );
  const updatedVault = {
    ...vault,
    onlinePasswordSalt,
    onlinePasswordIterations,
    onlinePasswordWrappedKey,
  };
  await idb.putToStore('offlineVaults', updatedVault);
  return publicVaultMetadata(updatedVault);
}

export async function changeOfflineVaultCredential({ userId, credential, credentialType = 'password' }) {
  const ownerId = normalizeUserId(userId);
  if (!['pin', 'password'].includes(credentialType)) throw new Error('The offline credential type is not supported.');
  validateCredential(credential, credentialType);
  const { rawKey, role } = getUnlockedKey(ownerId);
  const vault = await idb.getFromStore('offlineVaults', ownerId);
  if (!vault || vault.version !== VAULT_VERSION) throw new Error('The offline vault format is not supported.');

  const salt = createRandomBytes(16);
  const wrappingKey = await deriveKey(credential, salt, PBKDF2_ITERATIONS);
  const wrappedKey = await encryptValue(
    wrappingKey,
    Array.from(rawKey),
    wrappedKeyAad(ownerId, role)
  );
  const updatedVault = { ...vault, credentialType, salt, wrappedKey, iterations: PBKDF2_ITERATIONS };
  if (credentialType === 'password') {
    const onlinePasswordSalt = createRandomBytes(16);
    const onlinePasswordKey = await deriveKey(credential, onlinePasswordSalt, PBKDF2_ITERATIONS);
    updatedVault.onlinePasswordSalt = onlinePasswordSalt;
    updatedVault.onlinePasswordIterations = PBKDF2_ITERATIONS;
    updatedVault.onlinePasswordWrappedKey = await encryptValue(
      onlinePasswordKey,
      Array.from(rawKey),
      onlinePasswordWrappedKeyAad(ownerId, role)
    );
  }
  await idb.putToStore('offlineVaults', updatedVault);
  return publicVaultMetadata(updatedVault);
}

export function lockOfflineVault(userId) {
  if (userId === undefined) {
    for (const { rawKey } of memoryKeys.values()) rawKey.fill(0);
    memoryKeys.clear();
    return;
  }
  const ownerId = normalizeUserId(userId);
  const unlocked = memoryKeys.get(ownerId);
  if (unlocked) unlocked.rawKey.fill(0);
  memoryKeys.delete(ownerId);
}

export function isOfflineVaultUnlocked(userId) {
  return memoryKeys.has(normalizeUserId(userId));
}

export function getUnlockedOfflineVaultRole(userId) {
  const unlocked = memoryKeys.get(normalizeUserId(userId));
  return unlocked?.role || null;
}

function getUnlockedKey(userId) {
  const ownerId = normalizeUserId(userId);
  const grant = getOfflineSession();
  const unlocked = memoryKeys.get(ownerId);
  if (!unlocked) throw new Error('Unlock offline access before using locally stored data.');
  if (!grant || String(grant.userId) !== ownerId || grant.role !== unlocked.role ||
      typeof grant.deviceId !== 'string' || localStorage.getItem('hs_offline_device_id') !== grant.deviceId) {
    throw new Error('Offline authorization is unavailable for this account and device.');
  }
  return {
    ownerId,
    key: unlocked.key,
    indexKey: unlocked.indexKey,
    rawKey: unlocked.rawKey,
    role: unlocked.role,
  };
}

function normalizeRecordKey(recordKey) {
  const value = String(recordKey ?? '').trim();
  if (!value) throw new Error('An offline record key is required.');
  return value;
}

function normalizeCollection(collection) {
  const value = String(collection ?? '').trim();
  if (!value) throw new Error('An offline data collection is required.');
  return value;
}

export async function putOfflineRecord(userId, collection, recordKey, value) {
  const { ownerId, key, indexKey } = getUnlockedKey(userId);
  const collectionName = normalizeCollection(collection);
  const keyName = normalizeRecordKey(recordKey);
  const storageKey = await getStorageRecordKey(indexKey, ownerId, collectionName, keyName);
  const encrypted = await encryptValue(key, value, recordAad(ownerId, collectionName, storageKey));
  await idb.putToStore('offlineData', {
    userId: ownerId,
    collection: collectionName,
    recordKey: storageKey,
    version: VAULT_VERSION,
    ...encrypted,
    updatedAt: new Date().toISOString(),
  });
}

export async function getOfflineRecord(userId, collection, recordKey) {
  const { ownerId, key, indexKey } = getUnlockedKey(userId);
  const collectionName = normalizeCollection(collection);
  const keyName = normalizeRecordKey(recordKey);
  const storageKey = await getStorageRecordKey(indexKey, ownerId, collectionName, keyName);
  const envelope = await idb.getFromStore('offlineData', [ownerId, collectionName, storageKey]);
  if (!envelope) return undefined;
  if (envelope.version !== VAULT_VERSION) throw new Error('The offline record format is not supported.');
  return decryptValue(key, envelope, recordAad(ownerId, collectionName, storageKey));
}

export async function getOfflineRecords(userId, collection) {
  const { ownerId, key } = getUnlockedKey(userId);
  const collectionName = normalizeCollection(collection);
  if (!window.IDBKeyRange?.only) {
    throw new Error('Account-scoped offline queries are unavailable in this browser.');
  }
  const envelopes = await idb.getAllByIndex(
    'offlineData',
    'byUserCollection',
    window.IDBKeyRange.only([ownerId, collectionName])
  );
  const records = [];
  for (const envelope of envelopes) {
    if (envelope.version !== VAULT_VERSION) throw new Error('The offline record format is not supported.');
    records.push(await decryptValue(key, envelope, recordAad(ownerId, collectionName, envelope.recordKey)));
  }
  return records;
}

export async function deleteOfflineRecords(userId, collection) {
  const { ownerId } = getUnlockedKey(userId);
  const collectionName = normalizeCollection(collection);
  if (!window.IDBKeyRange?.only) {
    throw new Error('Account-scoped offline queries are unavailable in this browser.');
  }
  const envelopes = await idb.getAllByIndex(
    'offlineData',
    'byUserCollection',
    window.IDBKeyRange.only([ownerId, collectionName])
  );
  for (const envelope of envelopes) {
    await idb.deleteFromStore('offlineData', [ownerId, collectionName, envelope.recordKey]);
  }
  return envelopes.length;
}

export async function deleteOfflineRecord(userId, collection, recordKey) {
  const { ownerId, indexKey } = getUnlockedKey(userId);
  const collectionName = normalizeCollection(collection);
  const keyName = normalizeRecordKey(recordKey);
  const storageKey = await getStorageRecordKey(indexKey, ownerId, collectionName, keyName);
  await idb.deleteFromStore('offlineData', [ownerId, collectionName, storageKey]);
}

const offlineVaultService = {
  addOfflineVaultPasswordWrapper,
  changeOfflineVaultCredential,
  createOfflineVault,
  deleteOfflineRecords,
  deleteOfflineRecord,
  getOfflineRecord,
  getOfflineRecords,
  getOfflineVaultMetadata,
  getPinAttemptStatus,
  getUnlockedOfflineVaultRole,
  isOfflineVaultUnlocked,
  offlineValuesEqual,
  lockOfflineVault,
  putOfflineRecord,
  unlockOfflineVault,
};

export default offlineVaultService;
