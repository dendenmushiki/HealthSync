import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ResidentDetails from './ResidentDetails';
import { deleteResident, getResidentSummary } from '../../services/api/residentService';

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
});

test('shows resident profile and health snapshot from the summary response', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Reyes, Marco Luis' })).toBeInTheDocument();
  expect(screen.getByText('Reyes, Marco L.')).toBeInTheDocument();
  expect(screen.getByText('73 kg')).toBeInTheDocument();
  expect(screen.getByText('Normal')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Residents' })).toHaveAttribute('href', '/residents');
});

test('keeps the active tab in the query string and de-emphasizes inapplicable records', async () => {
  renderPage();

  fireEvent.click(await screen.findByRole('tab', { name: 'Health Records' }));
  expect(screen.getByTestId('location')).toHaveTextContent('?tab=records');
  expect(screen.getByRole('link', { name: 'Open Clinical Record' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Create Child Record' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Create Maternal Record' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Show all record types' }));
  expect(screen.getByRole('link', { name: 'Create Child Record' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create Maternal Record' })).toBeInTheDocument();
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
