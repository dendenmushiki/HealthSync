import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ClinicalRecordForm from './ClinicalRecordForm';
import MedicalRecordForm from './MedicalRecordForm';
import ResidentMedicalRecords from './ResidentMedicalRecords';
import { getResident } from '../../services/api/residentService';
import { createResidentMedicalRecord, listResidentMedicalRecords } from '../../services/api/residentMedicalRecordService';

jest.mock('../../services/api/residentService', () => ({
  getResident: jest.fn()
}));

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

  await screen.findByRole('heading', { name: 'Patient Demographics' });
  expect(screen.queryByText('Visit history')).not.toBeInTheDocument();
  expect(screen.getByText('Santos, Ana Maria Jr.')).toBeInTheDocument();
  expect(screen.getByText('January 5, 1981')).toBeInTheDocument();
  expect(screen.getByText('Poblacion')).toBeInTheDocument();
  expect(screen.getByText('PH-123')).toBeInTheDocument();
  expect(screen.getByText('Gender')).toBeInTheDocument();
  expect(screen.getAllByText('Female').length).toBeGreaterThan(0);
  expect(screen.getByText('Resident ID · 7')).toBeInTheDocument();
  expect(screen.queryByText('Sex')).not.toBeInTheDocument();
  expect(screen.queryByText('00')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /Client Type/ })).toBeInTheDocument();
  expect(screen.queryByLabelText('First Name')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit in resident profile' })).toHaveAttribute('href', '/residents/7/edit');
});

test('clinical demographics lead the form and PMH details appear alongside native yes/no radios', async () => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  const { container } = render(<MemoryRouter><ClinicalRecordForm resident={{
    resident_id: 7,
    first_name: 'Ana',
    last_name: 'Santos',
    birthdate: '1981-01-05',
    sex: 'female'
  }} /></MemoryRouter>);

  await screen.findByRole('heading', { name: 'Patient Demographics' });
  expect(screen.queryByText('Visit history')).not.toBeInTheDocument();
  const form = container.querySelector('.clinical-form-content');
  expect(form.firstElementChild).toHaveAttribute('id', 'clinical-section-patient-demographics');
  expect(screen.queryByRole('navigation', { name: 'Clinical form sections' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Past Medical History (PMH)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /PMH/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Expand all|Collapse all/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/filled$/)).not.toBeInTheDocument();

  const allergyRow = container.querySelector('.clinical-history-prompt-row');
  expect(within(allergyRow).getByLabelText('Allergy: Yes')).toHaveAttribute('type', 'radio');
  expect(within(allergyRow).queryByLabelText('Specify Allergy')).not.toBeInTheDocument();
  fireEvent.click(within(allergyRow).getByLabelText('Allergy: Yes'));
  expect(within(allergyRow).getByLabelText('Specify Allergy')).toBeInTheDocument();
});

