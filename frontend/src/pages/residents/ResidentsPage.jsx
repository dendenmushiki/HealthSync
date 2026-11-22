import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  Accessibility,
  Baby,
  Check,
  ChevronDown,
  FileText,
  HeartPulse,
  MapPin,
  Search,
  UserPlus,
  UserRound,
  Users,
  VenusAndMars,
} from 'lucide-react';
import ResidentsTable from '../../components/residents/ResidentsTable';
import ResidentProfilePanel from '../../components/residents/ResidentProfilePanel';
import StatCard from '../../components/residents/StatCard';
import ResidentForm from './ResidentForm';
import { deleteResident, getResidentStats, getResidents } from '../../services/api/residentService';
import ConfirmModal from '../../components/common/ConfirmModal';
import Pagination from '../../components/common/Pagination';
import PageBanner from '../../components/common/PageBanner';
import StatusBanner from '../../components/common/StatusBanner';
import { getFriendlyError } from '../../utils/apiErrorMessages';

const DEFAULTS = { search: '', status: '', sex: '', sitio: '', classification: '', nutritionStatus: '', sort: 'id-asc', page: 1, pageSize: 10 };
const SORT_OPTIONS = [
  ['id-asc', 'ID ascending'], ['id-desc', 'ID descending'],
  ['name-asc', 'Name A-Z'], ['name-desc', 'Name Z-A'],
  ['age-asc', 'Age: youngest first'], ['age-desc', 'Age: oldest first'],
  ['newest', 'Newest added'],
];
const SORT_API = {
  'id-asc': { sort: 'id', order: 'asc' },
  'id-desc': { sort: 'id', order: 'desc' },
  'name-asc': { sort: 'name', order: 'asc' },
  'name-desc': { sort: 'name', order: 'desc' },
  'age-desc': { sort: 'age', order: 'desc' },
  'age-asc': { sort: 'age', order: 'asc' },
  newest: { sort: 'newest', order: 'asc' },
};

