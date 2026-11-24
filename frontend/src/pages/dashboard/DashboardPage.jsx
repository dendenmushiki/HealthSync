import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../services/api/apiClient';
import { getResidents } from '../../services/api/residentService';
import idb from '../../services/offline/indexedDbService';
import syncManager from '../../services/offline/syncManager';
import useSyncStatus from '../../services/offline/useSyncStatus';
import { AuthContext } from '../../context/AuthContext';
import StatusBanner from '../../components/common/StatusBanner';
import PageBanner from '../../components/common/PageBanner';
import {
  Accessibility,
  Activity,
  ArrowRight,
  Baby,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ClipboardList,
  Clock3,
  FileText,
  HeartPulse,
  RefreshCw,
  TriangleAlert,
  Users,
} from 'lucide-react';

const rangeLabels = {
  this_month: 'This month',
  last_30_days: 'Last 30 days',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  custom: 'Custom range',
};

const RECENT_ACTIVITY_POLL_INTERVAL_MS = 15000;
const populationGroups = ['0-4', '5-19', '20-59', '60+'];
const nutritionTrendSeries = [
  { key: 'normal', label: 'Normal', color: 'nutrition-line-normal' },
  { key: 'underweight', label: 'Underweight', color: 'nutrition-line-underweight' },
  { key: 'overweight', label: 'Overweight / obese', color: 'nutrition-line-overweight' },
];
const nutritionStatusGroups = [
  { key: 'normal', label: 'Normal' },
  { key: 'underweight', label: 'Underweight' },
  { key: 'severely-underweight', label: 'Severely Underweight' },
  { key: 'overweight', label: 'Overweight' },
  { key: 'obese', label: 'Obese' },
  { key: 'other', label: 'Other' },
];

const toCount = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatCount = (value) => {
  const count = toCount(value);
  return count === null ? '—' : count.toLocaleString();
};

const formatPercent = (value) => {
  const percent = toCount(value);
  return percent === null ? '—' : `${percent.toLocaleString([], { maximumFractionDigits: 1 })}%`;
};

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Mayad-ayad nga Agahon';
  if (hour < 18) return 'Mayad-ayad nga Hapon';
  return 'Mayad-ayad nga Gabi-e';
};

const formatActivityDate = (value) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatResidentDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const isValidSummary = (data) => (
  data
  && typeof data === 'object'
  && data.kpis
  && typeof data.kpis === 'object'
  && data.population
  && typeof data.population === 'object'
  && Array.isArray(data.recordsTrend)
);

function DashboardIcon({ name, size = 18 }) {
  const icons = {
    users: Users,
    senior: Accessibility,
    child: Baby,
    records: FileText,
    nutrition: HeartPulse,
    refresh: RefreshCw,
    clinical: ClipboardList,
    activity: Activity,
    chart: BarChart3,
    alert: TriangleAlert,
    bell: Bell,
    clock: Clock3,
    arrow: ArrowRight,
    check: Check,
  };
  const Icon = icons[name] || Activity;
  return <Icon className="dashboard-svg-icon" size={size} strokeWidth={1.8} aria-hidden="true" />;
}

function useCountUp(value) {
  const count = toCount(value);
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (count === null) return undefined;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || count === 0) {
      setDisplayValue(count);
      return undefined;
    }

    const startedAt = performance.now();
    const duration = 900;
    let frameId;
    let active = true;

    const tick = (now) => {
      if (!active) return;
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - ((1 - progress) ** 3);
      setDisplayValue(Math.round(count * eased));
      if (progress < 1) frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
    };
  }, [count]);

  return count === null ? '—' : displayValue.toLocaleString();
}

function KpiCard({ label, value, context, icon, tone, to, index }) {
  const animatedValue = useCountUp(value);
  const content = (
    <>
      <span className={`dashboard-kpi-icon dashboard-tone-${tone}`} aria-hidden="true">
        <DashboardIcon name={icon} size={17} />
      </span>
      <span className="dashboard-kpi-label">{label}</span>
      <strong className="dashboard-kpi-value" aria-label={`${label}: ${formatCount(value)}`}>
        {animatedValue}
      </strong>
      <span className="dashboard-kpi-context">{context}</span>
    </>
  );
  const className = `dashboard-kpi dashboard-entrance dashboard-delay-${index}`;

  return to
    ? <Link className={className} to={to}>{content}</Link>
    : <article className={className}>{content}</article>;
}

function EmptyChart({ children = 'No data available for this view.' }) {
  return <div className="dashboard-empty-chart">{children}</div>;
}

