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
import { getNutritionRecord, listNutritionRecords } from './nutritionRecordsService';

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
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });
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
  await createOfflineVault({ userId: 7, role: 'bhw', credential: 'CorrectHorseBattery9!' });
  createOfflineSession({ userId: 7, role: 'bhw', deviceId: 'device-local' });
  const records = [
    { id: 1, resident_id: 21, record_type: 'Adult BMI', record_date: '2026-03-10', status: 'Normal', first_name: 'Ada', last_name: 'Resident' },
    { id: 2, resident_id: 21, record_type: 'Operation Timbang', record_date: '2026-03-11', status: 'Underweight', first_name: 'Ada', last_name: 'Resident' },
  ];
  await Promise.all(records.map((record) => putOfflineRecord(
    7,
    'nutritionSnapshot:test',
    `${record.record_type}:${record.id}`,
    record
  )));
  await putOfflineRecord(7, 'offlineMetadata', 'activeOfflineDataSnapshot', {
    status: 'complete',
    collections: { residents: 'residentSnapshot:test', nutrition: 'nutritionSnapshot:test' },
    recordCounts: { residents: 1, nutrition: records.length },
    downloadedAt: '2026-03-11T00:00:00.000Z',
  });
});

afterEach(() => {
  lockOfflineVault();
});

test('lists and filters encrypted nutrition records while offline', async () => {
  const response = await listNutritionRecords({ type: 'Adult BMI', pageSize: 10 });

  expect(response.data.items).toHaveLength(1);
  expect(response.data.items[0].id).toBe(1);
  expect(response.data.offline).toBe(true);
  expect(response.data.counts.total).toBe(2);
  expect(api.get).not.toHaveBeenCalled();
});

test('returns the cached nutrition record and its local history offline', async () => {
  const response = await getNutritionRecord('adult', 1);

  expect(response.data.record_type).toBe('Adult BMI');
  expect(response.data.history).toHaveLength(2);
  expect(response.data.nextId).toEqual({ type: 'Operation Timbang', id: 2 });
  expect(response.data.offline).toBe(true);
});

test('does not expose offline nutrition data after account switching', async () => {
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 8, role: 'bhw' }));

  await expect(listNutritionRecords()).rejects.toThrow('Unlock authorized BHW offline access');
});
