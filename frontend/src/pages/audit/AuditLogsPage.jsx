import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/common/Pagination';
import { exportAuditLogs, getAuditLog, getAuditOptions, getAuditSummary, listAuditLogs } from '../../services/api/auditService';
import { formatDateTimeInTimeZone, formatRelativeTime, getDateInputValueInTimeZone } from '../../utils/dateUtils';
import { AUDIT_CATEGORIES, getCategoryLabel, getEventConfig, getEventSummary, getModuleLabel } from './auditEventConfig';
import './AuditLogsPage.css';

const SECRET_KEY = /(password|passwd|passphrase|hash|token|secret|authorization|cookie|credential|api.?key|private.?key)/i;
const parseList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const makeQueryParams = (params) => Object.fromEntries([...params.entries()].filter(([key]) => !['event', 'range', 'page', 'pageSize', 'sort'].includes(key)));
const localDate = (date = new Date()) => getDateInputValueInTimeZone('Asia/Manila', date);
const moveDate = (value, days) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};
const dayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value: partValue }) => [type, partValue]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};
const dayTitle = (key) => {
  if (!key) return 'Date unavailable';
  const today = localDate();
  if (key === today) return 'Today';
  if (key === moveDate(today, -1)) return 'Yesterday';
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
};
const actorRole = (role) => ({ admin: 'Admin', official: 'Official', bhw: 'BHW', barangay_official: 'Official' })[role] || 'System';
const parseObject = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
};
const redactObject = (value) => {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : redactObject(child)]));
};
const formatValue = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(redactObject(value));
  return String(value);
};
const getDeviceLabel = (userAgent) => {
  if (!userAgent) return 'Not recorded';
  const browser = /Edg\/([\d.]+)/.test(userAgent) ? 'Edge'
    : /Chrome\/([\d.]+)/.test(userAgent) ? 'Chrome'
      : /Firefox\/([\d.]+)/.test(userAgent) ? 'Firefox'
        : /Safari\/([\d.]+)/.test(userAgent) ? 'Safari' : 'Browser';
  const os = /Windows/.test(userAgent) ? 'Windows'
    : /Mac OS|Macintosh/.test(userAgent) ? 'macOS'
      : /Android/.test(userAgent) ? 'Android'
        : /iPhone|iPad/.test(userAgent) ? 'iOS'
          : /Linux/.test(userAgent) ? 'Linux' : 'device';
  return `${browser} on ${os}`;
};
const exactDate = (value) => formatDateTimeInTimeZone(value, 'Asia/Manila') || 'Time unavailable';
const relativeDate = (value) => formatRelativeTime(value) || 'Time unavailable';
const Avatar = ({ name, username, photo, size = 'normal' }) => {
  const initials = String(name || username || 'S').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'S';
  const tone = (String(username || name || 'S').charCodeAt(0) || 0) % 8;
  return photo
    ? <img className={`audit-avatar audit-avatar-${size}`} src={photo} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
    : <span className={`audit-avatar audit-avatar-${size} audit-avatar-${tone}`} aria-hidden="true">{initials}</span>;
};

const EventBadge = ({ item }) => {
  const config = getEventConfig(item.action);
  const severity = item.severity || (item.result === 'failure' ? 'warning' : config.severity);
  return (
    <span className={`audit-event-badge audit-category-${config.category} audit-severity-${severity}`} title={`Action key: ${item.action || 'unknown'}`}>
      <span aria-hidden="true">{config.icon}</span><span>{config.label}</span>
    </span>
  );
};

const ResultBadge = ({ result }) => (
  <span className={`audit-result audit-result-${result === 'failure' ? 'failure' : 'success'}`}>
    <span aria-hidden="true">{result === 'failure' ? '!' : '✓'}</span>{result === 'failure' ? 'Failed' : 'Success'}
  </span>
);

const FilterChecklist = ({ title, values, selected, labels, onToggle, className = '' }) => (
  <details className={`audit-multi-filter ${className}`}>
    <summary>{title}{selected.length ? <span className="audit-filter-count">{selected.length}</span> : null}<span aria-hidden="true">⌄</span></summary>
    <div className="audit-checklist" role="group" aria-label={title}>
      {values.map((value) => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} /><span>{labels[value] || value}</span></label>)}
      {!values.length && <span className="audit-muted">No values available</span>}
    </div>
  </details>
);

