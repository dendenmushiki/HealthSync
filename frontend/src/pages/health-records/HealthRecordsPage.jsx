import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { deleteHealthRecord, listAllHealthRecords } from '../../services/api/healthRecordService';
import { deleteChildHealthRecord } from '../../services/api/childHealthService';
import { deleteResidentMedicalRecord } from '../../services/api/residentMedicalRecordService';
import { getResidents } from '../../services/api/residentService';
import ConfirmModal from '../../components/common/ConfirmModal';
import Pagination from '../../components/common/Pagination';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateLabel, getLocalDateInputValue } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import StatusBanner from '../../components/common/StatusBanner';
import { getFriendlyError } from '../../utils/apiErrorMessages';

const TYPES = [
  { key: 'clinical', label: 'Clinical', fullLabel: 'Clinical Record' },
  { key: 'child', label: 'Child', fullLabel: 'Child Record' },
  { key: 'maternal', label: 'Maternal', fullLabel: 'Maternal Record' },
  { key: 'immunization', label: 'Immunization', fullLabel: 'Immunization Record' }
];
const PAGE_SIZES = [10, 25, 50];
const DEFAULTS = { search: '', type: '', from: '', to: '', sort: 'date', order: 'desc', page: 1, pageSize: 10 };
const SOURCE_TYPES = {
  health_records: 'clinical',
  patient_clinical_records: 'clinical',
  child_health_records: 'child',
  child_records: 'child',
  maternal_records: 'maternal',
  immunization_records: 'immunization'
};

function readUrlState(params) {
  const parsedPage = Number(params.get('page'));
  const parsedSize = Number(params.get('pageSize'));
  const sort = ['date', 'resident', 'type'].includes(params.get('sort')) ? params.get('sort') : DEFAULTS.sort;
  return {
    search: params.get('search') || '',
    type: TYPES.some(({ key }) => key === params.get('type')) ? params.get('type') : '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    sort,
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize: PAGE_SIZES.includes(parsedSize) ? parsedSize : 10
  };
}

const buildRecordPath = (item) => {
  const type = SOURCE_TYPES[item.source_table] || item.record_type || 'clinical';
  return `/health-records/${type}/${encodeURIComponent(`${item.source_table}-${item.record_id}`)}`;
};

const TypeBadge = ({ type, label }) => <span className={`health-record-type-badge health-record-type-${type || 'clinical'}`}>
  <span className="health-record-type-icon" aria-hidden="true">{({ clinical: '✚', child: '⌂', maternal: '♡', immunization: '✓' })[type] || '•'}</span>
  {label || TYPES.find((item) => item.key === type)?.fullLabel || 'Health Record'}
</span>;