function AgePopulationChart({ ageSex = [] }) {
  const data = populationGroups.map((group) => {
    let total = 0;
    (Array.isArray(ageSex) ? ageSex : []).forEach((row) => {
      if (row.ageGroup !== group) return;
      total += toCount(row.count) || 0;
    });
    return { group, total };
  }).filter((row) => row.total > 0);
  const maximum = Math.max(...data.map((row) => row.total), 0);

  if (!data.length) return <EmptyChart>No resident age data is available yet.</EmptyChart>;

  return (
    <div className="dashboard-age-chart" role="list" aria-label="Residents by age group">
      {data.map((row, index) => (
        <div className="dashboard-age-row" key={row.group} role="listitem">
          <span className="dashboard-age-label">{row.group} years</span>
          <div className="dashboard-age-track" aria-hidden="true">
            <span
              className="dashboard-age-bar"
              style={{ width: `${(row.total / maximum) * 100}%`, animationDelay: `${index * 80}ms` }}
            />
          </div>
          <strong>{formatCount(row.total)}</strong>
        </div>
      ))}
      <p className="dashboard-chart-footnote">Completed age; residents without a birthdate are not charted.</p>
    </div>
  );
}

function monthLabel(value) {
  if (!value) return '';
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString([], { month: 'short', ...(month === 1 ? { year: '2-digit' } : {}) });
}

function NutritionTrendChart({ data = [] }) {
  const rows = Array.isArray(data) ? data : [];
  if (!rows.some((row) => (toCount(row.assessed) || 0) > 0)) {
    return <EmptyChart>No Operation Timbang nutrition assessments are available for the past 12 months.</EmptyChart>;
  }

  const chart = { width: 640, height: 190, left: 40, right: 12, top: 16, bottom: 30 };
  const plotWidth = chart.width - chart.left - chart.right;
  const plotHeight = chart.height - chart.top - chart.bottom;
  const xFor = (index) => chart.left + (rows.length === 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const yFor = (value) => chart.top + plotHeight - ((toCount(value) || 0) / 100) * plotHeight;
  const segments = [];
  let segment = [];
  rows.forEach((row, index) => {
    if ((toCount(row.assessed) || 0) > 0) {
      segment.push({ row, index });
    } else if (segment.length) {
      segments.push(segment);
      segment = [];
    }
  });
  if (segment.length) segments.push(segment);

  return (
    <div className="dashboard-nutrition-trend">
      <div className="dashboard-nutrition-trend-legend" aria-label="Weight-for-age classifications">
        {nutritionTrendSeries.map((series) => (
          <span key={series.key}><i className={series.color} />{series.label}</span>
        ))}
      </div>
      <div className="dashboard-trend-canvas">
        <svg
          viewBox="0 0 640 190"
          role="img"
          aria-label={`Monthly child weight-for-age classifications: ${rows.filter((row) => (toCount(row.assessed) || 0) > 0).map((row) => `${row.month}, ${nutritionTrendSeries.map((series) => `${series.label} ${formatPercent(row[series.key])}`).join(', ')}`).join('; ')}`}
        >
          {[100, 75, 50, 25, 0].map((value) => {
            const y = yFor(value);
            return (
              <g key={value}>
                <line x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} className="dashboard-chart-gridline" />
                <text x={chart.left - 7} y={y + 3} textAnchor="end" className="dashboard-chart-axis-label">{value}%</text>
              </g>
            );
          })}
          {nutritionTrendSeries.map((series) => (
            <g key={series.key}>
              {segments.filter((points) => points.length > 1).map((points) => (
                <polyline
                  key={`${series.key}-${points[0].row.month}`}
                  points={points.map(({ row, index }) => `${xFor(index)},${yFor(row[series.key])}`).join(' ')}
                  className={`dashboard-nutrition-trend-line ${series.color}`}
                />
              ))}
              {segments.flat().map(({ row, index }) => (
                <circle
                  key={`${series.key}-${row.month}`}
                  cx={xFor(index)}
                  cy={yFor(row[series.key])}
                  r="3"
                  className={`dashboard-nutrition-trend-point ${series.color}`}
                >
                  <title>{`${monthLabel(row.month)} · ${series.label}: ${formatPercent(row[series.key])} of ${formatCount(row.assessed)} assessments`}</title>
                </circle>
              ))}
            </g>
          ))}
          {rows.map((row, index) => (
            <text key={row.month} x={xFor(index)} y="181" textAnchor="middle" className="dashboard-chart-axis-label">
              {monthLabel(row.month)}
            </text>
          ))}
        </svg>
      </div>
      <p className="dashboard-chart-footnote">Share of recorded weight-for-age assessments each month.</p>
    </div>
  );
}

