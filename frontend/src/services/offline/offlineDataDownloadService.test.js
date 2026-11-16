import { TextDecoder, TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import api from '../api/apiClient';
import idb from './indexedDbService';
import {
  createOfflineVault,
  getOfflineRecord,
  getOfflineRecords,
  lockOfflineVault,
  putOfflineRecord,
} from './offlineVaultService';
import { createOfflineSession } from './offlineSessionService';
import { downloadOfflineData, getOfflineSnapshotReadiness } from './offlineDataDownloadService';

jest.mock('../api/apiClient', () => ({
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
const paginatedResponse = (page, total, totalPages, items) => ({
  data: {
    success: true,
    data: { page, total, items, pagination: { page, total, totalPages } },
  },
});

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
  localStorage.setItem('hs_token', 'server-token');
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
  createOfflineSession({ userId: 7, role: 'bhw' });
  api.get.mockReset();
});

afterEach(() => {
  lockOfflineVault();
});

test('downloads every resident page into an encrypted snapshot and deduplicates IDs', async () => {
  api.get.mockImplementation(async (path, { params }) => {
    if (path === '/residents') {
      return params.page === 1
        ? paginatedResponse(1, 3, 2, [{ resident_id: 1 }, { resident_id: 2 }])
        : paginatedResponse(2, 3, 2, [{ resident_id: 2 }, { resident_id: 3 }]);
    }
    const emptyResult = { items: [], total: 0, page: params.page, limit: params.limit, pageSize: params.pageSize };
    if (path === '/operation-timbang') {
      const items = params.page === 1
        ? Array.from({ length: 100 }, (_, index) => ({
          timbang_id: index + 1,
          resident_id: index + 1,
        }))
        : [{ timbang_id: 100, resident_id: 100 }, { timbang_id: 101, resident_id: 101 }];
      return {
        data: {
          success: true,
          data: { items, total: 101, page: params.page, limit: 100 },
        },
      };
    }
    if (path === '/resident-medical-records') {
      return {
        data: {
          success: true,
          data: {
            items: [
              { id: 11, resident_id: 1, record_type: 'clinical', record_data: { notes: 'Private clinical note' } },
              { id: 12, resident_id: 2, record_type: 'maternal', record_data: { visit: 'Private visit' } },
            ],
            total: 2,
            page: 1,
            limit: 100,
            pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
          },
        },
      };
    }
    if (path === '/health-records') {
      const items = params.page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ health_record_id: index + 1 }))
        : [{ health_record_id: 100 }, { health_record_id: 101 }];
      return {
        data: {
          success: true,
          data: { items, total: 101, page: params.page, limit: 100 },
        },
      };
    }
    return { data: { success: true, data: emptyResult } };
  });

  const result = await downloadOfflineData();
  const active = await getOfflineRecord(7, 'offlineMetadata', 'activeOfflineDataSnapshot');
  const residents = await getOfflineRecords(7, active.collections.residents);
  const nutritionRecords = await getOfflineRecords(7, active.collections.nutrition);
  const medicalRecords = await getOfflineRecords(7, active.collections.medicalRecords);

  expect(api.get).toHaveBeenCalledTimes(11);
  expect(api.get).toHaveBeenNthCalledWith(1, '/residents', {
    params: { page: 1, limit: 100, sort: 'oldest', order: 'asc' },
  });
  expect(api.get).toHaveBeenNthCalledWith(3, '/operation-timbang', {
    params: { page: 1, limit: 100 },
  });
  expect(result).toEqual(expect.objectContaining({ status: 'complete', recordCount: 3 }));
  expect(result.nutritionRecordCount).toBe(101);
  expect(result.medicalRecordCount).toBe(2);
  expect(result.legacyClinicalRecordCount).toBe(101);
  expect(result.legacyChildRecordCount).toBe(0);
  expect(result.seniorCitizenRecordCount).toBe(0);
  expect(active.recordCounts).toEqual({
    residents: 3,
    nutrition: 101,
    medicalRecords: 2,
    legacyClinical: 101,
    legacyChild: 0,
    seniorCitizens: 0,
  });
  expect(residents.map((resident) => resident.resident_id).sort()).toEqual([1, 2, 3]);
  expect(nutritionRecords).toHaveLength(101);
  expect(nutritionRecords.map((record) => record.id).sort((a, b) => a - b)).toEqual(Array.from({ length: 101 }, (_, index) => index + 1));
  expect(medicalRecords).toHaveLength(2);
  expect(await getOfflineRecords(7, active.collections.legacyClinical)).toHaveLength(101);
  expect(JSON.stringify(Array.from(getStore('offlineData').values()))).not.toContain('Private clinical note');
  expect(JSON.stringify(Array.from(getStore('offlineData').values()))).not.toContain('"resident_id":1');
});

