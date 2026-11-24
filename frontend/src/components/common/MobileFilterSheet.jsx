import React, { useEffect, useRef } from 'react';
import { Check, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import './MobileFilterSheet.css';

const FOCUSABLE_SELECTOR = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const MobileFilterSheet = ({ id, title = 'Filters', activeCount = 0, open, onOpenChange, onReset, children }) => {
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const firstFocusable = dialogRef.current?.querySelector(FOCUSABLE_SELECTOR);
    (firstFocusable || dialogRef.current)?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  const reset = () => {
    onReset();
    onOpenChangeRef.current(false);
  };

  return (
    <div className="mobile-filter-sheet-control">
      <button
        ref={triggerRef}
        type="button"
        className="mobile-filter-sheet-trigger"
        aria-label={`${title}${activeCount ? `, ${activeCount} active` : ''}`}
        aria-expanded={open}
        aria-controls={`${id}-dialog`}
        onClick={() => onOpenChangeRef.current(!open)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>{title}</span>
        {activeCount > 0 && <span className="mobile-filter-sheet-count" aria-hidden="true">{activeCount}</span>}
      </button>
      <div
        className={`mobile-filter-sheet-layer${open ? ' is-open' : ''}`}
        onPointerDown={(event) => { if (event.target === event.currentTarget) onOpenChangeRef.current(false); }}
      >
        <section
          ref={dialogRef}
          id={`${id}-dialog`}
          className="mobile-filter-sheet-dialog"
          role={open ? 'dialog' : undefined}
          aria-modal={open ? 'true' : undefined}
          aria-labelledby={open ? `${id}-title` : undefined}
          tabIndex={open ? -1 : undefined}
        >
          <header className="mobile-filter-sheet-header">
            <span className="mobile-filter-sheet-handle" aria-hidden="true" />
            <h2 id={`${id}-title`}>{title}</h2>
            <button type="button" className="mobile-filter-sheet-close" aria-label="Close filters" onClick={() => onOpenChangeRef.current(false)}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="mobile-filter-sheet-body">{children}</div>
          <footer className="mobile-filter-sheet-footer">
            <button type="button" className="mobile-filter-sheet-reset" onClick={reset}>
              <RotateCcw size={15} aria-hidden="true" />Reset
            </button>
            <button type="button" className="mobile-filter-sheet-apply" onClick={() => onOpenChangeRef.current(false)}>
              <Check size={16} aria-hidden="true" />Apply
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
};

export default MobileFilterSheet;
