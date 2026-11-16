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
import {
  getResidentMedicalRecord,
  listResidentMedicalRecords,
} from './residentMedicalRecordService';

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
  await putOfflineRecord(7, 'medicalRecordsSnapshot:test', '12:clinical:4', {
    id: 4,
    resident_id: 12,
    record_type: 'clinical',
    record_data: { chief_complaint: 'Private record' },
  });
  await putOfflineRecord(7, 'offlineMetadata', 'activeOfflineDataSnapshot', {
    status: 'complete',
    collections: { medicalRecords: 'medicalRecordsSnapshot:test' },
  });
});

afterEach(() => {
  lockOfflineVault();
});

test('lists and opens downloaded resident medical records offline', async () => {
  const list = await listResidentMedicalRecords(12, 'clinical');
  const detail = await getResidentMedicalRecord(12, 'clinical', 4);

  expect(list.data).toHaveLength(1);
  expect(list.offline).toBe(true);
  expect(detail.data.record_data.chief_complaint).toBe('Private record');
  expect(detail.offline).toBe(true);
  expect(api.get).not.toHaveBeenCalled();
});

test('does not expose downloaded medical records after account switching', async () => {
  localStorage.setItem('hs_user', JSON.stringify({ user_id: 8, role: 'bhw' }));

  await expect(listResidentMedicalRecords(12, 'clinical')).rejects.toThrow('Unlock authorized BHW offline access');
});
