import { TextDecoder, TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import idb from './indexedDbService';
import {
  createOfflineVault,
  lockOfflineVault,
  unlockOfflineVault,
} from './offlineVaultService';
import {
  cleanupSyncedOperations,
  enqueueOperation,
  getDependentOperations,
  getPendingOperations,
  getQueueItems,
  getResidentIdMapping,
  migrateLegacyQueue,
  putResidentIdMapping,
  rewriteResidentReferences,
  updateOperationStatus,
} from './offlineQueueService';
import { clearOfflineSession, createOfflineSession } from './offlineSessionService';

const stores = new Map();
const encodeKey = (key) => JSON.stringify(key);
const getStore = (name) => {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name);
};
const primaryKey = (name, value) => (
  name === 'offlineVaults'
    ? value.userId
    : name === 'offlineQueue'
      ? value.offlineOperationId
      : [value.userId, value.collection, value.recordKey]
);

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: { only: (value) => value } });
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });
  Object.defineProperty(globalThis, 'TextDecoder', { configurable: true, value: TextDecoder });
});

beforeEach(async () => {
  stores.clear();
  localStorage.clear();
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 7, role: 'bhw' }));
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
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
});

afterEach(() => {
  lockOfflineVault();
});

test('stores queue payloads encrypted and scopes queue reads to the active account', async () => {
  await enqueueOperation({
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: { diagnosis: 'Sensitive diagnosis' },
    userId: 7,
  });

  const encryptedRows = Array.from(getStore('offlineData').values());
  expect(JSON.stringify(encryptedRows)).not.toContain('Sensitive diagnosis');
  await expect(getPendingOperations()).resolves.toHaveLength(1);
  await expect(getQueueItems(8)).rejects.toThrow('active account');
});

test('updates encrypted queue status without changing account ownership', async () => {
  const item = await enqueueOperation({
    operation: 'CREATE',
    module: 'residents',
    table: 'residents',
    payload: { first_name: 'Test' },
    userId: 7,
  });

  await updateOperationStatus(item.offlineOperationId, {
    status: 'SYNCED',
    userId: '8',
    offlineOperationId: 'foreign-change',
  });
  await expect(getQueueItems()).resolves.toEqual([
    expect.objectContaining({ offlineOperationId: item.offlineOperationId, status: 'SYNCED', userId: '7' }),
  ]);
});

test('assigns a stable local resident ID to encrypted resident queue records', async () => {
  const item = await enqueueOperation({
    operation: 'CREATE',
    module: 'residents',
    table: 'residents',
    payload: { first_name: 'Offline' },
    localRecord: { first_name: 'Offline', birthdate: '2010-01-01' },
    userId: 7,
  });

  expect(item.localRecord).toEqual(expect.objectContaining({
    id: `offline:${item.offlineOperationId}`,
    resident_id: `offline:${item.offlineOperationId}`,
    offlineResidentId: `offline:${item.offlineOperationId}`,
    sync_status: 'PENDING',
  }));
  expect(JSON.stringify(Array.from(getStore('offlineData').values()))).not.toContain('Offline');
});

test('coalesces an offline resident edit into its pending create', async () => {
  const create = await enqueueOperation({
    operation: 'CREATE',
    module: 'residents',
    table: 'residents',
    payload: { first_name: 'Offline', sitio: 'North' },
    request: { method: 'POST', url: '/residents', data: { first_name: 'Offline', sitio: 'North' } },
    localRecord: { first_name: 'Offline', sitio: 'North' },
    userId: 7,
  });

  const updated = await enqueueOperation({
    operation: 'UPDATE',
    module: 'residents',
    table: 'residents',
    payload: { first_name: 'Updated', sitio: 'South' },
    request: { method: 'PUT', url: `/residents/${create.localRecord.resident_id}`, data: { first_name: 'Updated', sitio: 'South' } },
    localRecord: { ...create.localRecord, first_name: 'Updated', sitio: 'South' },
    userId: 7,
  });

  expect(updated.offlineOperationId).toBe(create.offlineOperationId);
  expect(updated.operation).toBe('CREATE');
  expect(updated.request).toEqual(expect.objectContaining({
    method: 'POST',
    url: '/residents',
    data: expect.objectContaining({ first_name: 'Updated', sitio: 'South' }),
  }));
  expect(await getQueueItems()).toHaveLength(1);
});

