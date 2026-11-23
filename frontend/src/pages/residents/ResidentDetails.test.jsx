import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ResidentDetails from './ResidentDetails';
import { listAllHealthRecords } from '../../services/api/healthRecordService';
import { listNutritionRecords } from '../../services/api/nutritionRecordsService';
import { deleteResident, getResidentSummary } from '../../services/api/residentService';

jest.mock('../../services/api/healthRecordService', () => ({
  listAllHealthRecords: jest.fn(),
}));

jest.mock('../../services/api/nutritionRecordsService', () => ({
  listNutritionRecords: jest.fn(),
}));

jest.mock('../../services/api/residentService', () => ({
  deleteResident: jest.fn(),
  getResident: jest.fn(),
  getResidentSummary: jest.fn()
}));

const residentSummary = {
  resident: {
    resident_id: 15,
    first_name: 'Marco',
    middle_name: 'Luis',
    last_name: 'Reyes',
    birthdate: '1990-04-15',
    sex: 'male',
    civil_status: 'Single',
    occupation: 'Fisherman',
    resident_status: 'Active',
    household_no: 'HH-005',
    contact_no: '09171234567',
    philhealth_id_no: 'PH-123456',
    created_by_name: 'Juan Dela Cruz',
    created_at: '2026-10-03T08:00:00.000Z',
    category_flags: []
  },
  records: {
    clinical: { exists: true, lastUpdated: '2026-10-12T08:00:00.000Z', count: 1 },
    child: { exists: false, lastUpdated: null, count: 0 },
    maternal: { exists: false, lastUpdated: null, count: 0 },
    immunization: { exists: false, lastUpdated: null, count: 0 }
  },
  healthSnapshot: {
    weightKg: 73,
    heightCm: 176,
    bmi: 23.6,
    nutritionStatus: 'Normal',
    lastVisitDate: '2026-10-12',
    nextCheckupDue: null,
    nextImmunizationDue: null,
    alerts: []
  },
  visitHistory: [],
  recentActivity: [],
  lastUpdated: '2026-10-12T08:00:00.000Z'
};

const LocationDisplay = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

const renderPage = (initialEntry = '/residents/15') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <LocationDisplay />
    <Routes>
      <Route path="/residents/:id" element={<ResidentDetails />} />
      <Route path="/residents" element={<div>Resident list</div>} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  jest.clearAllMocks();
  getResidentSummary.mockResolvedValue({ success: true, data: residentSummary });
  listAllHealthRecords.mockResolvedValue({ success: true, data: { items: [], total: 0, page: 1, pageSize: 50, pagination: { totalPages: 0 } } });
  listNutritionRecords.mockResolvedValue({ success: true, data: { items: [], total: 0, page: 1, pageSize: 50 } });
});

test('shows resident profile and health snapshot from the summary response', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Reyes, Marco Luis' })).toBeInTheDocument();
  expect(screen.getByText('Reyes, Marco L.')).toBeInTheDocument();
  expect(screen.getByText('73 kg')).toBeInTheDocument();
  expect(screen.getByText('Normal')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Residents' })).toHaveAttribute('href', '/residents');
});

