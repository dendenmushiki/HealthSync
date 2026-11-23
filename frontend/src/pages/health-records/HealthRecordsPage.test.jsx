import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { listAllHealthRecords } from '../../services/api/healthRecordService';
import { getResidents } from '../../services/api/residentService';
import HealthRecordsPage from './HealthRecordsPage';

jest.mock('../../services/api/healthRecordService', () => ({
  listAllHealthRecords: jest.fn(),
  deleteHealthRecord: jest.fn()
}));
jest.mock('../../services/api/childHealthService', () => ({ deleteChildHealthRecord: jest.fn() }));
jest.mock('../../services/api/residentMedicalRecordService', () => ({ deleteResidentMedicalRecord: jest.fn() }));
jest.mock('../../services/api/residentService', () => ({ getResidents: jest.fn() }));
jest.mock('../../components/common/ConfirmModal', () => () => null);
jest.mock('../../components/common/Pagination', () => () => null);

const CurrentPath = () => <output data-testid="current-path">{useLocation().pathname}</output>;
const CurrentSearch = () => <output data-testid="current-search">{useLocation().search}</output>;
const success = (items = [], total = items.length, extras = {}) => ({
  success: true,
  data: {
    items, total, page: 1, pageSize: 10,
    typeCounts: { clinical: 0, child: 0, maternal: 0, immunization: 0 },
    stats: { totalRecords: total, addedThisMonth: 0, residentsWithRecords: total, addedThisWeek: 0, availableTypes: ['clinical', 'child', 'maternal', 'immunization'] },
    ...extras,
  }
});

test('lists all record types and links to canonical details routes', async () => {
  listAllHealthRecords.mockResolvedValue({
    success: true,
    data: {
      items: [
    { source_table: 'patient_clinical_records', record_id: 3, resident_id: 8, first_name: 'Mia', last_name: 'Reyes', birthdate: '1980-10-08', sex: 'female', profile_photo: '/uploads/mia.png', record_label: 'Clinical Record', record_type: 'clinical', record_date: '2026-10-08', summary: 'Check-up', recorded_by_name: 'Clinic staff' },
    { source_table: 'child_records', record_id: 4, resident_id: 9, first_name: 'Noah', last_name: 'Cruz', record_label: 'Child Record', record_type: 'child', record_date: '2026-10-07', summary: 'Vaccination visit' },
    { source_table: 'maternal_records', record_id: 5, resident_id: 10, first_name: 'Ana', last_name: 'Rivera', record_label: 'Maternal Record', record_type: 'maternal', record_date: '2026-10-06', summary: 'Prenatal check' },
    { source_table: 'immunization_records', record_id: 6, resident_id: 11, first_name: 'Leo', last_name: 'Mori', record_label: 'Immunization Record', record_type: 'immunization', record_date: '2026-10-05', summary: 'BCG' }
      ],
      total: 4,
      page: 1,
      pageSize: 10,
      typeCounts: { clinical: 1, child: 1, maternal: 1, immunization: 1 }
    }
  });

  render(<MemoryRouter><HealthRecordsPage /></MemoryRouter>);

  expect((await screen.findAllByText('Check-up')).length).toBeGreaterThan(0);
  expect((await screen.findAllByText('Clinical')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Child').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Maternal').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Immunization').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('link', { name: /Reyes, Mia/ })[0]).toHaveAttribute('href', '/health-records/clinical/patient_clinical_records-3');
  expect(screen.getAllByRole('link', { name: /View Reyes, Mia/ })[0]).toHaveAttribute('href', '/health-records/clinical/patient_clinical_records-3');
  expect(screen.getAllByText('46 yrs · Gender: Female').length).toBeGreaterThan(0);
  expect(document.querySelector('img[src="http://localhost:5000/api/uploads/mia.png"]')).toBeInTheDocument();
});

test('search, type and date filters are sent to the server and reflected in the URL', async () => {
  listAllHealthRecords.mockResolvedValue(success([], 0, {
    typeCounts: { clinical: 2, child: 1, maternal: 4, immunization: 0 },
  }));
  render(<MemoryRouter initialEntries={['/health-records']}><HealthRecordsPage /><CurrentSearch /></MemoryRouter>);

  const search = screen.getByRole('searchbox', { name: 'Search health records' });
  await userEvent.type(search, 'Rivera');
  await waitFor(() => expect(listAllHealthRecords).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, search: 'Rivera', type: '', from: '', to: '', sort: 'date', order: 'desc' }));

  await userEvent.click(screen.getByRole('tab', { name: /Maternal/ }));
  await userEvent.click(screen.getByRole('button', { name: /Date range/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(listAllHealthRecords).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, search: 'Rivera', type: 'maternal', from: '2026-10-01', to: '2026-10-31', sort: 'date', order: 'desc' }));
  expect(screen.getByTestId('current-search')).toHaveTextContent('?search=Rivera&type=maternal&from=2026-10-01&to=2026-10-31');
});

