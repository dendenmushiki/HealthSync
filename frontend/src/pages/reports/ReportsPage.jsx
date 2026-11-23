import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Baby,
  Calendar,
  CalendarDays,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardList,
  Clock3,
  Download,
  FileBarChart,
  FileText,
  HeartHandshake,
  HeartPulse,
  Info,
  LayoutDashboard,
  Loader2,
  MapPin,
  MapPinOff,
  MessageSquareText,
  RefreshCw,
  Stethoscope,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import api from '../../services/api/apiClient';
import PageBanner from '../../components/common/PageBanner';
import { AuthContext } from '../../context/AuthContext';
import { formatDateOnly, formatDateTimeInTimeZone, getDateInputValueInTimeZone } from '../../utils/dateUtils';
import {
  CHILD_INDICATORS,
  MATERNAL_INDICATORS,
  NUTRITION_CATEGORIES,
  NUTRITION_TOTALS,
  REPORT_SECTIONS,
  SENIOR_INDICATORS,
} from './reportConfig';
import {
  AlertBanner,
  DataQualitySummary,
  DrilldownDrawer,
  IndicatorTable,
  NutritionPiePanel,
  ReportLoading,
  ReportSection,
  SaveState,
} from './ReportComponents';
import './ReportsPage.css';

const REMARK_LIMIT = 1000;
const numberFormat = new Intl.NumberFormat();
const todayManila = () => getDateInputValueInTimeZone('Asia/Manila');

function rangeFor(period, params) {
  const today = todayManila();
  if (period === 'custom') return { from: params.from || '', to: params.to || '' };
  if (period === 'year') {
    const year = params.year || today.slice(0, 4);
    const end = `${year}-12-31`;
    return { from: `${year}-01-01`, to: end > today ? today : end };
  }
  if (period === 'quarter') {
    const quarter = Number(params.quarter || Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1);
    const year = Number(params.year || today.slice(0, 4));
    const startMonth = (quarter - 1) * 3 + 1;
    const end = new Date(Date.UTC(year, startMonth + 2, 0));
    const endDay = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
    return { from: `${year}-${String(startMonth).padStart(2, '0')}-01`, to: endDay > today ? today : endDay };
  }
  const month = params.month || today.slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0));
  const endDay = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
  return { from: `${month}-01`, to: endDay > today ? today : endDay };
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readPath(source, path) {
  return path.reduce((value, key) => value?.[key], source);
}

function trackedRow(key, label, values = {}, definition = '', group = '') {
  return {
    key,
    label,
    male: numericValue(values.male),
    female: numericValue(values.female),
    total: numericValue(values.total),
    tracked: true,
    definition,
    group,
  };
}

function untrackedRow({ key, label, group, definition }) {
  return { key, label, male: 'Not tracked', female: 'Not tracked', total: 'Not tracked', tracked: false, group, definition };
}

