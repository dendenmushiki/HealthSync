import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../services/api/apiClient';
import idb from '../../services/offline/indexedDbService';
import syncManager from '../../services/offline/syncManager';
import useSyncStatus from '../../services/offline/useSyncStatus';
import { AuthContext } from '../../context/AuthContext';

const rangeLabels = {
  this_month: 'This month',
  last_30_days: 'Last 30 days',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  custom: 'Custom range',
};

const recordSeries = [
  { key: 'clinical', label: 'Clinical', color: 'chart-clinical' },
  { key: 'child', label: 'Child growth', color: 'chart-child' },
  { key: 'maternal', label: 'Maternal', color: 'chart-maternal' },
  { key: 'immunization', label: 'Immunization', color: 'chart-immunization' },
];

const populationGroups = ['0-4', '5-19', '20-59', '60+'];
const nutritionTypes = [
  { key: 'child', label: 'Child growth', shortLabel: 'Child growth' },
  { key: 'adolescent', label: 'Adolescent BMI', shortLabel: 'Adolescent' },
  { key: 'adult', label: 'Adult BMI', shortLabel: 'Adult' },
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

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const formatTime = (value) => {
  if (!value) return 'Not updated yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not updated yet'
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatActivityDate = (value) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
  const paths = {
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    senior: 'M12 21v-9M8 12l4-9 4 9-4 3-4-3zM4 21h16',
    child: 'M12 3v18M3 12h18M8 7l-2-2M16 7l2-2',
    records: 'M7 3h10a2 2 0 0 1 2 2v16H5V5a2 2 0 0 1 2-2zM9 8h6M9 12h6M9 16h4',
    nutrition: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78zM3 12h4l2-3 3 6 2-3h7',
    refresh: 'M20 7h-5V2M4 17h5v5M6 6a8 8 0 0 1 13.66-1L20 7M4 17l-.66 2A8 8 0 0 0 18 20',
    clinical: 'M4 3h16v18H4zM8 8h8M8 12h8M8 16h5',
    activity: 'M3 12h4l2-5 4 10 2-5h6',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    check: 'M20 6L9 17l-5-5',
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
    >
      <path d={paths[name] || paths.activity} />
    </svg>
  );
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
      <span className="dashboard-kpi-topline">
        <span className={`dashboard-kpi-icon dashboard-tone-${tone}`} aria-hidden="true">
          <DashboardIcon name={icon} size={17} />
        </span>
        <span className="dashboard-kpi-label">{label}</span>
      </span>
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
    const counts = { male: 0, female: 0, unspecified: 0 };
    (Array.isArray(ageSex) ? ageSex : []).forEach((row) => {
      if (row.ageGroup !== group) return;
      const sex = String(row.sex || 'unspecified').toLowerCase();
      const key = sex === 'male' || sex === 'female' ? sex : 'unspecified';
      counts[key] += toCount(row.count) || 0;
    });
    return { group, ...counts, total: counts.male + counts.female + counts.unspecified };
  }).filter((row) => row.total > 0);
  const maximum = Math.max(...data.map((row) => row.total), 0);

  if (!data.length) return <EmptyChart>No resident age data is available yet.</EmptyChart>;

  return (
    <div className="dashboard-age-chart">
      <div className="dashboard-chart-legend">
        <span><i className="legend-male" />Male</span>
        <span><i className="legend-female" />Female</span>
        {data.some((row) => row.unspecified > 0) && <span><i className="legend-unspecified" />Unspecified</span>}
      </div>
      <div className="dashboard-age-rows" role="list" aria-label="Resident population by age group and sex">
        {data.map((row, index) => (
          <div className="dashboard-age-row" key={row.group} role="listitem">
            <span className="dashboard-age-label">{row.group} years</span>
            <div className="dashboard-age-track" aria-hidden="true">
              {['male', 'female', 'unspecified'].map((key) => (
                row[key] > 0 && (
                  <span
                    key={key}
                    className={`dashboard-age-segment age-${key}`}
                    style={{
                      width: `${(row[key] / maximum) * 100}%`,
                      animationDelay: `${index * 80}ms`,
                    }}
                  />
                )
              ))}
            </div>
            <strong>{formatCount(row.total)}</strong>
          </div>
        ))}
      </div>
      <p className="dashboard-chart-footnote">Completed age; residents without a birthdate are not charted.</p>
    </div>
  );
}

