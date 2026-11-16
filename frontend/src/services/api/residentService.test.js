import { TextDecoder, TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import api from './apiClient';
import idb from '../offline/indexedDbService';
import {
  createOfflineVault,
  lockOfflineVault,
  putOfflineRecord,
} from '../offline/offlineVaultService';
import { createOfflineSession } from '../offline/offlineSessionService';
import { enqueueOperation } from '../offline/offlineQueueService';
import { getResidents } from './residentService';

jest.mock('./apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

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
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: true });
  idb.addToStore = jest.fn(async (name, value) => {
    const key = encodeKey(primaryKey(name, value));
    if (getStore(name).has(key)) throw new Error('Key already exists.');
    getStore(name).set(key, value);
  });
  idb.putToStore = jest.fn(async (name, value) => {
    getStore(name).set(encodeKey(primaryKey(name, value)), value);
  });
  idb.getFromStore = jest.fn(async (name, key) => getStore(name).get(encodeKey(key)));
  idb.getAllByIndex = jest.fn(async (name, index, range) => Array.from(getStore(name).values())
    .filter((record) => record.userId === range[0] && record.collection === range[1]));
  idb.deleteFromStore = jest.fn(async (name, key) => getStore(name).delete(encodeKey(key)));
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  api.get.mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [{
          resident_id: 19,
          first_name: 'Sensitive',
          last_name: 'Resident',
          birthdate: '2000-01-01',
          sex: 'female',
        }],
        total: 1,
        pagination: { totalPages: 1 },
      },
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
  lockOfflineVault();
});

test('caches online residents encrypted and serves them to the owning account offline', async () => {
  await getResidents({ page: 1, limit: 10 });
  const encryptedRows = Array.from(getStore('offlineData').values());
  expect(JSON.stringify(encryptedRows)).not.toContain('Sensitive');

  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });
  const response = await getResidents({ search: 'Sensitive' });

  expect(response.data.items).toHaveLength(1);
  expect(response.data.items[0].resident_id).toBe(19);
});

test('does not expose encrypted residents to a different local account', async () => {
  await getResidents();
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 8, role: 'bhw' }));

  await expect(getResidents()).rejects.toThrow('Unlock authorized BHW offline access');
});

test('makes offline-created residents searchable before synchronization', async () => {
  const queued = await enqueueOperation({
    operation: 'CREATE',
    module: 'residents',
    table: 'residents',
    payload: { first_name: 'Offline', last_name: 'Resident' },
    localRecord: {
      first_name: 'Offline',
      last_name: 'Resident',
      birthdate: '2010-01-01',
      sex: 'female',
      resident_status: 'Active',
    },
    userId: 7,
  });
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });

  const response = await getResidents({ search: 'Offline Resident' });

  expect(response.data.items).toEqual([
    expect.objectContaining({
      resident_id: `offline:${queued.offlineOperationId}`,
      first_name: 'Offline',
      last_name: 'Resident',
    }),
  ]);
});

test('uses the active complete resident snapshot for offline searches', async () => {
  await putOfflineRecord(7, 'residentSnapshot:active', 32, {
    resident_id: 32,
    first_name: 'Downloaded',
    last_name: 'Resident',
    birthdate: '2000-01-01',
  });
  await putOfflineRecord(7, 'offlineMetadata', 'activeOfflineDataSnapshot', {
    status: 'complete',
    collections: { residents: 'residentSnapshot:active', nutrition: 'nutritionSnapshot:active' },
    recordCounts: { residents: 1, nutrition: 0 },
    downloadedAt: '2026-01-01T00:00:00.000Z',
  });
  await putOfflineRecord(7, 'residents', 19, {
    resident_id: 19,
    first_name: 'Old',
    last_name: 'Page Cache',
    birthdate: '2000-01-01',
  });
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });

  const response = await getResidents();

  expect(response.data.items.map((resident) => resident.resident_id)).toEqual([32]);
});

test('filters offline resident suggestions by completed-month boundaries, not cached age', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-03-01T04:00:00.000Z'));
  const residents = [
    { resident_id: 61, first_name: 'Age', last_name: 'Boundary', birthdate: '2021-01-31', age: 99 },
    { resident_id: 60, first_name: 'Age', last_name: 'Below', birthdate: '2021-03-01', age: 99 },
    { resident_id: 228, first_name: 'Age', last_name: 'Boundary', birthdate: '2007-03-01', age: 1 },
    { resident_id: 229, first_name: 'Age', last_name: 'Above', birthdate: '2007-02-01', age: 1 },
    { resident_id: 240, first_name: 'Adult', last_name: 'Boundary', birthdate: '2006-03-01', age: 1 },
    { resident_id: 239, first_name: 'Adult', last_name: 'Below', birthdate: '2006-03-02', age: 99 },
  ];
  await Promise.all(residents.map((resident) => putOfflineRecord(7, 'residents', resident.resident_id, resident)));
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });

  const adolescents = await getResidents({ min_age_months: 61, max_age_months: 228 });
  const adults = await getResidents({ min_age_months: 240 });

  expect(adolescents.data.items.map((resident) => resident.resident_id).sort((a, b) => a - b)).toEqual([61, 228]);
  expect(adults.data.items.map((resident) => resident.resident_id)).toEqual([240]);
});
