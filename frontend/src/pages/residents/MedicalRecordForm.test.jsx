import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClinicalRecordForm from './ClinicalRecordForm';
import MedicalRecordForm from './MedicalRecordForm';
import { listResidentMedicalRecords } from '../../services/api/residentMedicalRecordService';

jest.mock('../../services/api/residentMedicalRecordService', () => ({
  listResidentMedicalRecords: jest.fn(),
  createResidentMedicalRecord: jest.fn(),
  updateResidentMedicalRecord: jest.fn(),
  deleteResidentMedicalRecord: jest.fn()
}));

test('clinical form shows profile demographics as read-only and keeps record fields editable', async () => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  render(<MemoryRouter><ClinicalRecordForm resident={{
    resident_id: 7,
    first_name: 'Ana',
    middle_name: 'Maria',
    last_name: 'Santos',
    suffix: 'Jr.',
    birthdate: '1981-01-05',
    sex: 'female',
    civil_status: 'Single',
    household_no: 'HH-12',
    address: 'Poblacion',
    philhealth_id_no: 'PH-123',
    contact_no: '09123456789',
    occupation: 'Teacher'
  }} /></MemoryRouter>);

  await waitFor(() => expect(screen.getByText('Visit history')).toBeInTheDocument());
  expect(screen.getByText('Santos, Ana Maria Jr.')).toBeInTheDocument();
  expect(screen.getByText('January 5, 1981')).toBeInTheDocument();
  expect(screen.getByText('Poblacion')).toBeInTheDocument();
  expect(screen.getByText('PH-123')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /Client Type/ })).toBeInTheDocument();
  expect(screen.queryByLabelText('First Name')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit in resident profile' })).toHaveAttribute('href', '/residents/7/edit');
});

test.each([
  ['child', 'Visit Details', 'Medical History'],
  ['maternal', 'Visit Details', 'Medical and Past History'],
  ['immunization', 'Parent Information', 'Immunization Details']
])('%s record uses the shared card workflow and preserves its sections', async (recordType, firstSection, secondSection) => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  render(<MemoryRouter><MedicalRecordForm recordType={recordType} resident={{
    resident_id: 8,
    first_name: 'Mika',
    middle_name: '',
    last_name: 'Reyes',
    birthdate: '2020-06-12',
    sex: 'female',
    household_no: 'HH-8',
    address: 'Central',
    philhealth_id_no: 'PH-8',
    contact_no: '09123456789'
  }} /></MemoryRouter>);

  await waitFor(() => expect(screen.getByText('Visit history')).toBeInTheDocument());
  expect(screen.getAllByText('Patient Demographics').length).toBeGreaterThan(0);
  expect(screen.getAllByText(firstSection).length).toBeGreaterThan(0);
  expect(screen.getAllByText(secondSection).length).toBeGreaterThan(0);
  expect(screen.getAllByText('HH-8').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Save record' })).toBeInTheDocument();
});
