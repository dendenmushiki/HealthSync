import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResidentForm from './ResidentForm';
import { AuthContext } from '../../context/AuthContext';
import {
  getResident,
  getResidentBarangays,
  getResidentCitiesMunicipalities,
  getResidentProvinces,
  getResidentRegions,
  getResidentSitios
} from '../../services/api/residentService';
import { enqueueOperation } from '../../services/offline/offlineQueueService';
import { healthCheck, isOffline } from '../../services/offline/networkService';

jest.mock('../../services/api/residentService', () => ({
  createResident: jest.fn(),
  deleteResidentPhoto: jest.fn(),
  getResident: jest.fn(),
  getResidentBarangays: jest.fn(),
  getResidentCitiesMunicipalities: jest.fn(),
  getResidentProvinces: jest.fn(),
  getResidentRegions: jest.fn(),
  getResidentSitios: jest.fn(),
  updateResident: jest.fn(),
  uploadResidentPhoto: jest.fn()
}));

jest.mock('../../services/offline/offlineQueueService', () => ({
  enqueueOperation: jest.fn(),
  updateOperationStatus: jest.fn()
}));

jest.mock('../../services/offline/networkService', () => ({
  healthCheck: jest.fn(),
  isOffline: jest.fn()
}));

beforeEach(() => {
  getResidentRegions.mockResolvedValue({ data: [] });
  getResidentProvinces.mockResolvedValue({ data: [] });
  getResidentCitiesMunicipalities.mockResolvedValue({ data: [] });
  getResidentBarangays.mockResolvedValue({ data: [] });
  getResidentSitios.mockResolvedValue({ success: true, data: [] });
  enqueueOperation.mockResolvedValue({ offlineOperationId: 'offline-resident-1' });
  healthCheck.mockResolvedValue(false);
  isOffline.mockReturnValue(true);
});

