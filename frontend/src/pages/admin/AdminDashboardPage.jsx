import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock3,
  HeartPulse,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SquarePen,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import PageBanner from '../../components/common/PageBanner';
import api from '../../services/api/apiClient';
import { listAuditLogs } from '../../services/api/auditService';
import { getEventConfig } from '../audit/auditEventConfig';
import { formatDateTimeInTimeZone, formatRelativeTime } from '../../utils/dateUtils';
import { getFriendlyError } from '../../utils/apiErrorMessages';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import './AdminDashboard.css';

const REFRESH_INTERVAL = 30000;
const RECENT_ITEMS_LIMIT = 5;

const metricDefinitions = [
  { key: 'totalUsers', label: 'Total users', caption: 'All registered accounts', Icon: Users, to: '/users' },
  { key: 'adminUsers', label: 'Administrators', caption: 'System administrators', Icon: ShieldCheck },
  { key: 'bhwUsers', label: 'Health workers', caption: 'Barangay health workers', Icon: HeartPulse },
  { key: 'auditEvents', label: 'Audit events', caption: 'Recorded in the last 30 days', Icon: Activity, to: '/audit-logs' },
];

const roleAliases = {
  admin: { key: 'admin', label: 'Administrator' },
  administrator: { key: 'admin', label: 'Administrator' },
  bhw: { key: 'bhw', label: 'BHW' },
  official: { key: 'official', label: 'Official' },
  barangay_official: { key: 'official', label: 'Official' },
};

const knownRoleColors = {
  admin: '--admin-role-administrator',
  bhw: '--admin-role-bhw',
  official: '--admin-role-official',
};

const otherRoleColors = ['--admin-role-other-teal', '--admin-role-other-neutral'];

const eventIcons = {
  LOGIN: LogIn,
  LOGOUT: LogOut,
  CREATE: UserPlus,
  USER_CREATED: UserPlus,
  UPDATE: SquarePen,
  USER_UPDATED: SquarePen,
  DELETE: Trash2,
  USER_DEACTIVATED: Trash2,
  PASSWORD_CHANGED: KeyRound,
  ACCOUNT_PASSWORD_UPDATED: KeyRound,
  PASSWORD_RESET: KeyRound,
  LOGIN_FAILED: ShieldAlert,
  ACCOUNT_LOCKED: ShieldAlert,
  ROLE_CHANGED: ShieldCheck,
  USER_REACTIVATED: ShieldCheck,
  USER_UNLOCKED: ShieldCheck,
};

function normalizeRoleKey(role) {
  return String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/_+/g, '_');
}

function hashRole(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getRolePresentation(role) {
  const key = normalizeRoleKey(role);
  const known = roleAliases[key];
  const label = known?.label || key.split('_').filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ') || 'Unknown';
  const canonicalKey = known?.key || key || 'unknown';
  const colorToken = known
    ? knownRoleColors[known.key]
    : otherRoleColors[hashRole(canonicalKey) % otherRoleColors.length];

  return {
    key: canonicalKey,
    label,
    variant: known?.key || 'other',
    color: `var(${colorToken})`,
    outline: canonicalKey === 'official' ? 'var(--admin-role-official-outline)' : 'var(--admin-card)',
  };
}

function getRoleStyle(role) {
  return { '--admin-role-color': getRolePresentation(role).color };
}

function getRoleCount(usersByRole, requestedRole) {
  const match = Object.entries(usersByRole).find(([role]) => (
    getRolePresentation(role).key === requestedRole
  ));
  const count = Number(match?.[1]);
  return Number.isFinite(count) ? count : 0;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '—';
}

function formatCreatedDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatUpdatedTime(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
}

function useCountUp(value) {
  const count = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reducedMotion || count === 0 || !window.requestAnimationFrame || !window.cancelAnimationFrame) {
      setDisplayValue(count);
      return undefined;
    }

    const startedAt = performance.now();
    const duration = 700;
    let frameId;
    let active = true;
    const tick = (now) => {
      if (!active) return;
      const progress = Math.min((now - startedAt) / duration, 1);
      setDisplayValue(Math.round(count * (1 - ((1 - progress) ** 3))));
      if (progress < 1) frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
    };
  }, [count]);

  return formatNumber(displayValue);
}

