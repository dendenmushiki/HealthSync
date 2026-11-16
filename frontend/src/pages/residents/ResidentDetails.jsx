import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { deleteResident, getResident, getResidentSummary } from '../../services/api/residentService';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateOnly } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';

const TABS = [
  ['overview', 'Overview'],
  ['records', 'Health Records'],
  ['visits', 'Visit History'],
  ['activity', 'Activity Log']
];

const RECORD_TYPES = [
  ['clinical', 'Clinical Record', 'Visit notes, vital signs, history, assessment, and plan.', 'Clinical notes'],
  ['child', 'Child Record', 'Child visits, medical history, and birth/immunization history.', 'Child health'],
  ['maternal', 'Maternal Record', 'Maternal visits, pregnancy details, and medical history.', 'Maternal health'],
  ['immunization', 'Immunization Record', 'Immunization details, screening, and growth measurements.', 'Immunization']
];

const ICON_PATHS = {
  person: 'M20 21a8 8 0 0 0-16 0 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  home: 'M3 10.5 12 3l9 7.5 M5 9v12h14V9 M9 21v-7h6v7',
  medical: 'M12 3v18 M3 12h18',
  clipboard: 'M9 4h6 M9 3h6v3H9z M6 5H4v16h16V5h-2 M8 11h8 M8 15h8',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',
  alert: 'M12 3 2.8 20h18.4L12 3z M12 9v5 M12 17h.01',
  check: 'm5 12 4 4L19 6',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  copy: 'M8 8V4h12v12h-4 M4 8h12v12H4z',
  chevron: 'm9 18 6-6-6-6',
  edit: 'm14 5 5 5 M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z',
  printer: 'M6 9V3h12v6 M6 18H4V9h16v9h-2 M6 14h12v7H6z M17 11h.01',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 14h10l1-14 M9 7V4h6v3'
};

