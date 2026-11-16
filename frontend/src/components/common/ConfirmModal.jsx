import React, { useEffect, useRef } from 'react';

const ConfirmModal = ({ open, title, message, confirmLabel = 'Delete', busy = false, onConfirm, onCancel }) => {
  const cancelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(document.querySelectorAll('.hs-confirm-modal button:not(:disabled)'));
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel, open]);
  if (!open) return null;
  return (
    <div className="hs-modal-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <div className="hs-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <h4 id="confirm-modal-title">{title}</h4>
        <p>{message}</p>
        <div className="hs-confirm-actions">
          <button ref={cancelRef} type="button" className="btn btn-outline-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting...' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;