test('rows are keyboard accessible and navigate to the correct record', async () => {
  listAllHealthRecords.mockResolvedValue(success([
    { source_table: 'maternal_records', record_id: 5, resident_id: 10, first_name: 'Ana', last_name: 'Rivera', record_type: 'maternal', record_label: 'Maternal Record', record_date: '2026-10-06', summary: 'Prenatal check' }
  ]));
  render(<MemoryRouter initialEntries={['/health-records?type=maternal&page=2']}><HealthRecordsPage /><CurrentPath /></MemoryRouter>);

  const row = await screen.findByRole('row', { name: /View Rivera, Ana's maternal record/i });
  row.focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByTestId('current-path')).toHaveTextContent('/health-records/maternal/maternal_records-5');
});

test('a search can be cleared without dropping unrelated filters', async () => {
  listAllHealthRecords.mockResolvedValue(success());
  render(<MemoryRouter initialEntries={['/health-records?type=child&from=2026-10-01']}><HealthRecordsPage /></MemoryRouter>);
  const search = screen.getByRole('searchbox', { name: 'Search health records' });
  await userEvent.type(search, 'Noah');
  await waitFor(() => expect(listAllHealthRecords).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, search: 'Noah', type: 'child', from: '2026-10-01', to: '', sort: 'date', order: 'desc' }));
});