const FilterControls = ({ params, options, onUpdate, onPreset, invalidRange, userOptions, onUserSearch, search, optionsError }) => {
  const modules = parseList(params.get('modules'));
  const actions = parseList(params.get('actions'));
  const modulesAvailable = options.modules || [];
  const actionsAvailable = options.actions || [];
  const moduleLabels = Object.fromEntries(modulesAvailable.map((module) => [module, getModuleLabel(module)]));
  const actionLabels = Object.fromEntries(actionsAvailable.map((action) => [action, getEventConfig(action).label]));
  const groupedActions = Object.fromEntries(Object.keys(AUDIT_CATEGORIES).map((category) => [
    category,
    actionsAvailable.filter((action) => getEventConfig(action).category === category),
  ]));
  const knownActions = Object.values(groupedActions).flat();
  const unknownActions = actionsAvailable.filter((action) => !knownActions.includes(action));
  const groupedModuleValues = Object.fromEntries(Object.keys(AUDIT_CATEGORIES).map((category) => [
    category,
    modulesAvailable.filter((module) => AUDIT_CATEGORIES[category].modules.includes(module)),
  ]));
  const knownModules = Object.values(groupedModuleValues).flat();
  const unknownModules = modulesAvailable.filter((module) => !knownModules.includes(module));
  const actor = userOptions.find((item) => String(item.user_id) === params.get('userId'));
  const actorValue = actor ? `${actor.full_name} (@${actor.username})` : (params.get('userId') ? 'Selected user' : '');

  const toggle = (key, value, current) => {
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
    onUpdate({ [key]: next.length ? next.join(',') : null, page: 1 });
  };
  const updateActor = (value) => {
    const selectedActor = userOptions.find((item) => `${item.full_name} (@${item.username})` === value || item.username === value || item.full_name === value);
    onUpdate({ userId: selectedActor ? selectedActor.user_id : null, target_user_id: null, page: 1 });
  };

  return (
    <div className="audit-filter-controls">
      {optionsError && <small className="audit-field-error" role="alert">Filter options could not be loaded. Refresh to try again.</small>}
      <label className="audit-filter-label audit-date-filter"><span>Date range</span>
        <select value={params.get('range') || '7d'} onChange={(event) => onPreset(event.target.value)} aria-label="Date range">
          <option value="all">All time</option><option value="today">Today</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option><option value="custom">Custom</option>
        </select>
      </label>
      {(params.get('range') === 'custom') && <div className="audit-custom-date">
        <label><span>From</span><input type="date" value={params.get('from')?.slice(0, 10) || ''} max={localDate()} onChange={(event) => onUpdate({ from: event.target.value || null, page: 1 })} /></label>
        <label><span>To</span><input type="date" value={params.get('to')?.slice(0, 10) || ''} max={localDate()} onChange={(event) => onUpdate({ to: event.target.value || null, page: 1 })} /></label>
        {invalidRange && <small className="audit-field-error" role="alert">{invalidRange}</small>}
      </div>}
      <div className="audit-filter-label audit-group-filter"><span>Category / module</span>
        <div className="audit-group-filter-list">
          {Object.entries(groupedModuleValues).filter(([, values]) => values.length).map(([category, values]) => (
            <FilterChecklist key={category} title={getCategoryLabel(category)} values={values} selected={modules} labels={moduleLabels}
              onToggle={(value) => toggle('modules', value, modules)} />
          ))}
          {unknownModules.length > 0 && <FilterChecklist title="Other" values={unknownModules} selected={modules} labels={moduleLabels} onToggle={(value) => toggle('modules', value, modules)} />}
        </div>
      </div>
      <div className="audit-action-filter"><span className="audit-filter-caption">Action</span><div className="audit-group-filter-list">
        {Object.entries(groupedActions).filter(([, values]) => values.length).map(([category, values]) => (
          <FilterChecklist key={category} title={getCategoryLabel(category)} values={values} selected={actions} labels={actionLabels}
            onToggle={(value) => toggle('actions', value, actions)} />
        ))}
        {unknownActions.length > 0 && <FilterChecklist title="Other" values={unknownActions} selected={actions} labels={actionLabels}
          onToggle={(value) => toggle('actions', value, actions)} />}
      </div></div>
      <label className="audit-filter-label audit-user-filter"><span>Actor</span>
        <input list="audit-actor-options" value={actorValue} onChange={(event) => updateActor(event.target.value)} onInput={(event) => onUserSearch(event.target.value)} placeholder="Search users…" aria-label="Filter by actor" />
        <datalist id="audit-actor-options">{userOptions.map((item) => <option key={item.user_id} value={`${item.full_name} (@${item.username})`} />)}</datalist>
      </label>
      <label className="audit-filter-label"><span>Result</span>
        <select value={params.get('result') || ''} onChange={(event) => onUpdate({ result: event.target.value || null, page: 1 })}>
          <option value="">All results</option><option value="success">Success</option><option value="failure">Failed</option>
        </select>
      </label>
      <label className="audit-filter-label"><span>Severity</span>
        <select value={params.get('severity') || ''} onChange={(event) => onUpdate({ severity: event.target.value || null, page: 1 })}>
          <option value="">All severity</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
        </select>
      </label>
      <label className="audit-filter-label audit-sort-filter"><span>Sort</span>
        <select value={params.get('sort') || 'newest'} onChange={(event) => onUpdate({ sort: event.target.value, page: 1 })}>
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
        </select>
      </label>
      {search && <span className="audit-sr-only">Search filter active</span>}
    </div>
  );
};

