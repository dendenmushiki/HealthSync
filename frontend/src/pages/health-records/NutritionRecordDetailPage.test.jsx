import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getNutritionRecord } from '../../services/api/nutritionRecordsService';
import NutritionRecordDetailPage from './NutritionRecordDetailPage';

jest.mock('../../services/api/nutritionRecordsService', () => ({ getNutritionRecord: jest.fn() }));

test('renders saved nutrition measurements, record metadata, and assessment history', async () => {
  getNutritionRecord.mockResolvedValue({
    success: true,
    data: {
      id: 12, resident_id: 7, record_type: 'Operation Timbang', record_date: '2026-04-03',
      first_name: 'Nina', last_name: 'Reyes', birthdate: '2021-01-02', sex: 'female',
      household_no: 'HH-9', sitio: 'Purok 2', status: 'Needs attention', weight_kg: 15.4,
      height_cm: 101, measurement_type: 'Height', wfa_status: 'Normal', wfa_zscore: -0.5,
      hfa_status: 'Needs attention', hfa_zscore: -2.1, wflh_status: 'Normal',
      wflh_zscore: -0.2, recorded_by_name: 'BHW User', created_at: '2026-04-03T08:30:00Z',
      history: [
        { id: 10, record_type: 'Operation Timbang', record_date: '2025-12-03', weight_kg: 14.2, height_cm: 98, status: 'Normal', recorded_by_name: 'BHW User' },
        { id: 12, record_type: 'Operation Timbang', record_date: '2026-04-03', weight_kg: 15.4, height_cm: 101, status: 'Needs attention', recorded_by_name: 'BHW User' }
      ]
    }
  });
  render(<MemoryRouter initialEntries={['/nutrition/records/operation/12']}>
    <Routes><Route path="/nutrition/records/:type/:id" element={<NutritionRecordDetailPage />} /></Routes>
  </MemoryRouter>);

  expect(await screen.findByText('Nina Reyes')).toBeInTheDocument();
  expect(screen.getByText('15.4')).toBeInTheDocument();
  expect(screen.getAllByText('Needs attention').length).toBeGreaterThan(0);
  expect(screen.getByText('Assessment History')).toBeInTheDocument();
  expect(screen.getAllByText('BHW User').length).toBeGreaterThan(0);
  expect(getNutritionRecord).toHaveBeenCalledWith('operation', '12');
});
