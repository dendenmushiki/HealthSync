import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Baby,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleSlash,
  EyeOff,
  HeartPulse,
  Info,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  RotateCcw,
  Scale,
  ShieldCheck,
  Stethoscope,
  Syringe,
  Table2,
  PieChart,
  Users,
  UserRound,
  X,
} from 'lucide-react';
import { getNutritionCategoryColorVariable } from '../../utils/nutritionCategoryColors';

const numberFormat = new Intl.NumberFormat();

export function SaveState({ status, onRetry }) {
  if (status === 'saving') return <span className="fhsis-save-status"><Loader2 aria-hidden="true" className="fhsis-spin" /> Saving</span>;
  if (status === 'saved') return <span className="fhsis-save-status"><Check aria-hidden="true" /> Saved</span>;
  if (status === 'failed') {
    return <span className="fhsis-save-status is-error"><AlertCircle aria-hidden="true" /> Save failed <button type="button" onClick={onRetry}>Retry</button></span>;
  }
  return null;
}

export function AlertBanner({ type = 'info', title, message, onRetry, onDismiss }) {
  const Icon = type === 'error' ? AlertCircle : type === 'warning' ? AlertTriangle : type === 'success' ? Check : Info;
  return (
    <div className={`fhsis-alert is-${type}`} role={type === 'info' || type === 'success' ? 'status' : 'alert'}>
      <Icon aria-hidden="true" className="fhsis-alert-icon" />
      <div className="fhsis-alert-copy">
        {title && <strong>{title}</strong>}
        <p>{message}</p>
      </div>
      {onRetry && <button type="button" className="fhsis-alert-retry" onClick={onRetry}><RotateCcw aria-hidden="true" /> Retry</button>}
      {onDismiss && <button type="button" className="fhsis-icon-button" onClick={onDismiss} aria-label="Dismiss alert"><X aria-hidden="true" /></button>}
    </div>
  );
}