function OperationTimbangMonthlyChart({ data = [], timbang = {} }) {
  const rows = Array.isArray(data) ? data : [];
  const maximum = Math.max(...rows.map((row) => toCount(row.count) || 0), 0);
  const coverageSummary = `${formatCount(timbang.weighed)} of ${formatCount(timbang.eligible)} eligible children measured this year · ${formatPercent(timbang.coveragePercent)} coverage`;
  if (!rows.length) return <EmptyChart>No Operation Timbang records are available for the past 12 months.</EmptyChart>;
  if (!maximum) {
    return (
      <div className="dashboard-timbang-monthly">
        <EmptyChart>No Operation Timbang records are available for the past 12 months.</EmptyChart>
        <p className="dashboard-chart-footnote">{coverageSummary}</p>
      </div>
    );
  }

  const chart = { width: 640, height: 190, left: 40, right: 12, top: 18, bottom: 30 };
  const plotWidth = chart.width - chart.left - chart.right;
  const plotHeight = chart.height - chart.top - chart.bottom;
  const tickStep = Math.max(1, Math.ceil(maximum / 4));
  const scaleMax = Math.ceil(maximum / tickStep) * tickStep;
  const slotWidth = plotWidth / rows.length;
  const barWidth = Math.min(28, slotWidth * 0.62);
  const yFor = (value) => chart.top + plotHeight - ((toCount(value) || 0) / scaleMax) * plotHeight;

  return (
    <div className="dashboard-timbang-monthly">
      <div className="dashboard-trend-canvas">
        <svg
          viewBox="0 0 640 190"
          role="img"
          aria-label={`Monthly Operation Timbang records: ${rows.map((row) => `${row.month}: ${formatCount(row.count)}`).join(', ')}`}
        >
          {Array.from({ length: 5 }, (_, index) => {
            const value = scaleMax - (tickStep * index);
            const y = yFor(value);
            return (
              <g key={value}>
                <line x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} className="dashboard-chart-gridline" />
                <text x={chart.left - 7} y={y + 3} textAnchor="end" className="dashboard-chart-axis-label">{formatCount(value)}</text>
              </g>
            );
          })}
          {rows.map((row, index) => {
            const count = toCount(row.count) || 0;
            const x = chart.left + (index * slotWidth) + ((slotWidth - barWidth) / 2);
            const y = yFor(count);
            return (
              <g key={row.month}>
                {count > 0 && (
                  <>
                    <rect x={x} y={y} width={barWidth} height={chart.top + plotHeight - y} rx="3" className="dashboard-timbang-bar" />
                    <text x={x + (barWidth / 2)} y={y - 5} textAnchor="middle" className="dashboard-timbang-value">{formatCount(count)}</text>
                  </>
                )}
                <text x={chart.left + (index * slotWidth) + (slotWidth / 2)} y="181" textAnchor="middle" className="dashboard-chart-axis-label">
                  {monthLabel(row.month)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="dashboard-chart-footnote">{coverageSummary}</p>
    </div>
  );
}

function nutritionStatusKey(category) {
  const value = String(category || '').trim().toLowerCase();
  if (value.includes('normal')) return 'normal';
  if (value.includes('obese')) return 'obese';
  if (value.includes('overweight')) return 'overweight';
  if (value.includes('severe') && (value.includes('underweight') || value.includes('thinness') || value.includes('wast'))) {
    return 'severely-underweight';
  }
  if (value.includes('underweight') || value.includes('thinness') || value.includes('wast')) return 'underweight';
  return 'other';
}

function NutritionDonut({ nutrition }) {
  const counts = Object.fromEntries(nutritionStatusGroups.map(({ key }) => [key, 0]));
  ['child', 'adolescent', 'adult'].forEach((group) => {
    (Array.isArray(nutrition?.[group]) ? nutrition[group] : []).forEach((row) => {
      const count = toCount(row.count);
      if (count === null || count <= 0) return;
      counts[nutritionStatusKey(row.category)] += count;
    });
  });
  const data = nutritionStatusGroups
    .map((group) => ({ ...group, count: counts[group.key] }))
    .filter((group) => group.count > 0);
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const circumference = 2 * Math.PI * 38;
  const signature = data.map((item) => `${item.key}:${item.count}`).join('|');
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
    const frameId = window.requestAnimationFrame(() => setRevealed(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [signature]);

  if (!total) return <EmptyChart>No nutritional status assessments are available.</EmptyChart>;

  let offset = 0;
  const segments = data.map((item) => {
    const length = (item.count / total) * circumference;
    const segment = { ...item, length, offset };
    offset += length;
    return segment;
  });

  return (
    <div className="dashboard-nutrition-visual">
      <div className="dashboard-donut" role="img" aria-label={`${formatCount(total)} total nutritional assessments`}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="dashboard-donut-track" cx="50" cy="50" r="38" />
          {segments.map((item, index) => (
            <circle
              key={item.key}
              className={`dashboard-donut-segment nutrition-status-${item.key}`}
              cx="50"
              cy="50"
              r="38"
              transform="rotate(-90 50 50)"
              style={{
                strokeDasharray: revealed ? `${item.length} ${circumference - item.length}` : `0 ${circumference}`,
                strokeDashoffset: -item.offset,
                transitionDelay: `${index * 70}ms`,
              }}
            >
              <title>{`${item.label}: ${formatCount(item.count)}`}</title>
            </circle>
          ))}
        </svg>
        <span><strong>{formatCount(total)}</strong><small>total</small></span>
      </div>
      <ul className="dashboard-nutrition-legend">
        {segments.filter((item) => item.key !== 'other').map((item) => (
          <li key={item.key}>
            <i className={`nutrition-status-${item.key}`} />
            <span title={item.label}>{item.label}</span>
            <strong title={`${formatCount(item.count)} assessments`}>{formatPercent((item.count / total) * 100)}</strong>
          </li>
        ))}
        {segments.some((item) => item.key === 'other') && (
          <li className="dashboard-nutrition-legend-other">
            <i className="nutrition-status-other" />
            <span>Other classifications</span>
            <strong>{formatPercent((counts.other / total) * 100)}</strong>
          </li>
        )}
      </ul>
    </div>
  );
}

function NutritionChart({ nutrition = {} }) {
  return (
    <div className="dashboard-nutrition-chart">
      <NutritionDonut nutrition={nutrition && typeof nutrition === 'object' ? nutrition : {}} />
    </div>
  );
}

function AttentionList({ items = [], isBhw }) {
  const visible = (Array.isArray(items) ? items : []).slice(0, 3);
  if (!visible.length) {
    return (
      <div className="dashboard-priority-empty">
        <span><DashboardIcon name="check" size={16} /></span>
        <p>No priority items are currently recorded.</p>
      </div>
    );
  }

  return (
    <ul className="dashboard-priority-list">
      {visible.map((item, index) => {
        const content = (
          <>
            <span className={`dashboard-priority-count priority-${item.severity || 'medium'}`}>{formatCount(item.count)}</span>
            <span className="dashboard-priority-copy">
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
            {isBhw && <DashboardIcon name="arrow" size={15} />}
          </>
        );
        return (
          <li key={`${item.title}-${index}`}>
            {isBhw && item.filter
              ? <Link to={item.filter}>{content}</Link>
              : <div className="dashboard-priority-item">{content}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function RecentActivity({ items = [], isBhw }) {
  const visible = (Array.isArray(items) ? items : []).slice(0, 4);
  if (!visible.length) {
    return <EmptyChart>No recent health records are available.</EmptyChart>;
  }

  return (
    <ul className="dashboard-activity-list">
      {visible.map((item) => {
        const icon = ['child', 'child_health'].includes(item.type)
          ? 'child'
          : ['clinical', 'clinical_form'].includes(item.type)
            ? 'clinical'
            : ['maternal', 'operation_timbang', 'adolescent_bmi', 'adult_bmi'].includes(item.type)
              ? 'nutrition'
              : 'records';
        const activity = (
          <>
            <span className={`dashboard-activity-icon activity-${item.type || 'other'}`} aria-hidden="true">
              <DashboardIcon name={icon} size={16} />
            </span>
            <span className="dashboard-activity-copy">
              <strong>{item.label || 'Health record'}</strong>
              <small>{item.residentName || item.recordedBy || 'Unknown resident'}</small>
            </span>
            <time dateTime={item.createdAt || undefined}>{formatActivityDate(item.createdAt || item.date)}</time>
          </>
        );
        return (
          <li key={item.id}>
            {isBhw && item.residentId
              ? <Link to={`/residents/${item.residentId}/medical-records`}>{activity}</Link>
              : <div className="dashboard-activity-row">{activity}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function RecentResidentsTable({ items = [], isBhw }) {
  const residents = (Array.isArray(items) ? items : []).slice(0, 5);
  if (!residents.length) return <EmptyChart>No resident registrations are available.</EmptyChart>;

  return (
    <div className="dashboard-registration-table-wrap">
      <table className="dashboard-registration-table">
        <thead>
          <tr><th scope="col">Name</th><th scope="col">Age</th><th scope="col">Gender</th><th scope="col">Date registered</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>
          {residents.map((resident) => {
            const name = resident.name || 'Unnamed resident';
            const nameCell = isBhw
              ? <Link to={`/residents/${resident.id}`} title={name}>{name}</Link>
              : <span title={name}>{name}</span>;
            return (
              <tr key={resident.id}>
                <th scope="row">{nameCell}</th>
                <td>{resident.age === null || resident.age === undefined ? '—' : formatCount(resident.age)}</td>
                <td>{String(resident.sex || '').toLowerCase() === 'male' ? 'M' : String(resident.sex || '').toLowerCase() === 'female' ? 'F' : '—'}</td>
                <td>{formatResidentDate(resident.registeredOn)}</td>
                <td><span className={`dashboard-resident-status status-${String(resident.status || '').toLowerCase()}`}>{resident.status || 'Unknown'}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChartCard({ title, subtitle, icon = 'records', className = '', children, index = 0 }) {
  return (
    <article className={`dashboard-chart-card dashboard-entrance dashboard-delay-${index} ${className}`}>
      <header className="dashboard-card-heading">
        <div className="dashboard-card-title">
          <DashboardIcon name={icon} size={16} />
          <div className="dashboard-card-title-copy">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
      </header>
      {children}
    </article>
  );
}

function DashboardLoadingSkeleton() {
  return (
    <div className="dashboard-loading" role="status" aria-label="Loading community health dashboard">
      <div className="dashboard-skeleton-kpis">
        {[0, 1, 2, 3, 4].map((item) => <div className="dashboard-skeleton dashboard-skeleton-kpi" key={item} />)}
      </div>
      <div className="dashboard-skeleton-charts">
        {[0, 1, 2, 3, 4, 5, 6].map((item) => <div className="dashboard-skeleton dashboard-skeleton-card" key={item} />)}
      </div>
    </div>
  );
}

const DashboardPage = ({ onInitialLoad }) => {
  const { user } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const range = searchParams.get('range') || 'this_month';
  const customFrom = searchParams.get('from') || '';
  const customTo = searchParams.get('to') || '';
  const [stats, setStats] = useState(null);
  const [liveRecentActivity, setLiveRecentActivity] = useState(null);
  const [statsKey, setStatsKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [requestInFlight, setRequestInFlight] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [requestDurationMs, setRequestDurationMs] = useState(null);
  const [showUpdatedToast, setShowUpdatedToast] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const initialLoadReportedRef = useRef(false);
  const sharedSync = useSyncStatus();
  const refreshSync = sharedSync.refresh;
  const setDashboardRequestFailed = sharedSync.setDashboardRequestFailed;
  const isBhw = String(user?.role || '').toLowerCase().replace(/[-_\s]+/g, '_') === 'bhw';
  const queryKey = JSON.stringify([user?.user_id || 'current', range, customFrom, customTo]);
  const queryKeyRef = useRef(queryKey);
  const statsKeyRef = useRef('');
  const requestIdRef = useRef(0);
  const wasUnavailableRef = useRef(false);
  const toastTimerRef = useRef(null);
  const dashboardRequestFailedRef = useRef(sharedSync.dashboardRequestFailed);
  dashboardRequestFailedRef.current = sharedSync.dashboardRequestFailed;
  queryKeyRef.current = queryKey;
  const requestUnavailable = Boolean(requestError && !requestError.response && (
    requestError.isAxiosError
    || requestError.request
    || /timeout|timed out|network error|failed to fetch/i.test(String(requestError.message || ''))
  ));
  const offline = !sharedSync.online || !navigator.onLine || requestUnavailable;
  const connectionUnavailable = offline || sharedSync.dashboardRequestFailed || Boolean(requestError);
  const currentStats = statsKey === queryKey ? stats : null;

  useEffect(() => {
    if (loading || initialLoadReportedRef.current || !onInitialLoad) return;
    initialLoadReportedRef.current = true;
    onInitialLoad(currentStats ? null : requestError || new Error('The dashboard data is unavailable.'));
  }, [currentStats, loading, onInitialLoad, requestError]);

  const loadSync = useCallback(async () => {
    try {
      await refreshSync();
    } catch (syncError) {
      console.error('Unable to refresh dashboard synchronization status.', syncError);
    }
  }, [refreshSync]);

  const loadRecentResidents = useCallback(async () => {
    if (!isBhw) return null;
    try {
      const response = await getResidents({ page: 1, limit: 5, sort: 'newest', order: 'asc' });
      const rows = response?.data?.items;
      if (response?.success !== true || !Array.isArray(rows)) {
        throw new Error('The residents response did not contain a resident list.');
      }
      return rows.map((resident) => ({
        id: resident.resident_id,
        name: [resident.first_name, resident.middle_name, resident.last_name, resident.suffix].filter(Boolean).join(' '),
        age: resident.age === null || resident.age === undefined ? null : Number(resident.age),
        sex: resident.sex || null,
        status: resident.resident_status || 'Unknown',
        registeredOn: resident.created_at || null,
      }));
    } catch (residentError) {
      console.error('Unable to load recent resident registrations.', residentError);
      return null;
    }
  }, [isBhw]);

  const fetchDashboard = useCallback(async (background = false) => {
    const requestKey = queryKeyRef.current;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const cacheKey = `dashboard_summary_${encodeURIComponent(requestKey)}`;
    const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let requestElapsedMs;
    setRequestInFlight(true);
    if (!background) setLoading(true);

    try {
      const response = await api.get('/dashboard/summary', {
        params: { range, from: customFrom, to: customTo },
      });
      requestElapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - requestStartedAt;
      if (requestId !== requestIdRef.current || requestKey !== queryKeyRef.current) return;

      const data = response.data?.data;
      if (response.data?.success !== true || !isValidSummary(data)) {
        throw new Error('The dashboard response did not contain a valid community summary.');
      }

      let summaryData = data;
      if (isBhw) {
        const recentResidents = await loadRecentResidents();
        if (requestId !== requestIdRef.current || requestKey !== queryKeyRef.current) return;
        if (recentResidents !== null) summaryData = { ...data, recentResidents };
      }

      setStats(summaryData);
      setStatsKey(requestKey);
      statsKeyRef.current = requestKey;
      setRequestError(null);
      setActionError(null);
      setRetryCount(0);
      setDashboardRequestFailed(false);
      if (wasUnavailableRef.current || dashboardRequestFailedRef.current) {
        window.clearTimeout(toastTimerRef.current);
        setShowUpdatedToast(true);
        toastTimerRef.current = window.setTimeout(() => setShowUpdatedToast(false), 3500);
      }
      wasUnavailableRef.current = false;
      setLastUpdated(new Date());
      try {
        const cachedSummary = {
          ...summaryData,
          recentActivity: Array.isArray(summaryData.recentActivity)
            ? summaryData.recentActivity.map(({ id, residentId, residentName, type, label, summary, recordedBy, date, createdAt }) => ({
              id,
              residentId,
              residentName,
              type,
              label,
              summary,
              recordedBy,
              date,
              createdAt,
            }))
            : [],
        };
        await idb.putToStore('syncMetadata', {
          key: cacheKey,
          value: cachedSummary,
          savedAt: new Date().toISOString(),
        });
      } catch (cacheError) {
        console.error('Unable to save the dashboard summary for offline use.', cacheError);
      }
    } catch (fetchError) {
      requestElapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - requestStartedAt;
      if (requestId !== requestIdRef.current || requestKey !== queryKeyRef.current) return;
      console.error('Unable to load dashboard summary.', fetchError);
      setRequestError(fetchError);
      setDashboardRequestFailed(true);
      setRetryCount((current) => current + 1);
      wasUnavailableRef.current = true;
      try {
        const cached = await idb.getFromStore('syncMetadata', cacheKey);
        if (requestId !== requestIdRef.current || requestKey !== queryKeyRef.current) return;
        if (cached?.value && isValidSummary(cached.value)) {
          let cachedData = cached.value;
          if (isBhw) {
            const recentResidents = await loadRecentResidents();
            if (requestId !== requestIdRef.current || requestKey !== queryKeyRef.current) return;
            if (recentResidents !== null) cachedData = { ...cachedData, recentResidents };
          }
          setStats(cachedData);
          setStatsKey(requestKey);
          statsKeyRef.current = requestKey;
          setLastUpdated(cached.savedAt || null);
        } else if (statsKeyRef.current !== requestKey) {
          setStats(null);
          setStatsKey('');
          statsKeyRef.current = '';
        }
      } catch (cacheError) {
        console.error('Unable to read the saved dashboard summary.', cacheError);
        if (statsKeyRef.current !== requestKey) {
          setStats(null);
          setStatsKey('');
          statsKeyRef.current = '';
        }
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setRequestDurationMs(requestElapsedMs);
        setRequestInFlight(false);
        setLoading(false);
        loadSync();
      }
    }
  }, [customFrom, customTo, isBhw, loadRecentResidents, loadSync, range, setDashboardRequestFailed]);

  useEffect(() => {
    fetchDashboard();
    const onFocus = () => { if (navigator.onLine) fetchDashboard(true); };
    const onNetworkChange = () => {
      if (navigator.onLine) fetchDashboard(true);
      loadSync();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onNetworkChange);
    window.addEventListener('offline', onNetworkChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onNetworkChange);
      window.removeEventListener('offline', onNetworkChange);
    };
  }, [fetchDashboard, loadSync, queryKey]);

  useEffect(() => {
    if (sharedSync.dashboardRequestFailed && !navigator.onLine) return undefined;
    const delay = sharedSync.dashboardRequestFailed
      ? Math.min(30000 * (2 ** Math.max(0, retryCount - 1)), 300000)
      : 300000;
    const timer = window.setTimeout(() => fetchDashboard(true), delay);
    return () => window.clearTimeout(timer);
  }, [fetchDashboard, retryCount, sharedSync.dashboardRequestFailed]);

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    setLiveRecentActivity(null);

    const refreshRecentActivity = async () => {
      if (!active || requestInFlight || !navigator.onLine || document.visibilityState === 'hidden') return;
      requestInFlight = true;
      try {
        const response = await api.get('/dashboard/recent-activity');
        const activities = response.data?.data;
        if (response.data?.success !== true || !Array.isArray(activities)) {
          throw new Error('The recent activity response did not contain an activity list.');
        }
        if (active) setLiveRecentActivity(activities);
      } catch (activityError) {
        if (active) console.error('Unable to refresh recent dashboard activities.', activityError);
      } finally {
        requestInFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshRecentActivity();
    };
    const interval = window.setInterval(refreshRecentActivity, RECENT_ACTIVITY_POLL_INTERVAL_MS);
    window.addEventListener('focus', refreshRecentActivity);
    window.addEventListener('online', refreshRecentActivity);
    document.addEventListener('visibilitychange', onVisibilityChange);
    refreshRecentActivity();

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshRecentActivity);
      window.removeEventListener('online', refreshRecentActivity);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user?.user_id]);

  useEffect(() => {
    if (connectionUnavailable) wasUnavailableRef.current = true;
  }, [connectionUnavailable]);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  const updateRange = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set('range', value);
    if (value !== 'custom') {
      next.delete('from');
      next.delete('to');
    }
    setSearchParams(next);
  };

  const updateCustom = (key, value) => {
    const next = new URLSearchParams(searchParams);
    next.set('range', 'custom');
    next.set(key, value);
    setSearchParams(next);
  };

  const syncNow = async () => {
    try {
      await syncManager.runSync();
      await loadSync();
      await fetchDashboard(true);
    } catch (syncError) {
      console.error('Unable to synchronize dashboard changes.', syncError);
      setActionError(syncError);
    }
  };

  const kpis = currentStats?.kpis || {};
  const senior = kpis.seniorCitizens || {};
  const children = kpis.childrenUnder5 || {};
  const normalChildAssessments = Array.isArray(currentStats?.nutrition?.child)
    ? currentStats.nutrition.child
      .filter((item) => String(item.category || '').toLowerCase() === 'normal')
      .reduce((total, item) => total + (toCount(item.count) || 0), 0)
    : null;
  const firstName = user?.first_name
    || user?.firstName
    || user?.full_name?.split(' ')?.[0]
    || user?.name?.split(' ')?.[0]
    || 'Health Worker';
  return (
    <main className="dashboard-page">
      <PageBanner
        className="page-banner-dashboard"
        icon={HeartPulse}
        eyebrow={new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        title={`${greeting()}, ${firstName}`}
        subtitle={currentStats?.barangayName ? `Community health overview · Barangay ${currentStats.barangayName}` : 'Community health overview'}
        actions={(
          <div className="dashboard-banner-range">
            <label className="dashboard-range-control">
              <CalendarDays size={16} strokeWidth={1.8} aria-hidden="true" />
              <select value={range} onChange={(event) => updateRange(event.target.value)} aria-label="Reporting period">
                {Object.entries(rangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {range === 'custom' && (
              <div className="dashboard-custom-range">
                <label><span>From</span><input type="date" value={customFrom} onChange={(event) => updateCustom('from', event.target.value)} /></label>
                <label><span>To</span><input type="date" value={customTo} onChange={(event) => updateCustom('to', event.target.value)} /></label>
              </div>
            )}
          </div>
        )}
      />

      {connectionUnavailable && (
        <StatusBanner
          error={requestError || actionError}
          offline={offline}
          savedAt={lastUpdated}
          retry={() => { setActionError(null); fetchDashboard(true); }}
          retrying={requestInFlight}
          technicalDetails={requestDurationMs === null ? '' : `Dashboard request: ${Math.round(requestDurationMs)} ms`}
        />
      )}
      {!connectionUnavailable && actionError && (
        <StatusBanner error={actionError} retry={syncNow} compact />
      )}
      {showUpdatedToast && <div className="dashboard-toast" role="status" aria-live="polite">Dashboard updated</div>}

      {loading && !currentStats ? (
        <DashboardLoadingSkeleton />
      ) : currentStats ? (
        <>
          <section className="dashboard-kpi-grid" aria-label="Community key metrics">
            <KpiCard
              label="Registered residents"
              value={kpis.totalResidents}
              context={toCount(kpis.addedCurrentMonth) !== null ? `${formatCount(kpis.addedCurrentMonth)} added this month` : 'Current registered population'}
              icon="users"
              tone="blue"
              to={isBhw ? '/residents' : undefined}
              index={0}
            />
            <KpiCard
              label="Children monitored"
              value={children.weighedThisYear}
              context={toCount(children.eligibleThisYear) !== null
                ? `Of ${formatCount(children.eligibleThisYear)} age-eligible children weighed this year`
                : 'Distinct children weighed this year'}
              icon="child"
              tone="teal"
              to={isBhw ? '/nutrition' : undefined}
              index={1}
            />
            <KpiCard
              label="Normal child assessments"
              value={normalChildAssessments}
              context="Weight-for-length/height classifications"
              icon="nutrition"
              tone="green"
              to={isBhw ? '/nutrition' : undefined}
              index={2}
            />
            <KpiCard
              label="Nutrition risk cases"
              value={kpis.nutritionCases}
              context="Residents with a recorded nutrition risk"
              icon="nutrition"
              tone="amber"
              to={isBhw ? '/nutrition' : undefined}
              index={3}
            />
            <KpiCard
              label="Registered seniors"
              value={senior.value}
              context={toCount(senior.unregistered) !== null ? `${formatCount(senior.unregistered)} age-eligible not registered` : 'Senior registry'}
              icon="senior"
              tone="teal"
              to={isBhw ? '/senior-citizens' : undefined}
              index={4}
            />
          </section>

          <section className="dashboard-analytics-grid" aria-label="Community health analytics">
            <ChartCard
              title="Nutritional Status Distribution"
              subtitle="Recorded classifications"
              icon="nutrition"
              className="dashboard-nutrition-card"
              index={6}
            >
              <NutritionChart nutrition={currentStats.nutrition} />
            </ChartCard>

            <ChartCard
              title="Monthly Nutrition Trends"
              subtitle="Weight-for-age status · past 12 months"
              icon="activity"
              className="dashboard-trend-card"
              index={7}
            >
              <NutritionTrendChart data={currentStats.nutritionTrend} />
            </ChartCard>

            <ChartCard
              title="Operation Timbang Statistics"
              subtitle="Monthly child assessments"
              icon="chart"
              className="dashboard-timbang-card"
              index={8}
            >
              <OperationTimbangMonthlyChart data={currentStats.timbangMonthly} timbang={currentStats.timbang} />
            </ChartCard>

            <ChartCard
              title="Age Group Distribution"
              subtitle="Residents by recorded age"
              icon="users"
              className="dashboard-age-card"
              index={9}
            >
              <AgePopulationChart ageSex={currentStats.population?.ageSex} />
            </ChartCard>

            <ChartCard
              title="Recent Resident Registrations"
              subtitle="Newest resident records"
              icon="users"
              className="dashboard-registrations-card"
              index={10}
            >
              <RecentResidentsTable items={currentStats.recentResidents} isBhw={isBhw} />
            </ChartCard>

            <ChartCard
              title="Health Alerts and Notifications"
              subtitle={`${Array.isArray(currentStats.attention) ? currentStats.attention.length : 0} items need review`}
              icon="bell"
              className="dashboard-alerts-card"
              index={11}
            >
              <AttentionList items={currentStats.attention} isBhw={isBhw} />
            </ChartCard>

            <ChartCard
              title="Recent Activities"
              subtitle="Latest recorded health events"
              icon="clock"
              className="dashboard-activities-card"
              index={12}
            >
              <RecentActivity items={liveRecentActivity ?? currentStats.recentActivity} isBhw={isBhw} />
            </ChartCard>
          </section>
        </>
      ) : !loading && !requestError ? (
        <div className="dashboard-unavailable" role="status">
          <strong>Dashboard data is unavailable.</strong>
          <p>No statistics have been displayed because a valid summary was not returned.</p>
        </div>
      ) : null}
    </main>
  );
};

export default DashboardPage;
