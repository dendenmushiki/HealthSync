import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

export function ReportSection({ section, trackedCount, totalCount, expanded, onToggle, children }) {
  return (
    <section className="fhsis-section-card" id={`fhsis-${section.id}`} aria-labelledby={`fhsis-title-${section.id}`}>
      <header className="fhsis-section-heading">
        <button
          type="button"
          className="fhsis-section-toggle"
          aria-expanded={expanded}
          aria-controls={`fhsis-content-${section.id}`}
          onClick={onToggle}
        >
          <span>
            <span className="fhsis-section-title-row">
              <h2 id={`fhsis-title-${section.id}`}>{section.title}</h2>
              <span className="fhsis-tracked-chip">{trackedCount} of {totalCount} tracked</span>
            </span>
            <span className="fhsis-section-description">{section.description}</span>
          </span>
          <span className="fhsis-collapse-indicator" aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>
      </header>
      <div id={`fhsis-content-${section.id}`} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}

export function DataQualitySummary({ tracked, total, hideNotTracked, onHideNotTracked, remarksOnly, onRemarksOnly }) {
  return (
    <section className="fhsis-quality-card" aria-labelledby="fhsis-quality-title">
      <div>
        <span className="fhsis-eyebrow">Data quality</span>
        <h2 id="fhsis-quality-title">{tracked} of {total} indicators tracked</h2>
        <p>Tracked values count records in the selected period. “Not tracked” means the current HealthSync model does not capture that indicator; it is not a zero.</p>
      </div>
      <div className="fhsis-quality-controls">
        <label className="fhsis-switch">
          <input type="checkbox" checked={hideNotTracked} onChange={(event) => onHideNotTracked(event.target.checked)} />
          <span>Hide not-tracked indicators</span>
        </label>
        <label className="fhsis-switch">
          <input type="checkbox" checked={remarksOnly} onChange={(event) => onRemarksOnly(event.target.checked)} />
          <span>Remarks only</span>
        </label>
      </div>
    </section>
  );
}

export function ReportLoading() {
  return (
    <div className="fhsis-loading-skeleton" role="status" aria-live="polite">
      <span className="sr-only">Loading FHSIS report…</span>
      <div className="fhsis-skeleton-quality" />
      <div className="fhsis-skeleton-cards">{[1, 2, 3, 4, 5].map((item) => <i key={item} />)}</div>
      <div className="fhsis-skeleton-tables">{[1, 2, 3].map((item) => <i key={item} />)}</div>
    </div>
  );
}

function RemarkEditor({ remark, onChange, onSaveNow, canEdit, status, editedBy, editedAt, indicator }) {
  const inputRef = useRef(null);
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(42, textarea.scrollHeight)}px`;
  }, [remark]);

  return (
    <div className="fhsis-remark">
      <details className="fhsis-remark-details">
        <summary>{remark ? 'Edit note' : 'Add note'}</summary>
        <textarea
          ref={inputRef}
          value={remark || ''}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onSaveNow}
          placeholder={canEdit ? 'Add note...' : 'No note'}
          aria-label={`Remarks for ${indicator}`}
          maxLength={1000}
          rows={1}
          readOnly={!canEdit}
        />
      </details>
      {canEdit && (remark || '').length > 900 && <small className="fhsis-remark-count">{(remark || '').length}/1000</small>}
      <span className="fhsis-save-status" aria-live="polite" title={editedBy || editedAt ? `Last edited${editedBy ? ` by ${editedBy}` : ''}${editedAt ? ` on ${editedAt}` : ''}` : undefined}>
        {status === 'failed' ? <button type="button" onClick={onSaveNow}>Failed - retry</button> : status === 'saving' ? 'Saving…' : status === 'queued' ? 'Saved offline · queued' : status === 'saved' ? 'Saved' : ''}
      </span>
    </div>
  );
}

function NotTracked({ definition }) {
  return <span className="fhsis-not-tracked" title={definition || 'Not captured in HealthSync records'}><span aria-hidden="true">ⓘ</span> Not tracked</span>;
}

function NumberCell({ value, label, onDrilldown }) {
  if (value === 'Not tracked') return <NotTracked />;
  const count = Number(value || 0);
  return count > 0
    ? <button type="button" className="fhsis-number-link" onClick={onDrilldown} aria-label={`${label}: ${count.toLocaleString()}; open details`}>{count.toLocaleString()}</button>
    : <span>{count.toLocaleString()}</span>;
}

export function IndicatorTable({ title, rows, remarks, onRemarkChange, onRemarkSave, canEdit, hideNotTracked, onDrilldown }) {
  let previousGroup = '';
  return (
    <div className="fhsis-table-wrap">
      <table className="fhsis-table" aria-label={`${title} indicators`}>
        <thead>
          <tr>
            <th scope="col">Indicator</th>
            <th scope="col">Male</th>
            <th scope="col">Female</th>
            <th scope="col" className="fhsis-total-cell">Total</th>
            <th scope="col">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const showGroup = Boolean(row.group && row.group !== previousGroup);
            previousGroup = row.group || '';
            return (
            <React.Fragment key={row.key}>
              {showGroup && <tr className="fhsis-group-row"><th colSpan="5" scope="rowgroup">{row.group}</th></tr>}
              <tr className={`${!row.tracked && hideNotTracked ? 'is-hidden-on-screen ' : ''}${row.isTotal ? 'fhsis-total-row' : ''}`.trim()}>
                <th scope="row">
                  <span>{row.label}</span>
                  {row.definition && <span className="fhsis-info" title={row.definition} aria-label={row.definition}>ⓘ</span>}
                </th>
                <td data-label="Male"><NumberCell value={row.male} label={`${row.label}, male`} onDrilldown={onDrilldown(row, 'male')} /></td>
                <td data-label="Female"><NumberCell value={row.female} label={`${row.label}, female`} onDrilldown={onDrilldown(row, 'female')} /></td>
                <td data-label="Total" className="fhsis-total-cell"><NumberCell value={row.total} label={`${row.label}, total`} onDrilldown={onDrilldown(row, 'total')} /></td>
                <td data-label="Remarks">
                  <RemarkEditor
                    indicator={row.label}
                    remark={remarks[row.key]?.remark || ''}
                    status={remarks[row.key]?.status}
                    editedBy={remarks[row.key]?.updatedBy}
                    editedAt={remarks[row.key]?.updatedAt}
                    canEdit={canEdit}
                    onChange={(value) => onRemarkChange(row.key, value)}
                    onSaveNow={() => onRemarkSave(row.key)}
                  />
                </td>
              </tr>
            </React.Fragment>
            );
          })}
          {!rows.length && <tr><td className="fhsis-no-rows" colSpan="5">No indicators to show with this filter.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function DrilldownDrawer({ state, onClose }) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  useEffect(() => {
    if (!state) return undefined;
    searchRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const nodes = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]') || []);
        if (!nodes.length) return;
        if (event.shiftKey && document.activeElement === nodes[0]) {
          event.preventDefault();
          nodes[nodes.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) {
          event.preventDefault();
          nodes[0].focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, onClose]);
  if (!state) return null;

  return (
    <div className="fhsis-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={dialogRef} className="fhsis-drawer" role="dialog" aria-modal="true" aria-labelledby="fhsis-drawer-title">
        <header>
          <div><span className="fhsis-eyebrow">Auditable count</span><h2 id="fhsis-drawer-title">{state.row.label}</h2><p>{state.sexLabel} · {state.periodLabel}</p></div>
          <button type="button" className="fhsis-icon-button" onClick={onClose} aria-label="Close count details">×</button>
        </header>
        <label className="fhsis-drawer-search">Search residents
          <input ref={searchRef} type="search" value={state.search} onChange={(event) => state.onSearch(event.target.value)} />
        </label>
        <p className="fhsis-drawer-check" role="status">Report count: {state.expected.toLocaleString()} · List count: {state.total.toLocaleString()} {state.expected === state.total ? '✓ Counts match' : '⚠ Count mismatch'}</p>
        {state.error && <div className="fhsis-inline-error" role="alert">{state.error}<button type="button" onClick={state.onRetry}>Try again</button></div>}
        {state.loading ? <div className="fhsis-loading" role="status">Loading residents…</div> : (
          <div className="fhsis-drilldown-list">
            {state.items.map((item) => <article key={item.drilldown_id || item.resident_id}>
              {item.resident_id ? <Link to={`/residents/${item.resident_id}`} onClick={onClose}><strong>{item.name || 'Resident record unavailable'}</strong></Link> : <strong>{item.name || 'Resident record unavailable'}</strong>}
              <span>{item.age ?? 'Age not recorded'} · {item.sex || 'Sex not recorded'}</span>
              <span>{item.sitio || 'Sitio not recorded'} · {item.relevant_date || 'Date not recorded'}</span>
            </article>)}
            {!state.items.length && <p>No matching residents.</p>}
          </div>
        )}
        <footer>
          <button type="button" className="fhsis-button-secondary" onClick={state.onExport} disabled={!state.items.length}>Export this list</button>
          <button type="button" className="fhsis-button-primary" onClick={() => state.onPage(Math.max(1, state.page - 1))} disabled={state.page <= 1}>Previous</button>
          <span>Page {state.page} of {Math.max(1, Math.ceil(state.total / state.pageSize))}</span>
          <button type="button" className="fhsis-button-primary" onClick={() => state.onPage(state.page + 1)} disabled={state.page * state.pageSize >= state.total}>Next</button>
        </footer>
      </aside>
    </div>
  );
}