test('records the parent resident operation as a local dependency', async () => {
  const resident = await enqueueOperation({
    operation: 'CREATE',
    module: 'residents',
    table: 'residents',
    payload: { first_name: 'Offline' },
    localRecord: { first_name: 'Offline' },
    userId: 7,
  });
  const record = await enqueueOperation({
    operation: 'CREATE',
    module: 'clinical_records',
    table: 'patient_clinical_records',
    payload: { resident_id: resident.localRecord.resident_id },
    request: { method: 'POST', url: `/resident-medical-records/${resident.localRecord.resident_id}/clinical`, data: { resident_id: resident.localRecord.resident_id } },
    userId: 7,
  });

  expect(record.dependsOn).toBe(resident.offlineOperationId);
});

test('marks every supported local record as pending before synchronization', async () => {
  const item = await enqueueOperation({
    operation: 'CREATE',
    module: 'adult_bmi',
    table: 'adult_bmi_records',
    payload: { resident_id: 15 },
    localRecord: { resident_id: 15, weight_kg: 62, height_cm: 165 },
    userId: 7,
  });

  expect(item.localRecord).toEqual(expect.objectContaining({
    offline: true,
    sync_status: 'PENDING',
    record_id: `offline:${item.offlineOperationId}`,
  }));
  expect(item.savedOffline).toBe(true);
});

test('preserves a provisional online request key when saving its failed write locally', async () => {
  const operationId = '123e4567-e89b-42d3-a456-426614174000';
  const item = await enqueueOperation({
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: { resident_id: 15 },
    userId: 7,
    offlineOperationId: operationId,
  });

  expect(item.offlineOperationId).toBe(operationId);
  expect(item.savedOffline).toBe(true);
});

test('does not automatically include failed or outcome-unknown records in synchronization attempts', async () => {
  const pending = await enqueueOperation({
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: { resident_id: 1 },
    userId: 7,
  });
  const failed = await enqueueOperation({
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: { resident_id: 2 },
    userId: 7,
  });
  const unknown = await enqueueOperation({
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: { resident_id: 3 },
    userId: 7,
  });
  await updateOperationStatus(failed.offlineOperationId, { status: 'FAILED' });
  await updateOperationStatus(unknown.offlineOperationId, { status: 'CONFLICT' });

  await expect(getPendingOperations()).resolves.toEqual([
    expect.objectContaining({ offlineOperationId: pending.offlineOperationId, status: 'PENDING' }),
  ]);
});

test('preserves Account A queued changes across logout and account switching', async () => {
  const accountAChange = await enqueueOperation({
    operation: 'CREATE',
    module: 'adult_bmi',
    table: 'adult_bmi_records',
    payload: { resident_id: 15, weight_kg: 62, height_cm: 165 },
    request: { method: 'POST', url: '/adult-bmi', data: { resident_id: 15, weight_kg: 62, height_cm: 165 } },
    userId: 7,
  });

  lockOfflineVault(7);
  clearOfflineSession();
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 8, role: 'bhw' }));
  await createOfflineVault({ userId: 8, role: 'bhw', credential: 'AnotherBatteryPassword9!' });
  createOfflineSession({ userId: 8, role: 'bhw', deviceId: 'device-local' });
  await expect(getQueueItems()).resolves.toEqual([]);
  await expect(getQueueItems(7)).rejects.toThrow('active account');

  lockOfflineVault(8);
  clearOfflineSession();
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 7, role: 'bhw' }));
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  await unlockOfflineVault({ userId: 7, credential: 'CorrectHorseBattery9!' });

  await expect(getQueueItems()).resolves.toEqual([
    expect.objectContaining({
      offlineOperationId: accountAChange.offlineOperationId,
      userId: '7',
      status: 'PENDING',
      request: accountAChange.request,
    }),
  ]);
});

test('stores resident ID mappings and rewrites dependent resident references', async () => {
  const resident = await enqueueOperation({
    operation: 'CREATE',
    module: 'residents',
    table: 'residents',
    payload: { first_name: 'Offline', last_name: 'Resident' },
    localRecord: { first_name: 'Offline', last_name: 'Resident' },
    userId: 7,
  });
  const localResidentId = resident.localRecord.resident_id;
  const dependent = await enqueueOperation({
    operation: 'CREATE',
    module: 'health_records',
    table: 'patient_clinical_records',
    payload: { resident_id: localResidentId },
    request: {
      method: 'POST',
      url: `/resident-medical-records/${localResidentId}/clinical`,
      data: { resident_id: localResidentId },
    },
    userId: 7,
  });

  await putResidentIdMapping(localResidentId, 77, 7);
  await rewriteResidentReferences(localResidentId, 77, 7);

  await expect(getResidentIdMapping(localResidentId, 7)).resolves.toEqual(
    expect.objectContaining({ localResidentId, serverResidentId: 77 })
  );
  expect(dependent.payload.resident_id).toBe(localResidentId);
  const rewritten = (await getQueueItems()).find((item) => item.offlineOperationId === dependent.offlineOperationId);
  expect(rewritten.payload.resident_id).toBe(77);
  expect(rewritten.request.url).toContain('/77/');
  expect(await getDependentOperations(resident.offlineOperationId, 7)).toEqual([
    expect.objectContaining({ offlineOperationId: dependent.offlineOperationId }),
  ]);
});

