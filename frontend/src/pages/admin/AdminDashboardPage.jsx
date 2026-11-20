import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api/apiClient';
import { listAuditLogs } from '../../services/api/auditService';
import { getEventConfig } from '../audit/auditEventConfig';
import { formatDateTimeInTimeZone, formatRelativeTime } from '../../utils/dateUtils';
import StatusBanner from '../../components/common/StatusBanner';
import './AdminDashboard.css';

const REFRESH_INTERVAL = 30000;
const RECENT_ITEMS_LIMIT = 5;

const metricDefinitions = [
  { key: 'totalUsers', label: 'Total users', note: 'All registered accounts', icon: 'users', tone: 'blue' },
  { key: 'adminUsers', label: 'Administrators', note: 'System administrators', icon: 'shield', tone: 'violet' },
  { key: 'bhwUsers', label: 'Health workers', note: 'Barangay health workers', icon: 'health', tone: 'green' },
  { key: 'auditEventsThisMonth', label: 'Audit events', note: 'Recorded in the last 30 days', icon: 'activity', tone: 'teal' },
];

function AdminIcon({ name, size = 18 }) {
  const paths = {
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11zM9 12l2 2 4-4',
    health: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8zM3 12h4l2-3 3 6 2-3h7',
    activity: 'M3 12h4l3-8 4 16 3-8h4',
    audit: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.2l-.1.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.6-1l-.2.1-2.9-1.7.1-.2a1.7 1.7 0 0 0-.2-1.8L7.6 15v-3.4l.2-.1a1.7 1.7 0 0 0 1-1.6l-.1-.2 1.7-2.9.2.1a1.7 1.7 0 0 0 1.8-.2l.1-.1h3.4l.1.2a1.7 1.7 0 0 0 1.6 1l.2-.1 2.9 1.7-.1.2a1.7 1.7 0 0 0 .2 1.8l.1.1V15z',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    refresh: 'M20 7h-5V2M4 17h5v5M6 6a8 8 0 0 1 13.66-1L20 7M4 17l-.66 2A8 8 0 0 0 18 20',
  };

  return (
    <svg
      className="dashboard-svg-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name] || paths.activity} />
    </svg>
  );
}

function useCountUp(value) {
  const count = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || count === 0) {
      setDisplayValue(count);
      return undefined;
    }

    const startedAt = performance.now();
    const duration = 750;
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

  return displayValue.toLocaleString();
}

function MetricTile({ metric, value, index }) {
  const animatedValue = useCountUp(value);
  return (
    <article className={`admin-kpi dashboard-entrance dashboard-delay-${index} tone-${metric.tone}`}>
      <div className="admin-kpi-heading">
        <span className={`admin-kpi-icon tone-${metric.tone}`}><AdminIcon name={metric.icon} size={17} /></span>
        <span className="admin-kpi-label">{metric.label}</span>
      </div>
      <strong className="admin-kpi-value" aria-label={`${metric.label}: ${Number(value || 0).toLocaleString()}`}>
        {animatedValue}
      </strong>
      <span className="admin-kpi-note">{metric.note}</span>
    </article>
  );
}

