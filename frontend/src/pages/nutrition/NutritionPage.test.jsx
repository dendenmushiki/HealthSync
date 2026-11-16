import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import NutritionPage from './NutritionPage';
import { listOperationTimbang, deleteOperationTimbang } from '../../services/api/operationTimbangService';
import { listAdolescentBMI } from '../../services/api/adolescentBMIService';
import { listAdultBMI } from '../../services/api/adultBMIService';

jest.mock('../../services/api/operationTimbangService', () => ({
  listOperationTimbang: jest.fn(),
  deleteOperationTimbang: jest.fn()
}));

jest.mock('../../services/api/adolescentBMIService', () => ({
  listAdolescentBMI: jest.fn(),
  deleteAdolescentBMI: jest.fn()
}));

jest.mock('../../services/api/adultBMIService', () => ({
  listAdultBMI: jest.fn(),
  deleteAdultBMI: jest.fn()
}));

jest.mock('../operation-timbang/OperationTimbangPage', () => () => null);
jest.mock('../adolescent-bmi/AdolescentBMIPage', () => () => null);
jest.mock('../adult-bmi/AdultBMIPage', () => () => null);

beforeEach(() => {
  listOperationTimbang.mockResolvedValue({
    data: {
      items: [
        {
          timbang_id: 4,
          first_name: 'Pedro',
          last_name: 'Cruz',
          birthdate: '2020-01-20',
          date_recorded: '2026-10-25',
          age_in_months: 81,
          weight_kg: 20,
          measurement_cm: 100,
          created_at: '2026-10-25T10:00:00.000Z'
        },
        {
          timbang_id: 5,
          first_name: 'Ana',
          last_name: 'Santos',
          birthdate: '2025-01-20',
          date_recorded: '2025-09-20',
          age_in_months: 8,
          weight_kg: 8,
          measurement_cm: 70,
          created_at: '2026-10-26T10:00:00.000Z'
        }
      ]
    }
  });
  listAdolescentBMI.mockResolvedValue({ data: { items: [] } });
  listAdultBMI.mockResolvedValue({ data: { items: [] } });
  deleteOperationTimbang.mockResolvedValue({ success: true });
});

test('recent records show infant ages in months and delete only after confirmation', async () => {
  render(<NutritionPage />);
  fireEvent.click(screen.getByRole('button', { name: /Recent Records/ }));

  expect(listOperationTimbang).toHaveBeenCalledWith({ page: 1, limit: 100, sort: 'created_at' });
  const rows = within(await screen.findByRole('table')).getAllByRole('row');
  expect(rows[1]).toHaveTextContent('Ana Santos');
  expect(rows[1]).toHaveTextContent('8 months');
  expect(rows[2]).toHaveTextContent('Pedro Cruz');
  expect(await screen.findByText('8 months')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Operation Timbang record for Ana Santos' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('This permanently deletes the Operation Timbang record for Ana Santos.');

  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(deleteOperationTimbang).toHaveBeenCalledWith(5));
  await waitFor(() => expect(screen.queryByText('Ana Santos')).not.toBeInTheDocument());
});