test('resident form has an improved page header and no section stepper or classification section', async () => {
  render(
    <AuthContext.Provider value={{ user: null }}>
      <MemoryRouter initialEntries={['/residents/new']}>
        <Routes>
          <Route path="/residents/new" element={<ResidentForm />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

  expect(await screen.findByRole('heading', { name: 'Add Resident' })).toBeInTheDocument();
  expect(screen.getByText('NEW RESIDENT PROFILE')).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Form sections' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Personal/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Resident Classification')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Classification/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save resident' })).toBeInTheDocument();
  expect(document.querySelectorAll('#resident-form button[type="submit"]')).toHaveLength(1);
  expect(document.querySelector('#resident-form').lastElementChild).toHaveClass('resident-form-actions');
});

test('gender and civil status choices match the new form options', async () => {
  render(
    <AuthContext.Provider value={{ user: null }}>
      <MemoryRouter initialEntries={['/residents/new']}>
        <Routes>
          <Route path="/residents/new" element={<ResidentForm />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

  const gender = await screen.findByRole('combobox', { name: 'Gender' });
  expect(Array.from(gender.options).map((option) => option.textContent)).toEqual(['Select gender', 'Male', 'Female', 'Others']);
  const civilStatus = screen.getByRole('combobox', { name: 'Civil status' });
  expect(civilStatus).toHaveValue('');
  expect(Array.from(civilStatus.options).map((option) => option.textContent)).toEqual([
    'Select civil status', 'Single', 'Married', 'Widowed', 'Separated', 'Annulled',
  ]);
  expect(screen.queryByLabelText(/^Sex/)).not.toBeInTheDocument();
});

test('edit form pre-fills a birthdate returned as a timestamp', async () => {
  getResident.mockResolvedValue({
    success: true,
    data: {
      resident_id: 7,
      first_name: 'Ana',
      last_name: 'Santos',
      birthdate: '2000-05-10T00:00:00.000Z',
      sex: 'female'
    }
  });

  render(
    <AuthContext.Provider value={{ user: null }}>
      <MemoryRouter initialEntries={['/residents/7/edit']}>
        <Routes>
          <Route path="/residents/:id/edit" element={<ResidentForm />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

  expect(await screen.findByLabelText('Birthdate *')).toHaveValue('2000-05-10');
});

test('address selectors load dependent province, city, and barangay options', async () => {
  getResidentRegions.mockResolvedValue({ data: [{ code: '010000000', name: 'Ilocos Region' }] });
  getResidentProvinces.mockResolvedValue({ data: [{ code: '012800000', name: 'Ilocos Norte' }] });
  getResidentCitiesMunicipalities.mockResolvedValue({ data: [{ code: '012801000', name: 'Adams' }] });
  getResidentBarangays.mockResolvedValue({ data: [{ code: '012801001', name: 'Adams (Pob.)' }] });

  render(
    <AuthContext.Provider value={{ user: null }}>
      <MemoryRouter initialEntries={['/residents/new']}>
        <Routes>
          <Route path="/residents/new" element={<ResidentForm />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

  fireEvent.change(await screen.findByLabelText('Region'), { target: { value: '010000000' } });
  expect(await screen.findByRole('option', { name: 'Ilocos Norte' })).toBeInTheDocument();
  await waitFor(() => expect(getResidentProvinces).toHaveBeenCalledWith('010000000'));

  fireEvent.change(screen.getByLabelText('Province'), { target: { value: '012800000' } });
  expect(await screen.findByRole('option', { name: 'Adams' })).toBeInTheDocument();
  await waitFor(() => expect(getResidentCitiesMunicipalities).toHaveBeenCalledWith('012800000'));

  fireEvent.change(screen.getByLabelText('City/Municipality'), { target: { value: '012801000' } });
  expect(await screen.findByRole('option', { name: 'Adams (Pob.)' })).toBeInTheDocument();
  await waitFor(() => expect(getResidentBarangays).toHaveBeenCalledWith('012801000'));
});

test('shows inline validation when required resident fields are missing', async () => {
  render(
    <AuthContext.Provider value={{ user: null }}>
      <MemoryRouter initialEntries={['/residents/new']}>
        <Routes>
          <Route path="/residents/new" element={<ResidentForm />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

  fireEvent.submit(document.getElementById('resident-form'));

  expect(await screen.findByText('First name is required.')).toBeInTheDocument();
  expect(screen.getByText('Please select a civil status.')).toBeInTheDocument();
  expect(screen.getByText('Select a gender.')).toBeInTheDocument();
  expect(screen.getByLabelText('First name *')).toHaveAttribute('aria-invalid', 'true');
});

test('announces an offline resident after adding it to the sync queue', async () => {
  const queueChanged = jest.fn();
  window.addEventListener('healthsync:queue-changed', queueChanged);

  render(
    <AuthContext.Provider value={{ user: { user_id: 7 } }}>
      <MemoryRouter initialEntries={['/residents/new']}>
        <Routes>
          <Route path="/residents/new" element={<ResidentForm />} />
          <Route path="/sync-status" element={<div>Sync Status</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

  fireEvent.change(await screen.findByLabelText('First name *'), { target: { value: 'Offline' } });
  fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Resident' } });
  fireEvent.change(screen.getByLabelText('Birthdate *'), { target: { value: '2000-01-01' } });
  fireEvent.change(screen.getByLabelText('Gender *'), { target: { value: 'others' } });
  fireEvent.change(screen.getByLabelText('Civil status *'), { target: { value: 'Single' } });
  fireEvent.submit(document.getElementById('resident-form'));

  expect(await screen.findByText('Sync Status')).toBeInTheDocument();
  expect(enqueueOperation).toHaveBeenCalledWith(expect.objectContaining({
    operation: 'CREATE',
    table: 'residents',
    userId: 7,
    payload: expect.objectContaining({
      sex: 'others',
      civil_status: 'Single',
      is_4ps: 0,
      category_flags: [],
      pregnant: 0,
      lactating: 0,
    }),
  }));
  expect(queueChanged).toHaveBeenCalledTimes(1);
  window.removeEventListener('healthsync:queue-changed', queueChanged);
});

test('asks before leaving when a resident form has unsaved changes', async () => {
  render(
    <AuthContext.Provider value={{ user: null }}>
      <MemoryRouter initialEntries={['/residents/new']}>
        <Routes>
          <Route path="/residents/new" element={<ResidentForm />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

  fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Maria' } });
  fireEvent.click(screen.getByRole('link', { name: 'Residents' }));

  expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument();
});