function DashboardPanel({ eyebrow, title, description, className = '', action, children, index }) {
  return (
    <section className={`admin-panel dashboard-entrance dashboard-delay-${index} ${className}`}>
      <header className="admin-panel-header">
        <div>
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

function initialsFor(user) {
  const name = String(user.full_name || user.username || 'U').trim();
  return name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');
}

function formatCreatedDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatUpdatedTime(value) {
  if (!value) return '';
  return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function AdminDashboardSkeleton() {
  return (
    <div className="admin-dashboard-skeleton" role="status" aria-label="Loading administrator dashboard">
      <div className="admin-skeleton-kpis">
        {metricDefinitions.map((metric) => <span className="admin-skeleton" key={metric.key} />)}
      </div>
      <div className="admin-skeleton-grid">
        {[0, 1, 2, 3].map((item) => <span className="admin-skeleton" key={item} />)}
      </div>
      <span className="visually-hidden">Loading administrator overview…</span>
    </div>
  );
}

function getActivityTone(activity, event) {
  const action = String(activity.action || '').toUpperCase();
  if (['LOGIN_FAILED', 'ACCOUNT_LOCKED', 'DELETE', 'USER_DEACTIVATED', 'PASSWORD_RESET'].includes(action)) return 'danger';
  if (['LOGIN', 'LOGOUT'].includes(action)) return 'blue';
  if (['CREATE', 'USER_CREATED'].includes(action)) return 'green';
  if (['UPDATE', 'USER_UPDATED', 'ACCOUNT_SETTINGS_UPDATED'].includes(action)) return 'teal';
  if (['ROLE_CHANGED', 'AUDIT_EXPORTED', 'SESSIONS_REVOKED'].includes(action)) return 'violet';
  if (event.category === 'authentication') return 'blue';
  if (event.category === 'resident' || event.category === 'health_record' || event.category === 'nutrition') return 'teal';
  return 'violet';
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
      title="Recent System Activity"
      description="Latest activities recorded across HealthSync."
      className="admin-activity-panel"
      index={6}
      action={<Link className="admin-view-all" to="/audit-logs">View all <AdminIcon name="arrow" size={13} /></Link>}
    >
      {loading && !activities.length ? (
        <ul className="admin-activity-list" aria-label="Loading recent system activity" aria-busy="true">
          {Array.from({ length: RECENT_ITEMS_LIMIT }, (_, index) => (
            <li className="admin-activity-skeleton" key={index}><span /><div><i /><i /></div><b /></li>
          ))}
        </ul>
      ) : error && !activities.length ? (
        <StatusBanner error={error} retry={fetchActivities} compact />
      ) : activities.length ? (
        <ul className="admin-activity-list" aria-label="Latest system activity" aria-busy={loading}>
          {activities.map((activity) => {
            const event = getEventConfig(activity.action);
            const tone = getActivityTone(activity, event);
            const when = formatDateTimeInTimeZone(activity.created_at, 'Asia/Manila') || 'Time unavailable';
            const relative = formatRelativeTime(activity.created_at);
            const actor = activity.actor_username
              ? `@${activity.actor_username}`
              : activity.actor_name || (activity.actor_id ? 'Account' : 'Unknown actor');
            const target = activity.target_label || activity.target_user_name || '';
            return (
              <li className="admin-activity-item" key={activity.audit_id}>
                <span className={`admin-activity-icon tone-${tone}`} aria-hidden="true">{event.icon}</span>
                <div className="admin-activity-copy">
                  <div className="admin-activity-heading">
                    <strong title={activity.description || event.label}>{activity.description || event.label}</strong>
                    <span className={`admin-activity-type tone-${tone}`}>{event.label}</span>
                  </div>
                              <p title={target ? `${actor} · ${target}` : actor}>
                                <span>{actor}</span>{activity.actor_role && <span className="admin-activity-role"> · {activity.actor_role}</span>}
                                {target && target !== actor ? <><span aria-hidden="true"> · </span><span className="admin-activity-target">{target}</span></> : null}
                  </p>
                </div>
                <time className="admin-activity-time" dateTime={activity.created_at || undefined} title={`${relative ? `${relative} · ` : ''}${when} Asia/Manila`}>
                  {when}
                </time>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="admin-activity-empty">
          <span className="admin-activity-empty-icon"><AdminIcon name="activity" size={17} /></span>
          <span>No recent system activity.</span>
        </div>
      )}
      {error && activities.length > 0 && <StatusBanner error={error} retry={fetchActivities} compact />}
    </DashboardPanel>
  );
}

const AdminDashboardPage = () => {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const requestInFlight = useRef(false);

  const fetchSummary = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const response = await api.get('/dashboard/admin-summary');
      if (response.data?.success !== true || !response.data?.data) {
        throw new Error('The administrator summary response was incomplete.');
      }
      setSummary(response.data.data);
      setLastUpdated(new Date());
      setError('');
    } catch (requestError) {
      console.error('Unable to load administrator overview.', requestError);
      setError(requestError);
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    const timer = window.setInterval(fetchSummary, REFRESH_INTERVAL);
    return () => window.clearInterval(timer);
  }, [fetchSummary]);

  const usersByRole = summary?.usersByRole || {};
  const totalUsers = Number(summary?.totalUsers || 0);
  const adminUsers = Number(usersByRole.admin || 0);
  const bhwUsers = Number(usersByRole.bhw || 0);
  const officialUsers = Number(usersByRole.official || usersByRole.barangay_official || 0);
  const auditEvents = Number(summary?.auditEventsThisMonth || 0);
  const recentUsers = Array.isArray(summary?.recentUsers) ? summary.recentUsers.slice(0, RECENT_ITEMS_LIMIT) : [];

  const roleBreakdown = useMemo(() => {
    const knownRoles = [
      { label: 'Administrators', value: adminUsers, className: 'role-admin' },
      { label: 'BHW users', value: bhwUsers, className: 'role-bhw' },
      { label: 'Official users', value: officialUsers, className: 'role-official' },
    ];
    const otherUsers = Math.max(totalUsers - knownRoles.reduce((sum, item) => sum + item.value, 0), 0);
    if (otherUsers > 0) knownRoles.push({ label: 'Other roles', value: otherUsers, className: 'role-other' });
    return knownRoles.map((item) => ({
      ...item,
      percent: totalUsers > 0 ? (item.value / totalUsers) * 100 : 0,
    }));
  }, [adminUsers, bhwUsers, officialUsers, totalUsers]);

  const updatedLabel = formatUpdatedTime(lastUpdated);
  const metricValues = { totalUsers, adminUsers, bhwUsers, auditEventsThisMonth: auditEvents };

  return (
    <main className="dashboard-page admin-dashboard-page">
      <header className="dashboard-header admin-dashboard-header">
        <div className="dashboard-header-copy">
          <p className="dashboard-date">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <h1>Administrator dashboard</h1>
          <p className="dashboard-subtitle">System access, account activity, and administration tools.</p>
        </div>
        <div className="admin-dashboard-header-actions">
          <span className={`dashboard-sync-status ${error ? 'is-warning' : ''}`} role="status" aria-live="polite">
            <i aria-hidden="true" />
            {error ? 'Update unavailable' : 'Live updates'}
          </span>
          {updatedLabel && <span className="dashboard-updated">Updated {updatedLabel}</span>}
          <button type="button" className="dashboard-action admin-refresh-button" onClick={fetchSummary} disabled={loading} aria-label="Refresh administrator dashboard" title="Refresh dashboard">
            <AdminIcon name="refresh" size={16} />
          </button>
          <Link to="/users" className="dashboard-action dashboard-action-primary">
            <AdminIcon name="users" size={16} />
            Manage users
          </Link>
        </div>
      </header>

      {error && <StatusBanner error={error} retry={fetchSummary} />}

      {loading && !summary ? <AdminDashboardSkeleton /> : summary && (
        <>
          <section className="admin-kpi-grid" aria-label="System metrics">
            {metricDefinitions.map((metric, index) => (
              <MetricTile key={metric.key} metric={metric} value={metricValues[metric.key]} index={index} />
            ))}
          </section>

          <div className="admin-dashboard-grid">
            <DashboardPanel
              eyebrow="ACCESS MIX"
              title="System user distribution"
              description="Accounts by assigned system role."
              className="admin-distribution-panel"
              index={4}
              action={<span className="admin-total-badge">{totalUsers.toLocaleString()} total</span>}
            >
              <div
                className="admin-role-bar"
                role="img"
                aria-label={roleBreakdown.map((item) => `${item.label}: ${item.value} (${Math.round(item.percent)}%)`).join(', ') || 'No user accounts'}
              >
                {roleBreakdown.map((item) => item.value > 0 && (
                  <span
                    key={item.className}
                    className={`admin-role-segment ${item.className}`}
                    style={{ width: `${item.percent}%` }}
                    title={`${item.label}: ${item.value} (${Math.round(item.percent)}%)`}
                  />
                ))}
              </div>
              <ul className="admin-role-legend">
                {roleBreakdown.map((item) => (
                  <li key={item.className}>
                    <span className={`admin-role-dot ${item.className}`} aria-hidden="true" />
                    <span className="admin-role-name">{item.label}</span>
                    <strong>{item.value.toLocaleString()}</strong>
                    <span className="admin-role-percent">{Math.round(item.percent)}%</span>
                  </li>
                ))}
                {!totalUsers && <li className="admin-no-accounts">No user accounts are available.</li>}
              </ul>
            </DashboardPanel>

            <DashboardPanel
              eyebrow="OPERATIONS"
              title="Quick actions"
              description="Common administration tasks."
              className="admin-actions-panel"
              index={5}
            >
              <nav className="admin-quick-actions" aria-label="Administration quick actions">
                <Link to="/users" className="admin-quick-action">
                  <span className="admin-quick-icon tone-blue"><AdminIcon name="users" size={17} /></span>
                  <span><strong>User management</strong><small>Manage accounts and roles</small></span>
                  <AdminIcon name="arrow" size={15} />
                </Link>
                <Link to="/audit-logs" className="admin-quick-action">
                  <span className="admin-quick-icon tone-violet"><AdminIcon name="audit" size={17} /></span>
                  <span><strong>Audit logs</strong><small>Review system activity</small></span>
                  <AdminIcon name="arrow" size={15} />
                </Link>
                <Link to="/admin-settings" className="admin-quick-action">
                  <span className="admin-quick-icon tone-teal"><AdminIcon name="settings" size={17} /></span>
                  <span><strong>Account settings</strong><small>Update administrator profile</small></span>
                  <AdminIcon name="arrow" size={15} />
                </Link>
              </nav>
            </DashboardPanel>

            <RecentSystemActivity />

            <DashboardPanel
              eyebrow="ACCOUNTS"
              title="Recently created"
              description="Latest accounts registered in HealthSync."
              className="admin-recent-panel"
              index={7}
              action={<Link className="admin-view-all" to="/users">View all <AdminIcon name="arrow" size={13} /></Link>}
            >
              {recentUsers.length ? (
                <ul className="admin-recent-list">
                  {recentUsers.map((user) => {
                    const role = String(user.role || 'user').replace(/[_-]+/g, ' ');
                    return (
                      <li key={user.user_id} className="admin-recent-user">
                        <span className="admin-user-avatar" aria-hidden="true">{initialsFor(user)}</span>
                        <span className="admin-user-copy">
                          <strong>{user.full_name || user.username || 'Unnamed account'}</strong>
                          <small>@{user.username || 'unknown'}</small>
                        </span>
                        <span className={`admin-role-badge role-badge-${role.replace(/\s+/g, '-')}`}>{role}</span>
                        <time dateTime={user.created_at || undefined}>{formatCreatedDate(user.created_at)}</time>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="admin-recent-empty">No recent accounts found.</div>
              )}
            </DashboardPanel>
          </div>
        </>
      )}
    </main>
  );
};

export default AdminDashboardPage;