function MetricTile({ metric, value, index }) {
  const animatedValue = useCountUp(value);
  const { Icon } = metric;
  const Content = (
    <>
      <span className="admin-metric-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></span>
      <span className="admin-metric-copy">
        <span className="admin-metric-label">{metric.label}</span>
        <strong className="admin-metric-value" aria-label={`${metric.label}: ${formatNumber(value)}`}>
          {animatedValue}
        </strong>
        <span className="admin-metric-caption">{metric.caption}</span>
      </span>
      <Icon className="admin-metric-watermark" size={76} strokeWidth={1.2} aria-hidden="true" />
      {metric.to && <ChevronRight className="admin-metric-chevron" size={17} aria-hidden="true" />}
    </>
  );
  const className = `admin-metric-card${metric.to ? ' is-link' : ''} dashboard-entrance dashboard-delay-${index}`;

  return metric.to
    ? <Link className={className} to={metric.to}>{Content}</Link>
    : <article className={className}>{Content}</article>;
}

function DashboardPanel({ eyebrow, title, description, className = '', action, children }) {
  return (
    <section className={`admin-panel ${className}`}>
      <header className="admin-panel-header">
        <div className="admin-panel-heading">
          <span className="admin-panel-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function RoleChip({ role, className = '' }) {
  const presentation = getRolePresentation(role);
  return (
    <span className={`admin-role-chip ${className}`} style={getRoleStyle(role)}>
      <i aria-hidden="true" />
      {presentation.label}
    </span>
  );
}

function LiveStatusChip({ live }) {
  return (
    <span className={`admin-live-chip${live ? ' is-live' : ''}`} role="status" aria-live="polite">
      <i aria-hidden="true" />
      {live ? 'Live' : 'Paused'}
    </span>
  );
}

function DashboardIssue({ title, error, onRetry, retrying = false, className = '' }) {
  const message = error ? getFriendlyError(error) : 'Please try again.';
  return (
    <div className={`admin-dashboard-issue ${className}`} role="alert">
      <span className="admin-issue-icon" aria-hidden="true"><AlertTriangle size={19} /></span>
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button type="button" className="admin-retry-button" onClick={onRetry} disabled={retrying}>
          {retrying && <RefreshCw size={14} className="admin-spin" aria-hidden="true" />}
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  );
}

function SkeletonLines({ count = 3, className = '' }) {
  return (
    <div className={`admin-skeleton-lines ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <span key={index} />)}
    </div>
  );
}

function MetricSkeleton() {
  return (
    <div className="admin-metric-skeleton" aria-hidden="true">
      <span />
      <div><i /><b /><small /></div>
    </div>
  );
}

function PieSkeleton() {
  return (
    <div className="admin-pie-skeleton" aria-hidden="true">
      <span className="admin-skeleton-ring" />
      <SkeletonLines count={3} />
    </div>
  );
}

function ActionSkeleton() {
  return (
    <div className="admin-action-skeleton-list" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => <div key={index}><i /><span /><b /></div>)}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="admin-list-skeleton" aria-hidden="true">
      {Array.from({ length: RECENT_ITEMS_LIMIT }, (_, index) => <div key={index}><i /><span /><b /></div>)}
    </div>
  );
}

function RolePieChart({ roles, totalUsers, activeRole, onActiveRoleChange }) {
  const chartRoles = roles.filter((role) => role.count > 0);
  const chartTotal = chartRoles.reduce((total, role) => total + role.count, 0);
  const empty = chartTotal === 0;
  const circumference = 2 * Math.PI * 38;
  const signature = chartRoles.map((role) => `${role.key}:${role.count}`).join('|');
  const [revealed, setRevealed] = useState(false);
  const summary = roles.length
    ? roles.map((role) => `${role.label}: ${formatNumber(role.count)}`).join('; ')
    : 'No role data available';
  const selectedRole = roles.find((role) => role.key === activeRole);
  useEffect(() => {
    setRevealed(false);
    const frameId = window.requestAnimationFrame(() => setRevealed(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [signature]);

  let offset = 0;
  const segments = chartRoles.map((role) => {
    const length = (role.count / chartTotal) * circumference;
    const segment = { ...role, length, offset };
    offset += length;
    return segment;
  });

  return (
    <div className="admin-pie-layout">
      <div className="admin-pie-wrap">
        <svg
          className="admin-role-pie"
          viewBox="0 0 100 100"
          role="group"
          aria-label={`System user distribution. ${summary}.`}
        >
          <title>{`System user distribution: ${summary}`}</title>
          {empty ? (
            <>
              <circle className="admin-pie-empty-ring" cx="50" cy="50" r="38" />
            </>
          ) : (
            <>
              <circle className="admin-pie-track" cx="50" cy="50" r="38" />
              {segments.map((role, index) => {
                const percentage = totalUsers > 0 ? Math.round((role.count / totalUsers) * 100) : 0;
                const highlighted = activeRole === role.key;
                const official = role.variant === 'official';
                return (
                  <circle
                    key={role.role}
                    className={`admin-pie-slice${activeRole && !highlighted ? ' is-dimmed' : ''}${official ? ' is-official' : ''}`}
                    cx="50"
                    cy="50"
                    r="38"
                    transform="rotate(-90 50 50)"
                    stroke={role.color}
                    style={{
                      ...getRoleStyle(role.role),
                      strokeDasharray: revealed
                        ? `${role.length} ${circumference - role.length}`
                        : `0 ${circumference}`,
                      strokeDashoffset: -role.offset,
                      transitionDelay: `${index * 70}ms`,
                    }}
                    tabIndex="0"
                    role="button"
                    aria-label={`${role.label}: ${formatNumber(role.count)} users (${percentage}%)`}
                    title={`${role.label}: ${formatNumber(role.count)} (${percentage}%)`}
                    onMouseEnter={() => onActiveRoleChange(role.key)}
                    onMouseLeave={() => onActiveRoleChange(null)}
                    onFocus={() => onActiveRoleChange(role.key)}
                    onBlur={() => onActiveRoleChange(null)}
                    onClick={() => onActiveRoleChange(activeRole === role.key ? null : role.key)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onActiveRoleChange(activeRole === role.key ? null : role.key);
                      }
                    }}
                  />
                );
              })}
            </>
          )}
        </svg>
        <span className="admin-pie-center" aria-hidden="true">
          <strong>{formatNumber(totalUsers)}</strong>
          <small>{empty ? (totalUsers === 0 ? 'No users yet' : 'No role data') : 'total'}</small>
        </span>
        {selectedRole && (
          <div className="admin-pie-tooltip" role="status" aria-live="polite">
            <span className="admin-pie-tooltip-dot" style={getRoleStyle(selectedRole.role)} />
            <strong>{selectedRole.label}</strong>
            <span>{formatNumber(selectedRole.count)}</span>
            <small>{totalUsers > 0 ? Math.round((selectedRole.count / totalUsers) * 100) : 0}% of users</small>
          </div>
        )}
      </div>
      <p className="admin-sr-only">{summary}</p>
    </div>
  );
}

function RoleLegend({ roles, totalUsers, activeRole, onActiveRoleChange }) {
  if (!roles.length) return <p className="admin-role-legend-empty">No role breakdown is available.</p>;

  return (
    <ul className="admin-role-legend" aria-label="Users by role">
      {roles.map((role) => {
        const percentage = totalUsers > 0 ? Math.round((role.count / totalUsers) * 100) : 0;
        const highlighted = activeRole === role.key;
        return (
          <li key={role.role}>
            <Link
              to={`/users?role=${encodeURIComponent(role.role)}`}
              className={`admin-role-legend-row${highlighted ? ' is-highlighted' : ''}${activeRole && !highlighted ? ' is-dimmed' : ''}`}
              style={getRoleStyle(role.role)}
              aria-label={`${role.label}: ${formatNumber(role.count)} users, ${percentage}% of users. View users with this role.`}
              title={`${role.label}: ${formatNumber(role.count)} users (${percentage}%)`}
              onMouseEnter={() => onActiveRoleChange(role.key)}
              onMouseLeave={() => onActiveRoleChange(null)}
              onFocus={() => onActiveRoleChange(role.key)}
              onBlur={() => onActiveRoleChange(null)}
            >
              <i className="admin-role-dot" aria-hidden="true" />
              <span className="admin-role-name">{role.label}</span>
              <strong>{formatNumber(role.count)}</strong>
              <small>{percentage}%</small>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UserDistributionCard({ usersByRole, totalUsers }) {
  const [activeRole, setActiveRole] = useState(null);
  const roles = useMemo(() => Object.entries(usersByRole).map(([role, value]) => {
    const presentation = getRolePresentation(role);
    const count = Number(value);
    return {
      role,
      key: presentation.key,
      label: presentation.label,
      variant: presentation.variant,
      color: presentation.color,
      count: Number.isFinite(count) ? count : 0,
    };
  }), [usersByRole]);
  const roleTotal = roles.reduce((total, role) => total + role.count, 0);

  return (
    <DashboardPanel
      eyebrow="ACCESS MIX"
      title="System user distribution"
      description="Accounts by assigned system role."
      className="admin-distribution-panel"
      action={<span className="admin-total-badge">{formatNumber(totalUsers)} total</span>}
    >
      <RolePieChart roles={roles} totalUsers={totalUsers} activeRole={activeRole} onActiveRoleChange={setActiveRole} />
      <RoleLegend roles={roles} totalUsers={totalUsers} activeRole={activeRole} onActiveRoleChange={setActiveRole} />
      {roleTotal > 0 && <span className="admin-sr-only">{roles.map((role) => `${role.label}: ${formatNumber(role.count)}`).join('; ')}</span>}
    </DashboardPanel>
  );
}

function ActionRow({ to, title, description, Icon }) {
  return (
    <Link to={to} className="admin-quick-action">
      <span className="admin-quick-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
      <span className="admin-quick-copy"><strong>{title}</strong><small>{description}</small></span>
      <ChevronRight size={18} className="admin-quick-chevron" aria-hidden="true" />
    </Link>
  );
}

function QuickActionsCard({ loading }) {
  return (
    <DashboardPanel
      eyebrow="OPERATIONS"
      title="Quick actions"
      description="Common administration tasks."
      className="admin-actions-panel"
    >
      {loading ? <ActionSkeleton /> : (
        <nav className="admin-quick-actions" aria-label="Administration quick actions">
          <ActionRow to="/users" title="User management" description="Manage accounts and roles" Icon={Users} />
          <ActionRow to="/audit-logs" title="Audit logs" description="Review system activity" Icon={ScrollText} />
          <ActionRow to="/admin-settings" title="Account settings" description="Update administrator profile" Icon={Settings} />
        </nav>
      )}
    </DashboardPanel>
  );
}

function getActivityPresentation(action, event) {
  const key = String(action || '').toUpperCase();
  const Icon = eventIcons[key] || Activity;
  const dangerActions = ['LOGIN_FAILED', 'ACCOUNT_LOCKED', 'DELETE', 'USER_DEACTIVATED', 'PASSWORD_RESET'];
  const positiveActions = ['LOGIN', 'USER_CREATED', 'CREATE', 'USER_REACTIVATED'];
  const tealActions = ['UPDATE', 'USER_UPDATED', 'ACCOUNT_SETTINGS_UPDATED', 'ROLE_CHANGED'];
  const tone = dangerActions.includes(key) || event.severity === 'critical' || event.severity === 'warning'
    ? 'danger'
    : positiveActions.includes(key) ? 'success'
      : tealActions.includes(key) ? 'teal'
        : 'neutral';
  return { Icon, tone };
}

function ActivityRow({ activity }) {
  const event = getEventConfig(activity.action);
  const { Icon, tone } = getActivityPresentation(activity.action, event);
  const fullDate = formatDateTimeInTimeZone(activity.created_at, 'Asia/Manila') || 'Time unavailable';
  const relative = formatRelativeTime(activity.created_at);
  const actor = activity.actor_username
    ? `@${activity.actor_username}`
    : activity.actor_name || (activity.actor_id ? 'Account' : 'Unknown actor');
  const target = activity.target_label || activity.target_user_name || '';
  const activityText = activity.description || event.label;
  const fullTitle = [activityText, actor, target && target !== actor ? target : ''].filter(Boolean).join(' · ');

  return (
    <li className="admin-activity-item">
      <span className={`admin-activity-icon tone-${tone}`} aria-hidden="true"><Icon size={17} strokeWidth={1.8} /></span>
      <div className="admin-activity-copy">
        <strong className="admin-activity-description" title={fullTitle}>{activityText}</strong>
        <p title={[actor, activity.actor_role && getRolePresentation(activity.actor_role).label, target].filter(Boolean).join(' · ')}>
          <span>{actor}</span>
          {activity.actor_role && <RoleChip role={activity.actor_role} className="admin-activity-role" />}
          {target && target !== actor && <span className="admin-activity-target">{target}</span>}
        </p>
      </div>
      <div className="admin-activity-meta">
        <span className={`admin-activity-status tone-${tone}`}>{event.label}</span>
        <time dateTime={activity.created_at || undefined} title={`${fullDate}${relative ? ` · ${relative}` : ''}`}>
          {relative || fullDate}
        </time>
      </div>
    </li>
  );
}

function EmptyState({ Icon, title, description }) {
  return (
    <div className="admin-empty-state">
      <span className="admin-empty-icon" aria-hidden="true"><Icon size={21} strokeWidth={1.8} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function RecentSystemActivity() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestInFlight = useRef(false);

  const fetchActivities = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const response = await listAuditLogs({ page: 1, pageSize: RECENT_ITEMS_LIMIT, sort: 'newest', preview: 1 });
      if (response?.success !== true || !Array.isArray(response.data)) {
        throw new Error('The recent activity response was incomplete.');
      }
      setActivities(response.data.slice(0, RECENT_ITEMS_LIMIT));
      setError(null);
    } catch (activityError) {
      console.error('Unable to load recent system activity.', activityError);
      setError(activityError);
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivities();
    const timer = window.setInterval(fetchActivities, REFRESH_INTERVAL);
    return () => window.clearInterval(timer);
  }, [fetchActivities]);

  return (
    <DashboardPanel
      eyebrow="SYSTEM ACTIVITY"
      title="Recent system activity"
      description="Latest activities recorded across HealthSync."
      className="admin-activity-panel"
      action={<Link className="admin-view-all" to="/audit-logs">View all <ArrowRight size={15} aria-hidden="true" /></Link>}
    >
      {loading && !activities.length ? (
        <ListSkeleton />
      ) : error && !activities.length ? (
        <DashboardIssue title="Recent activity is unavailable" error={error} onRetry={fetchActivities} />
      ) : activities.length ? (
        <ul className="admin-activity-list" aria-label="Latest system activity" aria-busy={loading}>
          {activities.map((activity) => <ActivityRow key={activity.audit_id} activity={activity} />)}
        </ul>
      ) : (
        <EmptyState Icon={Activity} title="No activity yet" description="System activity will appear here as it is recorded." />
      )}
      {error && activities.length > 0 && (
        <DashboardIssue title="Activity could not be refreshed" error={error} onRetry={fetchActivities} />
      )}
    </DashboardPanel>
  );
}

function initialsFor(user) {
  const name = String(user.full_name || user.username || '').trim();
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

function UserAvatar({ user }) {
  const [imageError, setImageError] = useState(false);
  const image = user.profile_photo && !imageError ? getProfilePhotoUrl(user.profile_photo) : '';
  return image ? (
    <img className="admin-user-avatar" src={image} alt="" onError={() => setImageError(true)} />
  ) : (
    <span className="admin-user-avatar" style={getRoleStyle(user.role)} aria-hidden="true">{initialsFor(user)}</span>
  );
}

function UserRow({ user }) {
  const fullDate = formatDateTimeInTimeZone(user.created_at, 'Asia/Manila');
  const relative = formatRelativeTime(user.created_at);
  return (
    <li className="admin-recent-user">
      <UserAvatar user={user} />
      <span className="admin-user-copy">
        <strong title={user.full_name || user.username || ''}>{user.full_name || user.username || 'Unnamed account'}</strong>
        {user.username && <small>@{user.username}</small>}
      </span>
      <RoleChip role={user.role} />
      <time dateTime={user.created_at || undefined} title={[fullDate, relative].filter(Boolean).join(' · ') || 'Date unavailable'}>
        {formatCreatedDate(user.created_at)}
      </time>
    </li>
  );
}

function RecentUsersCard({ users, loading, error, onRetry, retrying }) {
  return (
    <DashboardPanel
      eyebrow="ACCOUNTS"
      title="Recently created"
      description="Latest accounts registered in HealthSync."
      className="admin-recent-panel"
      action={<Link className="admin-view-all" to="/users">View all <ArrowRight size={15} aria-hidden="true" /></Link>}
    >
      {loading ? <ListSkeleton /> : error && !users.length ? (
        <DashboardIssue title="Recently created accounts are unavailable" error={error} onRetry={onRetry} retrying={retrying} />
      ) : users.length ? (
        <ul className="admin-recent-list" aria-label="Recently created accounts">
          {users.map((user) => <UserRow key={user.user_id} user={user} />)}
        </ul>
      ) : (
        <EmptyState Icon={Users} title="No accounts yet" description="Newly created accounts will appear here." />
      )}
    </DashboardPanel>
  );
}

function DashboardSkeleton() {
  return (
    <div className="admin-dashboard-skeleton" role="status" aria-label="Loading administrator dashboard">
      <div className="admin-metric-grid">
        {metricDefinitions.map((metric) => <MetricSkeleton key={metric.key} />)}
      </div>
      <div className="admin-dashboard-grid">
        <section className="admin-panel admin-distribution-panel" aria-label="Loading user distribution">
          <div className="admin-panel-header"><div><span className="admin-skeleton-block" /><span className="admin-skeleton-block" /></div></div>
          <PieSkeleton />
        </section>
        <section className="admin-panel admin-actions-panel" aria-label="Loading quick actions">
          <div className="admin-panel-header"><div><span className="admin-skeleton-block" /><span className="admin-skeleton-block" /></div></div>
          <ActionSkeleton />
        </section>
        <section className="admin-panel admin-activity-panel" aria-label="Loading recent activity">
          <div className="admin-panel-header"><div><span className="admin-skeleton-block" /><span className="admin-skeleton-block" /></div></div>
          <ListSkeleton />
        </section>
        <section className="admin-panel admin-recent-panel" aria-label="Loading recent accounts">
          <div className="admin-panel-header"><div><span className="admin-skeleton-block" /><span className="admin-skeleton-block" /></div></div>
          <ListSkeleton />
        </section>
      </div>
    </div>
  );
}

function AdminDashboardPage() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const requestInFlight = useRef(false);

  const fetchSummary = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);
    try {
      const response = await api.get('/dashboard/admin-summary');
      if (response.data?.success !== true || !response.data?.data) {
        throw new Error('The administrator summary response was incomplete.');
      }
      setSummary(response.data.data);
      setLastUpdated(new Date());
      setError(null);
    } catch (requestError) {
      console.error('Unable to load administrator overview.', requestError);
      setError(requestError);
    } finally {
      requestInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    const timer = window.setInterval(fetchSummary, REFRESH_INTERVAL);
    return () => window.clearInterval(timer);
  }, [fetchSummary]);

  const usersByRole = useMemo(() => {
    const value = summary?.usersByRole;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }, [summary?.usersByRole]);
  const totalUsers = Number(summary?.totalUsers || 0);
  const metricValues = {
    totalUsers,
    adminUsers: getRoleCount(usersByRole, 'admin'),
    bhwUsers: getRoleCount(usersByRole, 'bhw'),
    auditEvents: Number(summary?.auditEventsThisMonth || 0),
  };
  const recentUsers = Array.isArray(summary?.recentUsers)
    ? summary.recentUsers.slice(0, RECENT_ITEMS_LIMIT)
    : [];
  const dateLabel = new Date().toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const updatedLabel = formatUpdatedTime(lastUpdated);
  const live = Boolean(summary && !error);

  if (loading && !summary) {
    return (
      <main className="dashboard-page admin-dashboard-page">
        <div className="admin-refresh-progress" aria-hidden="true" />
        <PageBanner
          icon={ShieldCheck}
          title="Administrator Dashboard"
          subtitle={(
            <span className="admin-dashboard-subtitle">
              <span className="admin-dashboard-date"><CalendarDays size={14} aria-hidden="true" />{dateLabel}</span>
              <span>System access, account activity, and administration tools.</span>
            </span>
          )}
          className="page-banner-dashboard admin-dashboard-banner is-loading"
          actions={(
            <div className="admin-dashboard-banner-actions" aria-label="Dashboard controls">
              <LiveStatusChip live={false} />
              <span className="admin-updated-skeleton" aria-hidden="true" />
              <button type="button" className="admin-refresh-button" aria-label="Refresh" disabled>
                <RefreshCw size={17} className="admin-spin" aria-hidden="true" />
              </button>
              <Link to="/users" className="admin-manage-button"><Users size={16} aria-hidden="true" />Manage users</Link>
            </div>
          )}
        />
        <DashboardSkeleton />
      </main>
    );
  }

  return (
    <main className="dashboard-page admin-dashboard-page">
      {refreshing && <div className="admin-refresh-progress" aria-hidden="true" />}
      <PageBanner
        icon={ShieldCheck}
        title="Administrator Dashboard"
        subtitle={(
          <span className="admin-dashboard-subtitle">
            <span className="admin-dashboard-date"><CalendarDays size={14} aria-hidden="true" />{dateLabel}</span>
            <span>System access, account activity, and administration tools.</span>
          </span>
        )}
        className="page-banner-dashboard admin-dashboard-banner"
        actions={(
          <div className="admin-dashboard-banner-actions" aria-label="Dashboard controls">
            <LiveStatusChip live={live} />
            {updatedLabel
              ? <span className="admin-dashboard-updated"><Clock3 size={14} aria-hidden="true" />Updated {updatedLabel}</span>
              : <span className="admin-dashboard-updated is-pending"><Clock3 size={14} aria-hidden="true" />Updated —</span>}
            <button
              type="button"
              className="admin-refresh-button"
              onClick={fetchSummary}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh dashboard"
            >
              <RefreshCw size={17} className={refreshing ? 'admin-spin' : ''} aria-hidden="true" />
            </button>
            <Link to="/users" className="admin-manage-button"><Users size={16} aria-hidden="true" />Manage users</Link>
          </div>
        )}
      />

      {error && summary && (
        <div className="admin-refresh-warning" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Dashboard updates are paused. {getFriendlyError(error)}</span>
          <button type="button" onClick={fetchSummary} disabled={refreshing}>{refreshing ? 'Retrying…' : 'Retry'}</button>
        </div>
      )}

      <section className="admin-metric-grid" aria-label="System metrics">
        {summary ? metricDefinitions.map((metric, index) => (
          <MetricTile key={metric.key} metric={metric} value={metricValues[metric.key]} index={index} />
        )) : (
          <DashboardIssue
            title="System metrics are unavailable"
            error={error}
            onRetry={fetchSummary}
            retrying={refreshing}
            className="admin-metrics-error"
          />
        )}
      </section>

      <div className={`admin-dashboard-grid${summary ? '' : ' has-summary-error'}`}>
        {summary ? (
          <UserDistributionCard usersByRole={usersByRole} totalUsers={totalUsers} />
        ) : (
          <DashboardPanel
            eyebrow="ACCESS MIX"
            title="System user distribution"
            description="Accounts by assigned system role."
            className="admin-distribution-panel"
            action={<span className="admin-total-badge">— total</span>}
          >
            <DashboardIssue title="User distribution is unavailable" error={error} onRetry={fetchSummary} retrying={refreshing} />
          </DashboardPanel>
        )}
        <QuickActionsCard />
        <RecentSystemActivity />
        {summary ? (
          <RecentUsersCard users={recentUsers} />
        ) : (
          <DashboardPanel
            eyebrow="ACCOUNTS"
            title="Recently created"
            description="Latest accounts registered in HealthSync."
            className="admin-recent-panel"
            action={<Link className="admin-view-all" to="/users">View all <ArrowRight size={15} aria-hidden="true" /></Link>}
          >
            <DashboardIssue title="Recently created accounts are unavailable" error={error} onRetry={fetchSummary} retrying={refreshing} />
          </DashboardPanel>
        )}
      </div>
    </main>
  );
}

export default AdminDashboardPage;