export function ReportSection({ section, Icon, trackedCount, totalCount, expanded, onToggle, children }) {
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <section className="fhsis-section-card" id={`fhsis-${section.id}`} aria-labelledby={`fhsis-title-${section.id}`}>
      <header className="fhsis-section-heading">
        <div className="fhsis-section-heading-copy">
          <span className="fhsis-section-icon" aria-hidden="true"><Icon /></span>
          <div className="fhsis-section-titles">
            <div className="fhsis-section-title-row">
              <h2 id={`fhsis-title-${section.id}`}>{section.title}</h2>
              <span className="fhsis-tracked-chip">{numberFormat.format(trackedCount)} of {numberFormat.format(totalCount)} tracked</span>
            </div>
            <p className="fhsis-section-description">{section.description}</p>
          </div>
        </div>
        <button
          type="button"
          className="fhsis-section-toggle"
          aria-expanded={expanded}
          aria-controls={`fhsis-content-${section.id}`}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${section.title}`}
          onClick={onToggle}
        >
          <Chevron aria-hidden="true" />
        </button>
      </header>
      <div className="fhsis-section-content" id={`fhsis-content-${section.id}`} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}

export function DataQualitySummary({ tracked, total, hideNotTracked, onHideNotTracked, remarksOnly, onRemarksOnly }) {
  const progress = total ? Math.min(100, (tracked / total) * 100) : 0;
  return (
    <section className="fhsis-quality-card" aria-labelledby="fhsis-quality-title">
      <div className="fhsis-quality-heading">
        <span className="fhsis-quality-icon" aria-hidden="true"><ShieldCheck /></span>
        <div>
          <span className="fhsis-eyebrow">Data quality</span>
          <h2 id="fhsis-quality-title">{numberFormat.format(tracked)} of {numberFormat.format(total)} indicators tracked</h2>
          <p>Tracked values count records in the selected period. “Not tracked” means the current HealthSync model does not capture that indicator; it is not a zero.</p>
        </div>
      </div>
      <div className="fhsis-quality-progress">
        <div className="fhsis-progress-track" role="progressbar" aria-label="Tracked indicators" aria-valuemin="0" aria-valuemax={total} aria-valuenow={tracked}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <strong>{Math.round(progress)}%</strong>
      </div>
      <div className="fhsis-quality-controls">
        <label className="fhsis-switch">
          <input type="checkbox" role="switch" checked={hideNotTracked} onChange={(event) => onHideNotTracked(event.target.checked)} />
          <span className="fhsis-switch-track" aria-hidden="true" />
          <span>Hide not-tracked indicators</span>
          <button type="button" className="fhsis-switch-help" title="Hides indicators the current data model does not capture; tracked zero values remain visible." aria-label="Hide not-tracked indicators help" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}><Info /></button>
          <EyeOff aria-hidden="true" className="fhsis-switch-leading-icon" />
        </label>
        <label className="fhsis-switch">
          <input type="checkbox" role="switch" checked={remarksOnly} onChange={(event) => onRemarksOnly(event.target.checked)} />
          <span className="fhsis-switch-track" aria-hidden="true" />
          <span>Remarks only</span>
          <button type="button" className="fhsis-switch-help" title="Shows indicators with a saved or in-progress remark." aria-label="Remarks only help" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}><Info /></button>
          <MessageSquareText aria-hidden="true" className="fhsis-switch-leading-icon" />
        </label>
        {(hideNotTracked || remarksOnly) && <span className="fhsis-filter-chip">Filters active</span>}
      </div>
    </section>
  );
}

export function ReportLoading() {
  return (
    <div className="fhsis-loading-skeleton" role="status" aria-live="polite">
      <span className="sr-only">Loading FHSIS report…</span>
      <div className="fhsis-skeleton-controls" />
      <div className="fhsis-skeleton-quality" />
      <div className="fhsis-skeleton-cards">{[1, 2, 3, 4, 5].map((item) => <i key={item} />)}</div>
      <div className="fhsis-skeleton-pies">{[1, 2, 3].map((item) => <i key={item} />)}</div>
      <div className="fhsis-skeleton-tables">{[1, 2, 3].map((item) => <i key={item} />)}</div>
    </div>
  );
}

function RemarkEditor({ remark, onChange, onSaveNow, canEdit, status, editedBy, editedAt, indicator }) {
  const inputRef = useRef(null);
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = '';
    if (document.activeElement === textarea) textarea.style.height = `${Math.max(76, textarea.scrollHeight)}px`;
  }, [remark]);

  return (
    <div className="fhsis-remark">
      <MessageSquareText aria-hidden="true" className="fhsis-remark-icon" />
      <textarea
        ref={inputRef}
        value={remark || ''}
        onFocus={(event) => { event.currentTarget.style.height = `${Math.max(76, event.currentTarget.scrollHeight)}px`; }}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onSaveNow}
        placeholder={canEdit ? 'Add remark' : 'No remark'}
        aria-label={`Remarks for ${indicator}`}
        title={editedBy || editedAt ? `Last edited${editedBy ? ` by ${editedBy}` : ''}${editedAt ? ` on ${editedAt}` : ''}` : undefined}
        maxLength={1000}
        rows={1}
        readOnly={!canEdit}
      />
      {canEdit && (remark || '').length > 900 && <small className="fhsis-remark-count">{(remark || '').length}/1000</small>}
      <SaveState status={status} onRetry={onSaveNow} />
    </div>
  );
}

export function NotTrackedCell({ definition }) {
  const help = definition || 'This indicator is not captured by the current HealthSync data model. It is not a zero.';
  return (
    <span className="fhsis-not-tracked" title={help} aria-label={`Not tracked. ${help}`}>
      <CircleSlash aria-hidden="true" /> Not tracked
    </span>
  );
}

function NumberValue({ value, label, onDrilldown }) {
  const count = Number(value || 0);
  return count > 0
    ? <button type="button" className="fhsis-number-link" onClick={onDrilldown} aria-label={`${label}: ${numberFormat.format(count)}; open details`}>{numberFormat.format(count)}</button>
    : <span className="fhsis-number-value">{numberFormat.format(count)}</span>;
}

function GroupHeading({ label, mobile = false }) {
  const lower = String(label).toLowerCase();
  const Icon = /penta|opv|ipv|pcv|mmr|vitamin/.test(lower) ? Syringe
    : /birth|delivery|skilled/.test(lower) ? Stethoscope
      : /child|immun/.test(lower) ? Baby : Users;
  return <div className={mobile ? 'fhsis-mobile-group' : 'fhsis-group-heading'}><Icon aria-hidden="true" /><span>{label}</span></div>;
}

function IndicatorFields({ row, onDrilldown }) {
  if (!row.tracked) {
    return <td colSpan="3" className="fhsis-not-tracked-cell" data-label="Status"><NotTrackedCell definition={row.definition} /></td>;
  }
  return (
    <>
      <td data-label="Male"><NumberValue value={row.male} label={`${row.label}, male`} onDrilldown={onDrilldown(row, 'male')} /></td>
      <td data-label="Female"><NumberValue value={row.female} label={`${row.label}, female`} onDrilldown={onDrilldown(row, 'female')} /></td>
      <td data-label="Total" className="fhsis-total-cell"><NumberValue value={row.total} label={`${row.label}, total`} onDrilldown={onDrilldown(row, 'total')} /></td>
    </>
  );
}

function IndicatorIdentity({ row }) {
  return (
    <span className="fhsis-indicator-identity">
      <span className="fhsis-indicator-label">{row.label}</span>
      {Boolean(row.definition) && <button type="button" className="fhsis-info" title={row.definition} aria-label={`${row.label}: ${row.definition}`}><Info aria-hidden="true" /></button>}
      {Boolean(row.remark) && <span className="fhsis-remark-dot" title="Has a remark" aria-label="Has a remark" />}
    </span>
  );
}

export function IndicatorTable({ title, rows, remarks, onRemarkChange, onRemarkSave, canEdit, onDrilldown, filtersActive = false, onClearFilters }) {
  return (
    <>
      {!rows.length ? (
        <div className="fhsis-filter-empty" role="status">
          <Info aria-hidden="true" />
          <span>No indicators match the current filters.</span>
          {filtersActive && <button type="button" onClick={onClearFilters}>Clear filters</button>}
        </div>
      ) : (
        <div className="fhsis-table-wrap">
          <table className="fhsis-table" aria-label={`${title} indicators`}>
            <caption className="sr-only">{title} indicators, grouped by sex, with remarks.</caption>
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
              {rows.map((row, index) => {
                const previousGroup = index ? rows[index - 1].group || '' : '';
                const showGroup = Boolean(row.group && row.group !== previousGroup);
                const remark = remarks[row.key]?.remark || '';
                const rowWithRemark = { ...row, remark };
                return (
                  <React.Fragment key={row.key}>
                    {showGroup && <tr className="fhsis-group-row"><th colSpan="5" scope="rowgroup"><GroupHeading label={row.group} /></th></tr>}
                    <tr className={`${!row.tracked ? 'is-not-tracked ' : ''}${row.group ? 'is-grouped ' : ''}${row.isTotal ? 'fhsis-total-row' : ''}`.trim()}>
                      <th scope="row"><IndicatorIdentity row={rowWithRemark} /></th>
                      <IndicatorFields row={row} onDrilldown={onDrilldown} />
                      <td data-label="Remarks">
                        <RemarkEditor
                          indicator={row.label}
                          remark={remark}
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
            </tbody>
          </table>
          <div className="fhsis-mobile-indicators" aria-label={`${title} indicators`}>
            {rows.map((row, index) => {
              const previousGroup = index ? rows[index - 1].group || '' : '';
              const showGroup = Boolean(row.group && row.group !== previousGroup);
              const remark = remarks[row.key]?.remark || '';
              return (
                <React.Fragment key={`mobile-${row.key}`}>
                  {showGroup && <GroupHeading label={row.group} mobile />}
                  <article className={`fhsis-indicator-card${!row.tracked ? ' is-not-tracked' : ''}`}>
                    <div className="fhsis-indicator-card-title"><IndicatorIdentity row={{ ...row, remark }} /></div>
                    {row.tracked ? (
                      <div className="fhsis-mobile-stat-chips">
                        <div><span>Male</span><NumberValue value={row.male} label={`${row.label}, male`} onDrilldown={onDrilldown(row, 'male')} /></div>
                        <div><span>Female</span><NumberValue value={row.female} label={`${row.label}, female`} onDrilldown={onDrilldown(row, 'female')} /></div>
                        <div className="fhsis-mobile-total"><span>Total</span><NumberValue value={row.total} label={`${row.label}, total`} onDrilldown={onDrilldown(row, 'total')} /></div>
                      </div>
                    ) : <NotTrackedCell definition={row.definition} />}
                    <RemarkEditor
                      indicator={row.label}
                      remark={remark}
                      status={remarks[row.key]?.status}
                      editedBy={remarks[row.key]?.updatedBy}
                      editedAt={remarks[row.key]?.updatedAt}
                      canEdit={canEdit}
                      onChange={(value) => onRemarkChange(row.key, value)}
                      onSaveNow={() => onRemarkSave(row.key)}
                    />
                  </article>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export function ChartTableToggle({ view, onChange, label }) {
  return (
    <div className="fhsis-chart-toggle" role="group" aria-label={`${label} display`}>
      <button type="button" className={view === 'chart' ? 'is-selected' : ''} aria-pressed={view === 'chart'} onClick={() => onChange('chart')}><PieChart aria-hidden="true" /> Chart</button>
      <button type="button" className={view === 'table' ? 'is-selected' : ''} aria-pressed={view === 'table'} onClick={() => onChange('table')}><Table2 aria-hidden="true" /> Table</button>
    </div>
  );
}

function polarPoint(angle, radius) {
  const radians = (angle - 90) * (Math.PI / 180);
  return { x: 110 + radius * Math.cos(radians), y: 110 + radius * Math.sin(radians) };
}

function piePath(start, end) {
  const first = polarPoint(start, 104);
  const last = polarPoint(end, 104);
  const largeArc = end - start > 180 ? 1 : 0;
  return `M 110 110 L ${first.x} ${first.y} A 104 104 0 ${largeArc} 1 ${last.x} ${last.y} Z`;
}

function PieChartWithLegend({ rows, total, title }) {
  const categories = rows.filter((row) => !row.isTotal);
  const [activeIndex, setActiveIndex] = useState(-1);
  let angle = 0;
  const slices = categories.map((row, index) => {
    const count = Number(row.total) || 0;
    const sweep = total ? (count / total) * 360 : 0;
    const slice = { row, index, count, start: angle, end: angle + sweep };
    angle += sweep;
    return slice;
  });
  const active = slices[activeIndex];
  const nonZeroSlices = slices.filter((slice) => slice.count > 0);
  const summary = categories.map((row) => `${row.label}: ${numberFormat.format(Number(row.total) || 0)}`).join('; ');
  const keyDown = (event, index) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setActiveIndex(activeIndex === index ? -1 : index);
    }
  };

  return (
    <div className="fhsis-pie-content" onPointerLeave={(event) => {
      if (event.pointerType !== 'touch' && !event.currentTarget.contains(document.activeElement)) setActiveIndex(-1);
    }}>
      {total > 0 ? (
        <div className="fhsis-pie-visual">
          <svg className="fhsis-pie-chart" viewBox="0 0 220 220" role="group" aria-label={`${title}. ${summary}`}>
            {nonZeroSlices.length === 1 ? (
              <circle
                cx="110"
                cy="110"
                r="104"
                style={{ fill: `var(${getNutritionCategoryColorVariable(nonZeroSlices[0].row.label)})` }}
                stroke="var(--fhsis-card)"
                strokeWidth="2"
                role="button"
                tabIndex="0"
                aria-label={`${nonZeroSlices[0].row.label}: Male ${numberFormat.format(Number(nonZeroSlices[0].row.male) || 0)}, Female ${numberFormat.format(Number(nonZeroSlices[0].row.female) || 0)}, Total ${numberFormat.format(nonZeroSlices[0].count)}, 100%`}
                onMouseEnter={() => setActiveIndex(nonZeroSlices[0].index)}
                onFocus={() => setActiveIndex(nonZeroSlices[0].index)}
                onBlur={() => setActiveIndex(-1)}
                onClick={() => setActiveIndex(activeIndex === nonZeroSlices[0].index ? -1 : nonZeroSlices[0].index)}
                onKeyDown={(event) => keyDown(event, nonZeroSlices[0].index)}
              >
                <title>{nonZeroSlices[0].row.label}: {numberFormat.format(nonZeroSlices[0].count)} (100%)</title>
              </circle>
            ) : nonZeroSlices.map((slice) => {
              const percentage = total ? (slice.count / total) * 100 : 0;
              return (
                <path
                  key={slice.row.key}
                  d={piePath(slice.start, slice.end)}
                  className={activeIndex === slice.index ? 'is-active' : ''}
                  style={{ fill: `var(${getNutritionCategoryColorVariable(slice.row.label)})` }}
                  stroke="var(--fhsis-card)"
                  strokeWidth="2"
                  role="button"
                  tabIndex="0"
                  aria-label={`${slice.row.label}: Male ${numberFormat.format(Number(slice.row.male) || 0)}, Female ${numberFormat.format(Number(slice.row.female) || 0)}, Total ${numberFormat.format(slice.count)}, ${percentage.toFixed(1)}%`}
                  onMouseEnter={() => setActiveIndex(slice.index)}
                  onFocus={() => setActiveIndex(slice.index)}
                  onBlur={() => setActiveIndex(-1)}
                  onClick={() => setActiveIndex(activeIndex === slice.index ? -1 : slice.index)}
                  onKeyDown={(event) => keyDown(event, slice.index)}
                >
                  <title>{slice.row.label}: Male {numberFormat.format(Number(slice.row.male) || 0)}, Female {numberFormat.format(Number(slice.row.female) || 0)}, Total {numberFormat.format(slice.count)}, {percentage.toFixed(1)}%</title>
                </path>
              );
            })}
          </svg>
          {active && <div className="fhsis-pie-tooltip" role="status">
            <strong>{active.row.label}</strong>
            <span>Male {numberFormat.format(Number(active.row.male) || 0)} · Female {numberFormat.format(Number(active.row.female) || 0)}</span>
            <span>Total {numberFormat.format(active.count)} · {((active.count / total) * 100).toFixed(1)}%</span>
          </div>}
        </div>
      ) : (
        <div className="fhsis-pie-empty">
          <span className="fhsis-pie-empty-ring"><span>No assessments</span></span>
          <p>No records in this period.</p>
        </div>
      )}
      <ul className="fhsis-pie-legend" aria-label={`${title} category legend`}>
        {slices.map((slice) => {
          const percentage = total ? (slice.count / total) * 100 : 0;
          return (
            <li key={slice.row.key}>
              <button
                type="button"
                title={slice.row.label}
                className={activeIndex === slice.index ? 'is-active' : ''}
                onMouseEnter={() => setActiveIndex(slice.index)}
                onFocus={() => setActiveIndex(slice.index)}
                onBlur={() => setActiveIndex(-1)}
                onClick={() => setActiveIndex(activeIndex === slice.index ? -1 : slice.index)}
                aria-pressed={activeIndex === slice.index}
              >
                <span className="fhsis-legend-dot" style={{ backgroundColor: `var(${getNutritionCategoryColorVariable(slice.row.label)})` }} />
                <span className="fhsis-legend-label">{slice.row.label}</span>
                <strong>{numberFormat.format(slice.count)}</strong>
                <span className="fhsis-legend-percent">{percentage.toFixed(1)}%</span>
                <small>M {numberFormat.format(Number(slice.row.male) || 0)} · F {numberFormat.format(Number(slice.row.female) || 0)}</small>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NutritionPiePanel({ table, displayRows = table.rows, remarks, onRemarkChange, onRemarkSave, canEdit, onDrilldown, filtersActive, onClearFilters }) {
  const [view, setView] = useState('chart');
  const rows = table.rows;
  const totalRow = rows.find((row) => row.isTotal);
  const categories = rows.filter((row) => !row.isTotal);
  const total = Number(totalRow?.total) || categories.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const totalLabel = totalRow?.label || 'Total classified assessments';
  const Icon = table.key === 'operation-timbang' ? Scale : table.key === 'adolescent-bmi' ? Activity : UserRound;

  return (
    <article className={`fhsis-table-card fhsis-nutrition-panel${view === 'table' ? ' is-table-view' : ''}`} aria-labelledby={`nutrition-title-${table.key}`}>
      <header className="fhsis-nutrition-panel-heading">
        <span className="fhsis-nutrition-icon" aria-hidden="true"><Icon /></span>
        <h3 id={`nutrition-title-${table.key}`}>{table.title}</h3>
        <ChartTableToggle view={view} onChange={setView} label={table.title} />
      </header>
      <div className="fhsis-nutrition-panel-body">
        <div className="fhsis-chart-view" hidden={view !== 'chart'}>
          <PieChartWithLegend rows={rows} total={total} title={table.title} />
        </div>
        <div className="fhsis-table-view">
          <IndicatorTable
            title={table.title}
            rows={displayRows}
            remarks={remarks}
            onRemarkChange={onRemarkChange}
            onRemarkSave={onRemarkSave}
            canEdit={canEdit}
            onDrilldown={onDrilldown}
            filtersActive={filtersActive}
            onClearFilters={onClearFilters}
          />
        </div>
        <p className="fhsis-nutrition-total"><span>{totalLabel}</span><strong>{numberFormat.format(total)}</strong></p>
      </div>
    </article>
  );
}

export function SectionNavigator({ sections, sectionCounts, activeSection, onSelect, onExpandAll, onCollapseAll }) {
  const icons = {
    overview: Users,
    nutrition: HeartPulse,
    'child-care': Baby,
    'maternal-care': Stethoscope,
    'senior-registry': Users,
  };
  return (
    <nav className="fhsis-section-nav" aria-label="Report sections">
      <div className="fhsis-section-nav-list">
        {sections.map((section) => {
          const Icon = icons[section.id] || Users;
          const count = sectionCounts(section.id);
          return (
            <button key={section.id} type="button" className={activeSection === section.id ? 'is-active' : ''} aria-current={activeSection === section.id ? 'location' : undefined} onClick={() => onSelect(section.id)}>
              <Icon aria-hidden="true" />
              <span>{section.title}</span>
              <small>{numberFormat.format(count.tracked)} / {numberFormat.format(count.total)}</small>
            </button>
          );
        })}
      </div>
      <div className="fhsis-expand-controls">
        <button type="button" onClick={onExpandAll}><ChevronsUpDown aria-hidden="true" />Expand all</button>
        <button type="button" onClick={onCollapseAll}><ChevronsDownUp aria-hidden="true" />Collapse all</button>
      </div>
      <details className="fhsis-nav-overflow">
        <summary aria-label="More section actions"><MoreHorizontal aria-hidden="true" /></summary>
        <div>
          <button type="button" onClick={(event) => { onExpandAll(); event.currentTarget.closest('details')?.removeAttribute('open'); }}><ChevronsUpDown aria-hidden="true" />Expand all</button>
          <button type="button" onClick={(event) => { onCollapseAll(); event.currentTarget.closest('details')?.removeAttribute('open'); }}><ChevronsDownUp aria-hidden="true" />Collapse all</button>
        </div>
      </details>
    </nav>
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
          <button type="button" className="fhsis-icon-button" onClick={onClose} aria-label="Close count details"><X aria-hidden="true" /></button>
        </header>
        <label className="fhsis-drawer-search">Search residents
          <input ref={searchRef} type="search" value={state.search} onChange={(event) => state.onSearch(event.target.value)} />
        </label>
        <p className="fhsis-drawer-check" role="status">Report count: {numberFormat.format(state.expected)} · List count: {numberFormat.format(state.total)} {state.expected === state.total ? <><Check aria-hidden="true" /> Counts match</> : <><AlertTriangle aria-hidden="true" /> Count mismatch</>}</p>
        {state.error && <AlertBanner type="error" title="Unable to load count details" message={state.error} onRetry={state.onRetry} />}
        {state.loading ? <div className="fhsis-loading" role="status"><Loader2 className="fhsis-spin" aria-hidden="true" /> Loading residents…</div> : (
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
          <button type="button" className="fhsis-button-primary" onClick={() => state.onPage(Math.max(1, state.page - 1))} disabled={state.page <= 1}><ChevronLeft aria-hidden="true" /> Previous</button>
          <span>Page {numberFormat.format(state.page)} of {numberFormat.format(Math.max(1, Math.ceil(state.total / state.pageSize)))}</span>
          <button type="button" className="fhsis-button-primary" onClick={() => state.onPage(state.page + 1)} disabled={state.page * state.pageSize >= state.total}>Next <ChevronRight aria-hidden="true" /></button>
        </footer>
      </aside>
    </div>
  );
}
