import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import SeniorRegistryPage from './SeniorRegistryPage';
import { listSeniorCitizens } from '../../services/api/seniorCitizenService';

jest.mock('../../services/api/seniorCitizenService', () => ({
  listSeniorCitizens: jest.fn(),
  getSeniorCitizen: jest.fn(),
  createSeniorCitizen: jest.fn(),
  updateSeniorCitizen: jest.fn(),
  removeSeniorCitizen: jest.fn(),
  searchEligibleResidents: jest.fn(),
  getNextSeniorId: jest.fn(),
}));

function QueryState() {
  const [params] = useSearchParams();
  return <output data-testid="query-state">{params.toString()}</output>;
}

beforeEach(() => {
  jest.useFakeTimers();
  listSeniorCitizens.mockReset().mockResolvedValue({
    success: true,
    data: {
      items: [],
      total: 0,
      stats: { registered: 0, age80Plus: 0, knownConditions: 0, registeredThisMonth: 0 },
      filterOptions: { conditions: ['Diabetes', 'Hypertension'] },
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

test('keeps a pending search when another filter is changed', async () => {
  render(
    <MemoryRouter initialEntries={['/senior-citizens?condition=Hypertension&page=3&pageSize=25']}>
      <QueryState />
      <SeniorRegistryPage />
    </MemoryRouter>,
  );

  await act(async () => {
    await Promise.resolve();
  });
  expect(listSeniorCitizens).toHaveBeenCalledTimes(1);

  fireEvent.change(screen.getByRole('textbox', { name: 'Search senior registry' }), {
    target: { value: 'Ana' },
  });
  expect(listSeniorCitizens).toHaveBeenCalledTimes(1);

  fireEvent.change(screen.getByRole('combobox', { name: 'Health condition' }), {
    target: { value: 'Diabetes' },
  });

  await act(async () => {
    await Promise.resolve();
  });
  expect(listSeniorCitizens).toHaveBeenCalledTimes(2);
  expect(listSeniorCitizens.mock.calls[1][0]).toEqual(expect.objectContaining({
    search: 'Ana',
    condition: 'Diabetes',
    page: 1,
    pageSize: 25,
  }));
  expect(screen.getByTestId('query-state')).toHaveTextContent('search=Ana');
  expect(screen.getByTestId('query-state')).toHaveTextContent('condition=Diabetes');
  expect(screen.getByTestId('query-state')).toHaveTextContent('page=1');
});
