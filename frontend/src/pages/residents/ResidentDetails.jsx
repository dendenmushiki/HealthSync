import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  Check,
  Circle,
  ChevronRight,
  ClipboardList,
  Copy as CopyIcon,
  House,
  MoreHorizontal,
  Pencil,
  Printer,
  Plus,
  Stethoscope,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { listAllHealthRecords } from '../../services/api/healthRecordService';
import { listNutritionRecords } from '../../services/api/nutritionRecordsService';
import { getResident, getResidentSummary } from '../../services/api/residentService';
import Pagination from '../../components/common/Pagination';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateOnly } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import offlineQueue from '../../services/offline/offlineQueueService';

const TABS = [
  ['overview', 'Overview', 'person'],
  ['records', 'Health Records', 'clipboard'],
  ['visits', 'Nutritional Assessment History', 'calendar'],
  ['activity', 'Activity Log', 'activity']
];
const HISTORY_PAGE_SIZE = 10;

const RECORD_TYPES = [
  ['clinical', 'Clinical Record', 'Visit notes, vital signs, history, assessment, and plan.', 'Clinical notes'],
  ['child', 'Child Record', 'Child visits, medical history, and birth/immunization history.', 'Child health'],
  ['maternal', 'Maternal Record', 'Maternal visits, pregnancy details, and medical history.', 'Maternal health'],
  ['immunization', 'Immunization Record', 'Immunization details, screening, and growth measurements.', 'Immunization']
];

const ICONS = {
  person: UserRound,
  home: House,
  medical: Stethoscope,
  clipboard: ClipboardList,
  activity: Activity,
  calendar: CalendarDays,
  alert: TriangleAlert,
  check: Check,
  circle: Circle,
  more: MoreHorizontal,
  copy: CopyIcon,
  chevron: ChevronRight,
  edit: Pencil,
  printer: Printer,
  plus: Plus,
};

const Icon = ({ name, className = '', size = 18 }) => {
  const LucideIcon = ICONS[name] || Activity;
  return <LucideIcon className={`resident-details-icon ${className}`} size={size} strokeWidth={1.8} aria-hidden="true" />;
};

const formatDate = (value, options = {}) => {
  if (!value) return null;
  return formatDateOnly(value, { month: 'short', ...options });
};

const formatPhone = (value) => {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('09')) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return String(value);
};

const formatBreadcrumbName = (resident) => {
  const firstName = resident.first_name || '';
  const middleInitial = resident.middle_name ? `${resident.middle_name.trim().charAt(0)}.` : '';
  const givenNames = [firstName, middleInitial].filter(Boolean).join(' ');
  return [resident.last_name, givenNames].filter(Boolean).join(', ');
};

const capitalize = (value) => {
  if (!value) return value;
  return String(value).toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
};

const relativeTime = (value) => {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return formatDate(value) || '';
};

const createEmptySummary = (resident) => ({
  resident,
  records: Object.fromEntries(RECORD_TYPES.map(([type]) => [type, { exists: false, lastUpdated: null, count: 0 }])),
  healthSnapshot: { weightKg: null, heightCm: null, bmi: null, nutritionStatus: null, lastVisitDate: null, nextCheckupDue: null, nextImmunizationDue: null, alerts: [] },
  recentActivity: [],
  lastUpdated: null,
  offline: true
});

async function loadAllResidentPages(fetchPage, residentId) {
  const items = [];
  const pageSize = 50;
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await fetchPage({
      resident_id: residentId,
      page,
      pageSize,
      sort: 'date',
      order: 'desc',
    });
    const data = response?.data;
    if (!response?.success || !Array.isArray(data?.items)) {
      throw new Error(response?.message || 'Unable to load resident records.');
    }

    items.push(...data.items);
    const reportedPages = Number(data.pagination?.totalPages);
    if (Number.isFinite(reportedPages)) {
      totalPages = reportedPages;
    } else {
      const total = Number(data.total);
      const returnedPageSize = Number(data.pageSize) || pageSize;
      totalPages = Number.isFinite(total)
        ? Math.ceil(total / returnedPageSize)
        : data.items.length === pageSize ? page + 1 : page;
    }
    page += 1;
  }

  return items;
}