const RecordResidentPicker = ({ type, onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  const loadResidents = useCallback(async (search) => {
    setLoading(true);
    setError('');
    try {
      const response = await getResidents({ search, page: 1, pageSize: 8, limit: 8 });
      if (!response?.success) throw new Error(response?.message || 'Unable to search residents.');
      setResidents(response.data?.items || []);
    } catch (loadError) {
      console.error('Unable to search residents.', loadError);
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    const timer = window.setTimeout(() => loadResidents(query.trim()), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadResidents, query]);
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll('input:not(:disabled), button:not(:disabled), a[href]') || []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return <div className="health-record-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="health-record-picker" role="dialog" aria-modal="true" aria-labelledby="health-record-picker-title">
      <div className="health-record-picker-heading">
        <div><span className="health-record-eyebrow">NEW {type.toUpperCase()} RECORD</span><h2 id="health-record-picker-title">Choose a resident</h2></div>
        <button type="button" className="health-record-icon-button" aria-label="Close resident selector" onClick={onClose}>×</button>
      </div>
      <label className="health-record-picker-search">
        <span aria-hidden="true">⌕</span>
        <input ref={inputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search residents by name" />
      </label>
      {error && <StatusBanner error={error} retry={() => loadResidents(query.trim())} compact />}
      {loading ? <div className="health-record-picker-loading" role="status">Searching residents…</div>
        : residents.length ? <ul className="health-record-picker-list">{residents.map((resident) => <li key={resident.resident_id}>
          <button type="button" onClick={() => onSelect(resident)}>
            <span className="health-record-picker-avatar">{`${resident.first_name?.charAt(0) || ''}${resident.last_name?.charAt(0) || ''}`.toUpperCase()}</span>
            <span><strong>{formatResidentName(resident)}</strong><small>{resident.household_no ? `Household ${resident.household_no}` : 'Resident'}</small></span>
          </button>
        </li>)}</ul>
          : <p className="health-record-picker-empty">No residents match this search.</p>}
    </section>
  </div>;
};

const HealthRecordsPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = useMemo(() => readUrlState(searchParams), [searchParams]);
  const [query, setQuery] = useState(urlState.search);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [typeCounts, setTypeCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [recordToDelete, setRecordToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');
  const [menuKey, setMenuKey] = useState('');
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newRecordType, setNewRecordType] = useState('');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const searchRef = useRef(null);
  const tableTopRef = useRef(null);

  const updateParams = useCallback((updates, resetPage = false) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === '' || value === null || value === undefined || (key === 'page' && value === 1) || (key === 'pageSize' && value === DEFAULTS.pageSize) || (key === 'sort' && value === DEFAULTS.sort) || (key === 'order' && value === DEFAULTS.order)) next.delete(key);
        else next.set(key, String(value));
      });
      if (resetPage) next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => { setQuery(urlState.search); }, [urlState.search]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query.trim() !== urlState.search) updateParams({ search: query.trim() }, true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, updateParams, urlState.search]);

  useEffect(() => {
    const onShortcut = (event) => {
      const target = event.target;
      const isEditable = typeof target?.matches === 'function' && target.matches('input, textarea, select, [contenteditable="true"]');
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  useEffect(() => {
    const message = location.state?.recordToast;
    if (!message) return undefined;
    setToast(message);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (urlState.from && urlState.to && urlState.from > urlState.to) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await listAllHealthRecords({
          page: urlState.page, pageSize: urlState.pageSize, search: urlState.search,
          type: urlState.type, from: urlState.from, to: urlState.to,
          sort: urlState.sort, order: urlState.order
        });
        if (!response?.success) throw new Error(response?.message || 'Unable to load health records.');
        if (!active) return;
        const data = response.data || {};
        setItems(data.items || []);
        setTotal(Number(data.total) || 0);
        setTypeCounts(data.typeCounts || {});
      } catch (fetchError) {
        if (active) {
          console.error('Unable to load health records.', fetchError);
          setError(fetchError);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [retry, urlState]);

  const invalidDateRange = Boolean(urlState.from && urlState.to && urlState.from > urlState.to);
  const totalPages = Math.ceil(total / urlState.pageSize);
  const first = total ? ((urlState.page - 1) * urlState.pageSize) + 1 : 0;
  const last = Math.min(urlState.page * urlState.pageSize, total);
  const isFiltered = Boolean(urlState.search || urlState.type || urlState.from || urlState.to);
  const activeFilters = [
    ['search', 'Search', urlState.search], ['type', 'Type', TYPES.find((type) => type.key === urlState.type)?.label],
    ['from', 'From', urlState.from && formatDateLabel(urlState.from)], ['to', 'To', urlState.to && formatDateLabel(urlState.to)]
  ].filter(([, , value]) => value);
  const from = (date) => updateParams({ from: date }, true);
  const to = (date) => updateParams({ to: date }, true);

  const clearFilters = () => {
    setQuery('');
    setSearchParams(new URLSearchParams());
  };
  const applyPreset = (preset) => {
    const today = getLocalDateInputValue();
    const date = new Date(`${today}T12:00:00`);
    const daysAgo = (days) => {
      const value = new Date(date);
      value.setDate(value.getDate() - days);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    };
    if (preset === 'Today') updateParams({ from: today, to: today }, true);
    if (preset === 'Last 7 days') updateParams({ from: daysAgo(6), to: today }, true);
    if (preset === 'Last 30 days') updateParams({ from: daysAgo(29), to: today }, true);
    if (preset === 'This month') updateParams({ from: `${today.slice(0, 7)}-01`, to: today }, true);
  };

  const setSort = (field) => {
    const order = urlState.sort === field && urlState.order === 'desc' ? 'asc' : 'desc';
    updateParams({ sort: field, order }, true);
  };
  const sortState = (field) => urlState.sort === field ? (urlState.order === 'asc' ? 'ascending' : 'descending') : 'none';
  const showRecord = (item) => navigate(buildRecordPath(item), { state: { from: `${location.pathname}${location.search}` } });

  const removeRecord = async () => {
    if (!recordToDelete) return;
    setDeleting(true);
    try {
      if (recordToDelete.source_table === 'health_records') await deleteHealthRecord(recordToDelete.record_id);
      else if (recordToDelete.source_table === 'child_health_records') await deleteChildHealthRecord(recordToDelete.record_id);
      else await deleteResidentMedicalRecord(recordToDelete.resident_id, recordToDelete.record_type, recordToDelete.record_id);
      setRecordToDelete(null);
      setToast('Record deleted.');
      setRetry((current) => current + 1);
    } catch (deleteError) {
      console.error('Unable to delete health record.', deleteError);
      setToast(getFriendlyError(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  const selectResident = (resident) => {
    navigate(`/residents/${resident.resident_id}/medical-records/${newRecordType}`);
    setNewRecordType('');
  };
  const rangeValue = (preset) => {
    const today = getLocalDateInputValue();
    if (preset === 'Today') return urlState.from === today && urlState.to === today;
    if (preset === 'This month') return urlState.from === `${today.slice(0, 7)}-01` && urlState.to === today;
    const days = preset === 'Last 7 days' ? 6 : 29;
    const start = new Date(`${today}T12:00:00`);
    start.setDate(start.getDate() - days);
    return urlState.from === `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}` && urlState.to === today;
  };

  return <main className="health-records-page">
    {toast && <div className="health-record-toast" role="status" aria-live="polite">{toast}</div>}
    <header className="health-records-page-header">
      <div className="health-records-title">
        <div><h1>Health records</h1><p>Browse clinical, child, maternal, and immunization records.</p></div>
      </div>
      <div className="health-record-header-actions">
        <span className="health-records-total" aria-live="polite">{total} {total === 1 ? 'record' : 'records'}</span>
        <div className="health-record-new-action">
        <button type="button" className="health-record-primary-button" aria-expanded={newMenuOpen} onClick={() => setNewMenuOpen((open) => !open)}>＋ New record <span aria-hidden="true"></span></button>
        {newMenuOpen && <div className="health-record-new-menu" role="menu" aria-label="Choose a new record type">
          {TYPES.map((type) => <button key={type.key} type="button" role="menuitem" onClick={() => { setNewMenuOpen(false); setNewRecordType(type.key); }}>{type.fullLabel}</button>)}
        </div>}
        </div>
      </div>
    </header>

    <section className={`health-record-toolbar ${showMobileFilters ? 'is-mobile-open' : ''}`} aria-label="Health record filters">
      <div className="health-record-toolbar-main">
        <label className="health-record-search">
          <span aria-hidden="true">⌕</span>
          <input ref={searchRef} type="search" aria-label="Search health records" placeholder="Search resident, type, notes, assessment" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); updateParams({ search: '' }, true); }}>×</button>}
          {!query && <kbd aria-hidden="true">/</kbd>}
        </label>
        <label className="health-record-filter-control">
          <span>Record type</span>
          <select aria-label="Record type" value={urlState.type} onChange={(event) => updateParams({ type: event.target.value }, true)}>
            <option value="">All types</option>{TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
          </select>
        </label>
        <div className="health-record-date-filter">
        {showMobileFilters && <button type="button" className="health-record-mobile-sheet-close" onClick={() => setShowMobileFilters(false)}>Close filters</button>}
          <span className="health-record-date-label">Date range</span>
          <div className="health-record-date-inputs">
            <label><span className="sr-only">From</span><input aria-label="From" type="date" value={urlState.from} max={urlState.to || undefined} onChange={(event) => from(event.target.value)} /></label>
            <span aria-hidden="true">–</span>
            <label><span className="sr-only">To</span><input aria-label="To" type="date" value={urlState.to} min={urlState.from || undefined} onChange={(event) => to(event.target.value)} /></label>
          </div>
          <div className="health-record-date-presets" aria-label="Quick date ranges">
            {['Today', 'Last 7 days', 'Last 30 days', 'This month'].map((preset) => <button type="button" key={preset} className={rangeValue(preset) ? 'active' : ''} aria-pressed={rangeValue(preset)} onClick={() => applyPreset(preset)}>{preset}</button>)}
            <button type="button" className={urlState.from || urlState.to ? 'active' : ''} aria-pressed={Boolean(urlState.from || urlState.to)} onClick={() => setShowMobileFilters(false)}>Custom</button>
          </div>
        </div>
        <button type="button" className="health-record-mobile-filter-toggle" aria-expanded={showMobileFilters} onClick={() => setShowMobileFilters((open) => !open)}>Filters</button>
      </div>
      {invalidDateRange && <p className="health-record-validation" role="alert">From date must be on or before To date.</p>}
    </section>

    <div className="health-record-quick-filters" role="tablist" aria-label="Filter by record type">
      <button type="button" role="tab" aria-selected={!urlState.type} className={!urlState.type ? 'active' : ''} onClick={() => updateParams({ type: '' }, true)}>All <span>{Object.values(typeCounts).reduce((sum, count) => sum + Number(count || 0), 0)}</span></button>
      {TYPES.map((type) => <button key={type.key} type="button" role="tab" aria-selected={urlState.type === type.key} className={urlState.type === type.key ? 'active' : ''} onClick={() => updateParams({ type: urlState.type === type.key ? '' : type.key }, true)}>{type.label} <span>{typeCounts[type.key] || 0}</span></button>)}
      <button type="button" className="health-record-mobile-filter-toggle" onClick={() => setShowMobileFilters(true)}>Date filters</button>
    </div>

    {activeFilters.length > 0 && <div className="health-record-active-filters" aria-label="Active filters">
      {activeFilters.map(([key, label, value]) => <button type="button" key={key} className="health-record-filter-chip" onClick={() => { if (key === 'search') setQuery(''); updateParams({ [key]: '' }, true); }}>{label}: {value}<span aria-hidden="true"> ×</span></button>)}
      <button type="button" className="health-record-clear-filters" onClick={clearFilters}>Clear all</button>
    </div>}

    <div ref={tableTopRef} className="health-record-results-count" aria-live="polite" aria-atomic="true">
      <span>{loading && items.length ? 'Updating results…' : `Showing ${first}-${last} of ${total} matching records`}</span>
      {loading && items.length > 0 && <span className="health-record-loading-indicator" aria-hidden="true" />}
      {loading && items.length > 0 && <span className="sr-only">Updating results</span>}
      {isFiltered && !loading && <span>{total} {total === 1 ? 'result' : 'results'}</span>}
    </div>
    {error && <StatusBanner error={error} retry={() => setRetry((current) => current + 1)} />}

    <section className="health-record-table-card" aria-label="Health records">
      <div className="health-record-table-wrap">
        <table className="health-records-table">
          <thead><tr>
            <th scope="col" aria-sort={sortState('resident')}><button type="button" onClick={() => setSort('resident')}>Resident <span aria-hidden="true">↕</span></button></th>
            <th scope="col" aria-sort={sortState('date')}><button type="button" onClick={() => setSort('date')}>Date <span aria-hidden="true">↕</span></button></th>
            <th scope="col" aria-sort={sortState('type')}><button type="button" onClick={() => setSort('type')}>Type <span aria-hidden="true">↕</span></button></th>
            <th scope="col">Summary</th><th scope="col">Recorded by</th><th scope="col">Actions</th>
          </tr></thead>
          <tbody>
            {loading && !items.length ? Array.from({ length: 7 }, (_, index) => <tr className="health-record-skeleton-row" key={`skeleton-${index}`} aria-hidden="true">{Array.from({ length: 6 }, (_, cell) => <td key={cell}><span /></td>)}</tr>)
              : items.map((item) => {
                const path = buildRecordPath(item);
                const residentName = formatResidentName(item) || 'Unknown resident';
                const identity = [item.age ?? calculateAge(item.birthdate), item.sex ? String(item.sex).replace(/^./, (letter) => letter.toUpperCase()) : null].filter(Boolean).join(' · ');
                const secondLine = identity || (item.household_no ? `Household ${item.household_no}` : 'Resident details unavailable');
                const rowKey = `${item.source_table}-${item.record_id}`;
                return <tr key={rowKey} className="health-record-row" tabIndex={0} onClick={(event) => { if (!event.target.closest('a, button, input, select')) showRecord(item); }} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showRecord(item); } }}>
                  <td><Link className="health-record-resident" to={path} state={{ from: `${location.pathname}${location.search}` }}>
                    <span className="health-record-avatar">{item.profile_photo && <img src={getProfilePhotoUrl(item.profile_photo)} alt="" onError={(event) => event.currentTarget.remove()} />}{`${item.first_name?.charAt(0) || ''}${item.last_name?.charAt(0) || ''}`.toUpperCase()}</span>
                    <span><strong>{residentName}</strong><small>{secondLine}</small></span>
                  </Link></td>
                  <td><time dateTime={String(item.record_date || '').slice(0, 10)}>{formatDateLabel(item.record_date) || 'Date not recorded'}</time></td>
                  <td><TypeBadge type={item.record_type} label={item.record_label} /></td>
                  <td><span className="health-record-summary" title={item.summary && item.summary !== '-' ? item.summary : undefined}>{item.summary && item.summary !== '-' ? item.summary : <span className="health-record-muted">Not recorded</span>}</span></td>
                  <td><span className="health-record-recorded-by">{item.recorded_by_name || 'Not recorded'}</span></td>
                  <td className="health-record-row-actions">
                    <Link to={path} state={{ from: `${location.pathname}${location.search}` }} className="health-record-view-button" aria-label={`View ${item.record_label || 'health record'} for ${residentName}`} title="View details">View</Link>
                    <div className="health-record-row-menu">
                      <button type="button" className="health-record-icon-button" aria-label={`More actions for ${residentName}`} aria-expanded={menuKey === rowKey} onClick={() => setMenuKey((current) => current === rowKey ? '' : rowKey)}>⋯</button>
                      {menuKey === rowKey && <div className="health-record-menu" role="menu">
                        <Link to={path} state={{ from: `${location.pathname}${location.search}` }} role="menuitem">View details</Link>
                        <button type="button" role="menuitem" onClick={() => { setRecordToDelete(item); setMenuKey(''); }}>Delete record</button>
                      </div>}
                    </div>
                  </td>
                </tr>;
              })}
            {!loading && !error && !items.length && <tr><td colSpan="6"><div className="health-record-empty-state">
              <span className="health-record-empty-icon" aria-hidden="true">▤</span>
              <strong>{isFiltered ? 'No records match these filters' : 'No health records yet'}</strong>
              <p>{isFiltered ? 'Try adjusting your search or filters.' : 'Create a record to start building this resident health history.'}</p>
              {isFiltered ? <button type="button" className="health-record-secondary-button" onClick={clearFilters}>Clear filters</button> : <button type="button" className="health-record-primary-button" onClick={() => setNewMenuOpen(true)}>New record</button>}
            </div></td></tr>}
            {!loading && error && !items.length && <tr><td colSpan="6"><div className="health-record-empty-state"><strong>Health records are unavailable</strong><p>Try again to reload the record list.</p><button type="button" className="health-record-secondary-button" onClick={() => setRetry((current) => current + 1)}>Try again</button></div></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="health-record-mobile-list">
        {loading && !items.length ? Array.from({ length: 5 }, (_, index) => <div className="health-record-mobile-skeleton" key={`mobile-skeleton-${index}`} aria-hidden="true"><span /><span /></div>)
          : items.map((item) => {
            const path = buildRecordPath(item);
            const residentName = formatResidentName(item) || 'Unknown resident';
            const rowKey = `${item.source_table}-${item.record_id}`;
            return <article className="health-record-mobile-card" key={`mobile-${rowKey}`}>
              <Link to={path} state={{ from: `${location.pathname}${location.search}` }} className="health-record-mobile-identity">
                <span className="health-record-avatar">{item.profile_photo && <img src={getProfilePhotoUrl(item.profile_photo)} alt="" onError={(event) => event.currentTarget.remove()} />}{`${item.first_name?.charAt(0) || ''}${item.last_name?.charAt(0) || ''}`.toUpperCase()}</span>
                <span><strong>{residentName}</strong><small>{item.age ?? calculateAge(item.birthdate)} yrs{item.sex ? ` · ${String(item.sex).replace(/^./, (letter) => letter.toUpperCase())}` : ''}</small></span>
              </Link>
              <div className="health-record-mobile-meta"><TypeBadge type={item.record_type} label={item.record_label} /><time dateTime={String(item.record_date || '').slice(0, 10)}>{formatDateLabel(item.record_date) || 'Date not recorded'}</time></div>
              <p className="health-record-mobile-summary" title={item.summary && item.summary !== '-' ? item.summary : undefined}>{item.summary && item.summary !== '-' ? item.summary : 'Not recorded'}</p>
              <div className="health-record-mobile-actions"><Link to={path} state={{ from: `${location.pathname}${location.search}` }} className="health-record-view-button">View record</Link><div className="health-record-row-menu">
                <button type="button" className="health-record-icon-button" aria-label={`More actions for ${residentName}`} aria-expanded={menuKey === rowKey} onClick={() => setMenuKey((current) => current === rowKey ? '' : rowKey)}>⋯</button>
                {menuKey === rowKey && <div className="health-record-menu" role="menu"><Link to={path} state={{ from: `${location.pathname}${location.search}` }} role="menuitem">View details</Link><button type="button" role="menuitem" onClick={() => { setRecordToDelete(item); setMenuKey(''); }}>Delete record</button></div>}
              </div></div>
            </article>;
          })}
        {!loading && !error && !items.length && <div className="health-record-empty-state"><strong>{isFiltered ? 'No records match these filters' : 'No health records yet'}</strong><p>{isFiltered ? 'Try adjusting your search or filters.' : 'Create a record to start building this resident health history.'}</p>{isFiltered ? <button type="button" className="health-record-secondary-button" onClick={clearFilters}>Clear filters</button> : <button type="button" className="health-record-primary-button" onClick={() => setNewMenuOpen(true)}>New record</button>}</div>}
      </div>
      <footer className="health-record-table-footer">
        <Pagination currentPage={urlState.page} totalPages={totalPages} first={first} last={last} total={total} itemLabel="records" onPageChange={(page) => { updateParams({ page }, false); tableTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} pageSize={urlState.pageSize} onPageSizeChange={(pageSize) => updateParams({ pageSize, page: '' }, false)} />
      </footer>
    </section>

    <ConfirmModal open={Boolean(recordToDelete)} title="Delete health record?" message={recordToDelete ? `Delete ${recordToDelete.record_label || 'health record'} for ${formatResidentName(recordToDelete)} dated ${formatDateLabel(recordToDelete.record_date) || 'Date not recorded'}? This cannot be undone.` : ''} busy={deleting} onCancel={() => setRecordToDelete(null)} onConfirm={removeRecord} />
    {newRecordType && <RecordResidentPicker type={newRecordType} onClose={() => setNewRecordType('')} onSelect={selectResident} />}
  </main>;
};

export default HealthRecordsPage;
