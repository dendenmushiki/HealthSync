import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Baby,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ClipboardList,
  CircleAlert,
  Eye,
  FileText,
  HeartPulse,
  Plus,
  RotateCcw,
  Search,
  SquarePen,
  Stethoscope,
  Syringe,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { listAllHealthRecords } from '../../services/api/healthRecordService';
import Pagination from '../../components/common/Pagination';
import PageBanner from '../../components/common/PageBanner';
import StatCard from '../../components/residents/StatCard';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateOnly, getDateInputValueInTimeZone } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import { getFriendlyError } from '../../utils/apiErrorMessages';
import ResidentPickerDialog from './ResidentPickerDialog';
import './HealthRecordsPage.css';

const TYPES = [
  { key: 'clinical', label: 'Clinical', fullLabel: 'Clinical Record', icon: Stethoscope },
  { key: 'child', label: 'Child', fullLabel: 'Child Record', icon: Baby },
  { key: 'maternal', label: 'Maternal', fullLabel: 'Maternal Record', icon: HeartPulse },
  { key: 'immunization', label: 'Immunization', fullLabel: 'Immunization Record', icon: Syringe }
];
const PAGE_SIZES = [10, 25, 50];
const DEFAULTS = { search: '', type: '', from: '', to: '', sort: 'date', order: 'desc', page: 1, pageSize: 10 };
const MOBILE_LAYOUT_QUERY = '(max-width: 767px)';
const TYPE_BY_KEY = Object.fromEntries(TYPES.map((type) => [type.key, type]));
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

const buildEditPath = (item) => {
  if (item.source_table === 'health_records') return `/residents/${item.resident_id}/clinical-records-legacy?recordId=${item.record_id}`;
  if (item.source_table === 'child_health_records') return `/residents/${item.resident_id}/child-health-records-legacy?recordId=${item.record_id}`;
  const type = SOURCE_TYPES[item.source_table] || item.record_type || 'clinical';
  return `/residents/${item.resident_id}/medical-records/${type}?recordId=${item.record_id}`;
};

function getResidentDisplayName(item) {
  const last = String(item.last_name || '').trim();
  const first = String(item.first_name || '').trim();
  const middle = String(item.middle_name || '').trim();
  const givenNames = [first, middle ? `${middle.charAt(0)}.` : ''].filter(Boolean).join(' ');
  const name = [last, givenNames].filter(Boolean).join(', ');
  return name || formatResidentName(item) || 'Not provided';
}