test('shows all of the resident health records and links to the existing detail route', async () => {
  listAllHealthRecords
    .mockResolvedValueOnce({
      success: true,
      data: {
        items: [{
          source_table: 'patient_clinical_records',
          record_id: 71,
          record_type: 'clinical',
          record_label: 'Clinical Record',
          record_date: '2026-10-12',
          summary: 'Follow-up consultation',
          recorded_by_name: 'Juan Dela Cruz',
        }],
        total: 2,
        page: 1,
        pageSize: 50,
        pagination: { totalPages: 2 },
      },
    })
    .mockResolvedValueOnce({
      success: true,
      data: {
        items: [{
          source_table: 'maternal_records',
          record_id: 72,
          record_type: 'maternal',
          record_label: 'Maternal Record',
          record_date: '2026-09-10',
          summary: '',
          recorded_by_name: null,
        }],
        total: 2,
        page: 2,
        pageSize: 50,
        pagination: { totalPages: 2 },
      },
    });
  renderPage();

  fireEvent.click(await screen.findByRole('tab', { name: 'Health Records' }));
  expect(screen.getByTestId('location')).toHaveTextContent('?tab=records');
  expect(await screen.findByText('Follow-up consultation')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View Clinical Record' })).toHaveAttribute(
    'href',
    '/health-records/clinical/patient_clinical_records-71'
  );
  expect(await screen.findByText('Maternal Record')).toBeInTheDocument();
  expect(screen.getAllByText('Not provided').length).toBeGreaterThan(0);
  expect(listAllHealthRecords).toHaveBeenNthCalledWith(1, {
    resident_id: '15',
    page: 1,
    pageSize: 50,
    sort: 'date',
    order: 'desc',
  });
  expect(listAllHealthRecords).toHaveBeenNthCalledWith(2, {
    resident_id: '15',
    page: 2,
    pageSize: 50,
    sort: 'date',
    order: 'desc',
  });
  expect(screen.queryByRole('checkbox', { name: 'Show all record types' })).not.toBeInTheDocument();
});

test('paginates resident health-record history locally', async () => {
  const records = Array.from({ length: 11 }, (_, index) => ({
    source_table: 'patient_clinical_records',
    record_id: index + 1,
    record_type: 'clinical',
    record_label: `Clinical Record ${index + 1}`,
    record_date: '2026-10-12',
    summary: `Record summary ${index + 1}`,
    recorded_by_name: 'Juan Dela Cruz',
  }));
  listAllHealthRecords.mockResolvedValue({
    success: true,
    data: { items: records, total: records.length, page: 1, pageSize: 50, pagination: { totalPages: 1 } },
  });
  renderPage();

  fireEvent.click(await screen.findByRole('tab', { name: 'Health Records' }));

  expect(await screen.findByText('Record summary 1')).toBeInTheDocument();
  expect(screen.queryByText('Record summary 11')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByText('Record summary 11')).toBeInTheDocument();
  expect(screen.getByText('Showing 11-11 of 11 records')).toBeInTheDocument();
});

test('shows the resident nutrition assessments in the renamed history tab', async () => {
  listNutritionRecords.mockResolvedValue({
    success: true,
    data: {
      items: [{
        id: 301,
        resident_id: 15,
        record_type: 'Adult BMI',
        record_date: '2026-10-01',
        weight_kg: 73,
        height_cm: 176,
        bmi: 23.6,
        status: 'Normal',
        indicators: [],
      }],
      total: 1,
      page: 1,
      pageSize: 50,
    },
  });
  renderPage();

  fireEvent.click(await screen.findByRole('tab', { name: 'Nutritional Assessment History' }));

  expect(await screen.findByText('Adult BMI')).toBeInTheDocument();
  expect(screen.getByText(/Weight 73 kg/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View Adult BMI assessment' })).toHaveAttribute(
    'href',
    '/nutrition?record=adult-301'
  );
  expect(listNutritionRecords).toHaveBeenCalledWith({
    resident_id: '15',
    page: 1,
    pageSize: 50,
    sort: 'date',
    order: 'desc',
  });
});

test('shows a retry action when resident health records fail to load', async () => {
  listAllHealthRecords.mockRejectedValueOnce(new Error('Health record request failed.'));
  renderPage();

  fireEvent.click(await screen.findByRole('tab', { name: 'Health Records' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Health record request failed.');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('requires explicit confirmation before deleting and then returns to residents', async () => {
  deleteResident.mockResolvedValue({ success: true });
  renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'More resident actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete resident' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Reyes, Marco Luis');
  fireEvent.click(screen.getByRole('button', { name: 'Delete resident' }));

  await waitFor(() => expect(deleteResident).toHaveBeenCalledWith('15'));
  expect(await screen.findByText('Resident list')).toBeInTheDocument();
});

test('shows a retry and residents link when the summary endpoint returns 404', async () => {
  getResidentSummary.mockRejectedValue({ response: { status: 404, data: { message: 'Resident not found.' } } });
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Resident not found' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to Residents' })).toHaveAttribute('href', '/residents');
});