const AuditDrawer = ({ eventId, filters, onClose, onNavigate, navigate, triggerRef, showToast }) => {
  const [event, setEvent] = useState(null);
  const [neighbors, setNeighbors] = useState({ previousId: null, nextId: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const panelRef = useRef(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getAuditLog(eventId, filters)
      .then((response) => {
        if (!response?.success) throw new Error(response?.message || 'Unable to load event.');
        if (active) {
          setEvent(response.data);
          setNeighbors({ previousId: response.previousId, nextId: response.nextId });
        }
      })
      .catch((requestError) => { if (active) setError(requestError.response?.data?.message || requestError.message || 'Unable to load event.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId, filters, retryKey]);

  useEffect(() => {
    const returnFocusTarget = triggerRef.current;
    const focusables = () => Array.from(panelRef.current?.querySelectorAll('button:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])') || []);
    const keydown = (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape') { keyboardEvent.preventDefault(); onClose(); }
      if (keyboardEvent.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      if (keyboardEvent.shiftKey && document.activeElement === items[0]) { keyboardEvent.preventDefault(); items[items.length - 1].focus(); }
      else if (!keyboardEvent.shiftKey && document.activeElement === items[items.length - 1]) { keyboardEvent.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', keydown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => (focusables()[0] || panelRef.current)?.focus());
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => returnFocusTarget?.focus?.());
    };
  }, [onClose, triggerRef]);

  const metadata = useMemo(() => redactObject(parseObject(event?.metadata)), [event]);
  const before = parseObject(event?.old_data || metadata.old_data);
  const after = parseObject(event?.new_data || metadata.new_data);
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !SECRET_KEY.test(key));
  const rawDetails = redactObject({ ...(Object.keys(before).length ? { old_data: before } : {}), ...(Object.keys(after).length ? { new_data: after } : {}), ...metadata });
  const copy = async (text, message) => {
    try { await navigator.clipboard.writeText(text); showToast(message); }
    catch { showToast('Clipboard access is unavailable.'); }
  };
  const copyDetails = () => {
    const lines = [
      `HealthSync audit event #${event?.audit_id}`,
      `Event: ${getEventConfig(event?.action).label} (${event?.action})`,
      `Result: ${event?.result}`,
      `When: ${exactDate(event?.created_at)} Asia/Manila`,
      `Actor: ${event?.actor_name || 'System'}${event?.actor_username ? ` (@${event.actor_username})` : ''}`,
      `Target: ${event?.target_label || event?.target_user_name || 'Not recorded'}`,
      `Module: ${getModuleLabel(event?.module)}`,
      `Details: ${getEventSummary(event || {})}`,
      `IP: ${event?.ip_address || 'Not recorded'}`,
      `Device: ${getDeviceLabel(event?.user_agent)}`,
      `Description: ${event?.description || 'Not recorded'}`,
    ];
    copy(lines.join('\n'), 'Event details copied.');
  };

  return (
    <div className="audit-drawer-backdrop" role="presentation" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) onClose(); }}>
      <aside ref={panelRef} className="audit-drawer" role="dialog" aria-modal="true" aria-label="Audit event details" tabIndex="-1">
        <header className="audit-drawer-header">
          <div><span className="audit-eyebrow">READ-ONLY EVENT</span><h2>Event details</h2></div>
          <button type="button" className="audit-icon-button" aria-label="Close event details" onClick={onClose}>×</button>
        </header>
        {loading && <div className="audit-detail-skeleton" aria-label="Loading event details"><span /><span /><span /><span /></div>}
        {!loading && error && <div className="audit-error" role="alert"><p>{error}</p><button type="button" className="audit-button" onClick={() => setRetryKey((value) => value + 1)}>Try again</button></div>}
        {!loading && event && <>
          <div className="audit-detail-event">
            <EventBadge item={event} /><ResultBadge result={event.result} />
            <strong>{exactDate(event.created_at)} <small>Asia/Manila</small></strong>
            <span>{relativeDate(event.created_at)}</span>
          </div>
          <div className="audit-drawer-content">
            <section className="audit-detail-section"><h3>Who</h3>
              <div className="audit-detail-person"><Avatar name={event.actor_name || 'System'} username={event.actor_username} size="large" /><div>
                {event.actor_id ? <button type="button" className="audit-link" onClick={() => navigate(`/users?user=${encodeURIComponent(event.actor_id)}&drawer=user`)}>{event.actor_name || 'Account'}</button> : <strong>{event.actor_name || 'System / unknown actor'}</strong>}
                <small>{event.actor_username ? `@${event.actor_username} · ` : ''}{actorRole(event.actor_role)}</small>
              </div></div>
            </section>
            <section className="audit-detail-section"><h3>What</h3><dl className="audit-detail-list">
              <div><dt>Event</dt><dd><EventBadge item={event} /></dd></div><div><dt>Action key</dt><dd><code>{event.action}</code></dd></div>
              <div><dt>Module</dt><dd>{getModuleLabel(event.module)}</dd></div><div><dt>Description</dt><dd>{event.description || getEventSummary(event)}</dd></div>
            </dl></section>
            <section className="audit-detail-section"><h3>Target</h3>
              {event.target_user_id
                ? <button type="button" className="audit-link" onClick={() => navigate(`/users?user=${encodeURIComponent(event.target_user_id)}&drawer=user`)}>{event.target_user_name || event.target_label || 'View user account'} <span aria-hidden="true">↗</span></button>
                : <p>{event.target_label || event.target_type || 'No target recorded'}</p>}
            </section>
            <section className="audit-detail-section"><h3>Where</h3><dl className="audit-detail-list">
              <div><dt>IP address</dt><dd>{event.ip_address || 'Not recorded'}</dd></div>
              <div><dt>Device</dt><dd>{getDeviceLabel(event.user_agent)}</dd></div>
              <div><dt>Browser / OS</dt><dd title={event.user_agent || ''}>{event.user_agent || 'Not recorded'}</dd></div>
            </dl></section>
            <section className="audit-detail-section"><h3>Changes</h3>
              {fields.length ? <div className="audit-diff-wrap"><table className="audit-diff-table"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                <tbody>{fields.map((key) => <tr key={key}><th scope="row">{key.replace(/[_-]/g, ' ')}</th><td>{formatValue(before[key])}</td><td>{formatValue(after[key])}</td></tr>)}</tbody></table></div>
                : <p className="audit-muted">No field-level changes were recorded for this event.</p>}
              <details className="audit-raw-json"><summary>View sanitized metadata</summary><pre>{JSON.stringify(rawDetails, null, 2) || '{}'}</pre></details>
            </section>
          </div>
          <footer className="audit-drawer-footer">
            <div className="audit-copy-actions">
              <button type="button" className="audit-button" onClick={copyDetails}>Copy event details</button>
              <button type="button" className="audit-button audit-button-secondary" onClick={() => copy(String(event.audit_id), 'Event ID copied.')}>Copy event ID</button>
            </div>
            <div className="audit-event-navigation">
              <button type="button" className="audit-button audit-button-secondary" disabled={!neighbors.previousId} onClick={() => onNavigate(neighbors.previousId)}>← Previous</button>
              {event.actor_id && <button type="button" className="audit-link-button" onClick={() => {
                onClose();
                navigate(`/audit-logs?userId=${encodeURIComponent(event.actor_id)}&range=7d&from=${moveDate(localDate(), -6)}&to=${localDate()}`);
              }}>View actor activity</button>}
              <button type="button" className="audit-button audit-button-secondary" disabled={!neighbors.nextId} onClick={() => onNavigate(neighbors.nextId)}>Next →</button>
            </div>
          </footer>
        </>}
      </aside>
    </div>
  );
};

const AuditFilterSheet = ({ onClose, onApply, onClear, triggerRef, ...filterProps }) => {
  const panelRef = useRef(null);
  useEffect(() => {
    const returnFocusTarget = triggerRef.current;
    const focusables = () => Array.from(panelRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') || []);
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', keydown);
    requestAnimationFrame(() => (focusables()[0] || panelRef.current)?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      requestAnimationFrame(() => returnFocusTarget?.focus?.());
    };
  }, [onClose, triggerRef]);

  return (
    <div className="audit-filter-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} className="audit-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="audit-filter-sheet-title" tabIndex="-1">
        <header><h2 id="audit-filter-sheet-title">Filter audit logs</h2><button type="button" className="audit-icon-button" aria-label="Close filters" onClick={onClose}>×</button></header>
        <FilterControls {...filterProps} />
        <footer><button type="button" className="audit-button audit-button-secondary" onClick={onClear}>Clear all</button><button type="button" className="audit-button audit-button-primary" onClick={onApply}>Apply</button></footer>
      </section>
    </div>
  );
};

const AuditLogsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryString = searchParams.toString();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(searchParams.get('pageSize'))) ? Number(searchParams.get('pageSize')) : 10;
  const eventId = searchParams.get('event') || '';
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ today: 0, failed_24h: 0, active_users_24h: 0, admin_actions_7d: 0 });
  const [summaryError, setSummaryError] = useState('');
  const [attention, setAttention] = useState([]);
  const [options, setOptions] = useState({ actions: [], modules: [], actors: [] });
  const [optionsError, setOptionsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(Date.now());
  const [invalidRange, setInvalidRange] = useState('');
  const [actorSearch, setActorSearch] = useState('');
  const searchRef = useRef(null);
  const filtersTriggerRef = useRef(null);
  const drawerTriggerRef = useRef(null);
  const debounceRef = useRef(null);
  const queryParams = useMemo(() => new URLSearchParams(queryString), [queryString]);
  const listParams = useMemo(() => ({
    ...makeQueryParams(queryParams),
    page,
    pageSize,
    sort: queryParams.get('sort') || 'newest',
  }), [page, pageSize, queryParams]);
  const updateParams = useCallback((updates, replace = false) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      });
      return next;
    }, { replace });
  }, [setSearchParams]);

  const closeFilterSheet = useCallback(() => setFiltersOpen(false), []);
  const applyFilterSheet = useCallback(() => setFiltersOpen(false), []);

  useEffect(() => {
    if (!searchParams.has('range')) updateParams({ range: '7d', from: moveDate(localDate(), -6), to: localDate(), page: 1, pageSize: 10, sort: 'newest' }, true);
  }, [searchParams, updateParams]);

  const urlSearchQuery = queryParams.get('q') || '';
  useEffect(() => {
    setSearchInput(urlSearchQuery);
  }, [urlSearchQuery]);

  useEffect(() => { setSearchInput(searchParams.get('q') || ''); }, [searchParams]);
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      if (trimmed !== (searchParams.get('q') || '')) updateParams({ q: trimmed || null, page: 1 });
    }, 300);
    return () => window.clearTimeout(debounceRef.current);
  }, [searchInput, searchParams, updateParams]);

  useEffect(() => {
    const shortcut = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
        || document.activeElement?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const queryFilterParams = useMemo(() => makeQueryParams(queryParams), [queryParams]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    listAuditLogs(listParams)
      .then((response) => {
        if (!response?.success) throw new Error(response?.message || 'Unable to load audit logs.');
        if (active) {
          setItems(response.data || []);
          setTotal(Number(response.total || 0));
          setUpdatedAt(Date.now());
          if (Number(response.page) && Number(response.page) !== page) updateParams({ page: Number(response.page) }, true);
        }
      })
      .catch((requestError) => { if (active) setError(requestError.response?.data?.message || requestError.message || 'Unable to load audit logs.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [queryString, listParams, page, refreshKey, updateParams]);

  const summaryFrom = queryParams.get('from') || '';
  const summaryTo = queryParams.get('to') || '';
  useEffect(() => {
    let active = true;
    setSummaryError('');
    getAuditSummary({ from: summaryFrom, to: summaryTo })
      .then((response) => {
        if (!response?.success) throw new Error(response?.message || 'Unable to load audit insights.');
        if (active) {
          setSummary(response.data?.counts || {});
          setAttention(response.data?.attention || []);
        }
      })
      .catch(() => { if (active) setSummaryError('Security insights could not be loaded. Refresh to try again.'); });
    return () => { active = false; };
  }, [summaryFrom, summaryTo, refreshKey]);

  useEffect(() => {
    let active = true;
    setOptionsError(false);
    getAuditOptions({ q: actorSearch })
      .then((response) => {
        if (!response?.success) throw new Error('Unable to load filter options.');
        if (active) setOptions(response.data || { actions: [], modules: [], actors: [] });
      })
      .catch(() => { if (active) setOptionsError(true); });
    return () => { active = false; };
  }, [actorSearch, refreshKey]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onPreset = (preset) => {
    setInvalidRange('');
    const today = localDate();
    if (preset === 'all') { updateParams({ range: 'all', from: null, to: null, page: 1 }); return; }
    if (preset === 'custom') { updateParams({ range: 'custom', page: 1 }); return; }
    if (preset === 'today') updateParams({ range: preset, from: today, to: today, page: 1 });
    else if (preset === '24h') {
      const now = new Date();
      updateParams({ range: preset, from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString(), page: 1 });
    } else updateParams({ range: preset, from: moveDate(today, preset === '7d' ? -6 : -29), to: today, page: 1 });
  };

  const onUpdate = (updates) => {
    if (updates.from !== undefined || updates.to !== undefined) {
      const from = updates.from ?? queryParams.get('from');
      const to = updates.to ?? queryParams.get('to');
      if (from && to && from.slice(0, 10) > to.slice(0, 10)) { setInvalidRange('From date must be on or before To date.'); return; }
      if (to && to.slice(0, 10) > localDate()) { setInvalidRange('To date cannot be in the future.'); return; }
      setInvalidRange('');
    }
    updateParams(updates);
  };

  const clearFilters = () => {
    setSearchInput('');
    setInvalidRange('');
    updateParams({ q: null, range: 'all', from: null, to: null, modules: null, actions: null, userId: null, target_user_id: null, result: null, severity: null, page: 1 });
  };

  const removeFilter = (key, value = null) => {
    if (['modules', 'actions'].includes(key) && value) {
      const remaining = parseList(searchParams.get(key)).filter((item) => item !== value);
      updateParams({ [key]: remaining.length ? remaining.join(',') : null, page: 1 });
    } else if (key === 'date') updateParams({ range: 'all', from: null, to: null, page: 1 });
    else updateParams({ [key]: null, page: 1 });
  };

  const selectEvent = (id, trigger) => {
    drawerTriggerRef.current = trigger || document.activeElement;
    updateParams({ event: id }, false);
  };
  const closeDrawer = useCallback(() => updateParams({ event: null }, true), [updateParams]);
  const navigateEvent = (id) => {
    if (id) updateParams({ event: id }, false);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await exportAuditLogs({ ...queryFilterParams, sort: searchParams.get('sort') || 'newest' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `HealthSync_AuditLog_${localDate()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setToast('Audit CSV export started.');
    } catch (requestError) {
      setToast(requestError.response?.data?.message || 'Audit export failed.');
    } finally { setExporting(false); }
  };

  const setSummaryFilter = (kind) => {
    const now = new Date();
    const today = localDate(now);
    if (kind === 'today') updateParams({ range: 'today', from: today, to: today, page: 1 });
    else if (kind === 'failed' || kind === 'active') {
      updateParams({
        range: '24h',
        from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        to: now.toISOString(),
        actions: kind === 'failed' ? 'LOGIN_FAILED' : 'LOGIN',
        result: kind === 'failed' ? 'failure' : 'success',
        page: 1,
      });
    } else if (kind === 'admin') {
      updateParams({ range: '7d', from: moveDate(today, -6), to: today, modules: 'users,account-settings,admin-settings', page: 1 });
    }
  };

  const activeFilters = useMemo(() => {
    const values = [];
    if (searchParams.get('q')) values.push({ key: 'q', label: `Search: ${searchParams.get('q')}` });
    if (searchParams.get('from') || searchParams.get('to')) values.push({ key: 'date', label: `${searchParams.get('from')?.slice(0, 10) || 'Any'} – ${searchParams.get('to')?.slice(0, 10) || 'Any'}` });
    parseList(searchParams.get('modules')).forEach((value) => values.push({ key: 'modules', value, label: getModuleLabel(value) }));
    parseList(searchParams.get('actions')).forEach((value) => values.push({ key: 'actions', value, label: getEventConfig(value).label }));
    if (searchParams.get('userId') || searchParams.get('target_user_id')) values.push({ key: searchParams.has('userId') ? 'userId' : 'target_user_id', label: 'Actor / target' });
    if (searchParams.get('result')) values.push({ key: 'result', label: searchParams.get('result') === 'failure' ? 'Failed' : 'Success' });
    if (searchParams.get('severity')) values.push({ key: 'severity', label: `Severity: ${searchParams.get('severity')}` });
    return values;
  }, [searchParams]);

  const groups = useMemo(() => {
    const grouped = [];
    items.forEach((item) => {
      const key = dayKey(item.created_at);
      let group = grouped.find((entry) => entry.key === key);
      if (!group) { group = { key, title: dayTitle(key), items: [] }; grouped.push(group); }
      group.items.push(item);
    });
    return grouped;
  }, [items]);
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  const printDateRange = searchParams.get('from') || searchParams.get('to')
    ? `${searchParams.get('from')?.slice(0, 10) || 'Beginning'} – ${searchParams.get('to')?.slice(0, 10) || 'Present'}`
    : 'All time';
  const selectedEventFilters = useMemo(() => ({ ...queryFilterParams, sort: searchParams.get('sort') || 'newest' }), [queryFilterParams, searchParams]);
  const dataRows = (group) => group.items.map((item) => (
    <tr key={item.audit_id} className={`audit-data-row ${item.result === 'failure' ? 'is-failed' : ''} audit-severity-row-${item.severity || 'info'}`}
      tabIndex="0" aria-label={`${getEventConfig(item.action).label}: ${getEventSummary(item)}. ${item.result}. Open details`}
      onClick={(event) => selectEvent(item.audit_id, event.currentTarget)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectEvent(item.audit_id, event.currentTarget); } }}>
      <td className="audit-time-cell"><time dateTime={new Date(item.created_at).toISOString()} title={`${exactDate(item.created_at)} Asia/Manila`}>{new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(item.created_at))}<small>{relativeDate(item.created_at)}</small></time></td>
      <td><div className="audit-actor"><Avatar name={item.actor_name || 'System'} username={item.actor_username} photo={item.actor_photo} /><span><strong>{item.actor_name || 'System / unknown actor'}</strong><small>{item.actor_username ? `@${item.actor_username} · ${actorRole(item.actor_role)}` : 'Actor not recorded'}</small></span></div></td>
      <td><EventBadge item={item} /></td>
      <td className="audit-module-cell"><span className="audit-module-chip">{getModuleLabel(item.module)}</span></td>
      <td className="audit-description-cell" title={getEventSummary(item)}>{getEventSummary(item)}</td>
      <td className="audit-source-cell" title={item.user_agent || ''}><span>{item.ip_address || 'Not recorded'}</span><small>{getDeviceLabel(item.user_agent)}</small></td>
      <td><ResultBadge result={item.result} /></td>
      <td className="audit-view-cell"><span aria-hidden="true">›</span><span className="audit-sr-only">View event</span></td>
    </tr>
  ));
  const mobileCards = (group) => group.items.map((item) => (
    <button type="button" key={`card-${item.audit_id}`} className={`audit-mobile-card ${item.result === 'failure' ? 'is-failed' : ''}`}
      onClick={(event) => selectEvent(item.audit_id, event.currentTarget)} aria-label={`View ${getEventConfig(item.action).label} by ${item.actor_name || 'unknown actor'}`}>
      <span className="audit-mobile-card-top"><EventBadge item={item} /><ResultBadge result={item.result} /></span>
      <span className="audit-actor"><Avatar name={item.actor_name || 'System'} username={item.actor_username} photo={item.actor_photo} /><span><strong>{item.actor_name || 'System / unknown actor'}</strong><small>{item.actor_username ? `@${item.actor_username}` : 'Actor not recorded'}</small></span></span>
      <span className="audit-mobile-description">{getEventSummary(item)}</span>
      <span className="audit-mobile-bottom"><small>{relativeDate(item.created_at)} · {getModuleLabel(item.module)}</small><b aria-hidden="true">›</b></span>
    </button>
  ));

  return (
    <div className="audit-logs-page">
      <header className="audit-page-header" data-generated-at={exactDate(new Date())} data-date-range={printDateRange}>
        <div><span className="audit-eyebrow">SYSTEM ACTIVITY</span><div className="audit-title-line"><h1>Audit logs</h1><span className="audit-read-only" title="Audit events are append-only and cannot be edited or deleted."><span aria-hidden="true">🔒</span> Read-only</span></div>
          <p>A read-only record of sign-ins, changes, and administrative actions. <span className="audit-header-total">{total} matching events</span></p></div>
        <div className="audit-header-actions">
          <button type="button" className="audit-button audit-export-button" onClick={exportCsv} disabled={exporting}>{exporting ? 'Preparing…' : '⇩ Export CSV'}</button>
          <button type="button" className="audit-button audit-print-button" onClick={() => window.print()}>Print</button>
          <details className="audit-mobile-more"><summary className="audit-icon-button" aria-label="More audit log actions">⋯</summary>
            <div><button type="button" onClick={exportCsv} disabled={exporting}>{exporting ? 'Preparing…' : 'Export CSV'}</button><button type="button" onClick={() => window.print()}>Print</button></div>
          </details>
          <button type="button" className="audit-icon-button audit-refresh-button" aria-label="Refresh audit logs" title={`Updated ${relativeDate(updatedAt)}`} onClick={() => setRefreshKey((value) => value + 1)}>
            <span aria-hidden="true">↻</span><span className="audit-refresh-label">Updated {relativeDate(updatedAt)}</span>
          </button>
        </div>
      </header>

      <section className="audit-summary" aria-label="Audit activity summary">
        {[
          { key: 'today', label: 'Events today', value: summary.today || 0 },
          { key: 'failed', label: 'Failed sign-ins · 24h', value: summary.failed_24h || 0, warning: Number(summary.failed_24h) > 0 },
          { key: 'active', label: 'Active users · 24h', value: summary.active_users_24h || 0 },
          { key: 'admin', label: 'Admin actions · 7d', value: summary.admin_actions_7d || 0 },
        ].map((chip) => <button key={chip.key} type="button" className={`audit-summary-chip ${chip.warning ? 'is-warning' : ''}`} onClick={() => setSummaryFilter(chip.key)}>
          <strong>{chip.value}</strong><span>{chip.label}</span>
        </button>)}
      </section>

      <section className="audit-attention" aria-label="Security insights">
        <div><span className="audit-attention-icon" aria-hidden="true">{summaryError || attention.length ? '!' : '✓'}</span><strong>{summaryError ? 'Insights unavailable' : attention.length ? 'Needs attention' : 'No unusual activity'}</strong></div>
        {summaryError ? <p className="audit-insight-error" role="alert">{summaryError}</p> : attention.length ? <ul>{attention.slice(0, 5).map((item, index) => <li key={`${item.type}-${item.eventId || index}`}>
          <span>{item.message}</span><button type="button" onClick={() => updateParams({ actions: item.filter.action, result: item.filter.result || null, page: 1 })}>View events</button>
        </li>)}</ul> : <p>No unusual sign-in patterns or recent account-security changes were found in this date range.</p>}
      </section>

      <section className="audit-surface" aria-label="Audit event records">
        <div className="audit-toolbar">
          <label className="audit-search" htmlFor="audit-search-input"><span aria-hidden="true">⌕</span>
            <input id="audit-search-input" ref={searchRef} value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search users, actions, modules, details, or IP addresses" aria-label="Search audit logs" />
            {!searchInput && <kbd aria-hidden="true">/</kbd>}
            {searchInput && <button type="button" aria-label="Clear search" onClick={() => { setSearchInput(''); updateParams({ q: null, page: 1 }); }}>×</button>}
          </label>
          <button ref={filtersTriggerRef} type="button" className="audit-mobile-filter-button" aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}>
            Filters{activeFilters.length > 0 && <span>{activeFilters.length}</span>}
          </button>
          <FilterControls params={searchParams} options={options} onUpdate={onUpdate} onPreset={onPreset} invalidRange={invalidRange}
            userOptions={options.actors || []} onUserSearch={setActorSearch} search={searchParams.get('q')} optionsError={optionsError} />
        </div>
        <div className="audit-active-filters">
          <span className="audit-result-count" aria-live="polite">{loading ? 'Updating results…' : `Showing ${first}-${last} of ${total} matching logs`}</span>
          {activeFilters.map((filter, index) => <button type="button" key={`${filter.key}-${filter.value || index}`} className="audit-filter-chip" onClick={() => removeFilter(filter.key, filter.value)}>{filter.label}<span aria-hidden="true">×</span></button>)}
          {activeFilters.length > 0 && <button type="button" className="audit-clear-link" onClick={clearFilters}>Clear all</button>}
        </div>
        {error && <div className="audit-error" role="alert"><span>{error}</span><button type="button" className="audit-button" onClick={() => setRefreshKey((value) => value + 1)}>Try again</button></div>}

        <div className="audit-table-wrap" aria-busy={loading}>
          <table className="audit-table" aria-label="Audit log events">
            <caption className="audit-sr-only">Read-only event history. Select a row to view details.</caption>
            <thead><tr>
              <th scope="col" aria-sort={searchParams.get('sort') === 'oldest' ? 'ascending' : 'descending'}>
                <button type="button" onClick={() => updateParams({ sort: searchParams.get('sort') === 'oldest' ? 'newest' : 'oldest', page: 1 })}>When <span aria-hidden="true">{searchParams.get('sort') === 'oldest' ? '↑' : '↓'}</span></button>
              </th><th scope="col">User</th><th scope="col">Event</th><th scope="col">Module</th><th scope="col">Details</th><th scope="col">Source</th><th scope="col">Result</th><th scope="col"><span className="audit-sr-only">Open</span></th>
            </tr></thead>
            <tbody>
              {loading && items.length === 0 && Array.from({ length: 6 }, (_, index) => <tr className="audit-skeleton-row" key={`skeleton-${index}`} aria-hidden="true">{Array.from({ length: 8 }, (_, cell) => <td key={cell}><span /></td>)}</tr>)}
              {groups.map((group) => <React.Fragment key={group.key}>
                <tr className="audit-day-heading"><th colSpan="8" scope="rowgroup"><span>{group.title}</span><small>{group.items.length} event{group.items.length === 1 ? '' : 's'}</small></th></tr>
                {dataRows(group)}
              </React.Fragment>)}
              {!loading && !error && !items.length && <tr><td colSpan="8"><div className="audit-empty-state">
                <span aria-hidden="true">⌕</span><strong>{activeFilters.length ? 'No events match your filters' : 'No audit events yet'}</strong>
                <p>{activeFilters.length ? 'Try removing a filter or expanding the date range.' : 'Activity will appear here as people use HealthSync.'}</p>
                {activeFilters.length > 0 && <button type="button" className="audit-button audit-button-secondary" onClick={clearFilters}>Clear filters</button>}
              </div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="audit-mobile-groups">
          {loading && items.length === 0 && <div className="audit-mobile-skeleton" aria-label="Loading audit events">{Array.from({ length: 6 }, (_, index) => <span key={index}><i /><i /><i /></span>)}</div>}
          {groups.map((group) => <section key={`mobile-${group.key}`} className="audit-mobile-day">
          <h2>{group.title}<small>{group.items.length} event{group.items.length === 1 ? '' : 's'}</small></h2>{mobileCards(group)}
        </section>)}
          {!loading && !error && !items.length && <div className="audit-empty-state"><strong>{activeFilters.length ? 'No events match your filters' : 'No audit events yet'}</strong><p>Try changing the date range or filters.</p>{activeFilters.length > 0 && <button type="button" className="audit-button" onClick={clearFilters}>Clear filters</button>}</div>}
        </div>
        {!error && <div className="audit-pagination"><Pagination currentPage={page} totalPages={Math.ceil(total / pageSize)} first={first} last={last} total={total}
          itemLabel="logs" pageSize={pageSize} onPageSizeChange={(value) => updateParams({ pageSize: value, page: 1 })}
          onPageChange={(value) => updateParams({ page: value })} /></div>}
      </section>

      {filtersOpen && <AuditFilterSheet
        onClose={closeFilterSheet}
        onApply={applyFilterSheet}
        onClear={clearFilters}
        triggerRef={filtersTriggerRef}
        params={searchParams}
        options={options}
        onUpdate={onUpdate}
        onPreset={onPreset}
        invalidRange={invalidRange}
        userOptions={options.actors || []}
        onUserSearch={setActorSearch}
        search={searchParams.get('q')}
        optionsError={optionsError}
      />}
      {eventId && <AuditDrawer key={eventId} eventId={eventId} filters={selectedEventFilters} onClose={closeDrawer} onNavigate={navigateEvent} navigate={navigate} triggerRef={drawerTriggerRef} showToast={setToast} />}
      {toast && <div className="audit-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
};

export default AuditLogsPage;