function formatGender(value) {
  const text = String(value || '').trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function getRecordSummary(value) {
  const summary = String(value || '').trim();
  return summary && summary !== '-' ? summary : '';
}

const TypeBadge = ({ type }) => {
  const typeInfo = TYPE_BY_KEY[type];
  const Icon = typeInfo?.icon || FileText;
  return <span className={`health-record-type-badge ${typeInfo ? `health-record-type-${type}` : 'health-record-type-unknown'}`}>
    <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
    {typeInfo?.label || String(type || 'Unknown')}
  </span>;
};

function RecordActions({ item, residentName, returnTo }) {
  const recordPath = buildRecordPath(item);

  return <div className="health-record-row-actions" onClick={(event) => event.stopPropagation()}>
    <Link to={recordPath} state={{ from: returnTo }} className="health-record-action-button" aria-label={`View ${residentName}`} title="View record">
      <Eye size={17} strokeWidth={1.8} aria-hidden="true" />
    </Link>
    <Link to={buildEditPath(item)} state={{ from: returnTo }} className="health-record-action-button" aria-label={`Edit ${residentName}`} title="Edit record">
      <SquarePen size={17} strokeWidth={1.8} aria-hidden="true" />
    </Link>
  </div>;
}

function DateRangeControl({ from, to, onApply, onPreset }) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const today = getDateInputValueInTimeZone('Asia/Manila');

  const presetMatches = (preset) => {
    if (!from || !to) return false;
    if (preset === 'Today') return from === today && to === today;
    if (preset === 'This month') return from === `${today.slice(0, 7)}-01` && to === today;
    const days = preset === 'Last 7 days' ? 6 : 29;
    const start = new Date(`${today}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - days);
    const expectedFrom = start.toISOString().slice(0, 10);
    return from === expectedFrom && to === today;
  };

  const selectedPreset = ['Today', 'Last 7 days', 'Last 30 days', 'This month'].find(presetMatches);
  const displayRange = selectedPreset || (
    from && to
      ? `${formatDateOnly(from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${formatDateOnly(to, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : from
        ? `From ${formatDateOnly(from, { month: 'short', day: 'numeric', year: 'numeric' })}`
        : to
          ? `Through ${formatDateOnly(to, { month: 'short', day: 'numeric', year: 'numeric' })}`
          : 'All dates'
  );
  const invalidRange = Boolean(draftFrom && draftTo && draftFrom > draftTo);
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    const restoreFocus = () => buttonRef.current?.focus();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restoreFocus);
    else window.setTimeout(restoreFocus, 0);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setDraftFrom(from);
    setDraftTo(to);
    setCustomOpen(Boolean(from || to) && !selectedPreset);
    rootRef.current?.querySelector('.health-record-date-presets button')?.focus();
    const handleOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = rootRef.current?.querySelector('.health-record-date-popover');
      const focusable = Array.from(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || [])
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeAndRestoreFocus, from, open, selectedPreset, to]);

  const choosePreset = (preset) => {
    onPreset(preset);
    closeAndRestoreFocus();
  };

  return <div className={`health-record-date-control${open ? ' is-open' : ''}`} ref={rootRef}>
    <button ref={buttonRef} type="button" className="health-record-date-trigger" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen((value) => !value)}>
      <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
      <span><small>Date range</small><strong>{displayRange}</strong></span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <>
      <button type="button" className="health-record-date-backdrop" aria-label="Close date range filter" onClick={closeAndRestoreFocus} />
      <div className="health-record-date-popover" role="dialog" aria-modal="true" aria-labelledby="health-record-date-title">
        <header className="health-record-date-sheet-header">
          <h2 id="health-record-date-title">Date range</h2>
          <button type="button" aria-label="Close date range filter" onClick={closeAndRestoreFocus}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="health-record-date-sheet-body">
          <div className="health-record-date-presets" aria-label="Date range presets">
            {['Today', 'Last 7 days', 'Last 30 days', 'This month'].map((preset) => <button key={preset} type="button"
              className={presetMatches(preset) ? 'active' : ''} aria-pressed={presetMatches(preset)} onClick={() => choosePreset(preset)}>{preset}</button>)}
            <button type="button" className={customOpen ? 'active' : ''} aria-pressed={customOpen} onClick={() => setCustomOpen(true)}>Custom</button>
          </div>
          {customOpen && <div className="health-record-custom-range">
            <label>From<input type="date" value={draftFrom} aria-invalid={invalidRange} onChange={(event) => setDraftFrom(event.target.value)} /></label>
            <label>To<input type="date" value={draftTo} aria-invalid={invalidRange} onChange={(event) => setDraftTo(event.target.value)} /></label>
            {invalidRange && <p className="health-record-validation" role="alert">From date must be on or before To date.</p>}
            <div className="health-record-custom-actions">
              <button type="button" className="health-record-date-clear" onClick={() => { onApply('', ''); closeAndRestoreFocus(); }}>Clear</button>
              <button type="button" className="health-record-primary-button" disabled={invalidRange} onClick={() => { onApply(draftFrom, draftTo); closeAndRestoreFocus(); }}>Apply</button>
            </div>
          </div>}
        </div>
      </div>
    </>}
  </div>;
}

const HealthRecordsPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = useMemo(() => readUrlState(searchParams), [searchParams]);
  const [query, setQuery] = useState(urlState.search);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [typeCounts, setTypeCounts] = useState({});
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [toast, setToast] = useState('');
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newRecordType, setNewRecordType] = useState('');
  const [mobileLayout, setMobileLayout] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_LAYOUT_QUERY).matches
      : null
  ));
  const searchRef = useRef(null);
  const tableTopRef = useRef(null);
  const tabRefs = useRef([]);
  const newRecordButtonRef = useRef(null);
  const newRecordMenuRef = useRef(null);

  const updateParams = useCallback((updates, resetPage = false) => {
    const hasPendingSearch = !Object.prototype.hasOwnProperty.call(updates, 'search') && query.trim() !== urlState.search;
    const effectiveUpdates = hasPendingSearch ? { search: query.trim(), ...updates } : updates;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(effectiveUpdates).forEach(([key, value]) => {
        if (value === '' || value === null || value === undefined || (key === 'page' && value === 1) || (key === 'pageSize' && value === DEFAULTS.pageSize) || (key === 'sort' && value === DEFAULTS.sort) || (key === 'order' && value === DEFAULTS.order)) next.delete(key);
        else next.set(key, String(value));
      });
      if (resetPage || hasPendingSearch) next.delete('page');
      return next;
    });
  }, [query, setSearchParams, urlState.search]);

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
    if (newMenuOpen) newRecordMenuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [newMenuOpen]);
  useEffect(() => {
    if (!newMenuOpen) return undefined;
    const handleOutsidePointer = (event) => {
      if (newRecordMenuRef.current?.contains(event.target) || newRecordButtonRef.current?.contains(event.target)) return;
      setNewMenuOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setNewMenuOpen(false);
      newRecordButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [newMenuOpen]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const handleChange = (event) => setMobileLayout(event.matches);
    setMobileLayout(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

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
        setStats(data.stats || null);
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
    ['dateRange', 'Date', urlState.from || urlState.to
      ? `${urlState.from ? formatDateOnly(urlState.from, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Any date'} – ${urlState.to ? formatDateOnly(urlState.to, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Any date'}`
      : '']
  ].filter(([, , value]) => value);

  const clearFilters = () => {
    setQuery('');
    setSearchParams(new URLSearchParams());
  };
  const applyPreset = (preset) => {
    const today = getDateInputValueInTimeZone('Asia/Manila');
    const date = new Date(`${today}T00:00:00.000Z`);
    const daysAgo = (days) => {
      const value = new Date(date);
      value.setUTCDate(value.getUTCDate() - days);
      return value.toISOString().slice(0, 10);
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

  const selectResident = (resident) => {
    navigate(`/residents/${resident.resident_id}/medical-records/${newRecordType}`);
    setNewRecordType('');
  };
  const closeResidentPicker = useCallback(() => {
    setNewRecordType('');
    const restoreFocus = () => newRecordButtonRef.current?.focus();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(restoreFocus);
    else window.setTimeout(restoreFocus, 0);
  }, []);

  const allCount = Object.values(typeCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const visibleTypes = stats?.availableTypes
    ? TYPES.filter((type) => stats.availableTypes.includes(type.key) || urlState.type === type.key)
    : TYPES;
  const tabs = [{ key: '', label: 'All', icon: ClipboardList }, ...visibleTypes];
  const handleTabKeyDown = (event, index) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    tabRefs.current[nextIndex]?.focus();
    updateParams({ type: tabs[nextIndex].key }, true);
  };
  const returnTo = `${location.pathname}${location.search}`;
  const openNewRecordMenu = () => setNewMenuOpen((open) => !open);
  const handleNewMenuKeyDown = (event) => {
    if (event.key === 'Escape') {
      setNewMenuOpen(false);
      newRecordButtonRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const options = Array.from(event.currentTarget.querySelectorAll('[role="menuitem"]'));
    const index = options.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown'
      ? (index + 1 + options.length) % options.length
      : (index - 1 + options.length) % options.length;
    options[next]?.focus();
  };

  const layoutClass = mobileLayout === true ? 'is-mobile-layout' : mobileLayout === false ? 'is-table-layout' : '';
  return <main className={`health-records-page ${layoutClass}`}>
    {toast && <div className="health-record-toast" role="status" aria-live="polite">{toast}</div>}
    <nav className="health-record-breadcrumb" aria-label="Breadcrumb">
      <Link to="/dashboard">Home</Link><span aria-hidden="true">/</span><span aria-current="page">Health Records</span>
    </nav>
    <PageBanner
      className="health-records-banner"
      icon={ClipboardList}
      eyebrow="HEALTH RECORDS"
      title="Health Records"
      subtitle="Browse clinical, child, maternal, and immunization records."
      actions={<div className="health-record-new-action">
        <button ref={newRecordButtonRef} type="button" className="health-record-primary-button" aria-haspopup="menu" aria-expanded={newMenuOpen}
          aria-controls="health-record-new-menu" onClick={openNewRecordMenu}><Plus size={17} strokeWidth={1.9} aria-hidden="true" />New record</button>
        {newMenuOpen && <div ref={newRecordMenuRef} id="health-record-new-menu" className="health-record-new-menu" role="menu" aria-label="Choose a new record type" onKeyDown={handleNewMenuKeyDown}>
          {TYPES.map(({ key, fullLabel, icon: Icon }) => <button key={key} type="button" role="menuitem" onClick={() => { setNewMenuOpen(false); setNewRecordType(key); }}>
            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />{fullLabel}
          </button>)}
        </div>}
      </div>}
    />

    <section className={`health-record-kpi-grid ${stats === null ? 'is-loading' : ''}`} aria-label="Health record statistics" aria-busy={stats === null}>
      {stats === null
        ? [
          ['Total Records', ClipboardList],
          ['Added This Month', CalendarPlus],
          ['Residents With Records', UsersRound],
          ['Added This Week', CalendarDays],
        ].map(([label, Icon]) => <div className="health-record-kpi-skeleton" key={label} aria-hidden="true">
          <span className="health-record-kpi-skeleton-icon"><Icon size={18} aria-hidden="true" /></span>
          <span className="health-record-kpi-skeleton-copy"><i /><small>{label}</small></span>
        </div>)
        : <>
          <StatCard icon={ClipboardList} label="Total Records" value={stats.totalRecords ?? 0} animateOnMount />
          <StatCard icon={CalendarPlus} label="Added This Month" value={stats.addedThisMonth ?? 0} animateOnMount />
          <StatCard icon={UsersRound} label="Residents With Records" value={stats.residentsWithRecords ?? 0} animateOnMount />
          <StatCard icon={CalendarDays} label="Added This Week" value={stats.addedThisWeek ?? 0} animateOnMount />
        </>}
    </section>

    <section className="health-record-filter-card" aria-label="Health record filters">
      <div className="health-record-filter-controls">
        <label className="health-record-search">
          <Search size={17} strokeWidth={1.8} aria-hidden="true" />
          <input ref={searchRef} type="search" aria-label="Search health records" placeholder="Search resident, type, notes, assessment"
            value={query} onChange={(event) => setQuery(event.target.value)} />
          {query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); updateParams({ search: '' }, true); }}><X size={16} aria-hidden="true" /></button> : <kbd aria-hidden="true">/</kbd>}
        </label>
        <DateRangeControl from={urlState.from} to={urlState.to}
          onApply={(startDate, endDate) => updateParams({ from: startDate, to: endDate }, true)}
          onPreset={applyPreset} />
        {isFiltered && <button type="button" className="health-record-clear-filters" onClick={clearFilters}><RotateCcw size={15} aria-hidden="true" />Clear filters</button>}
      </div>
      {invalidDateRange && <p className="health-record-validation" role="alert">From date must be on or before To date.</p>}
      {activeFilters.length > 0 && <div className="health-record-active-filters" aria-label="Active filters">
        {activeFilters.map(([key, label, value]) => <span className="health-record-filter-chip" key={key}>
          <span><strong>{label}:</strong> {value}</span>
          <button type="button" aria-label={`Remove ${label} filter`} onClick={() => {
            if (key === 'search') setQuery('');
            if (key === 'type') updateParams({ type: '' }, true);
            else if (key === 'search') updateParams({ search: '' }, true);
            else updateParams({ from: '', to: '' }, true);
          }}><X size={14} aria-hidden="true" /></button>
        </span>)}
      </div>}
      <div className="health-record-quick-filters" role="tablist" aria-label="Filter by record type">
        {tabs.map(({ key, label, icon: Icon }, index) => {
          const selected = urlState.type === key;
          const count = key ? Number(typeCounts[key] || 0) : allCount;
          return <button key={key || 'all'} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab"
            aria-selected={selected} aria-controls="health-record-results" tabIndex={selected ? 0 : -1}
            className={`health-record-type-tab ${selected ? 'active' : ''} ${key ? `health-record-type-${key}` : ''}`}
            onClick={() => updateParams({ type: key }, true)} onKeyDown={(event) => handleTabKeyDown(event, index)}>
            <Icon size={16} strokeWidth={1.8} aria-hidden="true" />{label}<span>{count.toLocaleString()}</span>
          </button>;
        })}
      </div>
    </section>

    <section ref={tableTopRef} id="health-record-results" className="health-record-table-card" aria-label="Health records" aria-busy={loading}>
      <header className="health-record-table-card-header">
        <div><h2>Health records</h2><p>{loading && !stats ? 'Loading health records' : `Showing ${first.toLocaleString()}-${last.toLocaleString()} of ${total.toLocaleString()} matching records`}</p></div>
        <span className="health-record-count-chip">{total.toLocaleString()} {total === 1 ? 'record' : 'records'}</span>
      </header>
      {error ? <div className="health-record-state" role="alert">
        <span className="health-record-state-icon is-error"><CircleAlert size={22} strokeWidth={1.8} aria-hidden="true" /></span>
        <h3>Unable to load health records</h3><p>{getFriendlyError(error)}</p>
        <button type="button" className="health-record-secondary-button" onClick={() => setRetry((current) => current + 1)}>Retry</button>
      </div> : <>
        {mobileLayout !== true && <div className="health-record-table-wrap">
          <table className="health-records-table">
            <thead><tr>
              {['resident', 'date', 'type'].map((field) => {
                const label = field.charAt(0).toUpperCase() + field.slice(1);
                const direction = sortState(field);
                const SortIcon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown;
                return <th key={field} scope="col" aria-sort={direction}><button type="button" onClick={() => setSort(field)}>{label}<SortIcon size={14} strokeWidth={1.8} aria-hidden="true" /></button></th>;
              })}
              <th className="health-record-hide-tablet" scope="col">Summary</th>
              <th className="health-record-hide-tablet" scope="col">Recorded By</th>
              <th className="health-record-hide-tablet" scope="col">Status</th>
              <th className="health-record-hide-tablet" scope="col">Last updated</th>
              <th scope="col">Actions</th>
            </tr></thead>
            <tbody>
              {loading && !items.length ? Array.from({ length: 7 }, (_, index) => <tr className="health-record-skeleton-row" key={`skeleton-${index}`} aria-hidden="true">{Array.from({ length: 8 }, (_, cell) => <td key={cell}><span /></td>)}</tr>)
                : items.map((item) => {
                  const residentName = getResidentDisplayName(item);
                  const age = item.age ?? calculateAge(item.birthdate);
                  const gender = formatGender(item.sex);
                  const demographics = [age !== null && age !== undefined ? `${age} yrs` : '', gender ? `Gender: ${gender}` : ''].filter(Boolean).join(' · ') || 'Not provided';
                  const summary = getRecordSummary(item.summary);
                  return <tr key={`${item.source_table}-${item.record_id}`} className="health-record-row" tabIndex={0}
                    aria-label={`View ${residentName}'s ${TYPE_BY_KEY[item.record_type]?.label || 'health'} record`}
                    onClick={(event) => { if (!event.target.closest('a, button, input, select')) showRecord(item); }}
                    onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showRecord(item); } }}>
                    <td>
                      <Link className="health-record-resident" to={buildRecordPath(item)} state={{ from: returnTo }} title={residentName}>
                        <span className="health-record-avatar">{item.profile_photo && <img src={getProfilePhotoUrl(item.profile_photo)} alt="" onError={(event) => event.currentTarget.remove()} />}{`${item.first_name?.charAt(0) || ''}${item.last_name?.charAt(0) || ''}`.toUpperCase()}</span>
                        <span><strong>{residentName}</strong><small>{demographics}</small>
                          <span className="health-record-table-hidden-details"><span><b>Summary</b>{summary || <i>No summary</i>}</span><span><b>Recorded by</b>{item.recorded_by_name || <i>Not provided</i>}</span></span>
                        </span>
                      </Link>
                    </td>
                    <td><span className="health-record-date-value"><CalendarDays size={14} strokeWidth={1.8} aria-hidden="true" /><time dateTime={String(item.record_date || '').slice(0, 10)}>{formatDateOnly(item.record_date, { month: 'short', day: 'numeric', year: 'numeric' }) || <i>Not provided</i>}</time></span></td>
                    <td><TypeBadge type={item.record_type} />{(item.offline === true || item.sync_status === 'PENDING') && <span className="healthsync-not-synced-badge">Not synced</span>}</td>
                    <td className="health-record-hide-tablet"><span className="health-record-summary" title={summary || undefined}>{summary || <i>No summary</i>}</span></td>
                    <td className="health-record-hide-tablet"><span className="health-record-recorded-by"><UserRound size={15} strokeWidth={1.8} aria-hidden="true" />{item.recorded_by_name || <i>Not provided</i>}</span></td>
                    <td className="health-record-hide-tablet"><span className="health-record-recorded-by">{item.status || <i>Not provided</i>}</span></td>
                    <td className="health-record-hide-tablet"><time dateTime={String(item.updated_at || item.created_at || '').slice(0, 10)}>{formatDateOnly(item.updated_at || item.created_at, { month: 'short', day: 'numeric', year: 'numeric' }) || <i>Not provided</i>}</time></td>
                    <td><RecordActions item={item} residentName={residentName} returnTo={returnTo} /></td>
                  </tr>;
                })}
              {!loading && !items.length && <tr><td colSpan="8"><div className="health-record-empty-state">
                <span className="health-record-empty-icon"><ClipboardList size={23} strokeWidth={1.8} aria-hidden="true" /></span>
                <strong>{isFiltered ? 'No health records found' : 'No health records found'}</strong>
                <p>{isFiltered ? 'Try changing your search or date range.' : 'There are no health records to display yet.'}</p>
                {isFiltered ? <button type="button" className="health-record-secondary-button" onClick={clearFilters}>Clear filters</button> : <button type="button" className="health-record-primary-button" onClick={() => setNewMenuOpen(true)}><Plus size={16} aria-hidden="true" />New record</button>}
              </div></td></tr>}
            </tbody>
          </table>
        </div>}
        {mobileLayout !== false && <div className="health-record-mobile-list">
          {loading && !items.length ? Array.from({ length: 5 }, (_, index) => <div className="health-record-mobile-skeleton" key={`mobile-skeleton-${index}`} aria-hidden="true"><span /><span /></div>)
            : items.map((item) => {
              const residentName = getResidentDisplayName(item);
              const age = item.age ?? calculateAge(item.birthdate);
              const gender = formatGender(item.sex);
              const demographics = [age !== null && age !== undefined ? `${age} yrs` : '', gender ? `Gender: ${gender}` : ''].filter(Boolean).join(' · ') || 'Not provided';
              const summary = getRecordSummary(item.summary);
              return <article className="health-record-mobile-card" key={`mobile-${item.source_table}-${item.record_id}`}>
                <Link to={buildRecordPath(item)} state={{ from: returnTo }} className="health-record-mobile-identity" title={residentName}>
                  <span className="health-record-avatar">{item.profile_photo && <img src={getProfilePhotoUrl(item.profile_photo)} alt="" onError={(event) => event.currentTarget.remove()} />}{`${item.first_name?.charAt(0) || ''}${item.last_name?.charAt(0) || ''}`.toUpperCase()}</span>
                  <span><strong>{residentName}</strong><small>{demographics}</small></span>
                </Link>
                <div className="health-record-mobile-meta"><TypeBadge type={item.record_type} />
                  <span className="health-record-date-value"><CalendarDays size={14} aria-hidden="true" /><time dateTime={String(item.record_date || '').slice(0, 10)}>{formatDateOnly(item.record_date, { month: 'short', day: 'numeric', year: 'numeric' }) || <i>Not provided</i>}</time></span>
                </div>
                <p className={`health-record-mobile-summary ${summary ? '' : 'is-empty'}`} title={summary || undefined}>{summary || 'No summary'}</p>
                <span className="health-record-mobile-recorded-by"><UserRound size={15} strokeWidth={1.8} aria-hidden="true" />{item.recorded_by_name || <i>Not provided</i>}</span>
                <span className="health-record-mobile-recorded-by">Status: {item.status || 'Not provided'}</span>
                <span className="health-record-mobile-recorded-by">Last updated: {formatDateOnly(item.updated_at || item.created_at, { month: 'short', day: 'numeric', year: 'numeric' }) || 'Not provided'}</span>
                <RecordActions item={item} residentName={residentName} returnTo={returnTo} />
              </article>;
            })}
          {!loading && !error && !items.length && <div className="health-record-empty-state">
            <span className="health-record-empty-icon"><ClipboardList size={23} strokeWidth={1.8} aria-hidden="true" /></span>
            <strong>No health records found</strong>
            <p>{isFiltered ? 'Try changing your search or date range.' : 'There are no health records to display yet.'}</p>
            {isFiltered ? <button type="button" className="health-record-secondary-button" onClick={clearFilters}>Clear filters</button> : <button type="button" className="health-record-primary-button" onClick={() => setNewMenuOpen(true)}><Plus size={16} aria-hidden="true" />New record</button>}
          </div>}
        </div>}
      </>}
      {!error && total > 0 && <footer className="health-record-table-footer">
        <Pagination currentPage={urlState.page} totalPages={totalPages} first={first} last={last} total={total} itemLabel="records"
          onPageChange={(page) => { updateParams({ page }, false); tableTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
          pageSize={urlState.pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(pageSize) => updateParams({ pageSize, page: '' }, true)}
          compactButtons formatCounts />
      </footer>}
    </section>

    {newRecordType && <ResidentPickerDialog key={newRecordType} typeInfo={TYPE_BY_KEY[newRecordType]} onClose={closeResidentPicker} onSelect={selectResident} />}
  </main>;
};

export default HealthRecordsPage;