test('resident picker keeps its record type and selects a real server result', async () => {
  const resident = {
    resident_id: 42,
    first_name: 'Alex',
    middle_name: 'Morgan',
    last_name: 'Nguyen',
    age: 23,
    sex: 'female',
    sitio: 'Riverside',
    household_no: 'HH-19',
  };
  listAllHealthRecords.mockResolvedValue(success());
  getResidents.mockResolvedValue({
    success: true,
    data: { items: [resident], total: 1, page: 1, pageSize: 10, pagination: { totalPages: 1 } },
  });
  render(<MemoryRouter initialEntries={['/health-records']}><HealthRecordsPage /><CurrentPath /></MemoryRouter>);

  await userEvent.click(screen.getAllByRole('button', { name: 'New record' })[0]);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Clinical Record' }));

  expect(await screen.findByRole('heading', { name: 'Choose a resident' })).toBeInTheDocument();
  expect(screen.getByText('NEW CLINICAL RECORD')).toBeInTheDocument();
  expect(await screen.findByRole('option', { name: 'Choose Nguyen, Alex M.' })).toBeInTheDocument();
  expect(screen.getByText('23 yrs · Female · Riverside')).toBeInTheDocument();
  expect(screen.getByText('ID 42')).toBeInTheDocument();
  expect(getResidents).toHaveBeenCalledWith(
    expect.objectContaining({ search: '', page: 1, pageSize: 10 }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );

  await userEvent.click(screen.getByRole('option', { name: 'Choose Nguyen, Alex M.' }));
  await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/residents/42/medical-records/clinical'));
});

test('resident picker debounces server search and loads the next page', async () => {
  const firstResident = { resident_id: 51, first_name: 'Sam', last_name: 'Lee', sex: 'male' };
  const nextResident = { resident_id: 52, first_name: 'Taylor', last_name: 'Park', sex: 'female' };
  listAllHealthRecords.mockResolvedValue(success());
  getResidents.mockImplementation(async ({ search, page }) => {
    if (search === '52') {
      return { success: true, data: { items: [nextResident], total: 1, page: 1, pageSize: 10, pagination: { totalPages: 1 } } };
    }
    if (page === 2) {
      return { success: true, data: { items: [nextResident], total: 2, page: 2, pageSize: 10, pagination: { totalPages: 2 } } };
    }
    return { success: true, data: { items: [firstResident], total: 2, page: 1, pageSize: 10, pagination: { totalPages: 2 } } };
  });
  render(<MemoryRouter><HealthRecordsPage /></MemoryRouter>);

  await userEvent.click(screen.getAllByRole('button', { name: 'New record' })[0]);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Child Record' }));
  const search = await screen.findByRole('searchbox', { name: 'Search residents by name, ID, or household' });
  expect(await screen.findByRole('option', { name: 'Choose Lee, Sam' })).toBeInTheDocument();

  const initialSignal = getResidents.mock.calls[0][1].signal;
  const callsBeforeSearch = getResidents.mock.calls.length;
  const setTimeoutSpy = jest.spyOn(window, 'setTimeout');
  fireEvent.change(search, { target: { value: '52' } });
  const usesThreeHundredMillisecondDelay = setTimeoutSpy.mock.calls.some(([, delay]) => delay === 300);
  setTimeoutSpy.mockRestore();
  expect(usesThreeHundredMillisecondDelay).toBe(true);
  expect(getResidents).toHaveBeenCalledTimes(callsBeforeSearch);
  expect(initialSignal.aborted).toBe(true);
  await waitFor(() => {
    expect(getResidents.mock.calls.some(([params]) => params.search === '52')).toBe(true);
  });
  expect(getResidents.mock.calls.find(([params]) => params.search === '52')[0]).toEqual(
    expect.objectContaining({ search: '52', page: 1, pageSize: 10 }),
  );

  fireEvent.change(search, { target: { value: '' } });
  await waitFor(() => {
    expect(screen.getByRole('option', { name: 'Choose Lee, Sam' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Choose Park, Taylor' })).not.toBeInTheDocument();
  });
  await act(async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Load more residents' }));
  });
  expect(await screen.findByRole('option', { name: 'Choose Park, Taylor' })).toBeInTheDocument();
  expect(getResidents).toHaveBeenCalledWith(
    expect.objectContaining({ page: 2, pageSize: 10 }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test('resident picker supports arrow selection, Escape, and trigger focus restoration', async () => {
  const residents = [
    { resident_id: 71, first_name: 'Jamie', last_name: 'Rivera' },
    { resident_id: 72, first_name: 'Robin', last_name: 'Santos' },
  ];
  listAllHealthRecords.mockResolvedValue(success());
  getResidents.mockResolvedValue({
    success: true,
    data: { items: residents, total: 2, page: 1, pageSize: 10, pagination: { totalPages: 1 } },
  });
  render(<MemoryRouter initialEntries={['/health-records']}><HealthRecordsPage /><CurrentPath /></MemoryRouter>);

  await userEvent.click(screen.getAllByRole('button', { name: 'New record' })[0]);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Immunization Record' }));
  const search = await screen.findByRole('searchbox', { name: 'Search residents by name, ID, or household' });
  await screen.findByRole('option', { name: 'Choose Rivera, Jamie' });

  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/residents/72/medical-records/immunization'));

  await userEvent.click(screen.getAllByRole('button', { name: 'New record' })[0]);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Maternal Record' }));
  await screen.findByRole('searchbox', { name: 'Search residents by name, ID, or household' });
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'New record' })[0]).toHaveFocus());
});