test('clinical form includes the requested menstrual and pregnancy history fields', async () => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  render(<MemoryRouter><ClinicalRecordForm resident={{
    resident_id: 9,
    first_name: 'Mika',
    last_name: 'Reyes',
    birthdate: '1990-06-12',
    sex: 'female'
  }} /></MemoryRouter>);

  await screen.findByRole('heading', { name: 'Patient Demographics' });
  expect(screen.getByRole('heading', { name: 'Menstrual History', level: 3 })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Pregnancy History', level: 3 })).toBeInTheDocument();
  expect(screen.getByRole('spinbutton', { name: 'Menarche' })).toBeInTheDocument();
  expect(screen.getByLabelText('LMP')).toHaveAttribute('type', 'date');
  expect(screen.getByLabelText('No. of pads/day')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Menopause' })).toBeInTheDocument();

  expect(screen.getByLabelText('Gravida')).toBeInTheDocument();
  expect(screen.getByLabelText('Parity')).toBeInTheDocument();
  expect(screen.getByLabelText('Type of Delivery')).toBeInTheDocument();
  expect(screen.getByLabelText('No. of Full Term')).toBeInTheDocument();
  expect(screen.getByLabelText('No. of Premature')).toBeInTheDocument();
  expect(screen.getByLabelText('No. of Abortion')).toBeInTheDocument();
  expect(screen.getByLabelText('Living Children')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Pre-eclampsia' })).toBeInTheDocument();
});

test('past surgical history reveals operation fields for Yes and clears them for No', async () => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  const { container } = render(<MemoryRouter><ClinicalRecordForm resident={{
    resident_id: 10,
    first_name: 'Lina',
    last_name: 'Cruz',
    birthdate: '1970-03-10',
    sex: 'female'
  }} /></MemoryRouter>);

  await screen.findByRole('heading', { name: 'Patient Demographics' });
  const historyRow = container.querySelector('[id="clinical-section-Past Surgical History"] .clinical-history-prompt-row');
  fireEvent.click(within(historyRow).getByLabelText('Past surgical history: Yes'));
  fireEvent.click(within(historyRow).getByRole('button', { name: 'Add operation' }));
  expect(within(historyRow).getByLabelText('Operation 1')).toBeInTheDocument();

  fireEvent.click(within(historyRow).getByLabelText('Past surgical history: No'));
  expect(within(historyRow).queryByLabelText('Operation 1')).not.toBeInTheDocument();
});

test('selected health record page does not offer tabs to switch record types', async () => {
  getResident.mockResolvedValue({ success: true, data: {
    resident_id: 7,
    first_name: 'Ana',
    last_name: 'Santos',
    birthdate: '1981-01-05',
    sex: 'female'
  } });
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  render(<MemoryRouter initialEntries={['/residents/7/medical-records/clinical']}>
    <Routes><Route path="/residents/:id/medical-records/:recordType" element={<ResidentMedicalRecords />} /></Routes>
  </MemoryRouter>);

  expect(await screen.findByRole('heading', { name: 'Clinical Record' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Resident medical forms' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Maternal' })).not.toBeInTheDocument();
});

test('clinical record page retries resident loading after an error', async () => {
  getResident.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ success: true, data: {
    resident_id: 7,
    first_name: 'Ana',
    last_name: 'Santos',
    birthdate: '1981-01-05',
    sex: 'female'
  } });
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  render(<MemoryRouter initialEntries={['/residents/7/medical-records/clinical']}>
    <Routes><Route path="/residents/:id/medical-records/:recordType" element={<ResidentMedicalRecords />} /></Routes>
  </MemoryRouter>);

  expect(await screen.findByRole('heading', { name: 'Clinical record unavailable' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'Clinical Record' })).toBeInTheDocument();
});

