import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Award,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  CircleAlert,
  Eye,
  House,
  Phone,
  RotateCcw,
  Search,
  SquarePen,
  Stethoscope,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';
import PageBanner from '../../components/common/PageBanner';
import Pagination from '../../components/common/Pagination';
import StatCard from '../../components/residents/StatCard';
import { listSeniorCitizens, getSeniorCitizen, createSeniorCitizen, updateSeniorCitizen, searchEligibleResidents, getNextSeniorId } from '../../services/api/seniorCitizenService';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateOnly, getLocalDateInputValue } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import './SeniorRegistry.css';

const PHONE_RE = /^(?:09\d{9}|\+639\d{9})$/;
const AGE_GROUPS = [
  ['', 'All ages'],
  ['60-69', '60–69'],
  ['70-79', '70–79'],
  ['80+', '80+'],
];
const PAGE_SIZE_OPTIONS = [10, 25, 50];

function formatPhone(value) {
  const original = String(value || '');
  const digits = original.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (digits.length === 12 && digits.startsWith('63')) return `+63 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return original;
}

function getSeniorName(resident) {
  const firstName = resident.first_name || '';
  const middleInitial = resident.middle_name ? `${resident.middle_name.trim().charAt(0)}.` : '';
  const givenNames = [firstName, middleInitial].filter(Boolean).join(' ');
  const fullName = [resident.last_name, givenNames].filter(Boolean).join(', ');
  return fullName || formatResidentName(resident) || 'Not provided';
}

function getConditionValues(value) {
  return [...new Set(String(value || '').split(',').map((condition) => condition.trim()).filter(Boolean))];
}

function SeniorResidentIdentity({ resident, onView }) {
  const name = getSeniorName(resident);
  const initials = `${resident.first_name?.charAt(0) || ''}${resident.last_name?.charAt(0) || ''}`.toUpperCase();
  return (
    <Link
      className="senior-resident-identity"
      to={`/residents/${resident.resident_id}`}
      onClick={onView}
      title={name}
      aria-label={`View resident ${name}`}
    >
      <span className="senior-resident-avatar" aria-hidden="true">
        {resident.profile_photo
          ? <img src={getProfilePhotoUrl(resident.profile_photo)} alt="" />
          : initials || <UsersRound size={17} strokeWidth={1.8} />}
      </span>
      <span className="senior-resident-name">{name}</span>
    </Link>
  );
}

function AgeBadge({ age }) {
  return <span className="senior-age-line">{age ?? '—'}{age >= 80 && <span className="senior-age-badge">80+</span>}</span>;
}

function ConditionChips({ value }) {
  const conditions = getConditionValues(value).filter((condition) => !['no known conditions', 'none recorded'].includes(condition.toLowerCase()));
  if (!conditions.length) return <span className="senior-condition-muted">None recorded</span>;
  return (
    <span className="senior-conditions">
      {conditions.slice(0, 2).map((condition) => <span className="senior-condition" key={condition}>{condition}</span>)}
      {conditions.length > 2 && <span className="senior-condition senior-condition-more" title={conditions.slice(2).join(', ')}>+{conditions.length - 2}</span>}
    </span>
  );
}

function PhoneValue({ value, label = 'Contact number' }) {
  if (!value) return <span className="senior-not-provided"><i>Not provided</i></span>;
  const dialValue = String(value).replace(/[^\d+]/g, '');
  return <a className="senior-phone-value" href={`tel:${dialValue}`} aria-label={`${label}: ${formatPhone(value)}`}><Phone size={14} strokeWidth={1.8} aria-hidden="true" />{formatPhone(value)}</a>;
}

function SeniorMobileCard({ resident, age, onView, actions }) {
  const name = getSeniorName(resident);
  return (
    <article
      className="senior-mobile-card"
      tabIndex={0}
      aria-label={`View resident ${name}`}
      onClick={(event) => { if (!event.target.closest('a, button')) onView(); }}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('a, button')) {
          event.preventDefault();
          onView();
        }
      }}
    >
      <div className="senior-mobile-card-header">
        <SeniorResidentIdentity resident={resident} onView={(event) => event.stopPropagation()} />
        <span className="senior-id-chip">{resident.senior_citizen_id || 'Not provided'}</span>
      </div>
      <div className="senior-mobile-card-grid">
        <div><span className="senior-mobile-label">Age</span><AgeBadge age={age} /></div>
        <div><span className="senior-mobile-label">Contact</span><PhoneValue value={resident.contact_number || resident.contact_no} /></div>
        <div className="senior-mobile-card-wide"><span className="senior-mobile-label">Conditions</span><ConditionChips value={resident.health_conditions} /></div>
        <div className="senior-mobile-card-wide"><span className="senior-mobile-label">Emergency contact</span>
          {resident.emergency_contact_name
            ? <span className="senior-emergency-value" title={resident.emergency_contact_name}>{resident.emergency_contact_name}<PhoneValue value={resident.emergency_contact_number} label="Emergency contact number" /></span>
            : <span className="senior-not-provided">No emergency contact</span>}
        </div>
        <div><span className="senior-mobile-label">Registered</span><span className="senior-date"><CalendarDays size={14} aria-hidden="true" />{formatDateOnly(resident.date_registered, { month: 'short', day: 'numeric', year: 'numeric' }) || <i>Not provided</i>}</span></div>
        <div><span className="senior-mobile-label">Household</span><span className="senior-household"><House size={14} aria-hidden="true" />{resident.household_no || <i>Not provided</i>}</span></div>
      </div>
      <div className="senior-mobile-actions">{actions}</div>
    </article>
  );
}

function SeniorRowActions({ resident, onEdit }) {
  return (
    <div className="senior-row-actions" onClick={(event) => event.stopPropagation()}>
      <Link className="senior-action-button" to={`/senior-citizens/records/${resident.senior_id}`} title="View registration record" aria-label="View registration record">
        <Eye size={17} strokeWidth={1.8} aria-hidden="true" />
      </Link>
      <button className="senior-action-button" type="button" title="Edit registration" aria-label="Edit registration" onClick={() => onEdit(resident)}>
        <SquarePen size={17} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function SeniorRegistryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNew = location.pathname === '/senior-citizens/new' || location.pathname.endsWith('/edit');
  const editId = location.pathname.match(/\/senior-citizens\/(\d+)\/edit$/)?.[1];
  const state = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const pageSize = Number(params.get('pageSize') || 10);
    return {
      search: params.get('search') || '',
      condition: params.get('condition') || '',
      ageGroup: params.get('ageGroup') || '',
      sitio: params.get('sitio') || '',
      sort: params.get('sort') || 'newest',
      page: Math.max(1, Number(params.get('page')) || 1),
      pageSize: PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : 10,
    };
  }, [location.search]);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [conditionOptions, setConditionOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [highlight, setHighlight] = useState(searchParams.get('highlight') || '');
  const [searchDraft, setSearchDraft] = useState(state.search);
  const searchRef = useRef(null);

  const updateState = useCallback((patch) => {
    const next = new URLSearchParams(searchParams);
    const hasPendingSearch = !Object.prototype.hasOwnProperty.call(patch, 'search') && searchDraft !== state.search;
    const effectivePatch = hasPendingSearch ? { search: searchDraft, ...patch } : patch;
    Object.entries(effectivePatch).forEach(([key, value]) => {
      if (value) next.set(key, String(value));
      else next.delete(key);
    });
    if (!Object.prototype.hasOwnProperty.call(patch, 'page') || hasPendingSearch) next.set('page', '1');
    setSearchParams(next);
  }, [searchDraft, searchParams, setSearchParams, state.search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listSeniorCitizens(state);
      if (!response?.success) throw new Error(response?.message || 'Unable to load senior citizens');
      setItems(response.data.items || []);
      setTotal(Number(response.data.total || 0));
      setStats(response.data.stats || null);
      setConditionOptions(response.data.filterOptions?.conditions || []);
    } catch (loadError) {
      setError(loadError?.response?.data?.message || loadError.message || 'Unable to load senior citizens');
    } finally {
      setLoading(false);
    }
  }, [state]);

  useEffect(() => {
    if (!isNew) load();
  }, [isNew, load]);
  useEffect(() => setSearchDraft(state.search), [state.search]);
  useEffect(() => {
    if (isNew || searchDraft === state.search) return undefined;
    const timer = setTimeout(() => updateState({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [isNew, searchDraft, state.search, updateState]);
  useEffect(() => {
    if (highlight) {
      const timer = setTimeout(() => setHighlight(''), 3500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [highlight]);
  useEffect(() => {
    const handleSlashShortcut = (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
      );
      if (event.key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey && !isTyping && !isNew) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleSlashShortcut);
    return () => window.removeEventListener('keydown', handleSlashShortcut);
  }, [isNew]);

  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['search', 'condition', 'ageGroup', 'sitio'].forEach((key) => next.delete(key));
    next.set('sort', 'newest');
    next.set('page', '1');
    setSearchParams(next);
    setSearchDraft('');
  };
  const viewResident = (resident) => navigate(`/residents/${resident.resident_id}`);
  if (isNew) {
    return <SeniorForm editId={editId} onCancel={() => navigate('/senior-citizens')} onSaved={(id, offline) => {
      navigate(`/senior-citizens?highlight=${id}`);
      setToast(offline
        ? 'Record saved on this device. It will synchronize when the connection is restored.'
        : editId ? 'Senior registration updated successfully.' : 'Senior registered successfully.');
    }} />;
  }

  const hasActiveFilters = Boolean(state.search || state.condition || state.ageGroup || state.sitio || state.sort !== 'newest');
  const activeFilters = [
    ['search', 'Search', state.search],
    ['condition', 'Condition', state.condition],
    ['ageGroup', 'Age', AGE_GROUPS.find(([value]) => value === state.ageGroup)?.[1]],
    ['sitio', 'Sitio', state.sitio],
    ['sort', 'Sort', state.sort !== 'newest' ? state.sort.replace(/_/g, ' ') : ''],
  ].filter(([, , value]) => value);
  const sortBy = (ascending, descending) => updateState({ sort: state.sort === ascending ? descending : ascending });
  const sortHeader = (label, ascending, descending) => {
    const activeSort = state.sort === ascending || state.sort === descending;
    const direction = state.sort === ascending ? 'ascending' : state.sort === descending ? 'descending' : 'none';
    const SortIcon = !activeSort ? ArrowUpDown : direction === 'ascending' ? ArrowUp : ArrowDown;
    return <th scope="col" aria-sort={direction}><button type="button" className="senior-sort-button" onClick={() => sortBy(ascending, descending)}>{label}<SortIcon size={14} strokeWidth={1.8} aria-hidden="true" /></button></th>;
  };
  const renderActions = (resident) => (
    <SeniorRowActions
      key={resident.senior_id}
      resident={resident}
      onEdit={(row) => navigate(`/senior-citizens/${row.senior_id}/edit`)}
    />
  );
  const renderSkeletons = () => (
    <>
      <div className="senior-table-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className="senior-skeleton-row" key={index}><span /><span /><span /><span /><span /><span /></div>)}</div>
      <div className="senior-card-skeleton" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <div className="senior-skeleton-card" key={index}><span /><span /><span /></div>)}</div>
    </>
  );
  const renderTable = () => (
    <div className="senior-table-scroll">
      <table className="senior-table">
        <thead><tr>
          {sortHeader('Resident', 'name_asc', 'name_desc')}
          {sortHeader('Senior ID', 'senior_id', 'senior_id_desc')}
          {sortHeader('Age', 'age_youngest', 'age_oldest')}
          <th scope="col">Contact</th><th scope="col" className="senior-hide-tablet">Emergency contact</th>
          <th scope="col">Conditions</th>{sortHeader('Registered', 'oldest', 'newest')}<th scope="col"><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          {items.map((resident) => {
            const age = resident.age ?? calculateAge(resident.birthdate);
            const fullName = getSeniorName(resident);
            return (
              <tr key={resident.senior_id} className={String(resident.senior_id) === highlight ? 'senior-highlight' : ''}
                tabIndex={0} aria-label={`View resident ${fullName}`}
                onClick={(event) => { if (!event.target.closest('a, button')) viewResident(resident); }}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('a, button')) {
                    event.preventDefault();
                    viewResident(resident);
                  }
                }}>
                <td data-label="Resident">
                  <SeniorResidentIdentity resident={resident} onView={(event) => event.stopPropagation()} />
                  <span className="senior-household"><House size={14} strokeWidth={1.8} aria-hidden="true" />Household {resident.household_no || <i>Not provided</i>}</span>
                  <span className="senior-table-hidden-details">
                    <span><span className="senior-cell-label">Emergency contact</span>{resident.emergency_contact_name || <i>Not provided</i>}{resident.emergency_contact_number && <PhoneValue value={resident.emergency_contact_number} label="Emergency contact number" />}</span>
                    <span><span className="senior-cell-label">Registered</span><span className="senior-date"><CalendarDays size={14} aria-hidden="true" />{formatDateOnly(resident.date_registered, { month: 'short', day: 'numeric', year: 'numeric' }) || <i>Not provided</i>}</span></span>
                  </span>
                </td>
                <td data-label="Senior ID"><span className="senior-id">{resident.senior_citizen_id || <i>Not provided</i>}</span></td>
                <td data-label="Age"><AgeBadge age={age} /></td>
                <td data-label="Contact"><PhoneValue value={resident.contact_number || resident.contact_no} /></td>
                <td data-label="Emergency contact" className="senior-hide-tablet">
                  {resident.emergency_contact_name
                    ? <span className="senior-emergency-value" title={resident.emergency_contact_name}>{resident.emergency_contact_name}{resident.emergency_contact_number && <PhoneValue value={resident.emergency_contact_number} label="Emergency contact number" />}</span>
                    : resident.emergency_contact_number
                      ? <PhoneValue value={resident.emergency_contact_number} label="Emergency contact number" />
                      : <span className="senior-not-provided">No emergency contact</span>}
                </td>
                <td data-label="Conditions"><ConditionChips value={resident.health_conditions} /></td>
                <td data-label="Registered" className="senior-hide-tablet"><span className="senior-date"><CalendarDays size={15} strokeWidth={1.8} aria-hidden="true" />{formatDateOnly(resident.date_registered, { month: 'short', day: 'numeric', year: 'numeric' }) || <i>Not provided</i>}</span></td>
                <td data-label="Actions">{renderActions(resident)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <main className="senior-registry-page">
      <nav className="senior-registry-breadcrumb" aria-label="Breadcrumb">
        <Link to="/residents">Residents</Link><span aria-hidden="true">/</span><span aria-current="page">Senior Registry</span>
      </nav>
      <PageBanner
        className="senior-registry-banner"
        icon={UsersRound}
        eyebrow="Community health system"
        title="Senior Registry"
        subtitle="Manage registrations and contact information for senior residents."
        actions={<Link className="senior-register-button" to="/senior-citizens/new"><UserPlus size={17} strokeWidth={1.8} aria-hidden="true" />Register senior</Link>}
      />

      <section className="senior-stat-grid" aria-label="Senior registry statistics" aria-busy={loading}>
        <StatCard icon={UsersRound} label="Registered Seniors" value={stats?.registered ?? null} />
        <StatCard icon={Award} label="Aged 80+" value={stats?.age80Plus ?? null} />
        <StatCard icon={Stethoscope} label="With Known Conditions" value={stats?.knownConditions ?? null} />
        <StatCard icon={UserPlus} label="Registered This Month" value={stats?.registeredThisMonth ?? null} />
      </section>

      {toast && <div className="senior-toast" role="status" aria-live="polite">{toast}</div>}

      <section className="senior-filter-card" aria-label="Senior registry filters">
        <div className="senior-filter-controls">
          <label className="senior-search-control" htmlFor="senior-registry-search">
            <Search size={17} strokeWidth={1.8} aria-hidden="true" />
            <input ref={searchRef} id="senior-registry-search" aria-label="Search senior registry" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search name, ID, contact, or condition" autoComplete="off" />
            {searchDraft ? <button type="button" className="senior-clear-search" aria-label="Clear search" onClick={() => { setSearchDraft(''); updateState({ search: '' }); }}><X size={16} aria-hidden="true" /></button> : <span className="senior-shortcut" aria-hidden="true">/</span>}
          </label>
          <label className="senior-filter-select">
            <Stethoscope size={16} aria-hidden="true" />
            <select aria-label="Health condition" value={state.condition} onChange={(event) => updateState({ condition: event.target.value })}>
              <option value="">All conditions</option>{conditionOptions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
          <label className="senior-filter-select">
            <CalendarRange size={16} aria-hidden="true" />
            <select aria-label="Age group" value={state.ageGroup} onChange={(event) => updateState({ ageGroup: event.target.value })}>
              {AGE_GROUPS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
          <label className="senior-filter-select">
            <ArrowUpDown size={16} aria-hidden="true" />
            <select aria-label="Sort seniors" value={state.sort} onChange={(event) => updateState({ sort: event.target.value })}>
              <option value="newest">Newest registered</option><option value="oldest">Oldest registered</option>
              <option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option>
              <option value="age_oldest">Age: oldest first</option><option value="age_youngest">Age: youngest first</option>
              <option value="senior_id">Senior ID: low to high</option><option value="senior_id_desc">Senior ID: high to low</option>
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
          {hasActiveFilters && <button type="button" className="senior-clear-filters" onClick={clearFilters}><RotateCcw size={15} aria-hidden="true" />Clear filters</button>}
        </div>
        {activeFilters.length > 0 && <div className="senior-active-filters" aria-label="Active filters">
          {activeFilters.map(([key, label, value]) => <span className="senior-filter-chip" key={key}>
            <span className="senior-filter-chip-label">{label}:</span> {value}
            <button type="button" aria-label={`Remove ${label} filter`} onClick={() => { if (key === 'search') setSearchDraft(''); updateState({ [key]: key === 'sort' ? 'newest' : '' }); }}><X size={13} aria-hidden="true" /></button>
          </span>)}
        </div>}
      </section>

      <section className="senior-table-card" aria-label="Registered seniors" aria-busy={loading}>
        <header className="senior-table-card-header">
          <div><h2>Registered seniors</h2><p>Registry records and resident contact details</p></div>
          <span className="senior-record-count">{total.toLocaleString()} {total === 1 ? 'record' : 'records'}</span>
        </header>
        {error ? (
          <div className="senior-state" role="alert">
            <span className="senior-state-icon is-error"><CircleAlert size={22} strokeWidth={1.8} aria-hidden="true" /></span>
            <h3>Unable to load senior citizens</h3><p>{error}</p>
            <button className="senior-secondary-button" type="button" onClick={load}>Retry</button>
          </div>
        ) : loading ? renderSkeletons() : total === 0 ? (
          <div className="senior-state">
            <span className="senior-state-icon"><UsersRound size={22} strokeWidth={1.8} aria-hidden="true" /></span>
            <h3>{hasActiveFilters ? 'No seniors found' : 'No seniors registered yet'}</h3>
            <p>{hasActiveFilters ? 'Try changing or clearing the active filters.' : 'Register an eligible resident to add them to this registry.'}</p>
            {hasActiveFilters
              ? <button className="senior-secondary-button" type="button" onClick={clearFilters}>Clear filters</button>
              : <Link className="senior-register-button" to="/senior-citizens/new"><UserPlus size={17} aria-hidden="true" />Register senior</Link>}
          </div>
        ) : (
          <>
            <div className="senior-table-view">{renderTable()}</div>
            <div className="senior-mobile-list">
              {items.map((resident) => (
                <SeniorMobileCard
                  key={resident.senior_id}
                  resident={resident}
                  age={resident.age ?? calculateAge(resident.birthdate)}
                  onView={() => viewResident(resident)}
                  actions={renderActions(resident)}
                />
              ))}
            </div>
          </>
        )}
        {total > 0 && !error && <footer className="senior-pagination">
          <Pagination currentPage={state.page} totalPages={totalPages}
            first={(state.page - 1) * state.pageSize + 1} last={Math.min(state.page * state.pageSize, total)}
            total={total} itemLabel="seniors" pageSize={state.pageSize} pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(pageSize) => updateState({ pageSize })} onPageChange={(page) => updateState({ page })}
            compactButtons formatCounts />
        </footer>}
      </section>
    </main>
  );
}

function SeniorForm({editId,onCancel,onSaved}) {
 const [form,setForm]=useState({resident_id:'',date_registered:getLocalDateInputValue(),senior_citizen_id:'',contact_number:'',emergency_contact_name:'',emergency_contact_number:'',health_conditions:''});const [resident,setResident]=useState(null);const [query,setQuery]=useState('');const [results,setResults]=useState([]);const [suggestionsOpen,setSuggestionsOpen]=useState(false);const [conditions,setConditions]=useState([]);const [conditionSuggestions,setConditionSuggestions]=useState([]);const [conditionSuggestionsError,setConditionSuggestionsError]=useState('');const [errors,setErrors]=useState({});const [saving,setSaving]=useState(false);const [status,setStatus]=useState('');
 useEffect(()=>{let active=true;listSeniorCitizens({page:1,pageSize:10}).then(r=>{if(!r?.success)throw new Error(r?.message||'Unable to load condition suggestions.');if(active)setConditionSuggestions(r.data.filterOptions?.conditions||[]);}).catch(error=>{if(active)setConditionSuggestionsError(error?.response?.data?.message||error.message||'Condition suggestions are unavailable.');});return()=>{active=false;};},[]);
 useEffect(()=>{if(editId){getSeniorCitizen(editId).then(r=>{if(r?.success){const d=r.data;setResident(d);setQuery(formatResidentName(d));setForm({resident_id:d.resident_id,date_registered:d.date_registered,senior_citizen_id:d.senior_citizen_id||'',contact_number:d.contact_number||d.contact_no||'',emergency_contact_name:d.emergency_contact_name||'',emergency_contact_number:d.emergency_contact_number||'',health_conditions:d.health_conditions||''});setConditions(String(d.health_conditions||'').split(',').map(v=>v.trim()).filter(Boolean));}}).catch(()=>setStatus('Unable to load this registration'));}else{getNextSeniorId().then(r=>{if(r?.success)setForm(v=>({...v,senior_citizen_id:r.data.senior_citizen_id}));}).catch(()=>{});}},[editId]);
 useEffect(()=>{if(query.trim().length<2||resident){setResults([]);return;}const t=setTimeout(async()=>{try{const r=await searchEligibleResidents(query.trim());setResults(r.success ? (r.data || []) : []);}catch{setResults([])}},300);return()=>clearTimeout(t);},[query,resident]);
 const age=useMemo(()=>resident?calculateAge(resident.birthdate,form.date_registered?new Date(`${form.date_registered}T00:00:00`):new Date()):null,[resident,form.date_registered]);
 const valid=Boolean(resident&&form.date_registered&&form.contact_number.trim()&&!Object.values(errors).some(Boolean));
 const clearError=(key)=>setErrors(current=>{const next={...current};delete next[key];return next;});
 const change=(k,v)=>{setForm(f=>({...f,[k]:v}));clearError(k);setStatus('');};
 useEffect(()=>{if(resident)setErrors(current=>{if(!current.resident_id)return current;const next={...current};delete next.resident_id;return next;});},[resident]);
 const addCondition=(value)=>{const v=value.trim();if(!v)return;if(v==='No known conditions'){setConditions(['No known conditions']);}else if(!conditions.includes(v)&&!conditions.includes('No known conditions'))setConditions(c=>[...c,v]);};
 const submit=async(e)=>{e.preventDefault();const next={};if(!resident)next.resident_id='Please select a resident.';else if(age<60)next.resident_id='The resident must be at least 60 on the registration date.';if(!form.contact_number)next.contact_number='Contact number is required.';else if(!PHONE_RE.test(String(form.contact_number).replace(/[\s()-]/g,'')))next.contact_number='Enter a valid Philippine mobile number.';if(form.emergency_contact_number&&!PHONE_RE.test(String(form.emergency_contact_number).replace(/[\s()-]/g,'')))next.emergency_contact_number='Enter a valid Philippine mobile number.';if(!form.date_registered||form.date_registered>getLocalDateInputValue())next.date_registered='Use today or an earlier date.';setErrors(next);if(Object.keys(next).length)return;setSaving(true);try{const payload={...form,resident_id:resident.resident_id,health_conditions:conditions.join(', ')};const r=editId?await updateSeniorCitizen(editId,payload):await createSeniorCitizen(payload);if(r.success)onSaved(r.data?.senior_id||r.data?.record_id||r.data?.id||editId||resident.resident_id,Boolean(r.offline||r.queued));else throw r;}catch(e){const data=e?.response?.data||e;if(data?.errors)setErrors(data.errors);else setStatus(data?.message||'Unable to register senior citizen');}finally{setSaving(false);}};
 return <main className="senior-registry-page"><nav className="senior-breadcrumb"><Link to="/senior-citizens">Senior Registry</Link> / Register senior</nav><div className="senior-registry-heading"><div><h1>Register senior</h1><p>Add an eligible resident to the Senior Registry.</p></div></div>{status&&<div className="senior-form-error">{status}</div>}<form className="senior-form" onSubmit={submit}><section className="senior-form-card"><h2><span>01</span>Senior details</h2><p>Select a resident aged 60 or older who is not already registered.</p><div className="senior-form-grid"><div className="senior-field senior-combobox"><label htmlFor="senior-resident">Resident <b>*</b></label>{resident?<div className="senior-resident-summary"><div className="senior-avatar">{resident.first_name?.[0]}{resident.last_name?.[0]}</div><div><strong>{formatResidentName(resident)}</strong><small>{formatResidentOnly(resident)}</small></div><button type="button" onClick={()=>{setResident(null);setQuery('');}}>Change</button></div>:<><input id="senior-resident" role="combobox" aria-expanded={suggestionsOpen} aria-controls="senior-resident-listbox" value={query} onChange={e=>{setQuery(e.target.value);setSuggestionsOpen(true)}} placeholder="Search name, household, or contact"/><small>Type 2 or more characters</small>{suggestionsOpen&&query.trim().length>=2&&<div id="senior-resident-listbox" role="listbox" className="senior-options">{results.length?results.map(r=><button role="option" aria-selected="false" type="button" key={r.resident_id} onClick={()=>{setResident(r);setForm(f=>({...f,resident_id:r.resident_id,contact_number:r.contact_no||''}));setSuggestionsOpen(false)}}><strong>{formatResidentName(r)}</strong><small>{r.age} yrs · Household {r.household_no||'—'} · {r.sitio||'No sitio'}</small></button>):<div className="senior-no-results">No eligible residents found.<small>Residents become eligible at age 60. Check their profile birthdate.</small></div>}</div>}</>}{errors.resident_id&&<span className="senior-field-error">{errors.resident_id}</span>}</div><div className="senior-field"><label htmlFor="senior-date">Date registered <b>*</b></label><input id="senior-date" type="date" max={getLocalDateInputValue()} value={form.date_registered} onChange={e=>change('date_registered',e.target.value)} aria-invalid={Boolean(errors.date_registered)} />{errors.date_registered&&<span className="senior-field-error">{errors.date_registered}</span>}</div><div className="senior-field"><label>Age detected</label><input value={age??''} readOnly aria-describedby="senior-age-hint"/><small id="senior-age-hint">Calculated from birthdate</small></div><div className="senior-field"><label htmlFor="senior-id">Senior citizen ID <b>*</b></label><input id="senior-id" className="senior-mono" value={form.senior_citizen_id} onChange={e=>change('senior_citizen_id',e.target.value)} aria-invalid={Boolean(errors.senior_citizen_id)} />{errors.senior_citizen_id&&<span className="senior-field-error">{errors.senior_citizen_id}</span>}</div></div></section>
  <section className="senior-form-card"><h2><span>02</span>Contact & emergency</h2><p>Keep the senior and emergency contact reachable.</p><div className="senior-form-grid"><div className="senior-field"><label htmlFor="senior-contact">Contact number <b>*</b></label><input id="senior-contact" value={form.contact_number} onChange={e=>change('contact_number',e.target.value)} placeholder="0912 345 6789" aria-invalid={Boolean(errors.contact_number)} />{errors.contact_number&&<span className="senior-field-error">{errors.contact_number}</span>}</div><div className="senior-field"><label htmlFor="emergency-name">Emergency contact name</label><input id="emergency-name" value={form.emergency_contact_name} onChange={e=>change('emergency_contact_name',e.target.value)}/></div><div className="senior-field"><label htmlFor="emergency-contact">Emergency contact number</label><input id="emergency-contact" value={form.emergency_contact_number} onChange={e=>change('emergency_contact_number',e.target.value)} placeholder="0912 345 6789"/><small>Optional, but strongly recommended</small>{errors.emergency_contact_number&&<span className="senior-field-error">{errors.emergency_contact_number}</span>}</div></div></section>
  <section className="senior-form-card"><h2><span>03</span>Medical information</h2><p>Add known conditions; free typing creates a new chip.</p><div className="senior-chip-input"><div className="senior-selected-chips">{conditions.map(v=><button type="button" key={v} onClick={()=>setConditions(c=>c.filter(x=>x!==v))} aria-label={`Remove ${v}`}>{v} <X size={14} strokeWidth={1.8} aria-hidden="true" /></button>)}</div><input aria-label="Add health condition" placeholder="Type and press Enter" onKeyDown={e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();addCondition(e.currentTarget.value);e.currentTarget.value='';}if(e.key==='Backspace'&&!e.currentTarget.value)setConditions(c=>c.slice(0,-1));}} list="senior-condition-options"/><datalist id="senior-condition-options">{conditionSuggestions.map(v=><option key={v} value={v}/>)}</datalist></div>{conditionSuggestionsError&&<small className="senior-field-error" role="status">{conditionSuggestionsError} You can still type a condition.</small>}</section>
  <div className="senior-sticky-actions"><button className="senior-secondary" type="button" onClick={onCancel}>Cancel</button><button className="senior-primary" type="submit" disabled={!valid||saving}>{saving?'Registering…':'Register senior'}</button></div></form></main>;
}
function formatResidentOnly(r){return `${r.birthdate?formatDateOnly(r.birthdate,{month:'short',day:'numeric',year:'numeric'}):'Birthdate unknown'} · ${r.sex||'Sex unknown'} · ${r.sitio||'No sitio'}`}
