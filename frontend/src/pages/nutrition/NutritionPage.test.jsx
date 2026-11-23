import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NutritionPage from './NutritionPage';
import { listNutritionRecords } from '../../services/api/nutritionRecordsService';

jest.mock('../../services/api/nutritionRecordsService', () => ({
  listNutritionRecords: jest.fn(),
  getNutritionRecord: jest.fn(),
  exportNutritionRecords: jest.fn(),
}));

jest.mock('../operation-timbang/OperationTimbangPage', () => () => null);
jest.mock('../adolescent-bmi/AdolescentBMIPage', () => () => null);
jest.mock('../adult-bmi/AdultBMIPage', () => () => null);

let nutritionRecords;

beforeEach(() => {
  nutritionRecords = [
    {
      id: 5,
      record_type: 'Operation Timbang',
      resident_id: 2,
      first_name: 'Ana',
      last_name: 'Santos',
      birthdate: '2025-01-20',
      record_date: '2025-09-20',
      weight_kg: 8,
      height_cm: 70,
      status: 'Normal',
      indicators: [],
    },
    {
      id: 4,
      record_type: 'Operation Timbang',
      resident_id: 1,
      first_name: 'Pedro',
      last_name: 'Cruz',
      birthdate: '2020-01-20',
      record_date: '2026-10-25',
      weight_kg: 20,
      height_cm: 100,
      status: 'Normal',
      indicators: [],
    },
  ];
  listNutritionRecords.mockImplementation(async () => ({
    success: true,
    data: { items: nutritionRecords, total: nutritionRecords.length, counts: { type: {} } },
  }));
});

test('nutritional assessment records show infant ages without exposing delete actions', async () => {
  render(
    <MemoryRouter>
      <NutritionPage />
    </MemoryRouter>
  );
  const table = await screen.findByRole('table');
  await within(table).findByText('Ana Santos');
  const rows = within(table).getAllByRole('row');
  const loadsBeforeSync = listNutritionRecords.mock.calls.length;
  fireEvent(window, new Event('healthsync:sync-complete'));
  await waitFor(() => expect(listNutritionRecords.mock.calls.length).toBeGreaterThan(loadsBeforeSync));

  expect(rows[1]).toHaveTextContent('Ana Santos');
  expect(rows[1]).toHaveTextContent('8 mos');
  expect(rows[2]).toHaveTextContent('Pedro Cruz');
  expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
});
