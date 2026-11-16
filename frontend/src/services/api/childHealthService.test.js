import { getOfflineSnapshotRecords } from '../offline/offlineDataDownloadService';
import { getChildHealthRecord, listChildHealthRecords } from './childHealthService';

jest.mock('./apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../offline/offlineDataDownloadService', () => ({
  getOfflineSnapshotRecords: jest.fn(),
}));

jest.mock('../offline/offlineQueueService', () => ({
  getQueueItems: () => [],
}));

beforeEach(() => {
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });
  getOfflineSnapshotRecords.mockReset();
  getOfflineSnapshotRecords.mockResolvedValue([
    { id: 1, resident_id: 7, record_date: '2026-02-01', assessment: 'Checkup' },
    { id: 2, resident_id: 8, record_date: '2026-02-02', assessment: 'Vaccination' },
    { id: 3, resident_id: 7, record_date: '2026-02-03', assessment: 'Follow-up' },
  ]);
});

test('offline child health list filters by resident and paginates locally', async () => {
  const result = await listChildHealthRecords({ resident_id: 7, page: 1, limit: 1 });

  expect(result).toEqual({
    success: true,
    data: {
      items: [{ id: 3, resident_id: 7, record_date: '2026-02-03', assessment: 'Follow-up' }],
      total: 2,
      page: 1,
      limit: 1,
    },
    offline: true,
  });
});

test('offline child health detail resolves only downloaded records', async () => {
  await expect(getChildHealthRecord(2)).resolves.toEqual({
    success: true,
    data: { id: 2, resident_id: 8, record_date: '2026-02-02', assessment: 'Vaccination' },
    offline: true,
  });
  await expect(getChildHealthRecord(9)).rejects.toThrow('has not been downloaded');
});
