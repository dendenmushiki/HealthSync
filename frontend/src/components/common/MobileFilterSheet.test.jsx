import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import MobileFilterSheet from './MobileFilterSheet';

function FilterSheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <MobileFilterSheet
      id="test-filters"
      title="Filters"
      activeCount={1}
      open={open}
      onOpenChange={setOpen}
      onReset={() => {}}
    >
      <label htmlFor="test-condition">Condition</label>
      <select id="test-condition"><option>All conditions</option></select>
    </MobileFilterSheet>
  );
}

test('traps focus and returns it to the filter trigger on close', () => {
  render(<FilterSheetHarness />);

  const trigger = screen.getByRole('button', { name: 'Filters, 1 active' });
  trigger.focus();
  fireEvent.click(trigger);

  const dialog = screen.getByRole('dialog', { name: 'Filters' });
  const closeButton = screen.getByRole('button', { name: 'Close filters' });
  const applyButton = screen.getByRole('button', { name: 'Apply' });
  expect(closeButton).toHaveFocus();

  fireEvent.keyDown(applyButton, { key: 'Tab' });
  expect(closeButton).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