function AreaPopulationChart({ sitios = [], isBhw }) {
  const data = [...(Array.isArray(sitios) ? sitios : [])]
    .map((item) => ({ ...item, count: toCount(item.count) }))
    .filter((item) => item.count !== null && item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const maximum = Math.max(...data.map((item) => item.count), 0);

  if (!data.length) return <EmptyChart>No sitio population data is available yet.</EmptyChart>;

  return (
    <div className="dashboard-area-chart">
      {data.map((item, index) => {
        const label = item.isNoSitio ? 'No sitio recorded' : item.label;
        const content = (
          <>
            <span className="dashboard-area-name" title={label}>{label}</span>
            <span className="dashboard-area-track" aria-hidden="true">
              <span
                className="dashboard-area-bar"
                style={{
                  width: `${(item.count / maximum) * 100}%`,
                  animationDelay: `${index * 70}ms`,
                }}
              />
            </span>
            <strong>{formatCount(item.count)}</strong>
          </>
        );
        return isBhw
          ? <Link className="dashboard-area-row" key={label} to={item.isNoSitio ? '/residents?sitio=no-sitio' : `/residents?sitio=${encodeURIComponent(item.label)}`}>{content}</Link>
          : <div className="dashboard-area-row" key={label}>{content}</div>;
      })}
      <p className="dashboard-chart-footnote">Top {data.length} recorded areas.</p>
    </div>
  );
}

function PopulationChart({ population = {}, sitios = [], isBhw }) {
  const [view, setView] = useState('age');

  return (
    <div className="dashboard-population-chart">
      <div className="dashboard-chart-switch" role="group" aria-label="Population chart">
        <button type="button" className={view === 'age' ? 'is-selected' : ''} aria-pressed={view === 'age'} onClick={() => setView('age')}>Age &amp; sex</button>
        <button type="button" className={view === 'area' ? 'is-selected' : ''} aria-pressed={view === 'area'} onClick={() => setView('area')}>By area</button>
      </div>
      {view === 'age'
        ? <AgePopulationChart ageSex={population.ageSex} />
        : <AreaPopulationChart sitios={sitios} isBhw={isBhw} />}
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

function RecordsTrendChart({ data = [] }) {
  const rows = Array.isArray(data) ? data : [];
  const [hidden, setHidden] = useState([]);
  const series = recordSeries.filter((item) => rows.some((row) => (toCount(row[item.key]) || 0) > 0));
  const visibleSeries = series.filter((item) => !hidden.includes(item.key));
  const max = Math.max(
    ...rows.flatMap((row) => visibleSeries.map((item) => toCount(row[item.key]) || 0)),
    0,
  );

  const chart = { width: 640, height: 190, left: 36, right: 12, top: 14, bottom: 30 };
  const plotWidth = chart.width - chart.left - chart.right;
  const plotHeight = chart.height - chart.top - chart.bottom;
  const scaleMax = max || 1;
  const plotted = rows.map((row, index) => ({
    ...row,
    x: chart.left + (rows.length === 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth),
    yFor: (value) => chart.top + plotHeight - ((toCount(value) || 0) / scaleMax) * plotHeight,
    label: monthLabel(row.month),
  }));

  if (!rows.length || !series.length) {
    return <EmptyChart>No health records were recorded in the selected period.</EmptyChart>;
  }

  const step = Math.max(1, Math.ceil(rows.length / 6));
  const horizontalLabels = [0, 1, 2, 3].map((index) => Math.round((max || 0) * (index / 3)));

  return (
    <div className="dashboard-records-chart">
      <div className="dashboard-trend-legend" aria-label="Toggle health record categories">
        {series.map((item) => (
          <button
            type="button"
            key={item.key}
            className={hidden.includes(item.key) ? 'is-hidden' : ''}
            aria-pressed={!hidden.includes(item.key)}
            disabled={!hidden.includes(item.key) && visibleSeries.length === 1}
            onClick={() => setHidden((current) => (
              current.includes(item.key)
                ? current.filter((key) => key !== item.key)
                : [...current, item.key]
            ))}
          >
            <i className={item.color} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="dashboard-trend-canvas">
        <svg
          viewBox="0 0 640 190"
          role="img"
          aria-label={`Monthly health records: ${rows.map((row) => `${row.month}, ${recordSeries.map((item) => `${item.label} ${formatCount(row[item.key])}`).join(', ')}`).join('; ')}`}
        >
          {horizontalLabels.map((label, index) => {
            const y = 160 - (index / 3) * 146;
            return (
              <g key={`${label}-${index}`}>
                <line x1="36" x2="628" y1={y} y2={y} className="dashboard-chart-gridline" />
                <text x="30" y={y + 3} textAnchor="end" className="dashboard-chart-axis-label">{formatCount(label)}</text>
              </g>
            );
          })}
          {visibleSeries.map((item) => {
            const points = plotted.map((point) => `${point.x},${point.yFor(point[item.key])}`).join(' ');
            return (
              <g key={item.key}>
                <polyline points={points} className={`dashboard-trend-line ${item.color}`} pathLength="1" />
                {plotted.map((point) => (
                  (toCount(point[item.key]) || 0) > 0 && (
                    <circle
                      key={`${item.key}-${point.month}`}
                      cx={point.x}
                      cy={point.yFor(point[item.key])}
                      r="3"
                      className={`dashboard-trend-point ${item.color}`}
                    >
                      <title>{`${item.label}, ${point.month}: ${formatCount(point[item.key])}`}</title>
                    </circle>
                  )
                ))}
              </g>
            );
          })}
          {plotted.map((point, index) => (
            index % step === 0 || index === plotted.length - 1
              ? <text key={point.month} x={point.x} y="181" textAnchor="middle" className="dashboard-chart-axis-label">{point.label}</text>
              : null
          ))}
        </svg>
      </div>
      <table className="dashboard-visually-hidden">
        <caption>Health records by month and record category</caption>
        <thead><tr><th>Month</th>{recordSeries.map((item) => <th key={item.key}>{item.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month}>
              <th>{row.month}</th>
              {recordSeries.map((item) => <td key={item.key}>{formatCount(row[item.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function classificationTone(category) {
  const value = String(category || '').toLowerCase();
  if (value.includes('normal') || value.includes('tall')) return 'normal';
  if (value.includes('obese') || value.includes('severe')) return 'high';
  if (value.includes('overweight') || value.includes('underweight') || value.includes('thinness') || value.includes('stunted') || value.includes('wasted')) return 'watch';
  return 'other';
}

function NutritionDonut({ rows }) {
  const data = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ ...row, count: toCount(row.count) }))
    .filter((row) => row.count !== null && row.count > 0);
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const circumference = 2 * Math.PI * 37;
  const signature = data.map((item) => `${item.category}:${item.count}`).join('|');
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
    const frameId = window.requestAnimationFrame(() => setRevealed(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [signature]);

  if (!total) return <EmptyChart>No classified records are available for this method.</EmptyChart>;

  let offset = 0;
  const segments = data.map((item) => {
    const length = (item.count / total) * circumference;
    const segment = { ...item, length, offset };
    offset += length;
    return segment;
  });

  return (
    <div className="dashboard-nutrition-visual">
      <div className="dashboard-donut" role="img" aria-label={`${formatCount(total)} classified records`}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="dashboard-donut-track" cx="50" cy="50" r="37" />
          {segments.map((item, index) => (
            <circle
              key={item.category}
              className={`dashboard-donut-segment status-${classificationTone(item.category)}`}
              cx="50"
              cy="50"
              r="37"
              transform="rotate(-90 50 50)"
              style={{
                strokeDasharray: revealed ? `${item.length} ${circumference - item.length}` : `0 ${circumference}`,
                strokeDashoffset: -item.offset,
                transitionDelay: `${index * 70}ms`,
              }}
            >
              <title>{`${item.category}: ${formatCount(item.count)}`}</title>
            </circle>
          ))}
        </svg>
        <span><strong>{formatCount(total)}</strong><small>records</small></span>
      </div>
      <ul className="dashboard-nutrition-legend">
        {segments.slice(0, 5).map((item) => (
          <li key={item.category}>
            <i className={`status-${classificationTone(item.category)}`} />
            <span title={item.category}>{item.category}</span>
            <strong>{formatCount(item.count)}</strong>
          </li>
        ))}
        {segments.length > 5 && <li className="dashboard-more-categories">+{segments.length - 5} other classifications</li>}
      </ul>
    </div>
  );
}

function NutritionChart({ nutrition = {} }) {
  const data = nutrition && typeof nutrition === 'object' ? nutrition : {};
  const firstPopulated = nutritionTypes.find((type) => (
    Array.isArray(data[type.key])
    && data[type.key].some((item) => (toCount(item.count) || 0) > 0)
  ))?.key || 'child';
  const [selected, setSelected] = useState(firstPopulated);
  const activeType = nutritionTypes.find((type) => type.key === selected) || nutritionTypes[0];

  return (
    <div className="dashboard-nutrition-chart">
      <div className="dashboard-chart-switch" role="group" aria-label="Nutritional assessment method">
        {nutritionTypes.map((type) => (
          <button
            type="button"
            key={type.key}
            className={selected === type.key ? 'is-selected' : ''}
            aria-pressed={selected === type.key}
            onClick={() => setSelected(type.key)}
          >
            {type.shortLabel}
          </button>
        ))}
      </div>
      <NutritionDonut rows={data[activeType.key]} />
      <p className="dashboard-chart-footnote">
        {activeType.key === 'child'
          ? 'Operation Timbang growth status; children aged 0–59 months.'
          : `${activeType.label} classifications are shown separately.`}
      </p>
    </div>
  );
}

function CoverageRing({ percent }) {
  const value = toCount(percent);
  if (value === null) return <div className="dashboard-ring-unavailable">—</div>;
  const normalized = Math.min(100, Math.max(0, value));

  return (
    <div className="dashboard-coverage-ring" role="img" aria-label={`${formatCount(normalized)} percent coverage`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="dashboard-ring-track" cx="50" cy="50" r="40" />
        <circle
          className="dashboard-ring-progress"
          cx="50"
          cy="50"
          r="40"
          style={{ '--ring-offset': `${251.33 - ((normalized / 100) * 251.33)}px` }}
        />
      </svg>
      <strong>{formatCount(normalized)}<small>%</small></strong>
    </div>
  );
}

function OperationTimbangCard({ timbang = {} }) {
  const eligible = toCount(timbang.eligible);
  const weighed = toCount(timbang.weighed);

  return (
    <div className="dashboard-timbang-summary">
      <CoverageRing percent={timbang.coveragePercent} />
      <div className="dashboard-timbang-copy">
        <strong>{formatCount(weighed)} <span>of</span> {formatCount(eligible)}</strong>
        <p>eligible children aged 0–59 months weighed this year</p>
      </div>
      {eligible === 0 && (
        <p className="dashboard-chart-footnote dashboard-timbang-results">No eligible children recorded for this year.</p>
      )}
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
        const activity = (
          <>
            <span className={`dashboard-activity-icon activity-${item.type || 'other'}`} aria-hidden="true">
              <DashboardIcon name={item.type === 'child' ? 'child' : item.type === 'clinical' ? 'clinical' : item.type === 'maternal' ? 'nutrition' : 'records'} size={16} />
            </span>
            <span className="dashboard-activity-copy">
              <strong>{item.label || 'Health record'}</strong>
              <small>{item.recordedBy || 'Unknown user'}</small>
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

function DashboardUpdates({ attention = [], recentActivity = [], isBhw }) {
  const priorities = Array.isArray(attention) ? attention : [];
  const activity = Array.isArray(recentActivity) ? recentActivity : [];
  const [view, setView] = useState(priorities.length ? 'attention' : 'activity');

  if (!isBhw) {
    return <RecentActivity items={activity} isBhw={false} />;
  }

  return (
    <div className="dashboard-updates">
      <div className="dashboard-chart-switch" role="group" aria-label="Community updates">
        <button
          type="button"
          className={view === 'attention' ? 'is-selected' : ''}
          aria-pressed={view === 'attention'}
          onClick={() => setView('attention')}
        >
          Needs attention
          {priorities.length > 0 && <span>{priorities.length}</span>}
        </button>
        <button
          type="button"
          className={view === 'activity' ? 'is-selected' : ''}
          aria-pressed={view === 'activity'}
          onClick={() => setView('activity')}
        >
          Recent activity
        </button>
      </div>
      {view === 'attention'
        ? <AttentionList items={priorities} isBhw />
        : <RecentActivity items={activity} isBhw />}
    </div>
  );
}

function ChartCard({ title, subtitle, className = '', children, index = 0 }) {
  return (
    <article className={`dashboard-chart-card dashboard-entrance dashboard-delay-${index} ${className}`}>
      <header className="dashboard-card-heading">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
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
        {[0, 1, 2, 3, 4].map((item) => <div className="dashboard-skeleton dashboard-skeleton-card" key={item} />)}
      </div>
    </div>
  );
}

const DashboardPage = () => {
  const { user } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const range = searchParams.get('range') || 'this_month';
  const customFrom = searchParams.get('from') || '';
  const customTo = searchParams.get('to') || '';
  const [stats, setStats] = useState(null);
  const [statsKey, setStatsKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const sharedSync = useSyncStatus();
  const refreshSync = sharedSync.refresh;
  const syncQueue = { pending: sharedSync.pending, failed: sharedSync.failed };
  const isBhw = String(user?.role || '').toLowerCase().replace(/[-_\s]+/g, '_') === 'bhw';
  const queryKey = JSON.stringify([user?.user_id || 'current', range, customFrom, customTo]);
  const queryKeyRef = useRef(queryKey);
  const statsKeyRef = useRef('');
  const requestIdRef = useRef(0);
  queryKeyRef.current = queryKey;

  const loadSync = useCallback(async () => {
    try {
      await refreshSync();
    } catch (syncError) {
      console.error('Unable to refresh dashboard synchronization status.', syncError);
      setError('Dashboard data loaded, but synchronization status could not be refreshed.');
    }
  }, [refreshSync]);

  const fetchDashboard = useCallback(async (background = false) => {
    const requestKey = queryKeyRef.current;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const cacheKey = `dashboard_summary_${encodeURIComponent(requestKey)}`;
    if (!background) setLoading(true);

    try {
      const response = await api.get('/dashboard/summary', {
        params: { range, from: customFrom, to: customTo },
      });
      if (requestId !== requestIdRef.current || requestKey !== queryKeyRef.current) return;

      const data = response.data?.data;
      if (response.data?.success !== true || !isValidSummary(data)) {
        throw new Error('The dashboard response did not contain a valid community summary.');
      }

      setStats(data);
      setStatsKey(requestKey);
      statsKeyRef.current = requestKey;
      setError('');
      setLastUpdated(new Date());
      setOffline(false);
      try {
        const cachedSummary = {
          ...data,
          recentActivity: Array.isArray(data.recentActivity)
            ? data.recentActivity.map(({ id, type, label, recordedBy, date, createdAt }) => ({
              id,
              type,
              label,
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
        setError('Dashboard data is current, but its offline copy could not be updated.');
      }
    } catch (fetchError) {
      if (requestId !== requestIdRef.current || requestKey !== queryKeyRef.current) return;
      const message = fetchError?.response?.data?.message
        || fetchError?.message
        || 'Unable to load dashboard data.';
      setError(`${message} Showing the last saved data for this view when available.`);
      setOffline(!navigator.onLine);
      try {
        const cached = await idb.getFromStore('syncMetadata', cacheKey);
        if (requestId !== requestIdRef.current || requestKey !== queryKeyRef.current) return;
        if (cached?.value && isValidSummary(cached.value)) {
          setStats(cached.value);
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
        setError(`${message} The saved dashboard copy could not be read.`);
        if (statsKeyRef.current !== requestKey) {
          setStats(null);
          setStatsKey('');
          statsKeyRef.current = '';
        }
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        loadSync();
      }
    }
  }, [customFrom, customTo, loadSync, range]);

  useEffect(() => {
    fetchDashboard();
    const timer = window.setInterval(() => fetchDashboard(true), 300000);
    const onFocus = () => fetchDashboard(true);
    const onNetworkChange = () => {
      setOffline(!navigator.onLine);
      loadSync();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onNetworkChange);
    window.addEventListener('offline', onNetworkChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onNetworkChange);
      window.removeEventListener('offline', onNetworkChange);
    };
  }, [fetchDashboard, loadSync, queryKey]);

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
      setError(syncError?.message || 'Unable to synchronize queued changes.');
    }
  };

  const currentStats = statsKey === queryKey ? stats : null;
  const kpis = currentStats?.kpis || {};
  const senior = kpis.seniorCitizens || {};
  const children = kpis.childrenUnder5 || {};
  const records = kpis.recordsThisMonth || {};
  const firstName = user?.first_name
    || user?.firstName
    || user?.full_name?.split(' ')?.[0]
    || user?.name?.split(' ')?.[0]
    || 'Health Worker';
  const syncLabel = offline
    ? 'Offline'
    : syncQueue.failed > 0
      ? `${syncQueue.failed} failed`
      : syncQueue.pending > 0
        ? `${syncQueue.pending} pending`
        : 'Synced';

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-header-copy">
          <p className="dashboard-date">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <h1>{greeting()}, {firstName}</h1>
          <p className="dashboard-subtitle">Community health overview <span aria-hidden="true">·</span> Barangay Estancia, Kalibo, Aklan</p>
        </div>
        <nav className="dashboard-quick-actions" aria-label="Dashboard quick actions">
          {isBhw ? (
            <>
              <Link className="dashboard-action dashboard-action-primary" to="/residents/new"><DashboardIcon name="users" size={16} />Add resident</Link>
              <Link className="dashboard-action" to="/health-records"><DashboardIcon name="clinical" size={16} />Clinical record</Link>
              <Link className="dashboard-action" to="/senior-citizens/new"><DashboardIcon name="senior" size={16} />Register senior</Link>
              <Link className="dashboard-action" to="/nutrition"><DashboardIcon name="child" size={16} />Operation Timbang</Link>
            </>
          ) : (
            <Link className="dashboard-action dashboard-action-primary" to="/reports"><DashboardIcon name="records" size={16} />View reports</Link>
          )}
        </nav>
      </header>

      <div className="dashboard-toolbar">
        <label className="dashboard-range-control">
          <span>Reporting period</span>
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
        <div className="dashboard-refresh">
          <span className={`dashboard-sync-status ${offline || syncQueue.failed ? 'is-warning' : ''}`}>
            <i aria-hidden="true" />
            {syncLabel}
          </span>
          <span className="dashboard-updated" aria-live="polite">Updated {formatTime(lastUpdated)}</span>
          <button type="button" onClick={() => fetchDashboard(true)} aria-label="Refresh dashboard" title="Refresh dashboard">
            <DashboardIcon name="refresh" size={17} />
          </button>
          {(syncQueue.pending > 0 || syncQueue.failed > 0) && (
            <button type="button" className="dashboard-sync-button" onClick={syncNow} disabled={offline}>
              Sync now
            </button>
          )}
        </div>
      </div>

      {offline && (
        <div className="dashboard-offline-banner" role="status">
          Offline — showing saved dashboard data when available.
        </div>
      )}
      {error && (
        <div className="dashboard-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => fetchDashboard()}>Try again</button>
        </div>
      )}

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
              label="Registered seniors"
              value={senior.value}
              context={toCount(senior.unregistered) !== null ? `${formatCount(senior.unregistered)} age-eligible not registered` : 'Senior registry'}
              icon="senior"
              tone="teal"
              to={isBhw ? '/senior-citizens' : undefined}
              index={1}
            />
            <KpiCard
              label="Children under 5"
              value={children.value}
              context={toCount(children.weighedThisYear) !== null && toCount(children.eligibleThisYear) !== null
                ? `${formatCount(children.weighedThisYear)} of ${formatCount(children.eligibleThisYear)} weighed this year`
                : 'Ages 0–59 months'}
              icon="child"
              tone="green"
              to={isBhw ? '/nutrition' : undefined}
              index={2}
            />
            <KpiCard
              label="Health records"
              value={records.value}
              context={rangeLabels[range] || 'Selected period'}
              icon="records"
              tone="violet"
              to={isBhw ? '/health-records' : undefined}
              index={3}
            />
            <KpiCard
              label="Nutrition follow-up"
              value={kpis.nutritionCases}
              context="Residents with a recorded nutrition risk"
              icon="nutrition"
              tone="amber"
              to={isBhw ? '/nutrition' : undefined}
              index={4}
            />
          </section>

          <section className="dashboard-analytics-grid" aria-label="Community health analytics">
            <ChartCard
              title="Population distribution"
              subtitle="Resident counts from the registry"
              className="dashboard-population-card"
              index={5}
            >
              <PopulationChart population={currentStats.population} sitios={currentStats.sitio} isBhw={isBhw} />
            </ChartCard>

            <ChartCard
              title="Health records trend"
              subtitle={rangeLabels[range] || 'Selected period'}
              className="dashboard-trend-card"
              index={6}
            >
              <RecordsTrendChart data={currentStats.recordsTrend} />
            </ChartCard>

            <ChartCard
              title="Nutrition classifications"
              subtitle="Assessment methods shown separately"
              className="dashboard-nutrition-card"
              index={7}
            >
              <NutritionChart nutrition={currentStats.nutrition} />
            </ChartCard>

            <ChartCard
              title="Operation Timbang"
              subtitle="Annual coverage · ages 0–59 months"
              className="dashboard-timbang-card"
              index={8}
            >
              <OperationTimbangCard timbang={currentStats.timbang} />
            </ChartCard>

            <ChartCard
              title={isBhw ? 'Community updates' : 'Recent activity'}
              subtitle={isBhw ? 'Priority items and latest records' : 'Latest recorded health activity'}
              className="dashboard-updates-card"
              index={9}
            >
              <DashboardUpdates
                attention={currentStats.attention}
                recentActivity={currentStats.recentActivity}
                isBhw={isBhw}
              />
            </ChartCard>
          </section>
        </>
      ) : !loading && !error ? (
        <div className="dashboard-unavailable" role="status">
          <strong>Dashboard data is unavailable.</strong>
          <p>No statistics have been displayed because a valid summary was not returned.</p>
        </div>
      ) : null}
    </main>
  );
};

export default DashboardPage;
