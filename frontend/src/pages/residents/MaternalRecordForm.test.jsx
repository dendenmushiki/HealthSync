import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MaternalRecordForm from './MaternalRecordForm';
import {
  createResidentMedicalRecord,
  listResidentMedicalRecords,
  updateResidentMedicalRecord,
} from '../../services/api/residentMedicalRecordService';

jest.mock('../../services/api/residentMedicalRecordService', () => ({
  createResidentMedicalRecord: jest.fn(),
  listResidentMedicalRecords: jest.fn(),
  updateResidentMedicalRecord: jest.fn(),
}));

const resident = {
  resident_id: 7,
  first_name: 'Ana',
  middle_name: 'Maria',
  last_name: 'Santos',
  birthdate: '2005-04-12',
  sex: 'female',
  household_no: 'HH-12',
  address: 'Poblacion',
  philhealth_id_no: 'PH-123',
  contact_no: '09123456789',
};

const renderForm = () => render(<MemoryRouter><MaternalRecordForm resident={resident} /></MemoryRouter>);

beforeEach(() => {
  jest.clearAllMocks();
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  createResidentMedicalRecord.mockResolvedValue({ success: true, data: {} });
  updateResidentMedicalRecord.mockResolvedValue({ success: true, data: {} });
});

test('suggests EDC from LMP, allows an override, and retains it when LMP is cleared', async () => {
  renderForm();
  const lmp = await screen.findByLabelText('Last menstrual period (LMP)');
  expect(screen.queryByText('Visit history')).not.toBeInTheDocument();
  const edc = screen.getByLabelText('EDC');
  const aog = screen.getByLabelText('Age of gestation (AOG)');
  expect(edc.compareDocumentPosition(aog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.change(lmp, { target: { value: '2024-01-15' } });
  expect(edc).toHaveValue('2024-10-21');
  fireEvent.change(edc, { target: { value: '2024-11-02' } });
  fireEvent.change(lmp, { target: { value: '2024-02-01' } });
  expect(edc).toHaveValue('2024-11-02');
  fireEvent.change(lmp, { target: { value: '' } });
  expect(edc).toHaveValue('2024-11-02');
});

test('rejects an EDC before LMP and sends valid EDC in the saved record payload', async () => {
  renderForm();
  const lmp = await screen.findByLabelText('Last menstrual period (LMP)');
  const edc = screen.getByLabelText('EDC');
  fireEvent.change(lmp, { target: { value: '2024-10-21' } });
  fireEvent.change(edc, { target: { value: '2024-01-15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
  expect(await screen.findByText('EDC cannot be before LMP.')).toBeInTheDocument();
  expect(createResidentMedicalRecord).not.toHaveBeenCalled();

  fireEvent.change(edc, { target: { value: '2025-01-27' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
  await waitFor(() => expect(createResidentMedicalRecord).toHaveBeenCalledWith(
    7,
    'maternal',
    expect.objectContaining({ lmp: '2024-10-21', edc: '2025-01-27' })
  ));
});

test('shows profile gender with a capitalized label and renders AOG as a text field', async () => {
  renderForm();
  expect(await screen.findByText('Gender')).toBeInTheDocument();
  expect(screen.getByText('Female')).toBeInTheDocument();
  expect(screen.getByLabelText('Age of gestation (AOG)')).toHaveAttribute('type', 'text');
});

test('discard returns to resident details after confirmation', async () => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  render(<MemoryRouter initialEntries={['/residents/7/medical-records/maternal']}>
    <Routes>
      <Route path="/residents/:id/medical-records/maternal" element={<MaternalRecordForm resident={resident} />} />
      <Route path="/residents/7" element={<h1>Resident details</h1>} />
    </Routes>
  </MemoryRouter>);

  fireEvent.change(await screen.findByLabelText('Last menstrual period (LMP)'), { target: { value: '2024-01-15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  const dialog = screen.getByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
  expect(await screen.findByRole('heading', { name: 'Resident details' })).toBeInTheDocument();
});
