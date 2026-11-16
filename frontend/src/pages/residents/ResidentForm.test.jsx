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
  getResidentRegions
} from '../../services/api/residentService';

jest.mock('../../services/api/residentService', () => ({
  createResident: jest.fn(),
  deleteResidentPhoto: jest.fn(),
  getResident: jest.fn(),
  getResidentBarangays: jest.fn(),
  getResidentCitiesMunicipalities: jest.fn(),
  getResidentProvinces: jest.fn(),
  getResidentRegions: jest.fn(),
  updateResident: jest.fn(),
  uploadResidentPhoto: jest.fn()
}));

beforeEach(() => {
  getResidentRegions.mockResolvedValue({ data: [] });
  getResidentProvinces.mockResolvedValue({ data: [] });
  getResidentCitiesMunicipalities.mockResolvedValue({ data: [] });
  getResidentBarangays.mockResolvedValue({ data: [] });
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

test('pregnancy and lactation options are enabled only for female residents and cleared when sex changes', async () => {
  render(
    <AuthContext.Provider value={{ user: null }}>
      <MemoryRouter initialEntries={['/residents/new']}>
        <Routes>
          <Route path="/residents/new" element={<ResidentForm />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

  const pregnant = screen.getByRole('checkbox', { name: 'Pregnant' });
  const lactating = screen.getByRole('checkbox', { name: 'Lactating' });
  expect(pregnant).toBeDisabled();
  expect(lactating).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Sex *'), { target: { value: 'female' } });
  expect(pregnant).toBeEnabled();
  fireEvent.click(pregnant);
  expect(pregnant).toBeChecked();

  fireEvent.change(screen.getByLabelText('Sex *'), { target: { value: 'male' } });
  expect(pregnant).toBeDisabled();
  expect(pregnant).not.toBeChecked();
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
  expect(screen.getByLabelText('First name *')).toHaveAttribute('aria-invalid', 'true');
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

  expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Stay on page' }));
  expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument();
});