const CopyButton = ({ value, label, onCopied }) => {
  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(value));
      } else {
        const temporaryInput = document.createElement('textarea');
        temporaryInput.value = String(value);
        temporaryInput.setAttribute('readonly', '');
        temporaryInput.style.position = 'fixed';
        temporaryInput.style.opacity = '0';
        document.body.appendChild(temporaryInput);
        temporaryInput.select();
        const copied = document.execCommand('copy');
        temporaryInput.remove();
        if (!copied) throw new Error('Clipboard access is unavailable.');
      }
      onCopied(`${label} copied.`);
    } catch (error) {
      onCopied(`Unable to copy ${label.toLowerCase()}.`, true);
    }
  };

  return <button type="button" className="resident-copy-button" onClick={handleCopy} aria-label={`Copy ${label}`} title={`Copy ${label}`}><Icon name="copy" /></button>;
};

const InfoField = ({ label, value, editHref, copy, onCopied, mono = false }) => (
  <div className="resident-info-field">
    <dt>{label}</dt>
    <dd className={mono ? 'resident-mono-value' : ''}>
      {value ? <>{value}{copy && <CopyButton value={copy} label={label} onCopied={onCopied} />}</> : <><span className="resident-not-provided">Not provided</span>{editHref && <Link className="resident-add-link" to={editHref}>Add</Link>}</>}
    </dd>
  </div>
);

const InfoCard = ({ title, icon, fields }) => (
  <section className="resident-detail-info-card">
    <h2><span className="resident-info-card-icon"><Icon name={icon} /></span>{title}</h2>
    <dl className="resident-info-grid">{fields}</dl>
  </section>
);

const StatusBadge = ({ status }) => {
  const normalized = String(status || 'Active').toLowerCase();
  const className = ['inactive', 'deceased', 'transferred'].includes(normalized) ? 'muted' : 'active';
  return <span className={`resident-status-badge resident-status-${className}`}><Icon name={className === 'active' ? 'check' : 'circle'} size={14} />{capitalize(status || 'Active')}</span>;
};

const ResidentDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [offlineNotice, setOfflineNotice] = useState('');
  const [healthRecords, setHealthRecords] = useState(null);
  const [healthRecordsLoading, setHealthRecordsLoading] = useState(false);
  const [healthRecordsError, setHealthRecordsError] = useState('');
  const [healthRecordsRetry, setHealthRecordsRetry] = useState(0);
  const [healthRecordsPage, setHealthRecordsPage] = useState(1);
  const [nutritionRecords, setNutritionRecords] = useState(null);
  const [nutritionRecordsLoading, setNutritionRecordsLoading] = useState(false);
  const [nutritionRecordsError, setNutritionRecordsError] = useState('');
  const [nutritionRecordsRetry, setNutritionRecordsRetry] = useState(0);
  const [nutritionRecordsPage, setNutritionRecordsPage] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);
  const activeTab = TABS.some(([tab]) => tab === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const resident = summary?.resident;
  const editHref = `/residents/${id}/edit`;
  const healthRecordsTotal = healthRecords?.length || 0;
  const healthRecordsTotalPages = Math.ceil(healthRecordsTotal / HISTORY_PAGE_SIZE);
  const currentHealthRecordsPage = Math.min(healthRecordsPage, Math.max(healthRecordsTotalPages, 1));
  const firstHealthRecord = healthRecordsTotal ? (currentHealthRecordsPage - 1) * HISTORY_PAGE_SIZE + 1 : 0;
  const lastHealthRecord = Math.min(currentHealthRecordsPage * HISTORY_PAGE_SIZE, healthRecordsTotal);
  const visibleHealthRecords = (healthRecords || []).slice(firstHealthRecord - 1, lastHealthRecord);
  const nutritionRecordsTotal = nutritionRecords?.length || 0;
  const nutritionRecordsTotalPages = Math.ceil(nutritionRecordsTotal / HISTORY_PAGE_SIZE);
  const currentNutritionRecordsPage = Math.min(nutritionRecordsPage, Math.max(nutritionRecordsTotalPages, 1));
  const firstNutritionRecord = nutritionRecordsTotal ? (currentNutritionRecordsPage - 1) * HISTORY_PAGE_SIZE + 1 : 0;
  const lastNutritionRecord = Math.min(currentNutritionRecordsPage * HISTORY_PAGE_SIZE, nutritionRecordsTotal);
  const visibleNutritionRecords = (nutritionRecords || []).slice(firstNutritionRecord - 1, lastNutritionRecord);

  useEffect(() => {
    if (typeof id !== 'string' || !id.startsWith('offline:')) return undefined;
    let active = true;
    offlineQueue.getResidentIdMapping(id).then((mapping) => {
      if (!active || !mapping?.serverResidentId) return;
      const next = `/residents/${mapping.serverResidentId}`;
      navigate(`${next}${window.location.search}${window.location.hash}`, { replace: true });
    }).catch(() => {});
    return () => { active = false; };
  }, [id, navigate]);

  const showToast = useCallback((message, isError = false) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setOfflineNotice('');
    try {
      const response = await getResidentSummary(id);
      if (!response?.success || !response.data?.resident) throw new Error(response?.message || 'Unable to load resident details.');
      setSummary(response.data);
    } catch (error) {
      if (!error.response) {
        try {
          const cached = await getResident(id);
          if (cached?.success && cached.data) {
            setSummary(createEmptySummary(cached.data));
            setOfflineNotice('Offline view: only classifications previously loaded on this device are available.');
            return;
          }
        } catch (offlineError) {
          setLoadError({ message: 'This resident is not available offline. Connect to the internet and try again.' });
          return;
        }
      }
      setLoadError({
        notFound: error.response?.status === 404,
        message: error.response?.data?.message || error.message || 'Unable to load resident details.'
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadSummary();
    return () => window.clearTimeout(toastTimer.current);
  }, [loadSummary]);

  useEffect(() => {
    setHealthRecordsPage(1);
    setNutritionRecordsPage(1);
  }, [id]);

  useEffect(() => {
    if (activeTab !== 'records') return undefined;
    let active = true;
    setHealthRecords(null);
    setHealthRecordsLoading(true);
    setHealthRecordsError('');
    loadAllResidentPages(listAllHealthRecords, id)
      .then((records) => { if (active) setHealthRecords(records); })
      .catch((error) => { if (active) setHealthRecordsError(error.response?.data?.message || error.message || 'Unable to load this resident’s health records.'); })
      .finally(() => { if (active) setHealthRecordsLoading(false); });
    return () => { active = false; };
  }, [activeTab, healthRecordsRetry, id]);

  useEffect(() => {
    if (activeTab !== 'visits') return undefined;
    let active = true;
    setNutritionRecords(null);
    setNutritionRecordsLoading(true);
    setNutritionRecordsError('');
    loadAllResidentPages(listNutritionRecords, id)
      .then((records) => { if (active) setNutritionRecords(records); })
      .catch((error) => { if (active) setNutritionRecordsError(error.response?.data?.message || error.message || 'Unable to load this resident’s nutritional assessments.'); })
      .finally(() => { if (active) setNutritionRecordsLoading(false); });
    return () => { active = false; };
  }, [activeTab, nutritionRecordsRetry, id]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const items = menuRef.current?.querySelectorAll('[role="menuitem"]') || [];
    items[0]?.focus();
    const handleMenuKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const index = Array.from(items).indexOf(document.activeElement);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + direction + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('keydown', handleMenuKeyDown);
    return () => document.removeEventListener('keydown', handleMenuKeyDown);
  }, [menuOpen]);

  const categories = useMemo(() => {
    if (!resident) return [];
    const age = resident.age ?? calculateAge(resident.birthdate);
    const flags = Array.isArray(resident.category_flags) ? resident.category_flags : [];
    const values = [];
    if (age !== null && age >= 60) values.push('Senior');
    if (age !== null && age < 18) values.push('Child');
    if (resident.pregnant) values.push('Pregnant');
    if (resident.lactating) values.push('Lactating');
    if (summary?.records?.maternal?.exists && !values.includes('Pregnant') && !values.includes('Lactating')) values.push('Maternal');
    if (flags.includes('PWD')) values.push('PWD');
    if (resident.is_4ps) values.push('4Ps member');
    if (summary?.healthSnapshot?.alerts?.some((alert) => /nutrition/i.test(alert.title))) values.push('Nutrition follow-up');
    return [...new Set(values)];
  }, [resident, summary]);

  const setTab = (nextTab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', nextTab);
    setSearchParams(nextParams);
  };

  const handleTabKeyDown = (event) => {
    const currentIndex = TABS.findIndex(([tab]) => tab === activeTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    const nextTab = TABS[nextIndex][0];
    setTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`resident-tab-${nextTab}`)?.focus());
  };

  const printSummary = () => {
    setTab('overview');
    window.setTimeout(() => window.print(), 100);
    setMenuOpen(false);
  };

  if (loading) {
    return <main className="resident-details-page resident-details-loading" aria-busy="true" aria-label="Loading resident details">
      <div className="resident-skeleton resident-skeleton-breadcrumb" />
      <div className="resident-skeleton resident-skeleton-profile" />
      <div className="resident-skeleton resident-skeleton-tabs" />
      <div className="resident-details-overview-layout"><div><div className="resident-skeleton resident-skeleton-card" /><div className="resident-skeleton resident-skeleton-card" /></div><div><div className="resident-skeleton resident-skeleton-card" /></div></div>
    </main>;
  }

  if (loadError || !resident) {
    return <main className="resident-details-page">
      <section className="resident-load-error" role="alert">
        <span className="resident-error-symbol"><Icon name={loadError?.notFound ? 'alert' : 'activity'} /></span>
        <h1>{loadError?.notFound ? 'Resident not found' : 'Unable to load resident'}</h1>
        <p>{loadError?.message || 'The requested resident could not be found.'}</p>
        <div className="resident-error-actions"><button className="resident-primary-button" type="button" onClick={loadSummary}>Try again</button><Link className="resident-secondary-button" to="/residents">Back to Residents</Link></div>
      </section>
    </main>;
  }

  const age = resident.age ?? calculateAge(resident.birthdate);
  const fullName = formatResidentName(resident);
  const birthdate = formatDate(resident.birthdate, { month: 'long', day: 'numeric' });
  const status = resident.resident_status || 'Active';
  const initials = `${resident.first_name?.charAt(0) || ''}${resident.last_name?.charAt(0) || ''}`.toUpperCase() || 'R';
  const avatarColor = [...initials].reduce((total, character) => total + character.charCodeAt(0), 0) % 5;
  const snapshot = summary.healthSnapshot || {};
  const getMetricText = (value, suffix) => value === null || value === undefined ? null : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${suffix}`;
  const isMissingDate = (value) => !value;

  return (
    <main className="resident-details-page">
      <nav className="resident-breadcrumb" aria-label="Breadcrumb">
        <Link to="/residents"><ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />Residents</Link>
        <span className="resident-breadcrumb-divider" aria-hidden="true">/</span>
        <span aria-current="page">{formatBreadcrumbName(resident)}</span>
      </nav>
      {offlineNotice && <div className="resident-offline-notice" role="status">{offlineNotice}</div>}

      <section className="resident-profile-card resident-detail-print" aria-label="Resident profile summary">
        <div className="resident-profile-main">
          {resident.profile_photo
            ? <img className="resident-profile-avatar" src={getProfilePhotoUrl(resident.profile_photo)} alt={`${fullName} profile`} />
            : <div className={`resident-profile-avatar resident-profile-avatar-initials resident-avatar-color-${avatarColor}`} aria-label={`${fullName} initials`}>{initials}</div>}
          <div className="resident-profile-copy">
            <span className="resident-profile-eyebrow">Resident profile</span>
            <div className="resident-name-status"><h1>{fullName}</h1><StatusBadge status={status} />{(resident?.offline === true || resident?.sync_status === 'PENDING') && <span className="healthsync-not-synced-badge">Not synced</span>}</div>
            <p className="resident-profile-meta">{age === null ? 'Age not provided' : `${age} ${age === 1 ? 'year' : 'years'}`}<span aria-hidden="true">·</span>{capitalize(resident.sex) || 'Gender not provided'}{resident.occupation && <><span aria-hidden="true">·</span>{capitalize(resident.occupation)}</>}</p>
            {categories.length > 0 && <div className="resident-category-chips" aria-label="Resident categories">{categories.map((category) => <span className="resident-category-chip" key={category}>{category}</span>)}</div>}
          </div>
        </div>
        <div className="resident-profile-side">
          <div className="resident-overflow-wrap">
            <button ref={menuButtonRef} type="button" className="resident-overflow-button" aria-label="More resident actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name="more" /></button>
            {menuOpen && <div ref={menuRef} className="resident-overflow-menu" role="menu">
              <button type="button" role="menuitem" onClick={printSummary}><Icon name="printer" />Print summary</button>
            </div>}
          </div>
          <Link className="resident-primary-button" to={editHref}><Icon name="edit" />Edit resident</Link>
        </div>
        <div className="resident-quick-facts">
          {[
            ['Household No.', resident.household_no, 'home'],
            ['PhilHealth ID', resident.philhealth_id_no, 'medical'],
            ['Contact No.', formatPhone(resident.contact_no), 'activity']
          ].map(([label, value, icon]) => <div className="resident-quick-fact" key={label}>
            <span className="resident-quick-fact-icon"><Icon name={icon} size={16} /></span>
            <span>{label}</span>
            <strong className={label === 'PhilHealth ID' ? 'resident-mono-value' : ''}>{value || <i>Not provided</i>}</strong>
            {value && <CopyButton value={value} label={label} onCopied={showToast} />}
          </div>)}
        </div>
      </section>

      <div className="resident-detail-tabs" role="tablist" aria-label="Resident details" onKeyDown={handleTabKeyDown}>
        {TABS.map(([tab, title, icon]) => <button key={tab} type="button" id={`resident-tab-${tab}`} role="tab" aria-selected={activeTab === tab} aria-controls={activeTab === tab ? `resident-panel-${tab}` : undefined} tabIndex={activeTab === tab ? 0 : -1} className={`resident-detail-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setTab(tab)}><Icon name={icon} size={16} />{title}</button>)}
      </div>

      {activeTab === 'overview' && <section id="resident-panel-overview" role="tabpanel" aria-labelledby="resident-tab-overview" className="resident-details-overview-layout resident-overview-print">
        <div className="resident-overview-main">
          <InfoCard title="Personal Information" icon="person" fields={[
            <InfoField key="name" label="Full name" value={fullName} editHref={editHref} />,
            <InfoField key="birthdate" label="Date of birth" value={birthdate ? `${birthdate}${age === null ? '' : ` (${age} yrs)`}` : null} editHref={editHref} />,
            <InfoField key="sex" label="Gender" value={capitalize(resident.sex)} editHref={editHref} />,
            <InfoField key="civil-status" label="Civil status" value={capitalize(resident.civil_status)} editHref={editHref} />,
            <InfoField key="occupation" label="Occupation" value={capitalize(resident.occupation)} editHref={editHref} />
          ]} />
          <InfoCard title="Contact & Address" icon="home" fields={[
            <InfoField key="address" label="Address" value={resident.address} editHref={editHref} />,
            <InfoField key="sitio" label="Sitio" value={resident.sitio} editHref={editHref} />,
            <InfoField key="contact" label="Contact number" value={formatPhone(resident.contact_no)} editHref={editHref} copy={resident.contact_no} onCopied={showToast} />,
            <InfoField key="household" label="Household number" value={resident.household_no} editHref={editHref} copy={resident.household_no} onCopied={showToast} mono />
          ]} />
          <InfoCard title="Medical & Administrative" icon="medical" fields={[
            <InfoField key="philhealth" label="PhilHealth ID" value={resident.philhealth_id_no} editHref={editHref} copy={resident.philhealth_id_no} onCopied={showToast} mono />,
            <InfoField key="status" label="Resident status" value={capitalize(status)} />,
            <InfoField key="created-by" label="Created by" value={resident.created_by_name || null} />
          ]} />
        </div>

        <aside className="resident-overview-side">
          <section className="resident-detail-info-card resident-health-snapshot">
            <div className="resident-card-title-row"><h2><span className="resident-info-card-icon"><Icon name="activity" /></span>Health Snapshot</h2></div>
            <div className="resident-snapshot-metrics">
              <div><span>Weight</span><strong>{getMetricText(snapshot.weightKg, 'kg') || <em>No data yet</em>}</strong></div>
              <div><span>Height</span><strong>{getMetricText(snapshot.heightCm, 'cm') || <em>No data yet</em>}</strong></div>
              <div><span>BMI</span><strong>{getMetricText(snapshot.bmi, 'kg/m²') || <em>No data yet</em>}</strong></div>
            </div>
            <div className="resident-snapshot-status"><span>Nutritional status</span>{snapshot.nutritionStatus ? <span className={`resident-nutrition-badge ${/underweight|wast(ed|ing)|stunt(ed|ing)|severe|malnutrition/i.test(snapshot.nutritionStatus) ? 'warning' : 'neutral'}`}>{snapshot.nutritionStatus}</span> : <em>No data yet</em>}</div>
            <div className="resident-snapshot-date"><span>Last visit</span><strong>{formatDate(snapshot.lastVisitDate) || <em>No visit recorded</em>}</strong></div>
            <div className="resident-snapshot-date"><span>Next checkup</span><strong>{isMissingDate(snapshot.nextCheckupDue) ? <em>No due date recorded</em> : formatDate(snapshot.nextCheckupDue)}</strong></div>
            <div className="resident-snapshot-date"><span>Next immunization</span><strong>{isMissingDate(snapshot.nextImmunizationDue) ? <em>No due date recorded</em> : formatDate(snapshot.nextImmunizationDue)}</strong></div>
            <p className="resident-snapshot-hint">Add a clinical or nutrition record to keep this snapshot current.</p>
          </section>

          <section className="resident-detail-info-card resident-alerts-card">
            <h2><span className="resident-info-card-icon"><Icon name="alert" /></span>Alerts</h2>
            {snapshot.alerts?.length ? <ul className="resident-alert-list">{snapshot.alerts.map((alert, index) => <li className={`resident-alert-item ${alert.type}`} key={`${alert.title}-${index}`}><Icon name="alert" /><span><strong>{alert.title}</strong><small>{alert.description}</small></span></li>)}</ul> : <div className="resident-no-alerts"><Icon name="check" /><span><strong>No active alerts</strong><small>No flagged nutrition result is currently recorded.</small></span></div>}
          </section>

          <section className="resident-detail-info-card resident-recent-activity">
            <div className="resident-card-title-row"><h2><span className="resident-info-card-icon"><Icon name="activity" /></span>Recent Activity</h2><button type="button" className="resident-inline-link" onClick={() => setTab('activity')}>View all</button></div>
            {summary.recentActivity?.length ? <ActivityList events={summary.recentActivity.slice(0, 5)} /> : <p className="resident-empty-note">No activity recorded yet.</p>}
          </section>
        </aside>
      </section>}

      {activeTab === 'records' && <section id="resident-panel-records" role="tabpanel" aria-labelledby="resident-tab-records" className="resident-detail-info-card resident-records-panel">
        <div className="resident-panel-heading">
          <div><h2>Health Records</h2><p>Saved clinical, child, maternal, and immunization records for this resident.</p></div>
          <Link className="resident-primary-button" to={`/residents/${id}/medical-records/clinical`}><Icon name="plus" />New clinical record</Link>
        </div>
        {healthRecordsError ? <div className="resident-history-error" role="alert"><p>{healthRecordsError}</p><button className="resident-secondary-button" type="button" onClick={() => setHealthRecordsRetry((retry) => retry + 1)}>Retry</button></div>
          : healthRecordsLoading || healthRecords === null ? <div className="resident-history-loading" role="status" aria-busy="true">Loading health records...</div>
            : healthRecords.length ? <><div className="resident-visit-table-wrap"><table className="resident-visit-table" aria-label="Resident health records"><thead><tr><th scope="col">Date</th><th scope="col">Record</th><th scope="col">Summary</th><th scope="col">Recorded by</th><th scope="col">Action</th></tr></thead><tbody>{visibleHealthRecords.map((record) => {
              const recordHref = `/health-records/${record.record_type}/${encodeURIComponent(`${record.source_table}-${record.record_id}`)}`;
              return <tr key={`${record.source_table}-${record.record_id}`}>
                <td>{formatDate(record.record_date) || 'Date not recorded'}</td>
                <td>{record.record_label || capitalize(record.record_type) || 'Health record'}</td>
                <td>{record.summary ? record.summary : <em>Not provided</em>}</td>
                <td>{record.recorded_by_name || <em>Not provided</em>}</td>
                <td><Link className="resident-record-action" to={recordHref} aria-label={`View ${record.record_label || 'health record'}`}><span>View</span><Icon name="chevron" /></Link></td>
              </tr>;
            })}</tbody></table></div><Pagination currentPage={currentHealthRecordsPage} totalPages={healthRecordsTotalPages} first={firstHealthRecord} last={lastHealthRecord} total={healthRecordsTotal} itemLabel="records" compact onPageChange={setHealthRecordsPage} /></>
              : <div className="resident-empty-state"><Icon name="clipboard" /><h3>No health records yet</h3><p>Saved records for this resident will appear here.</p></div>}
      </section>}

      {activeTab === 'visits' && <section id="resident-panel-visits" role="tabpanel" aria-labelledby="resident-tab-visits" className="resident-detail-info-card">
        <div className="resident-panel-heading"><div><h2>Nutritional Assessment History</h2><p>Operation Timbang, Adolescent BMI, and Adult BMI assessments for this resident.</p></div></div>
        {nutritionRecordsError ? <div className="resident-history-error" role="alert"><p>{nutritionRecordsError}</p><button className="resident-secondary-button" type="button" onClick={() => setNutritionRecordsRetry((retry) => retry + 1)}>Retry</button></div>
          : nutritionRecordsLoading || nutritionRecords === null ? <div className="resident-history-loading" role="status" aria-busy="true">Loading nutritional assessments...</div>
            : nutritionRecords.length ? <><div className="resident-visit-table-wrap"><table className="resident-visit-table" aria-label="Resident nutritional assessment history"><thead><tr><th scope="col">Date</th><th scope="col">Assessment</th><th scope="col">Measurements</th><th scope="col">Result</th><th scope="col">Action</th></tr></thead><tbody>{visibleNutritionRecords.map((record) => {
              const typeKey = {
                'Operation Timbang': 'operation',
                'Adolescent BMI': 'adolescent',
                'Adult BMI': 'adult',
              }[record.record_type];
              const detailHref = `/nutrition?record=${encodeURIComponent(`${typeKey}-${record.id}`)}`;
              const measurements = [
                record.weight_kg === null || record.weight_kg === undefined ? null : `Weight ${getMetricText(record.weight_kg, 'kg')}`,
                record.height_cm === null || record.height_cm === undefined ? null : `Height ${getMetricText(record.height_cm, 'cm')}`,
                record.bmi === null || record.bmi === undefined ? null : `BMI ${getMetricText(record.bmi, 'kg/m²')}`,
              ].filter(Boolean);
              const indicators = Array.isArray(record.indicators) ? record.indicators.filter(Boolean) : [];
              const indicatorSummary = indicators.map((indicator) => (
                typeof indicator === 'string'
                  ? indicator
                  : [indicator.code, indicator.status].filter(Boolean).join(': ')
              )).filter(Boolean).join(', ');
              const status = record.status || 'Not provided';
              return <tr key={`${record.record_type}-${record.id}`}>
                <td>{formatDate(record.record_date) || 'Date not recorded'}</td>
                <td>{record.record_type}</td>
                <td>{measurements.length ? measurements.join(' · ') : <em>Not provided</em>}</td>
                <td><span className={`resident-nutrition-badge ${/normal/i.test(status) ? 'neutral' : 'warning'}`}>{status}</span>{indicatorSummary && <small className="resident-assessment-indicators">{indicatorSummary}</small>}</td>
                <td><Link className="resident-record-action" to={detailHref} aria-label={`View ${record.record_type} assessment`}><span>View</span><Icon name="chevron" /></Link></td>
              </tr>;
            })}</tbody></table></div><Pagination currentPage={currentNutritionRecordsPage} totalPages={nutritionRecordsTotalPages} first={firstNutritionRecord} last={lastNutritionRecord} total={nutritionRecordsTotal} itemLabel="assessments" compact onPageChange={setNutritionRecordsPage} /></>
              : <div className="resident-empty-state"><Icon name="calendar" /><h3>No nutritional assessments yet</h3><p>Assessments for this resident will appear here when available.</p></div>}
      </section>}

      {activeTab === 'activity' && <section id="resident-panel-activity" role="tabpanel" aria-labelledby="resident-tab-activity" className="resident-detail-info-card">
        <div className="resident-panel-heading"><div><h2>Activity Log</h2><p>Recent record activity based on saved record timestamps.</p></div></div>
        {summary.activityLog?.length ? <ActivityList events={summary.activityLog} detailed /> : <div className="resident-empty-state"><Icon name="activity" /><h3>No activity yet</h3><p>New and updated health records will appear here.</p></div>}
      </section>}

      <footer className="resident-details-footer">
        {resident.created_by_name ? <>Created by {resident.created_by_name} · </> : null}
        {formatDate(resident.created_at) || 'Creation date unavailable'}
        {(summary.lastUpdated || resident.created_at) && <> · Last updated {formatDate(summary.lastUpdated || resident.created_at)}</>}
      </footer>

      {toast && <div className={`resident-toast ${toast.isError ? 'error' : ''}`} role={toast.isError ? 'alert' : 'status'}>{toast.message}</div>}
    </main>
  );
};

const ActivityList = ({ events, detailed = false }) => (
  <ol className={`resident-activity-list ${detailed ? 'detailed' : ''}`}>
    {events.map((event) => {
      const date = event.updatedAt || event.createdAt || event.date;
      return <li key={event.id}><span className="resident-activity-marker"><Icon name={event.action === 'Updated' ? 'edit' : 'clipboard'} /></span><div><strong>{event.action} {event.title}</strong><span>{formatDate(event.date || date)}{event.date && date && event.date !== date ? ` · Saved ${formatDate(date)}` : ''}</span></div><time dateTime={date || undefined}>{relativeTime(date)}</time></li>;
    })}
  </ol>
);

export default ResidentDetails;
