import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ResidentsPage from './ResidentsPage';
import { getResidentStats, getResidentSummary, getResidents } from '../../services/api/residentService';

jest.mock('../../services/api/residentService', () => ({
  getResidents: jest.fn(),
  getResidentStats: jest.fn(),
  getResidentSummary: jest.fn()
}));

jest.mock('./ResidentForm', () => () => <div>Resident form</div>);

const response = {
  success: true,
  data: {
    items: [{
      resident_id: 7,
      first_name: 'Ana',
      middle_name: 'Maria',
      last_name: 'Santos',
      birthdate: '1981-01-05',
      age: 45,
      sex: 'female',
      household_no: 'HH-7',
      contact_no: '09123456789',
      philhealth_id_no: 'PH-7',
      resident_status: 'Active',
      category_flags: ['PWD'],
      is_4ps: 1
    }],
    total: 26,
    page: 1,
    limit: 10,
    pagination: { page: 1, limit: 10, total: 26, totalPages: 3 }
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, '', '/residents');
  getResidents.mockResolvedValue(response);
  getResidentStats.mockResolvedValue({
    success: true,
    data: {
      total: 26,
      children: 4,
      adults: 18,
      seniors: 4,
      recordCompleteness: 96.2,
      trends: { total: null, children: null, adults: null, seniors: null },
      barangayName: null,
      filterOptions: {
        sitios: ['Melgar'],
        genders: ['female', 'male'],
        nutritionStatuses: ['Normal', 'Not assessed']
      }
    }
  });
  getResidentSummary.mockResolvedValue({
    success: true,
    data: {
      resident: {
        resident_id: 7,
        first_name: 'Ana',
        middle_name: 'Maria',
        last_name: 'Santos',
        birthdate: '1981-01-05',
        sex: 'female',
        household_no: 'HH-7',
        sitio: 'Melgar'
      },
      healthSnapshot: { weightKg: 61, heightCm: 163, bmi: 23, nutritionStatus: 'Normal' },
      visitHistory: [{
        id: 'adult_bmi-1',
        recordType: 'adult_bmi',
        date: '2024-06-01',
        bmi: 23,
        nutritionStatus: 'Normal'
      }]
    }
  });
});

test('directory search, filter dropdowns, sorting, and pagination work', async () => {
  render(<BrowserRouter><ResidentsPage /></BrowserRouter>);
  expect(await screen.findByRole('heading', { name: 'Resident Records' })).toBeInTheDocument();
  expect(screen.getByText('Total Residents')).toBeInTheDocument();
  expect(screen.getByText('Children (0-12 yrs)')).toBeInTheDocument();
  expect(screen.getByText('Adults (13-59 yrs)')).toBeInTheDocument();
  expect(screen.getByText('Senior Citizens (60+)')).toBeInTheDocument();
  expect(screen.getByText('Record Completeness')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(getResidentSummary).not.toHaveBeenCalled();
  expect(await screen.findByText('Showing 1-10 of 26 residents')).toBeInTheDocument();

  fireEvent.keyDown(window, { key: '/' });
  expect(screen.getByLabelText('Search by name, household no., contact no., or PhilHealth ID')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Search by name, household no., contact no., or PhilHealth ID'), { target: { value: 'PH-7' } });
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('search')).toBe('PH-7'));

  fireEvent.click(screen.getByRole('button', { name: 'All Sitios' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Melgar' }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('sitio')).toBe('Melgar'));

  fireEvent.click(screen.getByRole('button', { name: 'All Sexes' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Female' }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('sex')).toBe('female'));

  fireEvent.click(screen.getByRole('button', { name: 'All Nutritional Status' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Normal' }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('nutritionStatus')).toBe('Normal'));
  await waitFor(() => expect(getResidents).toHaveBeenLastCalledWith(expect.objectContaining({
    sitio: 'Melgar',
    sex: 'female',
    nutritionStatus: 'Normal'
  })));

  fireEvent.click(screen.getByRole('button', { name: /Age/ }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('sort')).toBe('age-asc'));

  fireEvent.click(screen.getByRole('button', { name: '2' }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('page')).toBe('2'));
});

test('opens the selected resident profile in a modal and supports keyboard tab navigation', async () => {
  render(<BrowserRouter><ResidentsPage /></BrowserRouter>);
  fireEvent.click(await screen.findByRole('row', { name: /Santos/ }));
  expect(await screen.findByRole('dialog', { name: 'Resident Profile' })).toBeInTheDocument();
  expect(screen.getByAltText('HealthSync logo')).toHaveAttribute('src', '/images/healthsynclogo.png');
  await waitFor(() => expect(getResidentSummary).toHaveBeenCalledWith(7));
  expect(screen.getByText('ID 7')).toBeInTheDocument();
  expect(screen.getByText('Melgar')).toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole('tab', { name: 'Health Overview' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Nutrition History' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText('BMI 23.0')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('shows an explicit fallback when the selected resident has no sitio assigned', async () => {
  getResidentSummary.mockResolvedValueOnce({
    success: true,
    data: {
      resident: { resident_id: 7, first_name: 'Ana', last_name: 'Santos' },
      healthSnapshot: null,
      visitHistory: []
    }
  });

  render(<BrowserRouter><ResidentsPage /></BrowserRouter>);
  fireEvent.click(await screen.findByRole('row', { name: /Santos/ }));
  expect(await screen.findByText('Not assigned')).toBeInTheDocument();
});

test('closes the profile modal on Escape and restores focus to the selected resident row', async () => {
  render(<BrowserRouter><ResidentsPage /></BrowserRouter>);
  const residentRow = await screen.findByRole('row', { name: /Santos/ });
  residentRow.focus();
  fireEvent.click(residentRow);

  expect(await screen.findByRole('dialog', { name: 'Resident Profile' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(residentRow).toHaveFocus();
});

test('refreshes the resident list when offline changes finish synchronizing', async () => {
  render(<BrowserRouter><ResidentsPage /></BrowserRouter>);
  await waitFor(() => expect(getResidents).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(getResidentStats).toHaveBeenCalledTimes(1));

  await act(async () => {
    window.dispatchEvent(new CustomEvent('healthsync:sync-complete'));
    await Promise.resolve();
  });

  await waitFor(() => expect(getResidents).toHaveBeenCalledTimes(2));
});