test('preserves the previous snapshot and removes staging records when a page fails', async () => {
  await putOfflineRecord(7, 'residentSnapshot:previous', 9, { resident_id: 9 });
  await putOfflineRecord(7, 'offlineMetadata', 'activeResidentsSnapshot', {
    collection: 'residentSnapshot:previous',
    dataset: 'residents',
    status: 'complete',
    recordCount: 1,
    downloadedAt: '2026-01-01T00:00:00.000Z',
  });
  api.get.mockImplementation(async (path, { params }) => {
    if (params.page === 1) return paginatedResponse(1, 2, 2, [{ resident_id: 10 }]);
    throw new Error('network failure');
  });

  await expect(downloadOfflineData()).rejects.toThrow('previous offline data is unchanged');

  const active = await getOfflineRecord(7, 'offlineMetadata', 'activeResidentsSnapshot');
  const previous = await getOfflineRecords(7, active.collection);
  const stagedCollections = Array.from(getStore('offlineData').values())
    .filter((record) => record.collection.startsWith('residentSnapshot:') && record.collection !== active.collection);

  expect(active.collection).toBe('residentSnapshot:previous');
  expect(previous).toEqual([{ resident_id: 9 }]);
  expect(stagedCollections).toHaveLength(0);
});

test('preserves the previous nutrition snapshot when a nutrition page fails', async () => {
  await putOfflineRecord(7, 'residentSnapshot:previous', 9, { resident_id: 9 });
  await putOfflineRecord(7, 'offlineMetadata', 'activeResidentsSnapshot', {
    collection: 'residentSnapshot:previous',
    dataset: 'residents',
    status: 'complete',
    recordCount: 1,
    downloadedAt: '2026-01-01T00:00:00.000Z',
  });
  await putOfflineRecord(7, 'nutritionSnapshot:previous', 'Adult BMI:99', {
    id: 99,
    record_type: 'Adult BMI',
    resident_id: 9,
  });
  await putOfflineRecord(7, 'offlineMetadata', 'activeNutritionSnapshot', {
    collection: 'nutritionSnapshot:previous',
    dataset: 'nutrition',
    status: 'complete',
    recordCount: 1,
    downloadedAt: '2026-01-01T00:00:00.000Z',
  });
  api.get.mockImplementation(async (path, { params }) => {
    if (path === '/residents') return paginatedResponse(1, 1, 1, [{ resident_id: 5 }]);
    if (params.page === 1) {
      return {
        data: {
          success: true,
          data: {
            items: Array.from({ length: 100 }, (_, index) => ({
              timbang_id: index + 1,
              resident_id: index + 1,
            })),
            total: 101,
            page: 1,
            limit: 100,
          },
        },
      };
    }
    throw new Error('network failure');
  });

  await expect(downloadOfflineData()).rejects.toThrow('previous nutrition snapshot is unchanged');

  const active = await getOfflineRecord(7, 'offlineMetadata', 'activeNutritionSnapshot');
  const previous = await getOfflineRecords(7, active.collection);
  const activeResidents = await getOfflineRecord(7, 'offlineMetadata', 'activeResidentsSnapshot');
  const previousResidents = await getOfflineRecords(7, activeResidents.collection);
  const activeCombinedSnapshot = await getOfflineRecord(7, 'offlineMetadata', 'activeOfflineDataSnapshot');
  const stagedCollections = Array.from(getStore('offlineData').values())
    .filter((record) => (
      (record.collection.startsWith('nutritionSnapshot:') && record.collection !== active.collection) ||
      (record.collection.startsWith('residentSnapshot:') && record.collection !== activeResidents.collection)
    ));

  expect(active.collection).toBe('nutritionSnapshot:previous');
  expect(previous).toEqual([{ id: 99, record_type: 'Adult BMI', resident_id: 9 }]);
  expect(activeResidents.collection).toBe('residentSnapshot:previous');
  expect(previousResidents).toEqual([{ resident_id: 9 }]);
  expect(activeCombinedSnapshot).toBeUndefined();
  expect(stagedCollections).toHaveLength(0);
});

test('refuses to download residents for a role without resident-route authorization', async () => {
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 7, role: 'official' }));

  await expect(downloadOfflineData()).rejects.toThrow('authorized BHW offline access');
  expect(api.get).not.toHaveBeenCalled();
});

test('reports offline snapshot readiness using all required datasets and freshness', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const completeSnapshot = {
    status: 'complete',
    downloadedAt: '2026-11-17T00:00:00.000Z',
    recordCount: 0,
    nutritionRecordCount: 0,
    medicalRecordCount: 0,
    legacyClinicalRecordCount: 0,
    legacyChildRecordCount: 0,
    seniorCitizenRecordCount: 0,
  };

  expect(getOfflineSnapshotReadiness(null, now)).toBe('unavailable');
  expect(getOfflineSnapshotReadiness({ ...completeSnapshot, medicalRecordCount: null }, now)).toBe('incomplete');
  expect(getOfflineSnapshotReadiness({ ...completeSnapshot, downloadedAt: '2026-11-16T11:59:59.999Z' }, now)).toBe('outdated');
  expect(getOfflineSnapshotReadiness(completeSnapshot, now)).toBe('complete');
});
