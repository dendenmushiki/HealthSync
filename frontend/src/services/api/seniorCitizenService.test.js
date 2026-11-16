import { getOfflineSnapshotRecords } from '../offline/offlineDataDownloadService';
import { getResident, getResidents } from './residentService';
import { createSeniorCitizen, getSeniorCitizen, listSeniorCitizens, searchEligibleResidents } from './seniorCitizenService';
import offlineQueue from '../offline/offlineQueueService';
import api from './apiClient';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../offline/offlineDataDownloadService', () => ({
  getOfflineSnapshotRecords: jest.fn(),
}));

jest.mock('./residentService', () => ({
  getResidents: jest.fn(),
  getResident: jest.fn(),
}));

jest.mock('../offline/offlineQueueService', () => ({
  __esModule: true,
  default: { getQueueItems: jest.fn() },
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-03-01T04:00:00.000Z'));
  Object.defineProperty(global.navigator, 'onLine', { configurable: true, value: false });
  getOfflineSnapshotRecords.mockReset();
  getResidents.mockReset();
  getResident.mockReset();
  api.post.mockReset();
  getOfflineSnapshotRecords.mockResolvedValue([]);
  offlineQueue.getQueueItems.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

test('offline senior search uses exact age, excludes registered residents, and searches downloaded records', async () => {
  getResidents.mockResolvedValue({
    data: {
      items: [
        { resident_id: 1, first_name: 'Maria', last_name: 'Santos', birthdate: '1966-03-01' },
        { resident_id: 2, first_name: 'Maria', last_name: 'Cruz', birthdate: '1966-03-02' },
        { resident_id: 3, first_name: 'Maria', last_name: 'Reyes', birthdate: '1950-01-01' },
        { resident_id: 4, first_name: 'Maria', last_name: 'Lopez', birthdate: 'not-a-date' },
      ],
    },
  });
  getOfflineSnapshotRecords.mockImplementation(async () => {
    return [{ resident_id: 3 }];
  });

  const result = await searchEligibleResidents('Maria');

  expect(result).toEqual({
    success: true,
    data: [{ resident_id: 1, first_name: 'Maria', last_name: 'Santos', birthdate: '1966-03-01' }],
    offline: true,
  });
  expect(getOfflineSnapshotRecords).toHaveBeenCalledWith('seniorCitizens');
});

test('offline senior search does not load records for searches shorter than two characters', async () => {
  const result = await searchEligibleResidents('M');

  expect(result).toEqual({ success: true, data: [], offline: true });
  expect(getOfflineSnapshotRecords).not.toHaveBeenCalled();
});

test('offline senior registry filters and paginates downloaded registrations', async () => {
  getOfflineSnapshotRecords.mockResolvedValue([
    { senior_id: 1, resident_id: 1, senior_citizen_id: 'SC-000001', first_name: 'Ana', last_name: 'Santos', date_registered: '2026-01-10' },
    { senior_id: 2, resident_id: 2, senior_citizen_id: 'SC-000002', first_name: 'Ben', last_name: 'Cruz', date_registered: '2026-01-12' },
  ]);

  const result = await listSeniorCitizens({ search: 'Santos', page: 1, pageSize: 10 });

  expect(result.offline).toBe(true);
  expect(result.data.total).toBe(1);
  expect(result.data.items).toEqual([
    expect.objectContaining({ senior_id: 1, senior_citizen_id: 'SC-000001' }),
  ]);
});

test('offline senior details resolve the downloaded registration', async () => {
  getOfflineSnapshotRecords.mockResolvedValue([
    { senior_id: 5, resident_id: 8, senior_citizen_id: 'SC-000005' },
  ]);

  await expect(getSeniorCitizen(5)).resolves.toEqual({
    success: true,
    data: { senior_id: 5, resident_id: 8, senior_citizen_id: 'SC-000005' },
    offline: true,
  });
});

test('offline senior registration validates eligibility, prevents duplicates, and defers ID allocation to the server', async () => {
  getResident.mockResolvedValue({
    data: { resident_id: 8, first_name: 'Ana', last_name: 'Santos', birthdate: '1960-05-01', sex: 'Female' },
  });
  api.post.mockResolvedValue({ data: { success: true, queued: true } });
  const payload = {
    resident_id: 8,
    senior_citizen_id: 'SC-000099',
    date_registered: '2026-03-01',
    contact_number: '09123456789',
  };

  await createSeniorCitizen(payload);

  expect(api.post).toHaveBeenCalledWith(
    '/senior-citizens',
    expect.objectContaining({ senior_citizen_id: '' }),
    expect.objectContaining({
      offlineLocalRecord: expect.objectContaining({ senior_citizen_id: 'SC-000099', resident_id: 8 }),
    }),
  );
  offlineQueue.getQueueItems.mockResolvedValue([{
    table: 'senior_citizen_records',
    operation: 'CREATE',
    localRecord: { resident_id: 8 },
  }]);

  await expect(createSeniorCitizen(payload)).rejects.toThrow('already registered');
  expect(api.post).toHaveBeenCalledTimes(1);
});
