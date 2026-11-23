import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Baby, BellRing, CalendarDays,
  CalendarPlus, ChevronDown, ClipboardList, Download, Eye, HeartPulse, Info,
  Loader2, Plus, RotateCcw, Scale, Search, UserRound, X,
} from 'lucide-react';
import PageBanner from '../../components/common/PageBanner';
import StatCard from '../../components/residents/StatCard';
import Pagination from '../../components/common/Pagination';
import ClassificationBadge from '../../components/nutrition/ClassificationBadge';
import ResultPanel from '../../components/nutrition/ResultPanel';
import TrendChart from '../../components/nutrition/TrendChart';
import { listNutritionRecords, getNutritionRecord, exportNutritionRecords } from '../../services/api/nutritionRecordsService';
import { formatDateOnly, getDateInputValueInTimeZone } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import './NutritionRecordsPage.css';

const PAGE_SIZES = [10, 25, 50];
const nameFor = (row) => [row.first_name, row.middle_name, row.last_name, row.suffix].filter(Boolean).join(' ').trim();
const typeKey = (type) => type === 'Operation Timbang' ? 'operation' : type === 'Adolescent BMI' ? 'adolescent' : type === 'Adult BMI' ? 'adult' : 'unknown';
const formatAge = (row) => {
  if (!row.birthdate || !row.record_date) return 'Age unknown';
  const birth = new Date(`${String(row.birthdate).slice(0, 10)}T00:00:00`);
  const record = new Date(`${String(row.record_date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(record.getTime()) || record < birth) return 'Age unknown';
  let months = (record.getFullYear() - birth.getFullYear()) * 12 + record.getMonth() - birth.getMonth();
  if (record.getDate() < birth.getDate()) months -= 1;
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  return years < 1 ? `${months} mos` : `${years} yr${years === 1 ? '' : 's'}${remaining ? ` ${remaining} mos` : ''}`;
};
const formatGender = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '';
};

function readUrlState(params) {
  const page = Number(params.get('page'));
  const pageSize = Number(params.get('pageSize'));
  const sort = ['date', 'name', 'status'].includes(params.get('sort')) ? params.get('sort') : 'date';
  return {
    search: params.get('search') || '',
    type: ['All', 'Operation Timbang', 'Adolescent BMI', 'Adult BMI'].includes(params.get('type')) ? params.get('type') : 'All',
    status: params.get('status') || '',
    sort,
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 10,
    latestOnly: params.get('latestOnly') === 'true',
    from: params.get('from') || '',
    to: params.get('to') || '',
  };
}

function RecordTypeBadge({ type }) {
  const map = {
    'Operation Timbang': ['operation', Scale],
    'Adolescent BMI': ['adolescent', Activity],
    'Adult BMI': ['adult', UserRound],
  };
  const [tone, Icon] = map[type] || ['unknown', ClipboardList];
  return <span className={`nutrition-type-badge nutrition-type-badge--${tone}`}><Icon size={14} strokeWidth={1.8} aria-hidden="true" />{type || 'Unknown'}</span>;
}

function IndicatorPopover({ indicators, status }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!indicators?.length) return <ClassificationBadge status={status} />;
  return <div className="nutrition-indicator-popover" ref={rootRef}>
    <button type="button" className="nutrition-status-trigger" aria-expanded={open} aria-label={`View indicators for ${status}`} onClick={() => setOpen((value) => !value)}>
      <ClassificationBadge status={status} />
      <span className="nutrition-indicator-count">+{indicators.length}</span>
    </button>
    {open && <div role="tooltip" className="nutrition-indicator-menu">
      {indicators.map((indicator) => <div key={indicator.code}><span>{indicator.code === 'HAZ' ? 'Height-for-age' : indicator.code === 'WAZ' ? 'Weight-for-age' : 'Weight-for-height'}</span><strong>{indicator.status}</strong></div>)}
    </div>}
  </div>;
}

function DateRangeControl({ from, to, onApply }) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const rootRef = useRef(null);
  const today = getDateInputValueInTimeZone('Asia/Manila');
  const presetMatches = (preset) => {
    if (!from || !to) return false;
    if (preset === 'Today') return from === today && to === today;
    if (preset === 'This month') return from === `${today.slice(0, 7)}-01` && to === today;
    const days = preset === 'Last 7 days' ? 6 : 29;
    const start = new Date(`${today}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - days);
    return from === start.toISOString().slice(0, 10) && to === today;
  };
  const selectedPreset = ['Today', 'Last 7 days', 'Last 30 days', 'This month'].find(presetMatches);
  const label = selectedPreset || (from && to
    ? `${formatDateOnly(from, { month: 'short', day: 'numeric', year: 'numeric' })} - ${formatDateOnly(to, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'All dates');
  const invalid = Boolean(draftFrom && draftTo && draftFrom > draftTo);
  useEffect(() => {
    if (!open) return undefined;
    setDraftFrom(from);
    setDraftTo(to);
    setCustomOpen(Boolean(from || to) && !selectedPreset);
  }, [open, from, to, selectedPreset]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const choosePreset = (preset) => {
    if (preset === 'Today') onApply(today, today);
    else if (preset === 'This month') onApply(`${today.slice(0, 7)}-01`, today);
    else {
      const days = preset === 'Last 7 days' ? 6 : 29;
      const start = new Date(`${today}T00:00:00.000Z`);
      start.setUTCDate(start.getUTCDate() - days);
      onApply(start.toISOString().slice(0, 10), today);
    }
    setOpen(false);
  };
  return <div className="nutrition-date-control" ref={rootRef}>
    <button type="button" className="nutrition-date-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" /><span><small>Date range</small><strong>{label}</strong></span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div className="nutrition-date-popover" role="dialog" aria-label="Date range filter">
      <div className="nutrition-date-presets">
        {['Today', 'Last 7 days', 'Last 30 days', 'This month'].map((preset) => <button type="button" key={preset} className={presetMatches(preset) ? 'active' : ''} aria-pressed={presetMatches(preset)} onClick={() => choosePreset(preset)}>{preset}</button>)}
        <button type="button" className={customOpen ? 'active' : ''} aria-pressed={customOpen} onClick={() => setCustomOpen(true)}>Custom</button>
      </div>
      {customOpen && <div className="nutrition-custom-range">
        <label>From<input type="date" value={draftFrom} aria-invalid={invalid} onChange={(event) => setDraftFrom(event.target.value)} /></label>
        <label>To<input type="date" value={draftTo} aria-invalid={invalid} onChange={(event) => setDraftTo(event.target.value)} /></label>
        {invalid && <p role="alert">From date must be on or before To date.</p>}
        <div><button type="button" className="nutrition-date-clear" onClick={() => { onApply('', ''); setOpen(false); }}>Clear</button><button type="button" className="nutrition-primary-button" disabled={invalid} onClick={() => { onApply(draftFrom, draftTo); setOpen(false); }}>Apply</button></div>
      </div>}
    </div>}
  </div>;
}

function RecordActions({ row, name, onView }) {
  return <div className="nutrition-row-actions">
    <button type="button" className="nutrition-icon-button" aria-label={`View ${row.record_type} for ${name}`} title="View record" onClick={() => onView(row)}><Eye size={17} strokeWidth={1.8} /></button>
  </div>;
}

const NutritionRecordsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = useMemo(() => readUrlState(searchParams), [searchParams]);
  const [searchInput, setSearchInput] = useState(urlState.search);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ total: 0, attention: 0, month: 0, childrenThisYear: 0, type: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [drawerDetail, setDrawerDetail] = useState(null);
  const [toast, setToast] = useState('');
  const drawerRef = useRef(null);
  const rowFocus = useRef(null);
  const tabRefs = useRef([]);
  const first = total ? (urlState.page - 1) * urlState.pageSize + 1 : 0;
  const last = Math.min(urlState.page * urlState.pageSize, total);
  const showDocument = (row) => navigate(`/nutrition/records/${typeKey(row.record_type)}/${row.id}`, { state: { from: `/nutrition${window.location.search}` } });

  const updateParams = useCallback((changes, resetPage = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === '' || value === null || value === false) next.delete(key);
        else next.set(key, String(value));
      });
      if (resetPage) next.set('page', '1');
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput !== urlState.search) updateParams({ search: searchInput }, true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, urlState.search, updateParams]);
  useEffect(() => { if (!urlState.search && searchInput) setSearchInput(''); else if (urlState.search !== searchInput) setSearchInput(urlState.search); }, [urlState.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listNutritionRecords({
        search: urlState.search, type: urlState.type === 'All' ? undefined : urlState.type,
        status: urlState.status, from: urlState.from, to: urlState.to, latestOnly: urlState.latestOnly,
        sort: urlState.sort, order: urlState.order, page: urlState.page, pageSize: urlState.pageSize,
      });
      if (!response.success) throw new Error(response.message || 'Unable to load nutrition records.');
      setItems(response.data.items || []);
      setCounts(response.data.counts || { total: 0, attention: 0, month: 0, childrenThisYear: 0, type: {} });
      setTotal(response.data.total || 0);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [retry, urlState]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('healthsync:sync-complete', load);
    return () => window.removeEventListener('healthsync:sync-complete', load);
  }, [load]);

  useEffect(() => {
    const recordParam = searchParams.get('record');
    if (!recordParam || drawer) return;
    const separator = recordParam.indexOf('-');
    if (separator < 1) return;
    const recordType = recordParam.slice(0, separator);
    const id = Number(recordParam.slice(separator + 1));
    if (!id) return;
    const found = items.find((row) => Number(row.id) === id && typeKey(row.record_type) === recordType);
    if (found) { openDrawer(found); return; }
    getNutritionRecord(recordType, id).then((response) => {
      if (response.success) { setDrawer(response.data); setDrawerDetail(response.data); }
    }).catch(() => setDrawer(null));
  }, [searchParams, items, drawer]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDrawer = useCallback(async (row, event) => {
    rowFocus.current = event?.currentTarget;
    setDrawer(row);
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('record', `${typeKey(row.record_type)}-${row.id}`); return next; });
    try {
      const response = await getNutritionRecord(typeKey(row.record_type), row.id);
      if (response.success) setDrawerDetail(response.data);
    } catch (loadError) {
      setDrawerDetail(row);
    }
  }, [setSearchParams]);

  useEffect(() => {
    if (!drawer) return undefined;
    drawerRef.current?.focus();
    const close = (event) => {
      if (event.key === 'Escape') {
        setDrawer(null);
        setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('record'); return next; });
        rowFocus.current?.focus();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [drawer, setSearchParams]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await exportNutritionRecords({
        search: urlState.search, type: urlState.type === 'All' ? undefined : urlState.type,
        status: urlState.status, from: urlState.from, to: urlState.to, latestOnly: urlState.latestOnly,
        sort: urlState.sort, order: urlState.order,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'nutrition-records.csv';
      link.click();
      URL.revokeObjectURL(url);
      setToast('CSV export downloaded.');
    } catch (exportError) {
      setToast(exportError.response?.data?.message || 'Unable to export nutrition records.');
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      ['search', 'type', 'status', 'from', 'to', 'latestOnly', 'sort', 'order', 'page', 'pageSize'].forEach((key) => next.delete(key));
      return next;
    });
  };
  const setSort = (field) => {
    if (urlState.sort === field) updateParams({ sort: field, order: urlState.order === 'asc' ? 'desc' : 'asc' }, true);
    else updateParams({ sort: field, order: field === 'date' ? 'desc' : 'asc' }, true);
  };
  const sortDirection = (field) => urlState.sort === field ? (urlState.order === 'asc' ? 'ascending' : 'descending') : 'none';
  const SortIcon = ({ field }) => {
    if (sortDirection(field) === 'ascending') return <ArrowUp size={14} strokeWidth={1.8} aria-hidden="true" />;
    if (sortDirection(field) === 'descending') return <ArrowDown size={14} strokeWidth={1.8} aria-hidden="true" />;
    return <ArrowUpDown size={14} strokeWidth={1.8} aria-hidden="true" />;
  };
  const tabOptions = [
    { key: 'All', label: 'All', icon: ClipboardList },
    { key: 'Operation Timbang', label: 'Operation Timbang', icon: Scale },
    { key: 'Adolescent BMI', label: 'Adolescent BMI', icon: Activity },
    { key: 'Adult BMI', label: 'Adult BMI', icon: UserRound },
  ];
  const handleTabKeyDown = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabOptions.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabOptions.length) % tabOptions.length;
    updateParams({ type: tabOptions[nextIndex].key === 'All' ? '' : tabOptions[nextIndex].key }, true);
    window.requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };
  const activeFilterCount = [searchInput, urlState.type !== 'All', urlState.status, urlState.from, urlState.to, urlState.latestOnly].filter(Boolean).length;
  const invalidDateRange = Boolean(urlState.from && urlState.to && urlState.from > urlState.to);

  return (
    <main className="nutrition-records-page">
      {toast && <div className="nutrition-toast" role="status" aria-live="polite">{toast}<button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16} /></button></div>}
      <nav className="nutrition-breadcrumb" aria-label="Breadcrumb"><span>Home</span><span aria-hidden="true">/</span><span aria-current="page">Nutritional Monitoring</span></nav>
      <PageBanner
        className="nutrition-page-banner"
        icon={HeartPulse}
        eyebrow="NUTRITIONAL MONITORING"
        title="Nutritional Monitoring"
        subtitle="Record measurements and review nutrition assessments."
        actions={<button type="button" className="nutrition-primary-button" onClick={() => window.dispatchEvent(new CustomEvent('healthsync:create-nutrition-record'))}><Plus size={17} strokeWidth={1.8} aria-hidden="true" />Create Record</button>}
      />

      <section className="nutrition-kpi-grid" aria-label="Nutrition record statistics" aria-busy={loading}>
        {loading && items.length === 0
          ? [['Total Records', ClipboardList], ['Needs Follow-up', BellRing], ['Recorded This Month', CalendarPlus], ['Children This Year', Baby]].map(([label, Icon]) =>
              <div className="nutrition-kpi-skeleton" key={label}><span><Icon size={18} /></span><i /><small>{label}</small></div>)
          : <>
              <button type="button" className="nutrition-kpi-button" onClick={() => updateParams({ type: '' }, true)} aria-label="View all nutrition records"><StatCard icon={ClipboardList} label="Total Records" value={counts.total} animateOnMount /></button>
              <button type="button" className={`nutrition-kpi-button ${urlState.status === 'attention' ? 'active' : ''}`} onClick={() => updateParams({ status: urlState.status === 'attention' ? '' : 'attention' }, true)} aria-label="Filter records needing follow-up"><StatCard icon={BellRing} label="Needs Follow-up" value={counts.attention} animateOnMount /></button>
              <button type="button" className="nutrition-kpi-button" onClick={() => updateParams({ from: `${getDateInputValueInTimeZone('Asia/Manila').slice(0, 7)}-01`, to: getDateInputValueInTimeZone('Asia/Manila') }, true)} aria-label="Filter records recorded this month"><StatCard icon={CalendarPlus} label="Recorded This Month" value={counts.month} animateOnMount /></button>
              <button type="button" className="nutrition-kpi-button" onClick={() => updateParams({ type: 'Operation Timbang', from: `${new Date().getFullYear()}-01-01`, to: getDateInputValueInTimeZone('Asia/Manila') }, true)} aria-label="Filter children assessed this year"><StatCard icon={Baby} label="Children This Year" value={counts.childrenThisYear} animateOnMount /></button>
            </>}
      </section>
      <section className="nutrition-filter-card" aria-label="Nutrition record filters">
        <div className="nutrition-filter-row-a">
          <label className="nutrition-search" htmlFor="nutrition-record-search">
            <Search size={17} strokeWidth={1.8} aria-hidden="true" />
            <input id="nutrition-record-search" type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search name, type, or status" />
            {searchInput ? <button type="button" aria-label="Clear search" onClick={() => { setSearchInput(''); updateParams({ search: '' }, true); }}><X size={16} aria-hidden="true" /></button> : <kbd aria-hidden="true">/</kbd>}
          </label>
          <button type="button" className="nutrition-export-button" onClick={exportCsv} disabled={exporting}>
            {exporting ? <Loader2 className="nutrition-spin" size={17} strokeWidth={1.8} /> : <Download size={17} strokeWidth={1.8} />}
            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
        </div>
        <div className="nutrition-record-type-tabs" role="tablist" aria-label="Record type filters">
          {tabOptions.map(({ key, label, icon: Icon }, index) => {
            const selected = urlState.type === key;
            const count = key === 'All' ? counts.total : key === 'Operation Timbang' ? counts.type?.operation : key === 'Adolescent BMI' ? counts.type?.adolescent : counts.type?.adult;
            return <button key={key} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" aria-selected={selected} aria-controls="nutrition-record-results" tabIndex={selected ? 0 : -1}
              className={selected ? 'active' : ''} onClick={() => updateParams({ type: key === 'All' ? '' : key }, true)} onKeyDown={(event) => handleTabKeyDown(event, index)}>
              <Icon size={16} strokeWidth={1.8} aria-hidden="true" />{label}<span>{Number(count || 0).toLocaleString()}</span>
            </button>;
          })}
        </div>
        <div className="nutrition-filter-row-c">
          <label className="nutrition-select-field"><span>Status</span><div><HeartPulse size={16} strokeWidth={1.8} /><select value={urlState.status} onChange={(event) => updateParams({ status: event.target.value }, true)}><option value="">All statuses</option><option value="normal">Normal</option><option value="attention">Needs attention</option></select></div></label>
          <label className="nutrition-select-field"><span>Sort</span><div><ArrowUpDown size={16} strokeWidth={1.8} /><select value={`${urlState.sort}:${urlState.order}`} onChange={(event) => { const [sort, order] = event.target.value.split(':'); updateParams({ sort, order }, true); }}><option value="date:desc">Record date: newest first</option><option value="date:asc">Record date: oldest first</option><option value="name:asc">Resident A-Z</option><option value="status:desc">Needs attention first</option></select></div></label>
          <DateRangeControl from={urlState.from} to={urlState.to} onApply={(from, to) => updateParams({ from, to }, true)} />
          <label className="nutrition-switch-field" title="Show only each resident's most recent record"><input type="checkbox" checked={urlState.latestOnly} onChange={(event) => updateParams({ latestOnly: event.target.checked }, true)} /><span aria-hidden="true" /><span>Latest per resident</span><Info size={14} strokeWidth={1.8} /></label>
          {activeFilterCount > 0 && <button type="button" className="nutrition-clear-filters" onClick={clearFilters}><RotateCcw size={15} strokeWidth={1.8} />Clear filters</button>}
        </div>
        {invalidDateRange && <p className="nutrition-validation" role="alert">From date must be on or before To date.</p>}
        {activeFilterCount > 0 && <div className="nutrition-active-filters" aria-label="Active filters">
          {searchInput && <button type="button" onClick={() => { setSearchInput(''); updateParams({ search: '' }, true); }}><span>Search: {searchInput}</span><X size={14} /></button>}
          {urlState.type !== 'All' && <button type="button" onClick={() => updateParams({ type: '' }, true)}><span>{urlState.type}</span><X size={14} /></button>}
          {urlState.status && <button type="button" onClick={() => updateParams({ status: '' }, true)}><span>{urlState.status === 'attention' ? 'Needs attention' : 'Normal'}</span><X size={14} /></button>}
          {(urlState.from || urlState.to) && <button type="button" onClick={() => updateParams({ from: '', to: '' }, true)}><span>Date range</span><X size={14} /></button>}
          {urlState.latestOnly && <button type="button" onClick={() => updateParams({ latestOnly: false }, true)}><span>Latest per resident</span><X size={14} /></button>}
        </div>}
      </section>
      <section id="nutrition-record-results" className="nutrition-table-card" aria-label="Nutrition records" aria-busy={loading}>
        <header className="nutrition-table-card-header">
          <div><h2>Nutrition records</h2><p>{loading && !items.length ? 'Loading nutrition records' : `Showing ${first.toLocaleString()}-${last.toLocaleString()} of ${total.toLocaleString()} matching records`}</p></div>
          <span className="nutrition-count-chip">{total.toLocaleString()} {total === 1 ? 'record' : 'records'}</span>
        </header>
        {error ? <div className="nutrition-state" role="alert">
          <span className="nutrition-state-icon is-error"><AlertCircle size={22} strokeWidth={1.8} /></span>
          <h3>Unable to load nutrition records</h3><p>{error.response?.data?.message || error.message || 'Please try again.'}</p>
          <button type="button" className="nutrition-secondary-button" onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div> : <>
          <div className="nutrition-table-wrap">
            <table className="nutrition-record-table">
              <thead><tr>
                <th scope="col" aria-sort="none"><button type="button" onClick={() => setSort('name')}>Resident<SortIcon field="name" /></button></th>
                <th scope="col">Type</th>
                <th scope="col" className="nutrition-hide-tablet">Age</th>
                <th scope="col">Measurement</th>
                <th scope="col">Result</th>
                <th scope="col" aria-sort={sortDirection('date')}><button type="button" onClick={() => setSort('date')}>Record Date<SortIcon field="date" /></button></th>
                <th scope="col" className="nutrition-hide-tablet">Recorded By</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {loading && items.length === 0 ? Array.from({ length: 7 }, (_, index) => <tr className="nutrition-skeleton-row" key={index} aria-hidden="true">{Array.from({ length: 8 }, (_, cell) => <td key={cell}><span /></td>)}</tr>)
                  : items.map((row) => {
                    const name = nameFor(row);
                    const gender = formatGender(row.sex);
                    const age = formatAge(row);
                    const household = row.household_no ? `Household ${row.household_no}` : 'No household';
                    const measurements = [
                      row.weight_kg !== null && row.weight_kg !== undefined ? `${Number(row.weight_kg).toFixed(1)} kg` : null,
                      row.height_cm !== null && row.height_cm !== undefined ? `${Number(row.height_cm).toFixed(1)} cm` : null,
                      row.bmi !== null && row.bmi !== undefined ? `BMI ${Number(row.bmi).toFixed(2)}` : null,
                    ].filter(Boolean);
                    return <tr key={`${row.record_type}-${row.id}`} className="nutrition-record-row" tabIndex={0}
                      aria-label={`View ${row.record_type} record for ${name}`}
                      onClick={(event) => { if (!event.target.closest('a, button, input, select')) openDrawer(row, event); }}
                      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDrawer(row, event); } }}>
                      <td><Link className="nutrition-resident" to={`/residents/${row.resident_id}`} title={name} onClick={(event) => event.stopPropagation()}>
                        <span className="nutrition-avatar">{row.profile_photo && <img src={getProfilePhotoUrl(row.profile_photo)} alt="" />}{`${row.first_name?.charAt(0) || ''}${row.last_name?.charAt(0) || ''}`.toUpperCase()}</span>
                        <span><strong>{name}</strong><small>{gender ? `Gender: ${gender}` : 'Gender unknown'} · {household}</small><span className="nutrition-tablet-details">{age}</span></span>
                      </Link></td>
                      <td><RecordTypeBadge type={row.record_type} /></td>
                      <td className="nutrition-hide-tablet"><span className="nutrition-age">{age}</span></td>
                      <td><div className="nutrition-measurement"><strong>{measurements[0] || 'Measurement unavailable'}</strong><small>{measurements.slice(1).join(' · ') || 'No additional measurements'}</small></div></td>
                      <td><IndicatorPopover indicators={row.record_type === 'Operation Timbang' ? row.indicators : []} status={row.status} /></td>
                      <td><span className="nutrition-date-value"><CalendarDays size={14} strokeWidth={1.8} /><time dateTime={String(row.record_date || '').slice(0, 10)}>{formatDateOnly(row.record_date, { month: 'short', day: 'numeric', year: 'numeric' }) || 'Date unavailable'}</time></span></td>
                      <td className="nutrition-hide-tablet"><span className="nutrition-recorded-by"><UserRound size={15} strokeWidth={1.8} />{row.recorded_by_name || 'Unknown user'}</span></td>
                      <td><RecordActions row={row} name={name} onView={showDocument} /></td>
                    </tr>;
                  })}
                {!loading && items.length === 0 && <tr><td colSpan="8"><div className="nutrition-empty-state">
                  <span><ClipboardList size={23} strokeWidth={1.8} /></span>
                  <strong>{activeFilterCount ? 'No nutrition records found' : 'No nutrition records yet'}</strong>
                  <p>{activeFilterCount ? 'Try changing your search or filters.' : 'Create a nutrition assessment to add the first record.'}</p>
                  {activeFilterCount
                    ? <button type="button" className="nutrition-secondary-button" onClick={clearFilters}><RotateCcw size={15} />Clear filters</button>
                    : <button type="button" className="nutrition-primary-button" onClick={() => window.dispatchEvent(new CustomEvent('healthsync:create-nutrition-record'))}><Plus size={16} />Create Record</button>}
                </div></td></tr>}
              </tbody>
            </table>
          </div>
          <div className="nutrition-mobile-list">
            {loading && items.length === 0 ? Array.from({ length: 4 }, (_, index) => <div className="nutrition-mobile-skeleton" key={index} />)
              : items.map((row) => {
                const name = nameFor(row);
                const gender = formatGender(row.sex);
                return <article key={`${row.record_type}-${row.id}`} className="nutrition-mobile-card" onClick={() => openDrawer(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDrawer(row); } }} tabIndex={0}>
                  <div className="nutrition-mobile-card-heading"><span className="nutrition-avatar">{`${row.first_name?.charAt(0) || ''}${row.last_name?.charAt(0) || ''}`.toUpperCase()}</span><div><strong>{name}</strong><small>{gender ? `Gender: ${gender}` : 'Gender unknown'} · {formatAge(row)}</small></div><RecordActions row={row} name={name} onView={showDocument} /></div>
                  <RecordTypeBadge type={row.record_type} />
                  <div className="nutrition-mobile-measurement"><strong>{row.weight_kg !== null && row.weight_kg !== undefined ? `${Number(row.weight_kg).toFixed(1)} kg` : 'Measurement unavailable'}</strong><small>{row.height_cm !== null && row.height_cm !== undefined ? `${Number(row.height_cm).toFixed(1)} cm` : ''}{row.bmi !== null && row.bmi !== undefined ? ` · BMI ${Number(row.bmi).toFixed(2)}` : ''}</small></div>
                  <IndicatorPopover indicators={row.record_type === 'Operation Timbang' ? row.indicators : []} status={row.status} />
                  <div className="nutrition-mobile-meta"><span><CalendarDays size={14} />{formatDateOnly(row.record_date, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span><UserRound size={14} />{row.recorded_by_name || 'Unknown user'}</span></div>
                </article>;
              })}
          </div>
          <footer className="nutrition-table-footer">
            <Pagination currentPage={urlState.page} totalPages={Math.ceil(total / urlState.pageSize)} first={first} last={last} total={total} itemLabel="records" pageSize={urlState.pageSize} onPageSizeChange={(size) => updateParams({ pageSize: size }, true)} onPageChange={(page) => updateParams({ page }, false)} />
          </footer>
        </>}
      </section>
      {drawer && <>
        <div className="nutrition-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDrawer(null); setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('record'); return next; }); rowFocus.current?.focus(); } }} />
        <aside className="nutrition-record-drawer" role="dialog" aria-modal="true" aria-label="Nutrition record details" ref={drawerRef} tabIndex="-1">
          <header><button type="button" aria-label="Close record details" onClick={() => { setDrawer(null); setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('record'); return next; }); rowFocus.current?.focus(); }}>×</button><div className="nutrition-record-drawer-title"><span className="nutrition-avatar">{(drawer.first_name || '?').charAt(0)}</span><div><button type="button" className="nutrition-resident-link" onClick={() => window.location.assign(`/residents/${drawer.resident_id}`)}>{nameFor(drawer)}</button><small>{drawer.record_type} · {formatDateOnly(drawer.record_date, { month: 'short', day: 'numeric', year: 'numeric' })}</small></div></div></header>
          <div className="nutrition-record-drawer-body"><ResultPanel mode={drawer.record_type === 'Operation Timbang' ? 'nutrition' : drawer.record_type === 'Adult BMI' ? 'adult-bmi' : 'bmi'} result={drawer.record_type === 'Adolescent BMI' ? { bmi: drawer.bmi, bmi_for_age_category: drawer.status, bmi_for_age_zscore: drawer.bmi_for_age_zscore } : drawer.record_type === 'Adult BMI' ? { bmi: drawer.bmi, bmi_category: drawer.status, weight_kg: drawer.weight_kg } : drawerDetail || drawer} heightCm={Number(drawer.height_cm)} resident={drawer} /><TrendChart mode={drawer.record_type === 'Adult BMI' ? 'adult-bmi' : drawer.record_type === 'Adolescent BMI' ? 'bmi' : 'nutrition'} items={drawerDetail?.history || []} /></div>
          <footer><Link className="nutrition-secondary-button" to={`/nutrition/records/${typeKey(drawer.record_type)}/${drawer.id}`}>Open medical document</Link><button type="button" className="nutrition-secondary-button" onClick={() => window.location.assign(`/residents/${drawer.resident_id}`)}>View resident</button></footer>
        </aside>
      </>}
    </main>
  );
};

export default NutritionRecordsPage;
