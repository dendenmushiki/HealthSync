import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, Calendar, CalendarClock, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, Circle, ClipboardList, Clock3, Copy, Cpu, Download, Globe, HeartHandshake,
  HeartPulse, Info, KeyRound, Loader2, LockKeyhole, LogIn, LogOut, Monitor, RotateCcw, ScrollText,
  Search, Settings, Shield, ShieldAlert, SlidersHorizontal, Smartphone, SquarePen, Trash2, UserCheck,
  UserCog, UserPlus, UserRound, Users, X, XCircle,
} from 'lucide-react';
import Pagination from '../../components/common/Pagination';
import PageBanner from '../../components/common/PageBanner';
import { exportAuditLogs, getAuditLog, getAuditOptions, getAuditSummary, listAuditLogs } from '../../services/api/auditService';
import { formatDateTimeInTimeZone, formatRelativeTime, getDateInputValueInTimeZone } from '../../utils/dateUtils';
import { AUDIT_CATEGORIES, getCategoryLabel, getEventConfig, getEventSummary, getModuleLabel } from './auditEventConfig';
import { getFriendlyError } from '../../utils/apiErrorMessages';
import { getRoleLabel } from '../../utils/roleLabels';
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
const SourceIcon = ({ userAgent }) => {
  const Icon = /Android|iPhone|iPad|Mobile/i.test(userAgent || '') ? Smartphone : /Windows|Mac OS|Macintosh|Linux/i.test(userAgent || '') ? Monitor : Globe;
  return <Icon size={13} aria-hidden="true" />;
};
const exactDate = (value) => formatDateTimeInTimeZone(value, 'Asia/Manila') || 'Time unavailable';
const relativeDate = (value) => formatRelativeTime(value) || 'Time unavailable';
const isFailedResult = (result) => ['failure', 'failed', 'denied'].includes(String(result || '').toLowerCase());
const isCriticalSeverity = (severity) => ['critical', 'error'].includes(String(severity || '').toLowerCase());
const formatDateRange = (from, to) => {
  if (!from && !to) return 'All dates';
  const dateOptions = { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' };
  const start = from ? new Date(`${from.slice(0, 10)}T12:00:00+08:00`) : null;
  const end = to ? new Date(`${to.slice(0, 10)}T12:00:00+08:00`) : null;
  if (start && end && start.getFullYear() === end.getFullYear()) {
    const year = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric' }).format(end);
    return `${new Intl.DateTimeFormat('en-US', dateOptions).format(start)} - ${new Intl.DateTimeFormat('en-US', { ...dateOptions, year: 'numeric' }).format(end) || year}`;
  }
  const formatter = new Intl.DateTimeFormat('en-US', { ...dateOptions, year: 'numeric' });
  return `${start ? formatter.format(start) : 'Any'} - ${end ? formatter.format(end) : 'Any'}`;
};
const Avatar = ({ name, username, photo, size = 'normal' }) => {
  const initials = String(name || username || 'S').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'S';
  const tone = (String(username || name || 'S').charCodeAt(0) || 0) % 8;
  return photo
    ? <img className={`audit-avatar audit-avatar-${size}`} src={photo} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
    : <span className={`audit-avatar audit-avatar-${size} audit-avatar-${tone}`} aria-hidden="true">{initials}</span>;
};

const eventIcons = {
  login: LogIn,
  logout: LogOut,
  created: UserPlus,
  updated: SquarePen,
  deleted: Trash2,
  password: KeyRound,
  failure: ShieldAlert,
  locked: LockKeyhole,
  download: Download,
  activity: Activity,
};

const EventBadge = ({ item }) => {
  const config = getEventConfig(item.action);
  const Icon = eventIcons[config.icon] || Activity;
  const failed = isFailedResult(item.result);
  return (
    <span className={`audit-event-badge ${failed ? 'is-failed' : 'is-success'}`} title={`Action key: ${item.action || 'unknown'}`}>
      <Icon size={14} aria-hidden="true" /><span>{config.label}</span>
    </span>
  );
};

const ResultBadge = ({ result }) => {
  const normalized = String(result || '').toLowerCase();
  const failed = ['failure', 'failed', 'denied'].includes(normalized);
  const warning = ['warning', 'partial'].includes(normalized);
  const Icon = failed ? XCircle : warning ? AlertTriangle : normalized === 'success' ? CheckCircle2 : Circle;
  const label = failed ? (normalized === 'denied' ? 'Denied' : 'Failed') : warning ? (normalized === 'partial' ? 'Partial' : 'Warning') : normalized === 'success' ? 'Success' : result || 'Unknown';
  return <span className={`audit-result ${failed ? 'is-failed' : warning ? 'is-warning' : normalized === 'success' ? 'is-success' : 'is-neutral'}`}><Icon size={14} aria-hidden="true" />{label}</span>;
};

const SeverityBadge = ({ severity, showDefault = false }) => {
  const value = String(severity || '').toLowerCase();
  if (!value || (!showDefault && ['info', 'normal', 'low'].includes(value))) return null;
  const isCritical = ['critical', 'error'].includes(value);
  const isWarning = value === 'warning';
  const isInfo = value === 'info';
  const Icon = isCritical ? ShieldAlert : isWarning ? AlertTriangle : isInfo ? Info : Circle;
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return <span className={`audit-severity-badge ${isCritical ? 'is-critical' : isWarning ? 'is-warning' : isInfo ? 'is-info' : 'is-neutral'}`}><Icon size={13} aria-hidden="true" />{label}</span>;
};

const RoleChip = ({ role }) => <span className="audit-role-chip">{getRoleLabel(role)}</span>;

const moduleIcons = {
  authentication: Shield,
  user_management: Users,
  resident: UserRound,
  health_record: ClipboardList,
  nutrition: HeartPulse,
  senior_registry: HeartHandshake,
  settings: Settings,
};

const ModuleChip = ({ module }) => {
  const category = AUDIT_CATEGORIES[Object.keys(AUDIT_CATEGORIES).find((key) => AUDIT_CATEGORIES[key].modules.includes(module))]?.label
    ? Object.keys(AUDIT_CATEGORIES).find((key) => AUDIT_CATEGORIES[key].modules.includes(module))
    : 'system';
  const Icon = moduleIcons[category] || Activity;
  return <span className="audit-module-chip"><Icon size={13} aria-hidden="true" />{getModuleLabel(module)}</span>;
};

const AuditError = ({ error, onRetry }) => (
  <div className="audit-error" role="alert">
    <AlertTriangle size={17} aria-hidden="true" />
    <span>{getFriendlyError(error)}</span>
    <button type="button" className="audit-button audit-button-secondary" onClick={onRetry}>Retry</button>
  </div>
);

const MultiSelect = ({ label, options, selected, onToggle, searchable = false }) => {
  const [query, setQuery] = useState('');
  const detailsRef = useRef(null);
  const filteredOptions = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && detailsRef.current?.open) {
      event.preventDefault();
      event.stopPropagation();
      detailsRef.current.open = false;
      detailsRef.current.querySelector('summary')?.focus();
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const checkboxes = Array.from(detailsRef.current?.querySelectorAll('.audit-checklist input[type="checkbox"]') || []);
    if (!checkboxes.length) return;
    const currentIndex = checkboxes.indexOf(document.activeElement);
    if (event.target.tagName !== 'SUMMARY' && currentIndex < 0) return;
    event.preventDefault();
    const nextIndex = currentIndex < 0
      ? (event.key === 'ArrowDown' ? 0 : checkboxes.length - 1)
      : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + checkboxes.length) % checkboxes.length;
    checkboxes[nextIndex].focus();
  };
  return (
    <details ref={detailsRef} className="audit-multi-filter" onKeyDown={handleKeyDown}>
      <summary aria-label={`${label}, ${selected.length} selected`}>{label}{selected.length > 0 && <span className="audit-filter-count">{selected.length}</span>}<ChevronDown size={14} aria-hidden="true" /></summary>
      <div className="audit-checklist" role="group" aria-label={label}>
        {searchable && <label className="audit-option-search"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`} /></label>}
        {filteredOptions.map((option) => (
          <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} /><span>{option.label}</span></label>
        ))}
        {!filteredOptions.length && <span className="audit-muted">No values available</span>}
      </div>
    </details>
  );
};

const FilterControls = ({ params, options, onUpdate, onPreset, invalidRange, userOptions, onUserSearch, onSearchChange, search, searchRef, searchId = 'audit-search-input', actorListId = 'audit-actor-options', optionsError }) => {
  const [draftFrom, setDraftFrom] = useState(params.get('from')?.slice(0, 10) || '');
  const [draftTo, setDraftTo] = useState(params.get('to')?.slice(0, 10) || '');
  const [actorInput, setActorInput] = useState('');
  useEffect(() => {
    setDraftFrom(params.get('from')?.slice(0, 10) || '');
    setDraftTo(params.get('to')?.slice(0, 10) || '');
  }, [params]);
  const modules = parseList(params.get('modules'));
  const actions = parseList(params.get('actions'));
  const modulesAvailable = options.modules || [];
  const actionsAvailable = options.actions || [];
  const moduleCategories = Object.keys(AUDIT_CATEGORIES).map((category) => ({
    value: category,
    label: getCategoryLabel(category),
    modules: modulesAvailable.filter((module) => AUDIT_CATEGORIES[category].modules.includes(module)),
  })).filter((category) => category.modules.length);
  const knownModules = moduleCategories.flatMap((category) => category.modules);
  const moduleOptions = [
    ...moduleCategories.map((category) => ({ value: category.value, label: category.label })),
    ...modulesAvailable.filter((module) => !knownModules.includes(module)).map((module) => ({ value: module, label: getModuleLabel(module) })),
  ];
  const actionOptions = actionsAvailable.map((action) => ({ value: action, label: getEventConfig(action).label }));
  const actor = userOptions.find((item) => String(item.user_id) === params.get('userId'));
  const actorValue = actor ? `${actor.full_name} (@${actor.username})` : (params.get('userId') ? 'Selected user' : '');
  useEffect(() => {
    setActorInput(actorValue);
  }, [actorValue]);

  const toggleValues = (key, values, current) => {
    const allSelected = values.every((value) => current.includes(value));
    const next = allSelected ? current.filter((entry) => !values.includes(entry)) : [...new Set([...current, ...values])];
    onUpdate({ [key]: next.length ? next.join(',') : null, page: 1 });
  };
  const updateActor = (value) => {
    const selectedActor = userOptions.find((item) => `${item.full_name} (@${item.username})` === value || item.username === value || item.full_name === value);
    onUpdate({ userId: selectedActor ? selectedActor.user_id : null, target_user_id: null, page: 1 });
  };
  const selectedModuleCategories = moduleCategories.filter((category) => category.modules.some((module) => modules.includes(module))).map((category) => category.value);
  const toggleModuleCategory = (categoryValue) => {
    const category = moduleCategories.find((item) => item.value === categoryValue);
    if (!category) {
      toggleValues('modules', [categoryValue], modules);
      return;
    }
    const next = category.modules.some((module) => modules.includes(module))
      ? modules.filter((module) => !category.modules.includes(module))
      : [...new Set([...modules, ...category.modules])];
    onUpdate({ modules: next.length ? next.join(',') : null, page: 1 });
  };
  const presetLabel = {
    all: 'All dates', today: 'Today', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', custom: 'Custom range',
  }[params.get('range') || '7d'];
  const resultValue = params.get('result') || '';
  const severityValue = params.get('severity') || '';
  const sortValue = params.get('sort') || 'newest';
  const applyCustomRange = () => {
    onUpdate({ range: 'custom', from: draftFrom || null, to: draftTo || null, page: 1 });
  };

  return (
    <div className="audit-filter-controls">
      {optionsError && <small className="audit-field-error" role="alert">Filter options could not be loaded. Refresh to try again.</small>}
      <div className="audit-filter-primary">
        <label className="audit-search" htmlFor={searchId}><Search size={17} aria-hidden="true" />
          <input id={searchId} ref={searchRef} value={search || ''} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search users, actions, modules, details" aria-label="Search audit logs" />
          {!search && <kbd aria-hidden="true">/</kbd>}
          {search && <button type="button" aria-label="Clear search" onClick={() => { onSearchChange(''); onUpdate({ q: null, page: 1 }); }}><X size={15} aria-hidden="true" /></button>}
        </label>
        <details className="audit-date-popover">
          <summary aria-label={`Date range: ${presetLabel}`}><Calendar size={16} aria-hidden="true" /><span>{params.get('range') === 'custom' ? formatDateRange(params.get('from'), params.get('to')) : presetLabel}</span><ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="audit-date-panel">
            <div className="audit-date-presets">{[['today', 'Today'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['custom', 'Custom']].map(([value, label]) => <button key={value} type="button" className={(params.get('range') || '7d') === value ? 'is-selected' : ''} onClick={() => onPreset(value)}>{label}</button>)}
              <button type="button" className={params.get('range') === 'all' ? 'is-selected' : ''} onClick={() => onPreset('all')}>All dates</button></div>
            {params.get('range') === 'custom' && <div className="audit-custom-date">
              <label>From<input type="date" value={draftFrom} max={localDate()} onChange={(event) => setDraftFrom(event.target.value)} /></label>
              <label>To<input type="date" value={draftTo} max={localDate()} onChange={(event) => setDraftTo(event.target.value)} /></label>
              {invalidRange && <small className="audit-field-error" role="alert">{invalidRange}</small>}
              <div className="audit-date-actions"><button type="button" onClick={() => onPreset('all')}>Clear</button><button type="button" onClick={applyCustomRange}>Apply</button></div>
            </div>}
          </div>
        </details>
        <label className="audit-select-field"><CheckCircle2 size={15} aria-hidden="true" /><span className="audit-sr-only">Result</span><select value={resultValue} onChange={(event) => onUpdate({ result: event.target.value || null, page: 1 })} aria-label="Result"><option value="">All results</option><option value="success">Success</option><option value="failure">Failed / denied</option></select></label>
        <label className="audit-select-field"><ShieldAlert size={15} aria-hidden="true" /><span className="audit-sr-only">Severity</span><select value={severityValue} onChange={(event) => onUpdate({ severity: event.target.value || null, page: 1 })} aria-label="Severity"><option value="">All severity</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
        <label className="audit-select-field audit-sort-field"><ArrowUpDown size={15} aria-hidden="true" /><select value={sortValue} onChange={(event) => onUpdate({ sort: event.target.value, page: 1 })} aria-label="Sort order"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>
      <details className="audit-more-filters">
        <summary><SlidersHorizontal size={15} aria-hidden="true" />More filters{(modules.length + actions.length + (params.get('userId') ? 1 : 0)) > 0 && <span className="audit-filter-count">{modules.length + actions.length + (params.get('userId') ? 1 : 0)}</span>}</summary>
        <div className="audit-more-panel">
          <MultiSelect label="Category / module" options={moduleOptions} selected={selectedModuleCategories} onToggle={toggleModuleCategory} searchable />
          <MultiSelect label="Action" options={actionOptions} selected={actions} onToggle={(value) => toggleValues('actions', [value], actions)} searchable />
          <label className="audit-actor-filter"><UserRound size={15} aria-hidden="true" /><input list={actorListId} value={actorInput} onChange={(event) => { setActorInput(event.target.value); updateActor(event.target.value); }} onInput={(event) => onUserSearch(event.target.value)} placeholder="Search users..." aria-label="Filter by actor" />
            <datalist id={actorListId}>{userOptions.map((item) => <option key={item.user_id} value={`${item.full_name} (@${item.username})`} />)}</datalist>
          </label>
        </div>
      </details>
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
      .catch((requestError) => {
        console.error('Unable to load audit event.', requestError);
        if (active) setError(requestError);
      })
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
      <aside ref={panelRef} id="audit-event-drawer" className="audit-drawer" role="dialog" aria-modal="true" aria-label="Audit event details" tabIndex="-1">
        <header className="audit-drawer-header">
          <div><span className="audit-eyebrow">READ-ONLY EVENT</span><h2>Event details</h2></div>
          <button type="button" className="audit-icon-button" aria-label="Close event details" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        {loading && <div className="audit-detail-skeleton" aria-label="Loading event details"><span /><span /><span /><span /></div>}
        {!loading && error && <AuditError error={error} onRetry={() => setRetryKey((value) => value + 1)} />}
        {!loading && event && <>
          <div className="audit-detail-event">
            <EventBadge item={event} /><ResultBadge result={event.result} />
            <strong>{exactDate(event.created_at)} <small>Asia/Manila</small></strong>
            <span>{relativeDate(event.created_at)}</span>
          </div>
          <div className="audit-drawer-content">
            <section className="audit-detail-section"><h3>Who</h3>
              <div className="audit-detail-person">{event.actor_id ? <Avatar name={event.actor_name} username={event.actor_username} photo={event.actor_photo} size="large" /> : <span className="audit-system-avatar audit-system-avatar-large"><Cpu size={18} aria-hidden="true" /></span>}<div>
                {event.actor_id ? <button type="button" className="audit-link" onClick={() => navigate(`/users?user=${encodeURIComponent(event.actor_id)}&drawer=user`)}>{event.actor_name || 'Account'}</button> : <strong>{event.actor_name || 'System / unknown actor'}</strong>}
                <small>{event.actor_username ? `@${event.actor_username} · ` : ''}<RoleChip role={event.actor_role} /></small>
              </div></div>
            </section>
            <section className="audit-detail-section"><h3>What</h3><dl className="audit-detail-list">
              <div><dt>Event</dt><dd><EventBadge item={event} /></dd></div>
              <div><dt>Result</dt><dd><ResultBadge result={event.result} /></dd></div>
              <div><dt>Severity</dt><dd><SeverityBadge severity={event.severity} showDefault />{event.severity ? '' : 'Not recorded'}</dd></div>
              <div><dt>Event ID</dt><dd><code>{event.audit_id}</code><button type="button" className="audit-copy-id" aria-label="Copy event ID" onClick={() => copy(String(event.audit_id), 'Event ID copied.')}><Copy size={13} aria-hidden="true" /></button></dd></div>
              <div><dt>Action key</dt><dd><code>{event.action}</code></dd></div>
              <div><dt>Module</dt><dd>{getModuleLabel(event.module)}</dd></div><div><dt>Description</dt><dd>{event.description || getEventSummary(event)}</dd></div>
            </dl></section>
            <section className="audit-detail-section"><h3>Target</h3>
              {event.target_user_id
                ? <button type="button" className="audit-link" onClick={() => navigate(`/users?user=${encodeURIComponent(event.target_user_id)}&drawer=user`)}>{event.target_user_name || event.target_label || 'View user account'} <ArrowUpRight size={14} aria-hidden="true" /></button>
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
            </section>
            <section className="audit-detail-section"><h3>Metadata</h3>
              <details className="audit-raw-json"><summary>View sanitized metadata</summary><pre>{JSON.stringify(rawDetails, null, 2) || '{}'}</pre></details>
              <button type="button" className="audit-link audit-copy-metadata" onClick={() => copy(JSON.stringify(rawDetails, null, 2), 'Metadata copied.')}><Copy size={13} aria-hidden="true" />Copy metadata</button>
            </section>
          </div>
          <footer className="audit-drawer-footer">
            <div className="audit-copy-actions">
              <button type="button" className="audit-button" onClick={copyDetails}><Copy size={14} aria-hidden="true" />Copy event details</button>
              <button type="button" className="audit-button audit-button-secondary" onClick={() => copy(String(event.audit_id), 'Event ID copied.')}><Copy size={14} aria-hidden="true" />Copy event ID</button>
            </div>
            <div className="audit-event-navigation">
              <button type="button" className="audit-button audit-button-secondary" disabled={!neighbors.previousId} onClick={() => onNavigate(neighbors.previousId)}><ChevronLeft size={15} aria-hidden="true" />Previous</button>
              {event.actor_id && <button type="button" className="audit-link-button" onClick={() => {
                onClose();
                navigate(`/audit-logs?userId=${encodeURIComponent(event.actor_id)}&range=7d&from=${moveDate(localDate(), -6)}&to=${localDate()}`);
              }}>View actor activity</button>}
              <button type="button" className="audit-button audit-button-secondary" disabled={!neighbors.nextId} onClick={() => onNavigate(neighbors.nextId)}>Next<ChevronRight size={15} aria-hidden="true" /></button>
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
        <header><h2 id="audit-filter-sheet-title">Filter audit logs</h2><button type="button" className="audit-icon-button" aria-label="Close filters" onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
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
  const pageSize = [10, 25, 50].includes(Number(searchParams.get('pageSize'))) ? Number(searchParams.get('pageSize')) : 10;
  const eventId = searchParams.get('event') || '';
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);
  const [summary, setSummary] = useState({});
  const [options, setOptions] = useState({ actions: [], modules: [], actors: [] });
  const [optionsError, setOptionsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
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
      .catch((requestError) => {
        console.error('Unable to load audit logs.', requestError);
        if (active) setError(requestError);
      })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [queryString, listParams, page, refreshKey, updateParams]);

  const summaryFrom = queryParams.get('from') || '';
  const summaryTo = queryParams.get('to') || '';
  useEffect(() => {
    let active = true;
    getAuditSummary({ from: summaryFrom, to: summaryTo })
      .then((response) => {
        if (!response?.success) throw new Error(response?.message || 'Unable to load audit insights.');
        if (active) setSummary(response.data?.counts || {});
      })
      .catch((requestError) => { if (active) console.error('Unable to load audit summary.', requestError); });
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
      const from = Object.prototype.hasOwnProperty.call(updates, 'from') ? updates.from : queryParams.get('from');
      const to = Object.prototype.hasOwnProperty.call(updates, 'to') ? updates.to : queryParams.get('to');
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
      console.error('Unable to export audit logs.', requestError);
      setToast(getFriendlyError(requestError));
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
  const isSummaryFilterActive = (kind) => {
    const activeRange = searchParams.get('range');
    const activeActions = parseList(searchParams.get('actions'));
    if (kind === 'today') return activeRange === 'today';
    if (kind === 'failed') return activeRange === '24h' && activeActions.includes('LOGIN_FAILED') && searchParams.get('result') === 'failure';
    if (kind === 'active') return activeRange === '24h' && activeActions.includes('LOGIN') && searchParams.get('result') === 'success';
    if (kind === 'admin') return activeRange === '7d' && ['users', 'account-settings', 'admin-settings'].every((module) => parseList(searchParams.get('modules')).includes(module));
    return false;
  };

  const activeFilters = useMemo(() => {
    const values = [];
    if (searchParams.get('q')) values.push({ key: 'q', label: `Search: ${searchParams.get('q')}` });
    const range = searchParams.get('range') || '7d';
    const rangeLabels = { all: 'All dates', today: 'Today', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' };
    if (range !== 'all' && (range !== '7d' || searchParams.get('from') || searchParams.get('to'))) {
      values.push({ key: 'date', label: range === 'custom' ? formatDateRange(searchParams.get('from'), searchParams.get('to')) : rangeLabels[range] || 'Date range' });
    }
    parseList(searchParams.get('modules')).forEach((value) => values.push({ key: 'modules', value, label: getModuleLabel(value) }));
    parseList(searchParams.get('actions')).forEach((value) => values.push({ key: 'actions', value, label: getEventConfig(value).label }));
    if (searchParams.get('userId') || searchParams.get('target_user_id')) {
      const selectedActor = (options.actors || []).find((item) => String(item.user_id) === searchParams.get('userId'));
      values.push({ key: searchParams.has('userId') ? 'userId' : 'target_user_id', label: selectedActor ? `Actor: ${selectedActor.full_name}` : 'Actor / target' });
    }
    if (searchParams.get('result')) values.push({ key: 'result', label: searchParams.get('result') === 'failure' ? 'Failed' : 'Success' });
    if (searchParams.get('severity')) values.push({ key: 'severity', label: `Severity: ${searchParams.get('severity').charAt(0).toUpperCase()}${searchParams.get('severity').slice(1)}` });
    return values;
  }, [options.actors, searchParams]);

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
  const selectedEventFilters = useMemo(() => ({ ...queryFilterParams, sort: searchParams.get('sort') || 'newest' }), [queryFilterParams, searchParams]);
  const dataRows = (group) => group.items.map((item) => (
    <tr key={item.audit_id} className={`audit-data-row ${isFailedResult(item.result) ? 'is-failed' : ''} ${isCriticalSeverity(item.severity) ? 'is-critical' : ''}`}
      tabIndex="0" aria-expanded={eventId === String(item.audit_id)} aria-controls="audit-event-drawer"
      aria-label={`${getEventConfig(item.action).label}: ${getEventSummary(item)}. ${item.result}. Open details`}
      onClick={(event) => selectEvent(item.audit_id, event.currentTarget)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectEvent(item.audit_id, event.currentTarget); } }}>
      <td className="audit-time-cell"><time dateTime={item.created_at} title={`${exactDate(item.created_at)} Asia/Manila`}>{new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(item.created_at))}<small>{relativeDate(item.created_at)}</small></time></td>
      <td><div className="audit-actor">{item.actor_id ? <Avatar name={item.actor_name} username={item.actor_username} photo={item.actor_photo} /> : <span className="audit-system-avatar"><Cpu size={15} aria-hidden="true" /></span>}<span><strong title={item.actor_name || 'System'}>{item.actor_name || 'System'}</strong><small>{item.actor_username ? `@${item.actor_username} · ` : ''}<RoleChip role={item.actor_role} /></small><small className="audit-inline-source"><SourceIcon userAgent={item.user_agent} />{item.ip_address || 'Not recorded'} · {getDeviceLabel(item.user_agent)}</small></span></div></td>
      <td><EventBadge item={item} /><span className="audit-inline-module"><ModuleChip module={item.module} /></span></td>
      <td className="audit-module-cell"><ModuleChip module={item.module} /></td>
      <td className="audit-description-cell" title={getEventSummary(item)}>{getEventSummary(item).toLowerCase() === getEventConfig(item.action).label.toLowerCase() ? '—' : getEventSummary(item)}</td>
      <td className="audit-source-cell" title={item.user_agent || ''}><span><SourceIcon userAgent={item.user_agent} />{item.ip_address || 'Not recorded'}</span><small>{getDeviceLabel(item.user_agent)}</small></td>
      <td><div className="audit-result-stack"><ResultBadge result={item.result} /><SeverityBadge severity={item.severity} /></div></td>
      <td className="audit-view-cell"><button type="button" aria-label="View details" aria-expanded={eventId === String(item.audit_id)} aria-controls="audit-event-drawer" onClick={(event) => { event.stopPropagation(); selectEvent(item.audit_id, event.currentTarget); }}><ChevronRight size={18} aria-hidden="true" /></button></td>
    </tr>
  ));
  const mobileCards = (group) => group.items.map((item) => (
    <button type="button" key={`card-${item.audit_id}`} className={`audit-mobile-card ${isFailedResult(item.result) ? 'is-failed' : ''} ${isCriticalSeverity(item.severity) ? 'is-critical' : ''}`}
      onClick={(event) => selectEvent(item.audit_id, event.currentTarget)} aria-label={`View ${getEventConfig(item.action).label} by ${item.actor_name || 'unknown actor'}`} aria-expanded={eventId === String(item.audit_id)} aria-controls="audit-event-drawer">
      <span className="audit-mobile-card-top"><EventBadge item={item} /><span className="audit-result-stack"><ResultBadge result={item.result} /><SeverityBadge severity={item.severity} /></span></span>
      <span className="audit-actor">{item.actor_id ? <Avatar name={item.actor_name} username={item.actor_username} photo={item.actor_photo} /> : <span className="audit-system-avatar"><Cpu size={15} aria-hidden="true" /></span>}<span><strong>{item.actor_name || 'System'}</strong><small>{item.actor_username ? `@${item.actor_username} · ` : ''}<RoleChip role={item.actor_role} /></small></span></span>
      <span className="audit-mobile-description">{getEventSummary(item).toLowerCase() === getEventConfig(item.action).label.toLowerCase() ? '—' : getEventSummary(item)}</span>
      <span className="audit-mobile-bottom"><small><Clock3 size={13} aria-hidden="true" />{relativeDate(item.created_at)}<ModuleChip module={item.module} /><span>{item.ip_address || 'Not recorded'}</span></small><ChevronRight size={18} aria-hidden="true" /></span>
    </button>
  ));
  const SortIcon = searchParams.get('sort') === 'oldest' ? ArrowUp : ArrowDown;

  return (
    <div className="audit-logs-page">
      {refreshing && <span className="audit-progress" role="progressbar" aria-label="Refreshing audit logs" />}
      <PageBanner
        className="audit-banner"
        eyebrow="ADMIN / AUDIT LOGS"
        icon={ScrollText}
        title={<span className="audit-banner-title">Audit Logs <span className="audit-read-only" title="Audit logs cannot be edited or deleted"><LockKeyhole size={13} aria-hidden="true" />Read-only</span></span>}
        subtitle="A read-only record of sign-ins, changes, and administrative actions."
        actions={<div className="audit-header-actions">
          <span className="audit-updated" title={`Updated ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Manila' }).format(new Date(updatedAt))}`}><Clock3 size={14} aria-hidden="true" />Updated {relativeDate(updatedAt)}</span>
          <button type="button" className="audit-icon-button audit-refresh-button" aria-label="Refresh" disabled={refreshing} onClick={() => { setRefreshing(true); setRefreshKey((value) => value + 1); }}><Loader2 className={refreshing ? 'is-spinning' : ''} size={16} aria-hidden="true" /></button>
          <button type="button" className="audit-button audit-export-button" onClick={exportCsv} disabled={exporting}>{exporting ? <Loader2 className="is-spinning" size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{exporting ? 'Exporting...' : 'Export CSV'}</button>
        </div>}
      />

      <section className="audit-summary" aria-label="Audit activity summary">
        {[
          { key: 'today', label: 'Events today', value: summary.today, caption: 'Recorded today', icon: CalendarClock },
          { key: 'failed', label: 'Failed sign-ins, 24h', value: summary.failed_24h, caption: 'Sign-in attempts', icon: ShieldAlert, warning: Number(summary.failed_24h) > 0 },
          { key: 'active', label: 'Active users, 24h', value: summary.active_users_24h, caption: 'Unique accounts', icon: UserCheck },
          { key: 'admin', label: 'Admin actions, 7d', value: summary.admin_actions_7d, caption: 'Administrative activity', icon: UserCog },
        ].map((card) => <button key={card.key} type="button" className={`audit-summary-card ${card.warning ? 'is-warning' : ''} ${isSummaryFilterActive(card.key) ? 'is-active' : ''}`} onClick={() => setSummaryFilter(card.key)}>
          <span className="audit-summary-icon"><card.icon size={19} aria-hidden="true" /></span>
          <span className="audit-summary-copy"><span>{card.label}</span><strong>{card.value === undefined ? '—' : Number(card.value).toLocaleString()}</strong><small>{card.caption}</small></span>
          <card.icon className="audit-summary-watermark" size={62} aria-hidden="true" />
          <ChevronRight className="audit-summary-chevron" size={16} aria-hidden="true" />
        </button>)}
      </section>

      <section className="audit-filter-card" aria-label="Audit filters">
        <div className="audit-filter-heading">
          <div><h2>Filters</h2><p>Refine audit events without changing the source records.</p></div>
          <button ref={filtersTriggerRef} type="button" className="audit-mobile-filter-button" aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal size={15} aria-hidden="true" />Filters{activeFilters.length > 0 && <span>{activeFilters.length}</span>}
          </button>
        </div>
        <FilterControls params={searchParams} options={options} onUpdate={onUpdate} onPreset={onPreset} invalidRange={invalidRange}
          userOptions={options.actors || []} onUserSearch={setActorSearch} onSearchChange={setSearchInput} search={searchInput} searchRef={searchRef} optionsError={optionsError} />
        <div className="audit-active-filters">
          {activeFilters.map((filter, index) => <button type="button" key={`${filter.key}-${filter.value || index}`} className="audit-filter-chip" onClick={() => removeFilter(filter.key, filter.value)}>{filter.label}<X size={13} aria-hidden="true" /></button>)}
          {activeFilters.length > 0 && <button type="button" className="audit-clear-link" onClick={clearFilters}><RotateCcw size={14} aria-hidden="true" />Clear all</button>}
        </div>
      </section>

      <section className="audit-surface" aria-label="Audit event records">
        <header className="audit-table-heading">
          <div><h2>Audit events</h2><span aria-live="polite">{loading ? 'Updating results...' : `Showing ${first.toLocaleString()}-${last.toLocaleString()} of ${total === null ? '—' : total.toLocaleString()} matching events`}</span></div>
          <span className="audit-count-chip">{total === null ? '—' : total.toLocaleString()} events</span>
        </header>
        {error && <AuditError error={error} onRetry={() => { setRefreshing(true); setRefreshKey((value) => value + 1); }} />}
        <div className="audit-table-wrap" aria-busy={loading}>
          <table className="audit-table" aria-label="Audit log events">
            <caption className="audit-sr-only">Read-only event history. Select a row to view details.</caption>
            <thead><tr>
              <th scope="col" aria-sort={searchParams.get('sort') === 'oldest' ? 'ascending' : 'descending'}>
                <button type="button" onClick={() => updateParams({ sort: searchParams.get('sort') === 'oldest' ? 'newest' : 'oldest', page: 1 })}>WHEN <SortIcon size={13} aria-hidden="true" /></button>
              </th><th scope="col">User</th><th scope="col">Event</th><th scope="col">Module</th><th scope="col">Details</th><th scope="col">Source</th><th scope="col">Result</th><th scope="col"><span className="audit-sr-only">Open</span></th>
            </tr></thead>
            <tbody>
              {loading && items.length === 0 && Array.from({ length: 6 }, (_, index) => <tr className="audit-skeleton-row" key={`skeleton-${index}`} aria-hidden="true">{Array.from({ length: 8 }, (_, cell) => <td key={cell}><span /></td>)}</tr>)}
              {groups.map((group) => <React.Fragment key={group.key}>
                <tr className="audit-day-heading"><th colSpan="8" scope="rowgroup"><Calendar size={14} aria-hidden="true" /><span>{group.title}</span><small>{group.items.length.toLocaleString()} event{group.items.length === 1 ? '' : 's'}</small></th></tr>
                {dataRows(group)}
              </React.Fragment>)}
              {!loading && !error && !items.length && <tr><td colSpan="8"><div className="audit-empty-state">
                <span><ScrollText size={23} aria-hidden="true" /></span><strong>No audit events found</strong>
                <p>Try a different date range or clear some filters.</p>
                {activeFilters.length > 0 && <button type="button" className="audit-button audit-button-secondary" onClick={clearFilters}>Clear all filters</button>}
              </div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="audit-mobile-groups">
          {loading && items.length === 0 && <div className="audit-mobile-skeleton" aria-label="Loading audit events">{Array.from({ length: 6 }, (_, index) => <span key={index}><i /><i /><i /></span>)}</div>}
          {groups.map((group) => <section key={`mobile-${group.key}`} className="audit-mobile-day">
          <h2><Calendar size={14} aria-hidden="true" />{group.title}<small>{group.items.length} event{group.items.length === 1 ? '' : 's'}</small></h2>{mobileCards(group)}
        </section>)}
          {!loading && !error && !items.length && <div className="audit-empty-state"><span><ScrollText size={23} aria-hidden="true" /></span><strong>No audit events found</strong><p>Try a different date range or clear some filters.</p>{activeFilters.length > 0 && <button type="button" className="audit-button" onClick={clearFilters}>Clear all filters</button>}</div>}
        </div>
        {!error && <div className="audit-pagination"><Pagination currentPage={page} totalPages={Math.ceil(total / pageSize)} first={first} last={last} total={total}
          itemLabel="events" pageSize={pageSize} pageSizeOptions={[10, 25, 50]} formatCounts onPageSizeChange={(value) => updateParams({ pageSize: value, page: 1 })}
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
        onSearchChange={setSearchInput}
        search={searchInput}
        searchRef={searchRef}
        searchId="audit-filter-sheet-search"
        actorListId="audit-filter-sheet-actors"
        optionsError={optionsError}
      />}
      {eventId && <AuditDrawer key={eventId} eventId={eventId} filters={selectedEventFilters} onClose={closeDrawer} onNavigate={navigateEvent} navigate={navigate} triggerRef={drawerTriggerRef} showToast={setToast} />}
      {toast && <div className="audit-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
};

export default AuditLogsPage;
