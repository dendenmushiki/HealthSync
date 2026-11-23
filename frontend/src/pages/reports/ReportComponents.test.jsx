import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataQualitySummary, IndicatorTable, NutritionPiePanel, ReportSection } from './ReportComponents';

const makeNutritionTable = (normalTotal = 3, underweightTotal = 2) => ({
  key: 'operation-timbang',
  title: 'Operation Timbang · 0–59 months',
  rows: [
    { key: 'normal', label: 'Normal', male: 2, female: 1, total: normalTotal, tracked: true },
    { key: 'underweight', label: 'Underweight / Thin', male: 1, female: 1, total: underweightTotal, tracked: true },
    { key: 'total', label: 'Total assessment records', male: 3, female: 2, total: normalTotal + underweightTotal, tracked: true, isTotal: true },
  ],
});

const nutritionProps = {
  displayRows: [],
  remarks: {},
  onRemarkChange: jest.fn(),
  onRemarkSave: jest.fn(),
  canEdit: false,
  onDrilldown: () => () => {},
  filtersActive: false,
  onClearFilters: jest.fn(),
};

describe('FHSIS report components', () => {
  test('renders accessible nutrition slices and supports the table view', () => {
    const table = makeNutritionTable();
    render(<NutritionPiePanel {...nutritionProps} table={table} displayRows={table.rows} />);

    expect(screen.getByRole('group', { name: /operation timbang.*normal: 3/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /normal: male 2, female 1, total 3/i })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole('button', { name: /underweight \/ thin: male 1/i }));
    expect(screen.getByText('Total 2 · 40.0%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const tableView = screen.getByRole('table', { name: `${table.title} indicators` });
    expect(within(tableView).getByRole('columnheader', { name: 'Male' })).toBeInTheDocument();
    expect(within(tableView).getByRole('columnheader', { name: 'Female' })).toBeInTheDocument();
    expect(within(tableView).getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
  });

  test('shows a stable empty chart when a nutrition panel has no assessments', () => {
    const table = makeNutritionTable(0, 0);
    render(<NutritionPiePanel {...nutritionProps} table={table} displayRows={table.rows} />);

    expect(screen.getByText('No assessments')).toBeInTheDocument();
    expect(screen.getByText('No records in this period.')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  test('represents an untracked indicator once in one merged numeric cell', () => {
    const row = {
      key: 'untracked',
      label: 'Indicator not captured',
      male: 'Not tracked',
      female: 'Not tracked',
      total: 'Not tracked',
      tracked: false,
      definition: 'The current data model does not capture this indicator.',
    };
    render(
      <IndicatorTable
        title="Child care"
        rows={[row]}
        remarks={{}}
        onRemarkChange={jest.fn()}
        onRemarkSave={jest.fn()}
        canEdit={false}
        onDrilldown={() => () => {}}
      />,
    );

    const indicatorTable = screen.getByRole('table', { name: 'Child care indicators' });
    const indicatorRow = within(indicatorTable).getByRole('row', { name: /indicator not captured/i });
    const mergedCell = indicatorRow.querySelector('td[colspan="3"]');
    expect(mergedCell).toHaveTextContent('Not tracked');
    expect(mergedCell.querySelectorAll('.fhsis-not-tracked')).toHaveLength(1);
    expect(mergedCell).toHaveAttribute('colspan', '3');
  });

  test('keeps section toggles accessible and quality filters as switches', () => {
    const section = { id: 'overview', title: 'Overview', description: 'Report overview' };
    render(
      <>
        <ReportSection section={section} Icon={() => <span />} trackedCount={1} totalCount={1} expanded onToggle={jest.fn()}>
          <p>Section content</p>
        </ReportSection>
        <DataQualitySummary tracked={1} total={2} hideNotTracked={false} onHideNotTracked={jest.fn()} remarksOnly={false} onRemarksOnly={jest.fn()} />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Collapse Overview' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });
});
