import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getHealthRecordDetails } from '../../services/api/healthRecordService';
import HealthRecordDetailPage from './HealthRecordDetailPage';

jest.mock('../../services/api/healthRecordService', () => ({
  getHealthRecordDetails: jest.fn(),
  deleteHealthRecord: jest.fn()
}));
jest.mock('../../services/api/childHealthService', () => ({ deleteChildHealthRecord: jest.fn() }));
jest.mock('../../services/api/residentMedicalRecordService', () => ({ deleteResidentMedicalRecord: jest.fn() }));

const renderDetail = (type, key) => render(
  <MemoryRouter initialEntries={[`/health-records/${type}/${key}`]}>
    <Routes><Route path="/health-records/:type/:recordKey" element={<HealthRecordDetailPage />} /></Routes>
  </MemoryRouter>
);

test('renders a grouped clinical summary with calendar dates and screening flags', async () => {
  getHealthRecordDetails.mockResolvedValue({
    success: true,
    data: {
      record: {
        id: 95,
        resident_id: 97,
        source_table: 'patient_clinical_records',
        record_type: 'clinical',
        record_date: '2026-09-07',
        recorded_by_name: 'Juan Dela Cruz',
        created_at: '2026-09-07T08:30:00.000Z',
        record_data: {
          visit_date: '2026-09-07',
          history_of_present_illness: 'Headache and dizziness.',
          findings: 'No acute distress.',
          assessment: 'Follow-up needed.',
          plan: 'Return in one week.',
          blood_pressure: '132/81',
          heart_rate: 105,
          respiratory_rate: 18,
          temperature: 36.8,
          weight_kg: 90,
          height_cm: 165
        }
      },
      resident: {
        resident_id: 97,
        first_name: 'Leah',
        last_name: 'Cruz',
        birthdate: '1978-02-25',
        sex: 'female',
        age: 48
      },
      previousRecord: null,
      nextRecord: null,
      otherRecords: []
    }
  });

  renderDetail('clinical', 'patient_clinical_records-95');

  expect(await screen.findByRole('heading', { name: 'Cruz, Leah' })).toBeInTheDocument();
  expect(screen.getAllByText('Sep 7, 2026').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Feb 25, 1978 (48 yrs)').length).toBeGreaterThan(0);
  expect(screen.getByText('Blood pressure')).toBeInTheDocument();
  expect(screen.getAllByText('High').length).toBeGreaterThan(0);
  expect(screen.getByText('Obese')).toBeInTheDocument();
  expect(screen.getByText('Headache and dizziness.')).toBeInTheDocument();
  expect(screen.getByText('Recorded by Juan Dela Cruz')).toBeInTheDocument();
  expect(getHealthRecordDetails).toHaveBeenCalledWith('patient_clinical_records', '95');
});

test('shows visible gaps for missing vitals and displays a resident’s other records', async () => {
  getHealthRecordDetails.mockResolvedValue({
    success: true,
    data: {
      record: { id: 4, resident_id: 9, source_table: 'maternal_records', record_type: 'maternal', record_date: '2026-10-06', record_data: { visit_date: '2026-10-06', tt_status: 'Complete' } },
      resident: { resident_id: 9, first_name: 'Ana', last_name: 'Santos', birthdate: '1990-10-10', sex: 'female', age: 36 },
      previousRecord: { type: 'clinical', sourceTable: 'patient_clinical_records', recordId: 3 },
      nextRecord: null,
      otherRecords: [{ source_table: 'patient_clinical_records', record_id: 3, record_type: 'clinical', record_label: 'Clinical Record', record_date: '2026-10-01' }]
    }
  });
  renderDetail('maternal', 'maternal_records-4');

  expect(await screen.findByText('Tetanus toxoid status')).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: /Previous record/ })).toHaveAttribute('href', '/health-records/clinical/patient_clinical_records-3');
  expect(screen.getByText('Other records for this resident')).toBeInTheDocument();
});

test('groups child growth data and immunization dates from their record-specific fields', async () => {
  getHealthRecordDetails.mockResolvedValue({
    success: true,
    data: {
      record: {
        id: 8, resident_id: 12, source_table: 'child_records', record_type: 'child', record_date: '2026-10-10',
        record_data: {
          visit_date: '2026-10-10',
          history_of_present_illness: 'Routine growth visit.',
          birth_and_immunization_history: 'Normal birth history.',
          weight_kg: 18,
          height_cm: 105,
          growth_rows: [{ date: '2026-10-10', age: 5, weight: 18, height: 105, muac: 16, remarks: 'Stable' }]
        }
      },
      resident: { resident_id: 12, first_name: 'Noah', last_name: 'Cruz', birthdate: '2021-03-01', sex: 'male', age: 5 },
      previousRecord: null,
      nextRecord: null,
      otherRecords: []
    }
  });
  const child = renderDetail('child', 'child_records-8');
  expect(await screen.findByText('Child health and growth')).toBeInTheDocument();
  expect(screen.getByText('Normal birth history.')).toBeInTheDocument();
  expect(screen.getByText('Stable')).toBeInTheDocument();
  child.unmount();

  getHealthRecordDetails.mockResolvedValue({
    success: true,
    data: {
      record: {
        id: 9, resident_id: 12, source_table: 'immunization_records', record_type: 'immunization', record_date: '2026-01-06',
        record_data: { bcg_date: '2026-01-05', vaccine_rows: [{ dose: 1, penta_hib: '2026-01-06' }] }
      },
      resident: { resident_id: 12, first_name: 'Noah', last_name: 'Cruz', birthdate: '2021-03-01', sex: 'male', age: 5 },
      previousRecord: null,
      nextRecord: null,
      otherRecords: []
    }
  });
  renderDetail('immunization', 'immunization_records-9');
  expect(await screen.findByText('Immunizations')).toBeInTheDocument();
  expect(screen.getByText('Jan 5, 2026')).toBeInTheDocument();
  expect(screen.getByText('Penta Hib · dose 1')).toBeInTheDocument();
});