function categoriesFromApi(records, expectedCategories, prefix, normalize = (value) => value, totalDefinition) {
  const seen = new Set();
  const rows = expectedCategories.map((category) => {
    const label = category.label;
    const matches = (records || []).filter((record) => normalize(String(record.status || '')) === label);
    matches.forEach((record) => seen.add(record));
    const values = matches.reduce((total, record) => ({
      male: total.male + numericValue(record.male),
      female: total.female + numericValue(record.female),
      total: total.total + numericValue(record.total),
    }), { male: 0, female: 0, total: 0 });
    return trackedRow(`${prefix}:${category.key}`, label, values, category.definition || '');
  });
  const additional = (records || []).filter((record) => !seen.has(record) && !expectedCategories.some((category) => category.label.toLowerCase() === String(record.status || '').trim().toLowerCase()));
  additional.forEach((record) => rows.push(trackedRow(
    `${prefix}:${String(record.status || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    record.status || 'Uncategorized',
    record,
  )));
  if (totalDefinition) {
    const totals = (records || []).reduce((value, record) => ({
      male: value.male + numericValue(record.male),
      female: value.female + numericValue(record.female),
      total: value.total + numericValue(record.total),
    }), { male: 0, female: 0, total: 0 });
    rows.push({ ...trackedRow(totalDefinition.key, totalDefinition.label, totals, totalDefinition.definition), isTotal: true });
  }
  return rows;
}

function buildReportTables(fhsis) {
  const nutrition = fhsis?.nutrition || {};
  const operationRows = categoriesFromApi(
    nutrition.operationTimbang,
    NUTRITION_CATEGORIES.operationTimbang,
    'operation-timbang',
    (status) => {
      const value = status.trim().toLowerCase();
      if (value === 'normal') return 'Normal';
      if (value.includes('overweight')) return 'Overweight';
      if (value.includes('obes')) return 'Obese';
      if (/underweight|thin|wast|stunt|mixed/.test(value)) return 'Underweight / Thin';
      return value;
    },
    NUTRITION_TOTALS.operationTimbang,
  );
  const adolescentRows = categoriesFromApi(
    nutrition.adolescent,
    NUTRITION_CATEGORIES.adolescent,
    'adolescent-bmi',
    (status) => NUTRITION_CATEGORIES.adolescent.find((category) => category.label.toLowerCase() === status.trim().toLowerCase())?.label || status.trim(),
    NUTRITION_TOTALS.adolescent,
  );
  const adultRows = categoriesFromApi(
    nutrition.adult,
    NUTRITION_CATEGORIES.adult,
    'adult-bmi',
    (status) => NUTRITION_CATEGORIES.adult.find((category) => category.label.toLowerCase() === status.trim().toLowerCase())?.label || status.trim(),
    NUTRITION_TOTALS.adult,
  );

  const staticRows = (definitions) => definitions.map((item) => {
    if (item.tracked === false) return untrackedRow(item);
    return trackedRow(item.key, item.label, readPath(fhsis, item.path), item.definition, item.group);
  });
  return {
    nutrition: [
      { key: 'operation-timbang', title: 'Operation Timbang · 0–59 months', rows: operationRows },
      { key: 'adolescent-bmi', title: 'Adolescent BMI categories', rows: adolescentRows },
      { key: 'adult-bmi', title: 'Adult BMI categories', rows: adultRows },
    ],
    'child-care': staticRows(CHILD_INDICATORS),
    'maternal-care': staticRows(MATERNAL_INDICATORS),
    'senior-registry': staticRows(SENIOR_INDICATORS),
  };
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readCachedRemarks(periodKey) {
  try {
    const all = JSON.parse(localStorage.getItem('hs_fhsis_remarks') || '{}');
    return all[periodKey] || {};
  } catch (error) {
    return {};
  }
}

function readCachedReport(periodKey) {
  try {
    const all = JSON.parse(localStorage.getItem('hs_fhsis_reports') || '{}');
    return all[periodKey] || null;
  } catch (error) {
    return null;
  }
}

function cacheReport(periodKey, reportData) {
  try {
    const all = JSON.parse(localStorage.getItem('hs_fhsis_reports') || '{}');
    all[periodKey] = reportData;
    localStorage.setItem('hs_fhsis_reports', JSON.stringify(all));
  } catch (error) {
    console.error('Unable to cache the FHSIS report for offline viewing.', error);
  }
}

function saveCachedRemark(periodKey, key, remark) {
  try {
    const all = JSON.parse(localStorage.getItem('hs_fhsis_remarks') || '{}');
    all[periodKey] = { ...(all[periodKey] || {}), [key]: { ...(all[periodKey]?.[key] || {}), remark } };
    localStorage.setItem('hs_fhsis_remarks', JSON.stringify(all));
  } catch (error) {
    console.error('Unable to cache FHSIS remarks locally.', error);
  }
}

function periodCaption(range) {
  if (!range.from || !range.to) return 'Choose a valid date range';
  return range.from === range.to
    ? formatDateOnly(range.from, { month: 'short', day: 'numeric', year: 'numeric' })
    : `${formatDateOnly(range.from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${formatDateOnly(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

const ReportsPage = () => {
  const { user } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const period = ['month', 'quarter', 'year', 'custom'].includes(searchParams.get('period')) ? searchParams.get('period') : 'month';
  const range = useMemo(() => rangeFor(period, Object.fromEntries(searchParams)), [period, searchParams]);
  const periodKey = `${period}:${range.from}:${range.to}`;
  const requestedMonth = searchParams.get('month');
  const requestedQuarter = searchParams.get('quarter');
  const requestedYear = searchParams.get('year');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [remarksError, setRemarksError] = useState('');
  const [remarksRetry, setRemarksRetry] = useState(0);
  const [offlineNotice, setOfflineNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [remarks, setRemarks] = useState({});
  const [expanded, setExpanded] = useState(Object.fromEntries(REPORT_SECTIONS.map(({ id }) => [id, true])));
  const [hideNotTracked, setHideNotTracked] = useState(false);
  const [remarksOnly, setRemarksOnly] = useState(false);
  const [exportScope, setExportScope] = useState('all');
  const [drawer, setDrawer] = useState(null);
  const [generalNote, setGeneralNote] = useState('');
  const [generalNoteStatus, setGeneralNoteStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState(null);
  const timers = useRef({});
  const remarkValuesRef = useRef({});
  const reportRequestIdRef = useRef(0);
  const pendingRef = useRef(false);
  const returnFocusRef = useRef(null);
  const reportRef = useRef(null);

  useEffect(() => {
    document.body.classList.add('healthsync-print-report');
    return () => document.body.classList.remove('healthsync-print-report');
  }, []);

  const updateParams = useCallback((updates) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === '' || value === null || value === undefined) next.delete(key);
        else next.set(key, String(value));
      });
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => {
    if (!searchParams.has('period')) updateParams({ period: 'month', month: todayManila().slice(0, 7) });
  }, [searchParams, updateParams]);

  const requestParams = useMemo(() => ({
    period,
    from: period === 'custom' ? range.from : undefined,
    to: period === 'custom' ? range.to : undefined,
    month: period === 'month' ? requestedMonth || todayManila().slice(0, 7) : undefined,
    quarter: period === 'quarter' ? requestedQuarter : undefined,
    year: ['quarter', 'year'].includes(period) ? requestedYear : undefined,
  }), [period, range.from, range.to, requestedMonth, requestedQuarter, requestedYear]);
  const periodError = !range.from || !range.to || range.from > range.to || range.to > todayManila();

  const loadReport = useCallback(async () => {
    const requestId = reportRequestIdRef.current + 1;
    reportRequestIdRef.current = requestId;
    if (periodError) {
      setLoading(false);
      setError('');
      setReport(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/reports/fhsis', { params: requestParams });
      if (!response.data?.success || !response.data?.data) throw new Error('The report service returned incomplete data.');
      if (requestId !== reportRequestIdRef.current) return;
      setReport(response.data.data);
      cacheReport(periodKey, response.data.data);
      setOfflineNotice('');
    } catch (loadError) {
      if (requestId !== reportRequestIdRef.current) return;
      const cachedReport = readCachedReport(periodKey);
      if (typeof navigator !== 'undefined' && !navigator.onLine && cachedReport) {
        setReport(cachedReport);
        setOfflineNotice(`Showing the report saved on this device: ${cachedReport.metadata?.generatedAt ? formatDateTimeInTimeZone(cachedReport.metadata.generatedAt) : 'last available sync'}.`);
        setError('');
      } else {
        console.error('Unable to load FHSIS report data.', loadError);
        setError(loadError);
      }
    } finally {
      if (requestId === reportRequestIdRef.current) setLoading(false);
    }
  }, [periodError, periodKey, requestParams]);

  useEffect(() => { loadReport(); }, [loadReport, retry]);

  useEffect(() => {
    const cached = readCachedRemarks(periodKey);
    setRemarks(cached);
    remarkValuesRef.current = Object.fromEntries(Object.entries(cached).map(([key, value]) => [key, value.remark || '']));
    setGeneralNote(cached.general?.remark || '');
    setGeneralNoteStatus('');
    setRemarksError('');
    if (periodError) return undefined;
    let active = true;
    api.get('/reports/fhsis/remarks', { params: { reportPeriod: periodKey } })
      .then((response) => {
        if (!response.data?.success || !Array.isArray(response.data.data)) throw new Error('The report remarks service returned incomplete data.');
        if (!active) return;
        const serverRemarks = response.data.data.reduce((accumulator, item) => {
          accumulator[item.indicator_key] = {
            remark: item.remark || '',
            status: 'saved',
            updatedBy: item.updated_by_name || '',
            updatedAt: item.updated_at ? formatDateTimeInTimeZone(item.updated_at) : '',
          };
          return accumulator;
        }, {});
        setRemarks(serverRemarks);
        Object.entries(serverRemarks).forEach(([key, value]) => { remarkValuesRef.current[key] = value.remark; });
        setGeneralNote(serverRemarks.general?.remark || '');
      })
      .catch((loadError) => {
        if (active) {
          setRemarksError('Saved remarks could not be loaded. Check the report_remarks migration and try refreshing.');
          console.error('Unable to load saved FHSIS remarks.', loadError);
        }
      });
    return () => { active = false; };
  }, [periodKey, periodError, remarksRetry]);

  const tables = useMemo(() => buildReportTables(report), [report]);
  const allRows = useMemo(() => Object.entries(tables).flatMap(([key, sectionRows]) => (
    key === 'nutrition' ? sectionRows.flatMap((table) => table.rows) : sectionRows
  )), [tables]);
  const trackedCount = allRows.filter((row) => row.tracked).length;
  const summary = useMemo(() => report?.summary || {}, [report]);
  const metadata = useMemo(() => report?.metadata || {}, [report]);
  const generatedAt = metadata.generatedAt ? formatDateTimeInTimeZone(metadata.generatedAt) : '';
  const reportIsStale = metadata.generatedAt && Date.now() - new Date(metadata.generatedAt).getTime() > 24 * 60 * 60 * 1000;
  const municipality = [metadata.barangay, metadata.municipality].filter(Boolean).join(', ') || 'Jurisdiction not configured';
  const periodLabel = periodCaption(range);
  const canEdit = ['bhw', 'official'].includes(String(user?.role || '').toLowerCase());

  const persistRemark = useCallback((key, value) => {
    pendingRef.current = true;
    setRemarks((current) => ({ ...current, [key]: { ...(current[key] || {}), remark: value, status: 'saving' } }));
    if (key === 'general') setGeneralNoteStatus('saving');
    api.put('/reports/fhsis/remarks', { reportPeriod: periodKey, indicatorKey: key, remark: value })
        .then((response) => {
          const saved = response.data?.data;
          setRemarks((current) => {
            const updated = {
              ...current,
              [key]: {
                ...(current[key] || {}),
                status: 'saved',
                updatedBy: saved?.updated_by_name || user?.full_name || '',
                updatedAt: saved?.updated_at ? formatDateTimeInTimeZone(saved.updated_at) : formatDateTimeInTimeZone(new Date()),
              },
            };
            pendingRef.current = Object.keys(timers.current).length > 0
              || Object.values(updated).some((item) => ['failed', 'saving'].includes(item.status));
            return updated;
          });
          if (key === 'general') setGeneralNoteStatus('saved');
        })
        .catch((saveError) => {
          setRemarks((current) => ({ ...current, [key]: { ...(current[key] || {}), status: 'failed' } }));
          if (key === 'general') setGeneralNoteStatus('failed');
          pendingRef.current = true;
          console.error('Unable to save FHSIS remark.', saveError);
        });
  }, [periodKey, user?.full_name]);

  const setRemarkValue = useCallback((key, value) => {
    if (value.length > REMARK_LIMIT) return;
    setRemarks((current) => {
      const next = { ...current, [key]: { ...(current[key] || {}), remark: value, status: 'saving' } };
      saveCachedRemark(periodKey, key, value);
      return next;
    });
    if (key === 'general') setGeneralNoteStatus('saving');
    remarkValuesRef.current[key] = value;
    pendingRef.current = true;
    if (timers.current[key]) window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(() => {
      delete timers.current[key];
      persistRemark(key, value);
    }, 800);
  }, [periodKey, persistRemark]);

  const saveRemarkNow = useCallback((key) => {
    if (!timers.current[key] && remarks[key]?.status !== 'failed' && (key !== 'general' || generalNoteStatus !== 'failed')) return;
    if (timers.current[key]) {
      window.clearTimeout(timers.current[key]);
      delete timers.current[key];
    }
    const value = remarkValuesRef.current[key] ?? (key === 'general' ? generalNote : remarks[key]?.remark || '');
    persistRemark(key, value);
  }, [generalNote, generalNoteStatus, persistRemark, remarks]);

  useEffect(() => {
    const warnBeforeLeave = (event) => {
      if (!pendingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [remarks]);

  const filterRows = useCallback((rows = []) => rows.filter((row) => (
    (!hideNotTracked || row.tracked)
    && (!remarksOnly || Boolean(remarks[row.key]?.remark?.trim()))
  )), [hideNotTracked, remarks, remarksOnly]);
  const sectionRows = useMemo(() => ({
    'child-care': filterRows(tables['child-care']),
    'maternal-care': filterRows(tables['maternal-care']),
    'senior-registry': filterRows(tables['senior-registry']),
  }), [filterRows, tables]);

  const openDrilldown = useCallback(async (row, sex, event) => {
    returnFocusRef.current = event?.currentTarget || document.activeElement;
    const expected = numericValue(sex === 'male' ? row.male : sex === 'female' ? row.female : row.total);
    if (!expected || !row.tracked) return;
    const next = {
      row,
      sex,
      sexLabel: sex === 'total' ? 'All sexes' : sex === 'male' ? 'Male' : 'Female',
      periodLabel,
      from: range.from,
      to: range.to,
      expected,
      page: 1,
      pageSize: 10,
      search: '',
      items: [],
      total: 0,
      loading: true,
      error: '',
    };
    setDrawer(next);
    updateParams({ drilldown: row.key, sex, drawerPage: 1, drawerSearch: '' });
    try {
      const response = await api.get('/reports/fhsis/drilldown', {
        params: { indicator: row.key, category: row.label, sex, from: range.from, to: range.to, page: 1, pageSize: 10 },
      });
      if (!response.data?.success || !response.data?.data) throw new Error('Unable to load count details.');
      setDrawer((current) => current && ({
        ...current,
        ...response.data.data,
        items: response.data.data.items || [],
        loading: false,
        error: '',
      }));
    } catch (loadError) {
      setDrawer((current) => current && ({ ...current, loading: false, error: loadError.response?.data?.message || loadError.message || 'Unable to load count details.' }));
    }
  }, [periodLabel, range.from, range.to, updateParams]);

  const reloadDrawer = useCallback(async (patch = {}) => {
    if (!drawer) return;
    const next = { ...drawer, ...patch, loading: true, error: '' };
    setDrawer(next);
    updateParams({ drawerPage: next.page, drawerSearch: next.search });
    try {
      const response = await api.get('/reports/fhsis/drilldown', {
        params: { indicator: next.row.key, category: next.row.label, sex: next.sex, from: range.from, to: range.to, page: next.page, pageSize: next.pageSize, search: next.search },
      });
      if (!response.data?.success || !response.data?.data) throw new Error('Unable to load count details.');
      setDrawer((current) => current && ({ ...current, ...response.data.data, items: response.data.data.items || [], loading: false }));
    } catch (loadError) {
      setDrawer((current) => current && ({ ...current, loading: false, error: loadError.response?.data?.message || loadError.message || 'Unable to load count details.' }));
    }
  }, [drawer, range.from, range.to, updateParams]);

  const closeDrawer = useCallback(() => {
    setDrawer(null);
    updateParams({ drilldown: '', sex: '', drawerPage: '', drawerSearch: '' });
    window.setTimeout(() => returnFocusRef.current?.focus?.(), 0);
  }, [updateParams]);

  useEffect(() => {
    if (drawer && (drawer.from !== range.from || drawer.to !== range.to)) closeDrawer();
  }, [closeDrawer, drawer, range.from, range.to]);

  useEffect(() => {
    const indicatorKey = searchParams.get('drilldown');
    const sex = searchParams.get('sex');
    if (!indicatorKey || !['male', 'female', 'total'].includes(sex) || loading || error || drawer) return;
    const row = allRows.find((candidate) => candidate.key === indicatorKey);
    if (row && numericValue(sex === 'male' ? row.male : sex === 'female' ? row.female : row.total) > 0) {
      openDrilldown(row, sex);
    }
  }, [allRows, drawer, error, loading, openDrilldown, searchParams]);

  const exportRows = useCallback(async (scope = exportScope) => {
    if (exporting) return;
    setExporting(true);
    setExportNotice(null);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      const selected = REPORT_SECTIONS.filter(({ id }) => scope === 'all' || expanded[id]);
      const lines = [['Section', 'Indicator', 'Male', 'Female', 'Total', 'Remarks', 'Period', 'Generated at']];
      const generated = metadata.generatedAt || new Date().toISOString();
      const addRow = (section, row) => lines.push([
        section,
        row.label,
        row.tracked ? row.male : 'Not tracked',
        row.tracked ? row.female : 'Not tracked',
        row.tracked ? row.total : 'Not tracked',
        remarks[row.key]?.remark || '',
        periodLabel,
        generated,
      ]);

      selected.forEach(({ id, title }) => {
        if (id === 'overview') {
          [
            ['Total residents', summary.totalResidents],
            ['New residents in period', summary.newResidents],
            ['Active residents', summary.activeResidents],
            ['Clinical records (legacy health_records)', summary.clinicalRecords],
            ['Senior citizens registered', summary.seniorCitizens?.total],
          ].forEach(([label, total]) => addRow(title, { key: `overview-${label}`, label, tracked: true, male: '', female: '', total: numericValue(total) }));
          return;
        }
        if (id === 'nutrition') {
          tables.nutrition?.forEach((table) => table.rows.forEach((row) => addRow(table.title, row)));
        } else {
          (tables[id] || []).forEach((row) => addRow(title, row));
        }
      });
      if (remarks.general?.remark) addRow('General note', { key: 'general', label: 'General note', tracked: true, male: '', female: '', total: '' });
      const csv = `\uFEFF${lines.map((line) => line.map(escapeCsvCell).join(',')).join('\r\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const areaName = [metadata.barangay, metadata.municipality].filter(Boolean).join('_').replace(/[^a-z0-9_-]+/gi, '_') || 'HealthSync';
      const dateSuffix = period === 'month' ? (searchParams.get('month') || todayManila().slice(0, 7)) : `${range.from}_to_${range.to}`;
      link.href = url;
      link.download = `FHSIS_${areaName}_${dateSuffix}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportNotice({ type: 'success', message: 'CSV export completed.' });
    } catch (exportError) {
      console.error('Unable to export the FHSIS report.', exportError);
      setExportNotice({ type: 'error', message: exportError.message || 'Unable to export the FHSIS report.' });
    } finally {
      setExporting(false);
    }
  }, [exportScope, exporting, expanded, metadata, period, periodLabel, range.from, range.to, remarks, searchParams, summary, tables]);

  const setPeriod = (value) => {
    const today = todayManila();
    const defaults = value === 'month'
      ? { period: value, month: today.slice(0, 7), quarter: '', year: '', from: '', to: '' }
      : value === 'quarter'
        ? { period: value, quarter: Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1, year: today.slice(0, 4), month: '', from: '', to: '' }
        : value === 'year'
          ? { period: value, year: today.slice(0, 4), month: '', quarter: '', from: '', to: '' }
          : { period: value, from: `${today.slice(0, 7)}-01`, to: today, month: '', quarter: '', year: '' };
    updateParams(defaults);
  };

  const sectionCount = (id) => {
    if (id === 'overview') return { tracked: 5, total: 5 };
    const rows = id === 'nutrition' ? tables.nutrition?.flatMap((table) => table.rows) || [] : tables[id] || [];
    return { tracked: rows.filter((row) => row.tracked).length, total: rows.length };
  };

  const startExportDrilldown = async () => {
    if (!drawer) return;
    let rows = [];
    try {
      const pageSize = 50;
      const pages = Math.ceil(drawer.total / pageSize);
      for (let page = 1; page <= pages; page += 1) {
        const response = await api.get('/reports/fhsis/drilldown', {
          params: { indicator: drawer.row.key, category: drawer.row.label, sex: drawer.sex, from: range.from, to: range.to, page, pageSize, search: drawer.search },
        });
        if (!response.data?.success || !Array.isArray(response.data.data?.items)) throw new Error('Unable to export the complete count list.');
        rows = rows.concat(response.data.data.items);
      }
    } catch (exportError) {
      setDrawer((current) => current && ({ ...current, error: exportError.response?.data?.message || exportError.message || 'Unable to export this list.' }));
      return;
    }
    const csv = [['Name', 'Age', 'Sex', 'Sitio', 'Relevant date'], ...rows.map((item) => [item.name, item.age ?? '', item.sex || '', item.sitio || '', item.relevant_date || ''])];
    const blob = new Blob([`\uFEFF${csv.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `FHSIS_${drawer.row.key}_details.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const onDrilldown = (row, sex) => (event) => openDrilldown(row, sex, event);
  const clearFilters = () => {
    setHideNotTracked(false);
    setRemarksOnly(false);
  };
  const sectionIcons = {
    overview: LayoutDashboard,
    nutrition: HeartPulse,
    'child-care': Baby,
    'maternal-care': Stethoscope,
    'senior-registry': Users,
  };

  return (
    <div className="page-shell fhsis-report-page" ref={reportRef}>
      {loading && report && !error && <div className="fhsis-top-progress" role="progressbar" aria-label="Refreshing report"><span /></div>}
      <PageBanner
        className="fhsis-page-banner"
        icon={FileBarChart}
        eyebrow={<nav className="fhsis-breadcrumb" aria-label="Breadcrumb"><span>Reports</span><span aria-hidden="true">/</span><span aria-current="page">FHSIS</span></nav>}
        title="FHSIS Report"
        subtitle="A clear view of HealthSync indicators for the selected reporting period."
        actions={(
          <div className="fhsis-report-actions">
            <label className="fhsis-export-scope">
              <FileText aria-hidden="true" />
              <span>CSV includes</span>
              <select value={exportScope} onChange={(event) => setExportScope(event.target.value)} aria-label="CSV includes">
                <option value="all">All sections</option>
                <option value="visible">Expanded sections</option>
              </select>
            </label>
            <button type="button" className="fhsis-button-primary fhsis-export-button" onClick={() => exportRows()} disabled={loading || Boolean(error) || !report || exporting}>
              {exporting ? <Loader2 aria-hidden="true" className="fhsis-spin" /> : <Download aria-hidden="true" />}
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        )}
      />

      <section className="fhsis-controls-bar" aria-label="Report controls">
        <div className="fhsis-period-fields">
          <label>Reporting period
            <span className="fhsis-control-input">
              <Calendar aria-hidden="true" />
              <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                <option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option><option value="custom">Custom range</option>
              </select>
            </span>
          </label>
          {period === 'month' && <label className="fhsis-period-value">Month
            <span className="fhsis-control-input">
              <CalendarDays aria-hidden="true" />
              <input type="month" value={searchParams.get('month') || todayManila().slice(0, 7)} max={todayManila().slice(0, 7)} onChange={(event) => updateParams({ month: event.target.value })} />
            </span>
          </label>}
          {period === 'quarter' && <label className="fhsis-period-value">Quarter
            <span className="fhsis-control-input">
              <CalendarDays aria-hidden="true" />
              <select value={searchParams.get('quarter') || String(Math.floor((Number(todayManila().slice(5, 7)) - 1) / 3) + 1)} onChange={(event) => updateParams({ quarter: event.target.value })}>
                <option value="1">Q1</option><option value="2">Q2</option><option value="3">Q3</option><option value="4">Q4</option>
              </select>
            </span>
          </label>}
          {['quarter', 'year'].includes(period) && <label className="fhsis-period-value">Year
            <span className="fhsis-control-input">
              <CalendarDays aria-hidden="true" />
              <input type="number" min="2000" max={todayManila().slice(0, 4)} value={searchParams.get('year') || todayManila().slice(0, 4)} onChange={(event) => updateParams({ year: event.target.value })} />
            </span>
          </label>}
          {period === 'custom' && <>
            <label className="fhsis-period-value">From
              <span className="fhsis-control-input">
                <CalendarDays aria-hidden="true" />
                <input type="date" value={searchParams.get('from') || range.from} max={todayManila()} onChange={(event) => updateParams({ from: event.target.value })} />
              </span>
            </label>
            <label className="fhsis-period-value">To
              <span className="fhsis-control-input">
                <CalendarDays aria-hidden="true" />
                <input type="date" value={searchParams.get('to') || range.to} min={range.from || undefined} max={todayManila()} onChange={(event) => updateParams({ to: event.target.value })} />
              </span>
            </label>
          </>}
        </div>
        <div className="fhsis-period-meta">
          <span className={`fhsis-locality${municipality === 'Jurisdiction not configured' ? ' is-unconfigured' : ''}`}>
            {municipality === 'Jurisdiction not configured'
              ? <><MapPinOff aria-hidden="true" />{municipality}<Link to="/admin-settings">Set jurisdiction</Link></>
              : <><MapPin aria-hidden="true" />{municipality}</>}
          </span>
          <span className="fhsis-generated"><Clock3 aria-hidden="true" />Generated <time dateTime={metadata.generatedAt || undefined}>{generatedAt || '—'}</time></span>
          <button type="button" className="fhsis-refresh" aria-label="Refresh report" title="Refresh report" onClick={() => setRetry((value) => value + 1)} disabled={loading}>
            <RefreshCw aria-hidden="true" className={loading ? 'fhsis-spin' : ''} />
          </button>
          <span className="fhsis-period-help"><Info aria-hidden="true" /><span>Period activity · registry snapshot</span><button type="button" title="New residents and records use the selected period. Residents, active residents, and registered seniors are point-in-time snapshots as of today." aria-label="About period activity and registry snapshot"><Info aria-hidden="true" /></button></span>
        </div>
      </section>

      <div className="fhsis-alert-stack">
        {periodError && <AlertBanner type="warning" title="Choose a valid reporting range" message="From must be on or before To, and To cannot be in the future." />}
        {error && <AlertBanner type="error" title="Report data could not be loaded" message={error.response?.data?.message || error.message || 'Unable to load FHSIS report data.'} onRetry={() => setRetry((value) => value + 1)} />}
        {remarksError && <AlertBanner type="warning" title="Remarks couldn't be loaded" message={remarksError} onRetry={() => { setRemarksError(''); setRemarksRetry((value) => value + 1); }} onDismiss={() => setRemarksError('')} />}
        {offlineNotice && <AlertBanner type="info" message={offlineNotice} />}
        {reportIsStale && <AlertBanner type="warning" message="This report was generated more than 24 hours ago. Refresh before relying on it." />}
        {exportNotice && <AlertBanner type={exportNotice.type} message={exportNotice.message} onDismiss={() => setExportNotice(null)} />}
      </div>

      {loading && !report && <ReportLoading />}
      {!loading && !error && !report && !periodError && <div className="fhsis-empty-state"><h2>No report data</h2><p>No indicators are available for this reporting period.</p><button type="button" className="fhsis-button-secondary" onClick={() => setRetry((value) => value + 1)}><RefreshCw aria-hidden="true" /> Retry</button></div>}

      {report && !error && !periodError && (
        <>
          <DataQualitySummary
            tracked={trackedCount}
            total={allRows.length}
            hideNotTracked={hideNotTracked}
            onHideNotTracked={setHideNotTracked}
            remarksOnly={remarksOnly}
            onRemarksOnly={setRemarksOnly}
          />
          <div className="fhsis-layout">
            <div className="fhsis-section-actions" aria-label="Section controls">
              <button type="button" onClick={() => setExpanded(Object.fromEntries(REPORT_SECTIONS.map(({ id }) => [id, true])))}>
                <ChevronsUpDown aria-hidden="true" />Expand all
              </button>
              <button type="button" onClick={() => setExpanded(Object.fromEntries(REPORT_SECTIONS.map(({ id }) => [id, false])))}>
                <ChevronsDownUp aria-hidden="true" />Collapse all
              </button>
            </div>
            <main className="fhsis-sections">
              {REPORT_SECTIONS.map((section) => {
                const counts = sectionCount(section.id);
                const SectionIcon = sectionIcons[section.id];
                return (
                  <ReportSection
                    key={section.id}
                    section={section}
                    Icon={SectionIcon}
                    trackedCount={counts.tracked}
                    totalCount={counts.total}
                    expanded={Boolean(expanded[section.id])}
                    onToggle={() => setExpanded((current) => ({ ...current, [section.id]: !current[section.id] }))}
                  >
                    {section.id === 'overview' ? (
                      <>
                        <div className="fhsis-summary-grid">
                          {[
                            { label: 'Total residents', value: summary.totalResidents, detail: 'Registered residents · all statuses', key: 'resident-total', Icon: Users },
                            { label: 'New residents', value: summary.newResidents, detail: 'Created during this period', key: 'resident-new', Icon: UserPlus },
                            { label: 'Active residents', value: summary.activeResidents, detail: 'Active status · snapshot today', key: 'resident-active', Icon: UserCheck },
                            { label: 'Clinical records', value: summary.clinicalRecords, detail: 'Legacy health_records only · period-based', key: 'clinical-records', Icon: ClipboardList },
                            { label: 'Registered senior residents', value: summary.seniorCitizens?.total, detail: 'Senior Registry entries · snapshot today', key: 'seniorRegistered', Icon: HeartHandshake },
                          ].map((card) => {
                            const values = card.key === 'resident-total' ? summary.residentSex
                              : card.key === 'resident-active' ? summary.activeSex
                                : card.key === 'seniorRegistered' ? summary.seniorCitizens : {};
                            const male = numericValue(values?.male);
                            const female = numericValue(values?.female);
                            const denominator = male + female;
                            const row = { key: card.key, label: card.label, male, female, total: numericValue(card.value), tracked: true };
                            const hasSplit = ['resident-total', 'resident-active', 'seniorRegistered'].includes(card.key);
                            return (
                              <button type="button" className="fhsis-summary-card" key={card.key} onClick={onDrilldown(row, 'total')} disabled={!numericValue(card.value)}>
                                <span className="fhsis-summary-icon" aria-hidden="true"><card.Icon /></span>
                                <span className="fhsis-summary-label">{card.label}</span>
                                <strong>{numberFormat.format(numericValue(card.value))}</strong>
                                <small>{card.detail}</small>
                                {hasSplit ? <span className="fhsis-gender-split" role="img" aria-label={`Male ${numberFormat.format(male)}, Female ${numberFormat.format(female)}`}>
                                  <span className="fhsis-gender-bar">
                                    <i className="is-male" style={{ width: `${denominator ? (male / denominator) * 100 : 0}%` }} />
                                    <i className="is-female" style={{ width: `${denominator ? (female / denominator) * 100 : 0}%` }} />
                                  </span>
                                  <span className="fhsis-gender-legend">Male {numberFormat.format(male)} · Female {numberFormat.format(female)}</span>
                                </span> : <span className="fhsis-gender-split-spacer" aria-hidden="true" />}
                              </button>
                            );
                          })}
                        </div>
                        <div className="fhsis-definition-note"><Info aria-hidden="true" /><strong>Reporting basis</strong><span>Period-based: new residents, clinical records, nutrition, child, maternal and immunization records. Point-in-time: total residents, active residents and registered senior residents.</span></div>
                      </>
                    ) : section.id === 'nutrition' ? (
                      <div className="fhsis-nutrition-grid">
                        {(tables.nutrition || []).map((table) => (
                          <NutritionPiePanel
                            key={table.key}
                            table={table}
                            displayRows={filterRows(table.rows)}
                            remarks={remarks}
                            onRemarkChange={setRemarkValue}
                            onRemarkSave={saveRemarkNow}
                            canEdit={canEdit}
                            onDrilldown={onDrilldown}
                            filtersActive={hideNotTracked || remarksOnly}
                            onClearFilters={clearFilters}
                          />
                        ))}
                      </div>
                    ) : (
                      <IndicatorTable
                        title={section.title}
                        rows={sectionRows[section.id] || []}
                        remarks={remarks}
                        onRemarkChange={setRemarkValue}
                        onRemarkSave={saveRemarkNow}
                        canEdit={canEdit}
                        onDrilldown={onDrilldown}
                        filtersActive={hideNotTracked || remarksOnly}
                        onClearFilters={clearFilters}
                      />
                    )}
                  </ReportSection>
                );
              })}
            </main>
          </div>
          <section className="fhsis-general-note" aria-labelledby="fhsis-general-note-title">
            <div className="fhsis-general-note-heading"><span className="fhsis-note-icon" aria-hidden="true"><MessageSquareText /></span><div><h2 id="fhsis-general-note-title">General note</h2><p>Add context for this reporting period.</p></div></div>
            <textarea id="fhsis-general-note" aria-label="General note" value={generalNote} maxLength={REMARK_LIMIT} onChange={(event) => { setGeneralNote(event.target.value); setRemarkValue('general', event.target.value); }} onBlur={() => saveRemarkNow('general')} placeholder={canEdit ? 'Add a note about this report' : 'No note'} readOnly={!canEdit} />
            <div className="fhsis-general-note-footer"><span>{generalNote.length}/{REMARK_LIMIT}</span><SaveState status={generalNoteStatus} onRetry={() => saveRemarkNow('general')} /></div>
          </section>
          <div className="fhsis-report-end">
            <footer className="fhsis-report-signature">
              <div className="fhsis-signature-cell"><span>Prepared by</span><i className="fhsis-signature-line" aria-hidden="true" /><strong>{user?.full_name || ''}</strong><small>{user?.role || 'Health worker'}</small><small className="fhsis-signature-caption">Signature over printed name</small></div>
              <div className="fhsis-signature-cell"><span>Noted by / Approved by</span><i className="fhsis-signature-line" aria-hidden="true" /><strong aria-label="Name not provided" /><small>Municipal health officer</small><small className="fhsis-signature-caption">Signature over printed name</small></div>
            </footer>
            <p className="fhsis-report-footnote"><Info aria-hidden="true" /><span>“Not tracked” means the current HealthSync data model does not capture the indicator. A displayed zero is a count of matching recorded fields in the selected period, not an estimate of people without services.</span></p>
          </div>
        </>
      )}
      <div className="fhsis-print-header">
        <p>{municipality}</p><h1>Family Health Services Information System (FHSIS) Report</h1>
        <p>Reporting period: {periodLabel} · Generated: {generatedAt || '—'} · Prepared by: {user?.full_name || 'HealthSync user'}</p>
      </div>
      <DrilldownDrawer
        state={drawer && {
          ...drawer,
          onSearch: (search) => reloadDrawer({ search, page: 1 }),
          onPage: (page) => reloadDrawer({ page }),
          onRetry: () => reloadDrawer(),
          onExport: startExportDrilldown,
        }}
        onClose={closeDrawer}
      />
    </div>
  );
};

export default ReportsPage;
