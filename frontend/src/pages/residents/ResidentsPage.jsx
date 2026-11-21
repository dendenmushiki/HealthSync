import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import ResidentsTable from '../../components/residents/ResidentsTable';
import ResidentForm from './ResidentForm';
import { deleteResident, getResidents } from '../../services/api/residentService';
import ConfirmModal from '../../components/common/ConfirmModal';
import Pagination from '../../components/common/Pagination';
import SITIOS from '../../constants/sitios';
import StatusBanner from '../../components/common/StatusBanner';
import { getFriendlyError } from '../../utils/apiErrorMessages';

const DEFAULTS = { search: '', status: '', sex: '', sitio: '', classification: '', sort: 'name-asc', page: 1, pageSize: 10 };
const SORT_OPTIONS = [
  ['name-asc', 'Name A-Z'], ['name-desc', 'Name Z-A'],
  ['age-asc', 'Age: youngest first'], ['age-desc', 'Age: oldest first'],
  ['newest', 'Newest added']
];
const SORT_API = {
  'name-asc': { sort: 'name', order: 'asc' },
  'name-desc': { sort: 'name', order: 'desc' },
  'age-desc': { sort: 'age', order: 'desc' },
  'age-asc': { sort: 'age', order: 'asc' },
  newest: { sort: 'newest', order: 'asc' }
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
    sort: allowedSort,
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize: [10, 25, 50].includes(parsedPageSize) ? parsedPageSize : 10
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
  const [showFilters, setShowFilters] = useState(false);
  const [residentToDelete, setResidentToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');
  const searchRef = useRef(null);
  const tableTopRef = useRef(null);

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
        ...sort
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

  useEffect(() => { fetchResidents(); }, [fetchResidents]);

  useEffect(() => {
    window.addEventListener('healthsync:sync-complete', fetchResidents);
    return () => window.removeEventListener('healthsync:sync-complete', fetchResidents);
  }, [fetchResidents]);

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
    const message = location.state?.residentToast;
    if (!message) return undefined;
    setToast(message);
  }, [location.state?.residentToast]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeFilters = useMemo(() => [
    ['search', 'Search', urlState.search], ['status', 'Status', urlState.status], ['sex', 'Sex', urlState.sex],
    ['sitio', 'Sitio', urlState.sitio], ['classification', 'Classification', urlState.classification]
  ].filter(([, , value]) => value), [urlState]);
  const activeFilterCount = activeFilters.length;
  const hasFilters = activeFilterCount > 0 || Boolean(urlState.search) || urlState.sort !== DEFAULTS.sort;
  const first = pagination.total ? ((urlState.page - 1) * urlState.pageSize) + 1 : 0;
  const last = Math.min(urlState.page * urlState.pageSize, pagination.total);

  const changeFilter = (event) => updateQueryParams({ [event.target.name]: event.target.value }, { resetPage: true });
  const setSort = (value) => updateQueryParams({ sort: value }, { resetPage: true });
  const setPage = (page) => {
    updateQueryParams({ page: page === 1 ? '' : page });
    tableTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      await fetchResidents();
    } catch (deleteError) {
      console.error('Unable to delete resident.', deleteError);
      setToast(getFriendlyError(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  const retryFetch = () => fetchResidents();
  const emptyResults = !loading && items.length === 0;

  return <div className="page-shell residents-directory-page">
    {toast && <div className="resident-toast" role="status" aria-live="polite">{toast}</div>}
    {activeTab === 'directory' ? <>
      <header className="residents-page-header">
        <div>
          <h1>Residents</h1>
          <p>Search and manage household records.</p>
        </div>
        <div className="residents-page-header-actions">
          <span className="residents-total-count" aria-live="polite">{pagination.total} {pagination.total === 1 ? 'resident' : 'residents'}</span>
          <button type="button" className="residents-primary-button" onClick={() => setActiveTab('add')}><span aria-hidden="true">+</span> Add resident</button>
        </div>
      </header>

      <section className="residents-surface" aria-label="Resident directory">
        {showingOfflineCache && <div className="residents-offline-note" role="status">Offline view: showing residents previously loaded on this device.</div>}
        <div className="residents-toolbar">
          <div className="residents-search-control">
            <label className="residents-visually-hidden" htmlFor="resident-search">Search by name, household no., contact no., or PhilHealth ID</label>
            <span className="residents-search-icon" aria-hidden="true">⌕</span>
            <input id="resident-search" ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, household no., contact no., PhilHealth ID" autoComplete="off" />
            {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button> : <kbd aria-hidden="true">/</kbd>}
          </div>
          <button type="button" className={`residents-filter-button ${showFilters ? 'active' : ''}`} aria-expanded={showFilters} aria-controls="residents-filter-panel" onClick={() => setShowFilters((current) => !current)}>
            Filters{activeFilterCount > 0 && <span>{activeFilterCount}</span>}
          </button>
        </div>

        {showFilters && <button type="button" className="residents-filter-backdrop" aria-label="Close filters" onClick={() => setShowFilters(false)} />}
        {showFilters && <div id="residents-filter-panel" className="residents-filter-panel">
          <div className="residents-filter-heading"><strong>Filters</strong><button type="button" aria-label="Close filters" onClick={() => setShowFilters(false)}>×</button></div>
          <div className="residents-filter-field"><label htmlFor="resident-status">Status</label><select id="resident-status" name="status" value={urlState.status} onChange={changeFilter}><option value="">All statuses</option>{['Active', 'Inactive', 'Transferred', 'Deceased'].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div className="residents-filter-field"><label htmlFor="resident-sex">Sex</label><select id="resident-sex" name="sex" value={urlState.sex} onChange={changeFilter}><option value="">All sexes</option><option value="male">Male</option><option value="female">Female</option></select></div>
          <div className="residents-filter-field"><label htmlFor="resident-sitio">Sitio</label><select id="resident-sitio" name="sitio" value={urlState.sitio} onChange={changeFilter}><option value="">All sitios</option>{SITIOS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          <div className="residents-filter-field"><label htmlFor="resident-classification">Classification</label><select id="resident-classification" name="classification" value={urlState.classification} onChange={changeFilter}><option value="">All classifications</option>{['Senior Citizen', 'PWD', '4Ps Member', 'Pregnant', 'Lactating'].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div className="residents-filter-field"><label htmlFor="resident-sort">Sort residents</label><select id="resident-sort" name="sort" value={urlState.sort} onChange={(event) => setSort(event.target.value)}>{SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          {hasFilters && <button type="button" className="residents-clear-link" onClick={clearFilters}>Clear all</button>}
        </div>}

        {(activeFilters.length > 0 || urlState.sort !== DEFAULTS.sort) && <div className="residents-active-filters" aria-label="Active filters">
          {activeFilters.map(([key, label, value]) => <button type="button" key={key} className="residents-filter-chip" onClick={() => removeFilter(key)}>{label}: {value}<span aria-hidden="true"> ×</span></button>)}
          {urlState.sort !== DEFAULTS.sort && <button type="button" className="residents-filter-chip" onClick={() => removeFilter('sort')}>Sort: {SORT_OPTIONS.find(([value]) => value === urlState.sort)?.[1]}<span aria-hidden="true"> ×</span></button>}
          <button type="button" className="residents-clear-link" onClick={clearFilters}>Clear all</button>
        </div>}

        <div ref={tableTopRef} className="residents-results-heading">
          <span aria-live="polite" aria-atomic="true">{loading && items.length ? 'Updating results…' : `Showing ${first}-${last} of ${pagination.total} matching residents`}</span>
          {loading && items.length > 0 && <span className="residents-loading-bar" aria-hidden="true" />}
        </div>
        {error && <StatusBanner error={error} retry={retryFetch} />}
        {emptyResults && !error ? <div className="residents-empty-state">
          <span className="residents-empty-icon" aria-hidden="true">⌕</span>
          <strong>{pagination.total === 0 && !hasFilters ? 'No residents yet' : 'No residents match your filters'}</strong>
          <span>{pagination.total === 0 && !hasFilters ? 'Add a resident to start building the directory.' : 'Try adjusting your search or clearing the filters.'}</span>
          {pagination.total === 0 && !hasFilters ? <button type="button" className="residents-primary-button" onClick={() => setActiveTab('add')}>Add resident</button> : <button type="button" className="residents-secondary-button" onClick={clearFilters}>Clear filters</button>}
        </div> : loading && items.length === 0 ? <div className="residents-skeleton-list" aria-label="Loading residents" aria-busy="true">{Array.from({ length: 7 }, (_, index) => <div className="residents-skeleton-row" key={index}><span /><i /><i /><i /><i /></div>)}</div> : <>
          <ResidentsTable items={items} onDelete={setResidentToDelete} sort={urlState.sort} onSort={setSort} />
          <Pagination currentPage={urlState.page} totalPages={pagination.totalPages} first={first} last={last} total={pagination.total} itemLabel="residents" onPageChange={setPage} pageSize={urlState.pageSize} onPageSizeChange={(pageSize) => updateQueryParams({ pageSize, page: '' })} />
        </>}
      </section>
    </> : <div className="residents-add-view"><ResidentForm onBack={() => setActiveTab('directory')} /></div>}

    <ConfirmModal open={Boolean(residentToDelete)} title="Delete resident?" message={residentToDelete ? `This permanently deletes ${residentToDelete.first_name} ${residentToDelete.last_name} and all related health records.` : ''} busy={deleting} onCancel={() => setResidentToDelete(null)} onConfirm={handleDelete} />
  </div>;
};

export default ResidentsPage;