test('marks stale Adult BMI processing state for idempotent outcome verification', async () => {
  const item = await enqueueOperation({
    operation: 'CREATE',
    module: 'adult_bmi',
    table: 'adult_bmi_records',
    payload: { resident_id: 15, weight_kg: 62, height_cm: 165 },
    userId: 7,
  });
  await updateOperationStatus(item.offlineOperationId, {
    status: 'SYNCING',
    syncStartedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  });

  const [recovered] = await getQueueItems();

  expect(recovered).toEqual(expect.objectContaining({
    offlineOperationId: item.offlineOperationId,
    payload: item.payload,
    status: 'CONFLICT',
    syncStartedAt: null,
    lastErrorCode: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
    lastError: expect.stringContaining('same operation key'),
  }));
});

test('cleans only confirmed old synced history and preserves unsynced records', async () => {
  const oldSynced = await enqueueOperation({
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: { resident_id: 15 },
    userId: 7,
  });
  await updateOperationStatus(oldSynced.offlineOperationId, {
    status: 'SYNCED',
    syncedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const pending = await enqueueOperation({
    operation: 'CREATE',
    module: 'adult_bmi',
    table: 'adult_bmi_records',
    payload: { resident_id: 15 },
    userId: 7,
  });

  await expect(cleanupSyncedOperations(7)).resolves.toBe(1);

  expect(await getQueueItems()).toEqual([
    expect.objectContaining({ offlineOperationId: pending.offlineOperationId, status: 'PENDING' }),
  ]);
});

test('marks interrupted non-BMI operations for idempotent outcome verification', async () => {
  const item = await enqueueOperation({
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: { resident_id: 15, diagnosis: 'Test' },
    userId: 7,
  });
  await updateOperationStatus(item.offlineOperationId, {
    status: 'SYNCING',
    syncStartedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  });

  const [recovered] = await getQueueItems();

  expect(recovered).toEqual(expect.objectContaining({
    offlineOperationId: item.offlineOperationId,
    payload: item.payload,
    status: 'CONFLICT',
    syncStartedAt: null,
    lastErrorCode: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
  }));
});

test('migrates only owned legacy queue items and preserves entries without an owner', async () => {
  const owned = {
    offlineOperationId: 'owned-change',
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: { diagnosis: 'Existing pending change' },
    createdAt: '2026-11-16T00:00:00.000Z',
    userId: 7,
    status: 'PENDING',
    retryCount: 0,
  };
  const foreign = { ...owned, offlineOperationId: 'foreign-change', userId: 8 };
  const unowned = { ...owned, offlineOperationId: 'unowned-change', userId: null };
  for (const item of [owned, foreign, unowned]) {
    getStore('offlineQueue').set(encodeKey(item.offlineOperationId), item);
  }

  await expect(migrateLegacyQueue(7)).resolves.toEqual({ migrated: 1, skipped: 0, unowned: 1 });
  expect(getStore('offlineQueue').has(encodeKey('owned-change'))).toBe(false);
  expect(getStore('offlineQueue').has(encodeKey('foreign-change'))).toBe(true);
  expect(getStore('offlineQueue').has(encodeKey('unowned-change'))).toBe(true);
  await expect(getQueueItems()).resolves.toEqual([expect.objectContaining({ offlineOperationId: 'owned-change' })]);
});

test('preserves a legacy item if its encrypted copy cannot be written', async () => {
  const cyclicPayload = {};
  cyclicPayload.self = cyclicPayload;
  const legacy = {
    offlineOperationId: 'cycle-change',
    operation: 'CREATE',
    module: 'health_records',
    table: 'health_records',
    payload: cyclicPayload,
    createdAt: '2026-11-16T00:00:00.000Z',
    userId: 7,
    status: 'PENDING',
    retryCount: 0,
  };
  getStore('offlineQueue').set(encodeKey(legacy.offlineOperationId), legacy);

  await expect(migrateLegacyQueue(7)).rejects.toThrow('circular references');
  expect(getStore('offlineQueue').has(encodeKey(legacy.offlineOperationId))).toBe(true);
});
