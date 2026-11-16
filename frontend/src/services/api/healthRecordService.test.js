import { getOfflineSnapshotRecords } from '../offline/offlineDataDownloadService';
import { getHealthRecordDetails, listAllHealthRecords, listHealthRecords } from './healthRecordService';

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
  getOfflineSnapshotRecords.mockImplementation(async (dataset) => {
    const recordsByDataset = {
      residents: [
        { resident_id: 1, first_name: 'Ana', last_name: 'Santos', birthdate: '2000-04-02', sex: 'Female' },
      ],
      legacyClinical: [
        { health_record_id: 10, resident_id: 1, record_date: '2026-02-02', chief_complaint: 'Cough', assessment: 'Upper respiratory infection' },
      ],
      legacyChild: [
        { id: 20, resident_id: 1, record_date: '2026-02-01', assessment: 'Routine checkup' },
      ],
      medicalRecords: [
        { id: 30, resident_id: 1, record_type: 'maternal', record_data: { visit_date: '2026-02-03', assessment: 'Prenatal visit' }, created_at: '2026-02-03T08:00:00.000Z' },
      ],
    };
    return recordsByDataset[dataset];
  });
});

test('offline health overview merges downloaded record datasets and filters by type', async () => {
  const result = await listAllHealthRecords({ type: 'maternal', page: 1, pageSize: 10 });

  expect(result.success).toBe(true);
  expect(result.data.offline).toBe(true);
  expect(result.data.items).toHaveLength(1);
  expect(result.data.items[0]).toEqual(expect.objectContaining({
    resident_id: 1,
    first_name: 'Ana',
    record_id: 30,
    source_table: 'maternal_records',
    record_type: 'maternal',
    summary: 'Prenatal visit',
  }));
  expect(result.data.items[0]).not.toHaveProperty('_record');
  expect(result.data.typeCounts).toEqual({ clinical: 1, child: 1, maternal: 1, immunization: 0 });
});

test('offline health record detail returns downloaded record and resident context', async () => {
  const result = await getHealthRecordDetails('maternal_records', 30);

  expect(result.offline).toBe(true);
  expect(result.data.record).toEqual(expect.objectContaining({
    id: 30,
    resident_id: 1,
    record_type: 'maternal',
    record_data: { visit_date: '2026-02-03', assessment: 'Prenatal visit' },
  }));
  expect(result.data.resident).toEqual(expect.objectContaining({
    resident_id: 1,
    first_name: 'Ana',
    last_name: 'Santos',
  }));
  expect(result.data.nextRecord).toEqual({
    type: 'clinical',
    sourceTable: 'health_records',
    recordId: 10,
  });
});

test('offline legacy clinical record lists paginate locally', async () => {
  const result = await listHealthRecords({ resident_id: 1, page: 1, limit: 1 });

  expect(result.offline).toBe(true);
  expect(result.data.items).toEqual([
    expect.objectContaining({ health_record_id: 10, resident_id: 1 }),
  ]);
  expect(result.data.total).toBe(1);
});