const Icon = ({ name, className = '' }) => (
  <svg className={`resident-details-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICON_PATHS[name] || ICON_PATHS.medical} />
  </svg>
);

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
  visitHistory: [],
  recentActivity: [],
  lastUpdated: null,
  offline: true
});

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
  return <span className={`resident-status-badge resident-status-${className}`}><span aria-hidden="true">{className === 'active' ? '✓' : '•'}</span>{capitalize(status || 'Active')}</span>;
};

const ConfirmDeleteModal = ({ name, busy, onCancel, onConfirm }) => {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
      if (event.key !== 'Tab') return;
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel]);

  return (
    <div className="resident-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section ref={dialogRef} className="resident-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="resident-delete-title" aria-describedby="resident-delete-description">
        <div className="resident-delete-icon"><Icon name="trash" /></div>
        <h2 id="resident-delete-title">Delete resident?</h2>
        <p id="resident-delete-description">You are about to permanently delete <strong>{name}</strong> and their related health records. This action cannot be undone.</p>
        <div className="resident-modal-actions">
          <button ref={cancelRef} className="resident-secondary-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button ref={confirmRef} className="resident-danger-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : 'Delete resident'}</button>
        </div>
      </section>
    </div>
  );
};

const ResidentDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [offlineNotice, setOfflineNotice] = useState('');
  const [showAllRecords, setShowAllRecords] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);
  const activeTab = TABS.some(([tab]) => tab === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const resident = summary?.resident;
  const editHref = `/residents/${id}/edit`;

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
            setOfflineNotice('Offline view: only resident details previously loaded on this device are available.');
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

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const response = await deleteResident(id);
      navigate('/residents', { replace: true, state: { residentToast: response?.queued ? 'Resident deletion queued for sync.' : 'Resident deleted.' } });
    } catch (error) {
      setDeleting(false);
      setConfirmDelete(false);
      showToast(error.response?.data?.message || 'Unable to delete resident. Please try again.', true);
    }
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
        <span className="resident-error-symbol" aria-hidden="true">{loadError?.notFound ? '!' : '↻'}</span>
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
  const recordItems = RECORD_TYPES.map(([type, title, description, icon]) => {
    const applicable = type === 'clinical' || summary.records?.[type]?.exists ||
      (type === 'child' && age !== null && age < 18) ||
      (type === 'maternal' && String(resident.sex).toLowerCase() === 'female') ||
      (type === 'immunization' && age !== null && age < 18);
    return { type, title, description, icon, applicable, status: summary.records?.[type] || { exists: false } };
  });
  const visibleRecordItems = showAllRecords ? recordItems : recordItems.filter((item) => item.applicable);
  const getMetricText = (value, suffix) => value === null || value === undefined ? null : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${suffix}`;
  const isMissingDate = (value) => !value;

  return (
    <main className="resident-details-page">
      <nav className="resident-breadcrumb" aria-label="Breadcrumb"><Link to="/residents">Residents</Link><span aria-hidden="true">/</span><span aria-current="page">{formatBreadcrumbName(resident)}</span></nav>
      {offlineNotice && <div className="resident-offline-notice" role="status">{offlineNotice}</div>}

      <section className="resident-profile-card resident-detail-print" aria-label="Resident profile summary">
        <div className="resident-profile-main">
          {resident.profile_photo
            ? <img className="resident-profile-avatar" src={getProfilePhotoUrl(resident.profile_photo)} alt={`${fullName} profile`} />
            : <div className={`resident-profile-avatar resident-profile-avatar-initials resident-avatar-color-${avatarColor}`} aria-label={`${fullName} initials`}>{initials}</div>}
          <div className="resident-profile-copy">
            <div className="resident-name-status"><h1>{fullName}</h1><StatusBadge status={status} /></div>
            <p className="resident-profile-meta">{age === null ? 'Age not provided' : `${age} ${age === 1 ? 'year' : 'years'}`}<span aria-hidden="true">·</span>{capitalize(resident.sex) || 'Sex not provided'}{resident.occupation && <><span aria-hidden="true">·</span>{capitalize(resident.occupation)}</>}</p>
            {categories.length > 0 && <div className="resident-category-chips" aria-label="Resident categories">{categories.map((category) => <span className="resident-category-chip" key={category}>{category}</span>)}</div>}
          </div>
        </div>
        <div className="resident-profile-side">
          <div className="resident-overflow-wrap">
            <button ref={menuButtonRef} type="button" className="resident-overflow-button" aria-label="More resident actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name="more" /></button>
            {menuOpen && <div ref={menuRef} className="resident-overflow-menu" role="menu">
              <button type="button" role="menuitem" onClick={printSummary}><Icon name="printer" />Print summary</button>
              <button type="button" role="menuitem" className="resident-menu-delete" onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}><Icon name="trash" />Delete resident</button>
            </div>}
          </div>
          <Link className="resident-primary-button" to={editHref}><Icon name="edit" />Edit resident</Link>
        </div>
        <div className="resident-quick-facts">
          {[
            ['Household No.', resident.household_no],
            ['PhilHealth ID', resident.philhealth_id_no],
            ['Contact No.', formatPhone(resident.contact_no)]
          ].map(([label, value]) => <div className="resident-quick-fact" key={label}>
            <span>{label}</span>
            <strong className={label === 'PhilHealth ID' ? 'resident-mono-value' : ''}>{value || <i>Not provided</i>}</strong>
            {value && <CopyButton value={value} label={label} onCopied={showToast} />}
          </div>)}
        </div>
      </section>

      <div className="resident-detail-tabs" role="tablist" aria-label="Resident details" onKeyDown={handleTabKeyDown}>
        {TABS.map(([tab, title]) => <button key={tab} type="button" id={`resident-tab-${tab}`} role="tab" aria-selected={activeTab === tab} aria-controls={activeTab === tab ? `resident-panel-${tab}` : undefined} tabIndex={activeTab === tab ? 0 : -1} className={`resident-detail-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setTab(tab)}>{title}</button>)}
      </div>

      {activeTab === 'overview' && <section id="resident-panel-overview" role="tabpanel" aria-labelledby="resident-tab-overview" className="resident-details-overview-layout resident-overview-print">
        <div className="resident-overview-main">
          <InfoCard title="Personal Information" icon="person" fields={[
            <InfoField key="name" label="Full name" value={fullName} editHref={editHref} />,
            <InfoField key="birthdate" label="Date of birth" value={birthdate ? `${birthdate}${age === null ? '' : ` (${age} yrs)`}` : null} editHref={editHref} />,
            <InfoField key="sex" label="Sex" value={capitalize(resident.sex)} editHref={editHref} />,
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
            <InfoField key="categories" label="Classification" value={categories.length ? categories.join(', ') : null} editHref={editHref} />,
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
        <div className="resident-panel-heading"><div><h2>Health Records</h2><p>Open an existing record or create a new one for this resident.</p></div><label className="resident-show-all"><input type="checkbox" checked={showAllRecords} onChange={(event) => setShowAllRecords(event.target.checked)} />Show all record types</label></div>
        <div className="resident-record-card-grid">{visibleRecordItems.map((item) => <Link key={item.type} className={`resident-record-card ${!item.applicable ? 'not-applicable' : ''}`} to={`/residents/${id}/medical-records/${item.type}`} aria-label={`${item.status.exists ? 'Open' : 'Create'} ${item.title}`}>
          <div className="resident-record-card-top"><span className="resident-info-card-icon"><Icon name={item.icon === 'Clinical notes' ? 'medical' : item.type === 'child' ? 'person' : item.type === 'maternal' ? 'person' : 'clipboard'} /></span><span className={`resident-record-status ${item.status.exists ? 'has-record' : ''}`}>{item.status.exists ? `Updated ${formatDate(item.status.lastUpdated) || 'recently'}` : 'No record yet'}</span></div>
          <h3>{item.title}</h3><p>{item.description}</p>
          {!item.applicable && <span className="resident-not-applicable-note">Not applicable based on recorded profile details</span>}
          <span className="resident-record-action">{item.status.exists ? 'Open record' : 'Create record'}<Icon name="chevron" /></span>
        </Link>)}</div>
        <p className="resident-record-footer">Record types marked not applicable remain available and can be shown at any time.</p>
      </section>}

      {activeTab === 'visits' && <section id="resident-panel-visits" role="tabpanel" aria-labelledby="resident-tab-visits" className="resident-detail-info-card">
        <div className="resident-panel-heading"><div><h2>Visit History</h2><p>Recorded visits, health measurements, and nutrition assessments.</p></div></div>
        {summary.visitHistory?.length ? <div className="resident-visit-table-wrap"><table className="resident-visit-table"><thead><tr><th scope="col">Date</th><th scope="col">Record</th><th scope="col">Weight</th><th scope="col">Height</th><th scope="col">BMI</th><th scope="col">Status</th></tr></thead><tbody>{summary.visitHistory.map((visit) => <tr key={visit.id}><td>{formatDate(visit.date) || 'Date not recorded'}</td><td>{visit.title}</td><td>{getMetricText(visit.weightKg, 'kg') || '—'}</td><td>{getMetricText(visit.heightCm, 'cm') || '—'}</td><td>{getMetricText(visit.bmi, 'kg/m²') || '—'}</td><td>{visit.nutritionStatus || '—'}</td></tr>)}</tbody></table></div> : <div className="resident-empty-state"><Icon name="calendar" /><h3>No visits recorded yet</h3><p>Visit and measurement entries will appear here when available.</p></div>}
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
      {confirmDelete && <ConfirmDeleteModal name={fullName} busy={deleting} onCancel={() => setConfirmDelete(false)} onConfirm={handleDelete} />}
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