test('discard confirms dirty changes and returns to resident details', async () => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  render(<MemoryRouter initialEntries={['/residents/7/medical-records/clinical']}>
    <Routes>
      <Route path="/residents/:id/medical-records/clinical" element={<ClinicalRecordForm resident={{
        resident_id: 7,
        first_name: 'Ana',
        last_name: 'Santos',
        birthdate: '1981-01-05',
        sex: 'female'
      }} />} />
      <Route path="/residents/7" element={<h1>Resident details</h1>} />
    </Routes>
  </MemoryRouter>);

  await screen.findByRole('heading', { name: 'Patient Demographics' });
  fireEvent.change(screen.getByRole('combobox', { name: /Client Type/ }), { target: { value: 'New' } });
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(screen.getByText('Your entered information will be lost.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByRole('heading', { name: 'Patient Demographics' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
  expect(await screen.findByRole('heading', { name: 'Resident details' })).toBeInTheDocument();
});

test.each([
  ['child', 'Visit Details', 'Medical History'],
  ['maternal', 'Visit Details', 'Medical and Past History'],
  ['immunization', 'Parent Information', 'Immunization Details']
])('%s record uses the shared card workflow and preserves its sections', async (recordType, firstSection, secondSection) => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  const { container } = render(<MemoryRouter><MedicalRecordForm recordType={recordType} resident={{
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

  await screen.findByRole('heading', { name: 'Patient Demographics' });
  expect(screen.queryByText('Visit history')).not.toBeInTheDocument();
  expect(screen.getAllByText('Patient Demographics').length).toBeGreaterThan(0);
  expect(screen.getAllByText(firstSection).length).toBeGreaterThan(0);
  expect(screen.getAllByText(secondSection).length).toBeGreaterThan(0);
  expect(screen.getAllByText('HH-8').length).toBeGreaterThan(0);
  expect(screen.getByText('Resident ID · 8')).toBeInTheDocument();
  expect(screen.getByText('Female')).toBeInTheDocument();
  expect(screen.queryByText('Sex')).not.toBeInTheDocument();
  expect(container.querySelector('.clinical-section-sidebar')).not.toBeInTheDocument();
  expect(container.querySelector('.clinical-accordion-heading')).not.toBeInTheDocument();
  expect(container.querySelector('.clinical-filled-count')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save record' })).toBeInTheDocument();
});

test.each(['child', 'immunization'])('%s discard returns to resident details after confirmation', async (recordType) => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  const resident = {
    resident_id: 8,
    first_name: 'Mika',
    last_name: 'Reyes',
    birthdate: '2020-06-12',
    sex: 'female',
    household_no: 'HH-8'
  };
  render(<MemoryRouter initialEntries={[`/residents/8/medical-records/${recordType}`]}>
    <Routes>
      <Route path="/residents/:id/medical-records/:recordType" element={<MedicalRecordForm recordType={recordType} resident={resident} />} />
      <Route path="/residents/8" element={<h1>Resident details</h1>} />
    </Routes>
  </MemoryRouter>);

  await screen.findByRole('heading', { name: 'Patient Demographics' });
  fireEvent.change(screen.getByLabelText('Religion'), { target: { value: 'Changed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  const dialog = screen.getByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
  expect(await screen.findByRole('heading', { name: 'Resident details' })).toBeInTheDocument();
});

test('immunization growth rows and screening dates remain in the saved payload', async () => {
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  createResidentMedicalRecord.mockResolvedValue({ success: true, data: {} });
  render(<MemoryRouter><MedicalRecordForm recordType="immunization" resident={{
    resident_id: 8,
    first_name: 'Mika',
    last_name: 'Reyes',
    birthdate: '2020-06-12',
    sex: 'female',
    household_no: 'HH-8'
  }} /></MemoryRouter>);

  await screen.findByRole('heading', { name: 'Patient Demographics' });
  expect(screen.queryByText('Visit history')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Date of Newborn Screening'), { target: { value: '2025-01-12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Row' }));
  fireEvent.change(screen.getByLabelText('Growth records 1 Age'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));

  await waitFor(() => expect(createResidentMedicalRecord).toHaveBeenCalledWith(
    8,
    'immunization',
    expect.objectContaining({
      newborn_screening_date: '2025-01-12',
      growth_rows: [expect.objectContaining({ age: '4' })],
    })
  ));
});

test.each([
  ['child', 'Child Record'],
  ['immunization', 'Immunization Record'],
])('%s record page uses the shared Clinical layout', async (recordType, title) => {
  getResident.mockResolvedValue({ success: true, data: {
    resident_id: 8,
    first_name: 'Mika',
    last_name: 'Reyes',
    birthdate: '2020-06-12',
    sex: 'female',
    household_no: 'HH-8',
  } });
  listResidentMedicalRecords.mockResolvedValue({ success: true, data: [] });
  const { container } = render(<MemoryRouter initialEntries={[`/residents/8/medical-records/${recordType}`]}>
    <Routes><Route path="/residents/:id/medical-records/:recordType" element={<ResidentMedicalRecords />} /></Routes>
  </MemoryRouter>);

  expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
  expect(container.querySelector('.resident-medical-records-page')).toHaveClass('clinical-form-page');
  expect(container.querySelector('.clinical-section-sidebar')).not.toBeInTheDocument();
  expect(container.querySelector('.clinical-accordion-heading')).not.toBeInTheDocument();
});
