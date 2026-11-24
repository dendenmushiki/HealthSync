import React, { useEffect, useRef } from 'react';

const ConfirmModal = ({ open, title, message, confirmLabel = 'Delete', busy = false, onConfirm, onCancel }) => {
  const cancelRef = useRef(null);
  const modalRef = useRef(null);
  const returnFocusRef = useRef(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  busyRef.current = busy;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    if (!returnFocusRef.current) returnFocusRef.current = document.activeElement;
    cancelRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCancelRef.current?.();
      }
      if (event.key !== 'Tab') return;
      const focusableItems = modalRef.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!focusableItems?.length) return;
      const first = focusableItems[0];
      const last = focusableItems[focusableItems.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modalRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);
  useEffect(() => {
    if (open || !returnFocusRef.current) return;
    if (returnFocusRef.current.isConnected) returnFocusRef.current.focus();
    returnFocusRef.current = null;
  }, [open]);
  useEffect(() => () => {
    if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
  }, []);
  if (!open) return null;
  return (
    <div className="hs-modal-backdrop" role="presentation" onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <div ref={modalRef} className="hs-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title" tabIndex="-1">
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