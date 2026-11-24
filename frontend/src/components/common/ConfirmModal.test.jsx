import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConfirmModal from './ConfirmModal';

function ConfirmModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open confirmation</button>
      <ConfirmModal
        open={open}
        title="Confirm delete"
        message="This action cannot be undone."
        onConfirm={() => {}}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

test('traps keyboard focus and restores it when the confirmation closes', () => {
  render(<ConfirmModalHarness />);

  const openButton = screen.getByRole('button', { name: 'Open confirmation' });
  openButton.focus();
  fireEvent.click(openButton);
  const cancelButton = screen.getByRole('button', { name: 'Cancel' });
  const confirmButton = screen.getByRole('button', { name: 'Delete' });

  expect(cancelButton).toHaveFocus();
  fireEvent.keyDown(confirmButton, { key: 'Tab' });
  expect(cancelButton).toHaveFocus();

  fireEvent.keyDown(cancelButton, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(openButton).toHaveFocus();
});