const ResidentFilterDropdown = ({ id, icon: Icon, label, value, options, open, onToggle, onSelect }) => {
  const selectedLabel = options.find(([optionValue]) => optionValue === value)?.[1];
  return (
    <div className={`resident-filter-dropdown resident-filter-${id}`}>
      <button type="button" className={`resident-toolbar-filter ${value ? 'active' : ''}`}
        aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`} onClick={onToggle}>
        <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>{selectedLabel || label}</span><ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && <div id={`${id}-menu`} className="resident-filter-menu" role="menu" aria-label={label}>
        {options.map(([optionValue, optionLabel]) => (
          <button key={optionValue || 'all'} type="button" role="menuitemradio" aria-checked={value === optionValue}
            onClick={() => onSelect(optionValue)}>
            {optionLabel}{value === optionValue && <Check size={14} strokeWidth={1.8} aria-hidden="true" />}
          </button>
        ))}
      </div>}
    </div>
  );
};

function readDirectoryState(params) {
  const parsedPage = Number(params.get('page'));
  const parsedPageSize = Number(params.get('pageSize'));
  const allowedSort = SORT_OPTIONS.some(([value]) => value === params.get('sort')) ? params.get('sort') : DEFAULTS.sort;
  return {
    search: params.get('search') || '',
    status: params.get('status') || '',
    sex: params.get('sex') || '',
    sitio: params.get('sitio') || '',
    classification: params.get('classification') || '',
    nutritionStatus: params.get('nutritionStatus') || '',
    sort: allowedSort,
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize: [10, 25, 50].includes(parsedPageSize) ? parsedPageSize : 10,
  };
}

const ResidentsPage = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = useMemo(() => readDirectoryState(searchParams), [searchParams]);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState(urlState.search);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showingOfflineCache, setShowingOfflineCache] = useState(false);
  const [activeTab, setActiveTab] = useState('directory');
  const [openFilter, setOpenFilter] = useState('');
  const [residentToDelete, setResidentToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');
  const [selectedResident, setSelectedResident] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState({ sitios: [], genders: [], nutritionStatuses: [] });
  const searchRef = useRef(null);
  const tableTopRef = useRef(null);
  const toolbarRef = useRef(null);

  const updateQueryParams = useCallback((updates, { resetPage = false } = {}) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === '' || value === null || value === undefined) next.delete(key);
        else next.set(key, String(value));
      });
      if (resetPage) next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => { setQuery(urlState.search); }, [urlState.search]);

  useEffect(() => {
    if (!items.length) {
      setSelectedResident(null);
      return;
    }
    setSelectedResident((current) => {
      if (current && items.some((item) => String(item.resident_id) === String(current.resident_id))) {
        return items.find((item) => String(item.resident_id) === String(current.resident_id));
      }
      return items[0];
    });
  }, [items]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query.trim() !== urlState.search) updateQueryParams({ search: query.trim() }, { resetPage: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, updateQueryParams, urlState.search]);

  const fetchResidents = useCallback(async () => {
    setLoading(true);
    setError('');
    const sort = SORT_API[urlState.sort] || SORT_API[DEFAULTS.sort];
    try {
      const response = await getResidents({
        page: urlState.page,
        pageSize: urlState.pageSize,
        limit: urlState.pageSize,
        search: urlState.search,
        status: urlState.status,
        sex: urlState.sex,
        sitio: urlState.sitio,
        classification: urlState.classification,
        nutritionStatus: urlState.nutritionStatus,
        ...sort,
      });
      if (!response?.success) throw new Error(response?.message || 'Unable to load residents.');
      const data = response.data || {};
      setItems(data.items || []);
      setShowingOfflineCache(Boolean(data.offline));
      const totalPages = data.pagination?.totalPages ?? Math.ceil((data.total || 0) / urlState.pageSize);
      setPagination(data.pagination || { page: urlState.page, limit: urlState.pageSize, total: data.total || 0, totalPages });
      if (totalPages > 0 && urlState.page > totalPages) updateQueryParams({ page: totalPages === 1 ? '' : totalPages });
    } catch (fetchError) {
      console.error('Unable to load residents.', fetchError);
      setError(fetchError);
    } finally {
      setLoading(false);
    }
  }, [updateQueryParams, urlState]);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const response = await getResidentStats();
      if (response?.success !== true || !response.data) throw new Error(response?.message || 'Unable to load resident statistics.');
      setStats(response.data);
      setFilterOptions(response.data.filterOptions || { sitios: [], genders: [], nutritionStatuses: [] });
    } catch (fetchError) {
      console.error('Unable to load resident statistics and filter options.', fetchError);
      setStatsError(fetchError);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => { fetchResidents(); }, [fetchResidents]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    const refresh = () => {
      fetchResidents();
      fetchStats();
    };
    window.addEventListener('healthsync:sync-complete', refresh);
    return () => window.removeEventListener('healthsync:sync-complete', refresh);
  }, [fetchResidents, fetchStats]);

  useEffect(() => {
    const handleShortcut = (event) => {
      const target = event.target;
      const isEditable = typeof target?.matches === 'function' && target.matches('input, textarea, select, [contenteditable="true"]');
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    const closeDropdown = (event) => {
      if (event.key === 'Escape') setOpenFilter('');
      if (event.type === 'pointerdown' && !toolbarRef.current?.contains(event.target)) setOpenFilter('');
    };
    document.addEventListener('keydown', closeDropdown);
    document.addEventListener('pointerdown', closeDropdown);
    return () => {
      document.removeEventListener('keydown', closeDropdown);
      document.removeEventListener('pointerdown', closeDropdown);
    };
  }, []);

  useEffect(() => {
    const message = location.state?.residentToast;
    if (message) setToast(message);
  }, [location.state?.residentToast]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeFilters = useMemo(() => [
    ['search', 'Search', urlState.search], ['status', 'Status', urlState.status], ['sex', 'Gender', urlState.sex],
    ['sitio', 'Sitio', urlState.sitio], ['classification', 'Classification', urlState.classification],
    ['nutritionStatus', 'Nutritional status', urlState.nutritionStatus],
  ].filter(([, , value]) => value), [urlState]);
  const hasFilters = activeFilters.length > 0 || urlState.sort !== DEFAULTS.sort;
  const first = pagination.total ? ((urlState.page - 1) * urlState.pageSize) + 1 : 0;
  const last = Math.min(urlState.page * urlState.pageSize, pagination.total);

  const selectFilter = (key, value) => {
    updateQueryParams({ [key]: value }, { resetPage: true });
    setOpenFilter('');
  };
  const setSort = (value) => updateQueryParams({ sort: value }, { resetPage: true });
  const setPage = (page) => {
    updateQueryParams({ page: page === 1 ? '' : page });
    if (typeof tableTopRef.current?.scrollIntoView === 'function') {
      tableTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const clearFilters = () => {
    setQuery('');
    setSearchParams(new URLSearchParams());
  };
  const removeFilter = (key) => updateQueryParams({ [key]: '' }, { resetPage: true });

  const handleDelete = async () => {
    if (!residentToDelete) return;
    setDeleting(true);
    try {
      await deleteResident(residentToDelete.resident_id);
      setResidentToDelete(null);
      setToast('Resident deleted.');
      await Promise.all([fetchResidents(), fetchStats()]);
    } catch (deleteError) {
      console.error('Unable to delete resident.', deleteError);
      setToast(getFriendlyError(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  const emptyResults = !loading && items.length === 0;
  const retryResidents = () => fetchResidents();
  const sitoOptions = [['', 'All Sitios'], ...filterOptions.sitios.map((sitio) => [sitio, sitio])];
  const genderOptions = [['', 'All Sexes'], ...filterOptions.genders.map((gender) => {
    const label = gender.charAt(0).toUpperCase() + gender.slice(1);
    return [gender, label];
  })];
  const nutritionOptions = [['', 'All Nutritional Status'], ...filterOptions.nutritionStatuses.map((status) => [status, status])];
  const categories = [
    { value: '', label: 'All Residents', icon: Users },
    { value: 'Children', label: 'Children', icon: Baby },
    { value: 'Adults', label: 'Adults', icon: UserRound },
    { value: 'Senior Citizen', label: 'Senior Citizens', icon: Accessibility },
  ];

  return <div className="page-shell residents-directory-page">
    {toast && <div className="resident-toast" role="status" aria-live="polite">{toast}</div>}
    {activeTab === 'directory' ? <>
      <PageBanner
        icon={Users}
        title="Resident Records"
        subtitle={stats?.barangayName
          ? `A centralized database of all residents in ${stats.barangayName}.`
          : 'A centralized database of all residents.'}
        total={stats?.total ?? null}
      />

      <section className="resident-stat-grid" aria-label="Resident statistics" aria-busy={statsLoading}>
        <StatCard icon={Users} label="Total Residents" value={stats?.total} trend={stats?.trends?.total} />
        <StatCard icon={Baby} label="Children (0-12 yrs)" value={stats?.children} trend={stats?.trends?.children} />
        <StatCard icon={HeartPulse} label="Adults (13-59 yrs)" value={stats?.adults} trend={stats?.trends?.adults} />
        <StatCard icon={Accessibility} label="Senior Citizens (60+)" value={stats?.seniors} trend={stats?.trends?.seniors} />
        <StatCard icon={FileText} label="Record Completeness" value={stats?.recordCompleteness} suffix="%" />
      </section>
      {statsError && <StatusBanner error={statsError} retry={fetchStats} />}

      <section className="residents-surface resident-records-surface" aria-label="Resident directory">
        {showingOfflineCache && <div className="residents-offline-note" role="status">Offline view: showing residents previously loaded on this device.</div>}
        <div className="resident-directory-toolbar" ref={toolbarRef}>
          <div className="resident-category-tabs" role="tablist" aria-label="Resident category">
            {categories.map(({ value, label, icon: Icon }) => (
              <button key={value || 'all'} type="button" role="tab" aria-selected={urlState.classification === value}
                onClick={() => updateQueryParams({ classification: value }, { resetPage: true })}>
                <Icon size={15} strokeWidth={1.8} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          <ResidentFilterDropdown id="resident-sitio" icon={MapPin} label="All Sitios" value={urlState.sitio}
            options={sitoOptions} open={openFilter === 'sitio'} onToggle={() => setOpenFilter(openFilter === 'sitio' ? '' : 'sitio')}
            onSelect={(value) => selectFilter('sitio', value)} />
          <ResidentFilterDropdown id="resident-gender" icon={VenusAndMars} label="All Sexes" value={urlState.sex}
            options={genderOptions} open={openFilter === 'sex'} onToggle={() => setOpenFilter(openFilter === 'sex' ? '' : 'sex')}
            onSelect={(value) => selectFilter('sex', value)} />
          <ResidentFilterDropdown id="resident-nutrition" icon={HeartPulse} label="All Nutritional Status" value={urlState.nutritionStatus}
            options={nutritionOptions} open={openFilter === 'nutritionStatus'} onToggle={() => setOpenFilter(openFilter === 'nutritionStatus' ? '' : 'nutritionStatus')}
            onSelect={(value) => selectFilter('nutritionStatus', value)} />
          <div className="residents-search-control resident-name-search">
            <label className="residents-visually-hidden" htmlFor="resident-search">Search by name, household no., contact no., or PhilHealth ID</label>
            <Search size={16} aria-hidden="true" />
            <input id="resident-search" ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name..." autoComplete="off" />
          </div>
          <button type="button" className="resident-add-button" onClick={() => setActiveTab('add')}>
            <UserPlus size={16} strokeWidth={1.8} aria-hidden="true" /> Add Resident
          </button>
        </div>

        {(activeFilters.length > 0 || urlState.sort !== DEFAULTS.sort) && <div className="residents-active-filters" aria-label="Active filters">
          {activeFilters.map(([key, label, value]) => <button type="button" key={key} className="residents-filter-chip" onClick={() => removeFilter(key)}>{label}: {value}<span aria-hidden="true"> ×</span></button>)}
          {urlState.sort !== DEFAULTS.sort && <button type="button" className="residents-filter-chip" onClick={() => removeFilter('sort')}>Sort: {SORT_OPTIONS.find(([value]) => value === urlState.sort)?.[1]}<span aria-hidden="true"> ×</span></button>}
          <button type="button" className="residents-clear-link" onClick={clearFilters}>Clear all</button>
        </div>}

        <div ref={tableTopRef} className="residents-results-heading">
          <span className="residents-visually-hidden" aria-live="polite" aria-atomic="true">{loading && items.length ? 'Updating resident results…' : `${pagination.total} matching residents`}</span>
          {loading && items.length > 0 && <span className="residents-loading-bar" aria-hidden="true" />}
        </div>
        {error && <StatusBanner error={error} retry={retryResidents} />}
        {emptyResults && !error ? <div className="residents-empty-state">
          <Search size={26} aria-hidden="true" />
          <strong>{hasFilters ? 'No residents found' : 'No residents yet'}</strong>
          <span>{hasFilters ? 'Try adjusting your search or clearing the filters.' : 'Add a resident to start building the directory.'}</span>
          {hasFilters
            ? <button type="button" className="residents-secondary-button" onClick={clearFilters}>Clear filters</button>
            : <button type="button" className="residents-primary-button" onClick={() => setActiveTab('add')}>Add resident</button>}
        </div> : loading && items.length === 0 ? (
          <div className="residents-skeleton-list" aria-label="Loading residents" aria-busy="true">
            {Array.from({ length: 7 }, (_, index) => <div className="residents-skeleton-row" key={index}><span /><i /><i /><i /><i /></div>)}
          </div>
        ) : (
          <div className="resident-record-workspace">
            <div className="resident-record-table-area">
              <ResidentsTable items={items} onDelete={setResidentToDelete} sort={urlState.sort} onSort={setSort}
                onSelect={setSelectedResident} selectedId={selectedResident?.resident_id} />
              <Pagination currentPage={urlState.page} totalPages={pagination.totalPages} first={first} last={last}
                total={pagination.total} itemLabel="residents" onPageChange={setPage} compact />
            </div>
            <ResidentProfilePanel resident={selectedResident} />
          </div>
        )}
      </section>
    </> : <div className="residents-add-view"><ResidentForm onBack={() => setActiveTab('directory')} /></div>}

    <ConfirmModal open={Boolean(residentToDelete)} title="Delete resident?"
      message={residentToDelete ? `This permanently deletes ${residentToDelete.first_name} ${residentToDelete.last_name} and all related health records.` : ''}
      busy={deleting} onCancel={() => setResidentToDelete(null)} onConfirm={handleDelete} />
  </div>;
};

export default ResidentsPage;
