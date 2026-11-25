import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import offlineQueue from '../services/offline/offlineQueueService';
import syncManager from '../services/offline/syncManager';
import api from '../services/api/apiClient';
import {
  downloadOfflineData,
  getActiveResidentSnapshot,
  getOfflineSnapshotReadiness,
} from '../services/offline/offlineDataDownloadService';
import useSyncStatus from '../services/offline/useSyncStatus';
import { formatStorageBytes, getOfflineStorageStatus } from '../services/offline/offlineStorageService';
import { formatDateLabel } from '../utils/dateUtils';
import StatusBanner from '../components/common/StatusBanner';
import PageBanner from '../components/common/PageBanner';
import Pagination from '../components/common/Pagination';
import StatCard from '../components/residents/StatCard';
import {
  AlertCircle,
  AlertTriangle,
  Activity,
  ArrowUpDown,
  Baby,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  CloudCheck,
  Copy,
  Download,
  FileText,
  HeartPulse,
  HelpCircle,
  HardDriveDownload,
  Link2Off,
  Loader2,
  LogIn,
  Lock,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  ServerOff,
  Stethoscope,
  UserPlus,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import './SyncStatus.css';

const statusLabel = { PENDING: 'Waiting to sync', SYNCING: 'Syncing', FAILED: 'Needs attention', SYNCED: 'Synced successfully', CONFLICT: 'Needs checking', BLOCKED: 'Blocked' };
const typeLabels = { residents: 'Resident registration', health_records: 'Clinical record', child_health: 'Child health record', child_health_records: 'Child health record', operation_timbang: 'Operation Timbang', operation_timbang_assessments: 'Operation Timbang assessment', adolescent_bmi: 'Adolescent BMI', adolescent_bmi_records: 'Adolescent BMI', adult_bmi: 'Adult BMI', adult_bmi_records: 'Adult BMI', senior_citizens: 'Senior citizen registration', senior_citizen_records: 'Senior citizen registration', patient_clinical_records: 'Clinical record', child_records: 'Child health record', maternal_records: 'Maternal record', immunization_records: 'Immunization record' };
const typeFilters = { residents: 'Residents', health_records: 'Clinical records', child_health: 'Child health', child_health_records: 'Child health', operation_timbang: 'Nutrition', operation_timbang_assessments: 'Nutrition', adolescent_bmi: 'Nutrition', adolescent_bmi_records: 'Nutrition', adult_bmi: 'Nutrition', adult_bmi_records: 'Nutrition', senior_citizens: 'Senior registry', senior_citizen_records: 'Senior registry', patient_clinical_records: 'Clinical records', child_records: 'Clinical records', maternal_records: 'Clinical records', immunization_records: 'Clinical records' };
const recordTypeLabels = { clinical: 'Clinical record', child: 'Child health record', maternal: 'Maternal record', immunization: 'Immunization record' };

function StatusBadge({ status, label }) {
  const normalized = String(status || 'PENDING').toUpperCase();
  const badgeIcons = {
    PENDING: Clock3,
    SYNCING: RefreshCw,
    FAILED: AlertTriangle,
    CONFLICT: HelpCircle,
    BLOCKED: Link2Off,
    SYNCED: CheckCircle2,
  };
  const StatusIcon = badgeIcons[normalized] || HelpCircle;
  return (
    <span className={`sync-status-badge status-${normalized.toLowerCase()}`}>
      <StatusIcon size={15} strokeWidth={1.8} aria-hidden="true" />
      <span>{label || statusLabel[normalized] || normalized}</span>
    </span>
  );
}

function relativeTime(value) { if (!value) return 'Unknown'; const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); if (minutes < 1) return 'Just now'; if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`; const days = Math.floor(hours / 24); return `${days} day${days === 1 ? '' : 's'} ago`; }

function friendlySummary(item) {
  if (item.syncActivity) {
    return `${getSavedAction(item)} ${getRecordType(item)} · Record #${item.server_record_id} · Synced by ${item.actor_name || 'BHW'}`;
  }
  const record = item.localRecord || item.payload || {};
  const name = [record.first_name, record.middle_name, record.last_name].filter(Boolean).join(' ') ||
    record.full_name || record.name || 'record';
  const type = getRecordType(item);
  if (item.operation === 'CREATE') return `New ${type} · ${name}`;
  if (item.operation === 'UPDATE') return `Updated ${type} · ${name}`;
  if (item.operation === 'DELETE') return `Removed ${type} · ${name}`;
  return `Saved ${type} · ${name}`;
}
function ChangeSummary({ item }) {
  const summary = friendlySummary(item);
  const separator = summary.indexOf(' · ');
  const title = separator < 0 ? summary : summary.slice(0, separator);
  const subject = separator < 0 ? '' : summary.slice(separator + 3);
  return <><strong>{title}</strong>{subject && <span>{subject}</span>}</>;
}
function getResidentName(item) {
  const record = item.localRecord || item.payload || {};
  return [record.first_name, record.middle_name, record.last_name].filter(Boolean).join(' ') ||
    record.full_name || record.name || 'Resident name unavailable';
}
function getRecordType(item) {
  const recordType = item.localRecord?.record_type;
  return recordTypeLabels[recordType] || recordType || typeLabels[item.table || item.table_name] || 'Health record';
}
function getSavedAction(item) {
  const operation = String(item.operation || '').toUpperCase();
  if (['CREATE', 'POST'].includes(operation)) return 'Added';
  if (['UPDATE', 'PUT', 'PATCH'].includes(operation)) return 'Updated';
  if (operation === 'DELETE') return 'Removed';
  return 'Saved';
}
function getOperationFilterValue(item) {
  const operation = String(item.operation || '').toUpperCase();
  if (['CREATE', 'POST'].includes(operation)) return 'CREATE';
  if (['UPDATE', 'PUT', 'PATCH'].includes(operation)) return 'UPDATE';
  if (operation === 'DELETE') return 'DELETE';
  return operation;
}
function detailLabel(field) {
  return String(field).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function renderRecordDetailValue(value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return renderRecordDetailValue(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value.length
      ? <ul className="sync-record-detail-list">{value.map((entry, index) => <li key={index}>{renderRecordDetailValue(entry)}</li>)}</ul>
      : 'Not available';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length
      ? <dl className="sync-record-detail-list">{entries.map(([key, entry]) => <div key={key}><dt>{detailLabel(key)}</dt><dd>{renderRecordDetailValue(entry)}</dd></div>)}</dl>
      : 'Not available';
  }
  return String(value);
}

const offlineDatasets = [
  'Resident records',
  'Nutrition records: Operation Timbang, Adult BMI, and Adolescent BMI',
  'Resident medical records: clinical, child, maternal, and immunization',
  'Legacy clinical records',
  'Legacy child-health records',
  'Senior citizen records',
];

function getDownloadDataset(phase) {
  if (phase === 'nutrition' || phase === 'nutrition-starting') return 'nutrition records';
  if (phase === 'medical-records' || phase === 'medical-records-starting') return 'resident medical records';
  if (phase?.startsWith('legacy-clinical')) return 'legacy clinical records';
  if (phase?.startsWith('legacy-child')) return 'legacy child-health records';
  if (phase?.startsWith('senior-citizens')) return 'senior citizen records';
  return 'resident records';
}

export default function SyncStatus() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useContext(AuthContext) || {};
  const { user, offlineVaultReady, offlineVaultMigrationRequired } = auth;
  const syncState = useSyncStatus();
  const connectivity = syncState.connectivity || {
    state: syncState.online ? 'online' : 'offline',
    lastChecked: null,
    lastError: null,
  };
  const checkConnection = syncState.checkNow || (async () => syncState.online);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'All');
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || 'All');
  const [operationFilter, setOperationFilter] = useState(searchParams.get('operation') || 'All');
  const [historyScope, setHistoryScope] = useState(searchParams.get('historyScope') === 'mine' ? 'mine' : 'all');
  const [sort, setSort] = useState(searchParams.get('sort') || 'newest');
  const [page, setPage] = useState(Number(searchParams.get('page') || 1));
  const [pageSize, setPageSize] = useState(Number(searchParams.get('pageSize') || 10));
  const [drawerId, setDrawerId] = useState(location.state?.queuedOperationId || null);
  const [discardItem, setDiscardItem] = useState(null);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [discardDependents, setDiscardDependents] = useState([]);
  const [toast, setToast] = useState(null);
  const [storageStatus, setStorageStatus] = useState({
    supported: false,
    usage: null,
    quota: null,
    usedPercent: null,
    warning: false,
    critical: false,
  });
  const [sharedSyncedHistory, setSharedSyncedHistory] = useState([]);
  const [sharedHistoryLoading, setSharedHistoryLoading] = useState(false);
  const [sharedHistoryError, setSharedHistoryError] = useState('');
  const [syncedRecordDetails, setSyncedRecordDetails] = useState(null);
  const [syncedDetailsLoading, setSyncedDetailsLoading] = useState(false);
  const [syncedDetailsError, setSyncedDetailsError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotExpanded, setSnapshotExpanded] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [offlineCacheError, setOfflineCacheError] = useState('');
  const [autoSyncError, setAutoSyncError] = useState('');
  const drawerRef = useRef(null);
  const rowRefs = useRef({});

  useEffect(() => { const timer = setTimeout(() => setSearch(searchParams.get('search') || ''), 300); return () => clearTimeout(timer); }, [searchParams]);
  useEffect(() => { const next = new URLSearchParams(); if (search) next.set('search', search); if (statusFilter !== 'All') next.set('status', statusFilter); if (typeFilter !== 'All') next.set('type', typeFilter); if (operationFilter !== 'All') next.set('operation', operationFilter); if (statusFilter === 'Synced' && historyScope !== 'all') next.set('historyScope', historyScope); if (sort !== 'newest') next.set('sort', sort); if (page !== 1) next.set('page', String(page)); if (pageSize !== 10) next.set('pageSize', String(pageSize)); setSearchParams(next, { replace: true }); }, [search, statusFilter, typeFilter, operationFilter, historyScope, sort, page, pageSize, setSearchParams]);
  useEffect(() => {
    const onComplete = async (event) => {
      const detail = event.detail || {};
      if (detail.authRequired) {
        setToast('Sign in again to finish syncing. Your saved changes remain on this device.');
      } else if (detail.synced) {
        setToast(`${detail.synced} change${detail.synced === 1 ? '' : 's'} synced`);
      } else if (detail.failed) {
        const queue = await offlineQueue.getQueueItems().catch(() => []);
        const failedItem = queue.find((item) => item.status === 'FAILED' || item.status === 'CONFLICT');
        setToast(`${detail.failed} change${detail.failed === 1 ? '' : 's'} couldn't be synced${failedItem?.lastErrorCode ? ` (${failedItem.lastErrorCode})` : ''}. ${failedItem?.lastError || 'Review Sync Status and retry when corrected.'}`);
      } else if (detail.blocked) {
        setToast(`${detail.blocked} change${detail.blocked === 1 ? '' : 's'} waiting for a resident registration.`);
      } else if (detail.skipped) {
        setToast('Another tab is already synchronizing. Your saved changes remain on this device.');
      } else if (!detail.synced && !detail.failed && !detail.blocked) {
        setToast('No saved changes changed status during this sync attempt.');
      }
    };
    window.addEventListener('healthsync:sync-complete', onComplete);
    return () => window.removeEventListener('healthsync:sync-complete', onComplete);
  }, []);
  useEffect(() => {
    if (user?.role !== 'bhw') {
      setSharedSyncedHistory([]);
      setSharedHistoryError('');
      setSharedHistoryLoading(false);
      return undefined;
    }
    if (statusFilter !== 'Synced') return undefined;

    let active = true;
    const loadSharedHistory = async () => {
      if (!syncState.online) {
        setSharedHistoryError('Connect to the server to view shared synced history.');
        setSharedHistoryLoading(false);
        return;
      }

      setSharedHistoryLoading(true);
      setSharedHistoryError('');
      try {
        const response = await api.get('/sync/activity', { params: { scope: historyScope } });
        const items = response.data?.data?.items;
        if (!response.data?.success || !Array.isArray(items)) {
          throw new Error('The server returned an invalid synced history response.');
        }
        if (active) setSharedSyncedHistory(items);
      } catch (error) {
        console.error('Unable to load shared synced history.', error);
        if (active) setSharedHistoryError(
          error?.response?.data?.message || error?.message || 'Shared synced history is unavailable.'
        );
      } finally {
        if (active) setSharedHistoryLoading(false);
      }
    };

    loadSharedHistory();
    window.addEventListener('healthsync:sync-complete', loadSharedHistory);
    return () => {
      active = false;
      window.removeEventListener('healthsync:sync-complete', loadSharedHistory);
    };
  }, [historyScope, statusFilter, syncState.online, user?.role]);
  const syncedActivityId = drawerId?.startsWith('sync:') ? drawerId.slice(5) : null;
  useEffect(() => {
    if (!syncedActivityId) {
      setSyncedRecordDetails(null);
      setSyncedDetailsError('');
      setSyncedDetailsLoading(false);
      return undefined;
    }

    let active = true;
    const loadSyncedRecordDetails = async () => {
      setSyncedDetailsLoading(true);
      setSyncedDetailsError('');
      try {
        const response = await api.get(`/sync/activity/${syncedActivityId}`);
        if (!response.data?.success || !response.data?.data) {
          throw new Error('The server returned an invalid synced record response.');
        }
        if (active) setSyncedRecordDetails(response.data.data);
      } catch (error) {
        console.error('Unable to load synced record details.', error);
        if (active) setSyncedDetailsError(
          error?.response?.data?.message || error?.message || 'Synced record details are unavailable.'
        );
      } finally {
        if (active) setSyncedDetailsLoading(false);
      }
    };

    loadSyncedRecordDetails();
    return () => { active = false; };
  }, [syncedActivityId]);
  useEffect(() => {
    if (user?.role !== 'bhw' || !offlineVaultReady) {
      setSnapshot(null);
      setSnapshotLoading(false);
      return undefined;
    }
    let active = true;
    const loadSnapshot = async () => {
      if (active) setSnapshotLoading(true);
      try {
        const current = await getActiveResidentSnapshot();
        if (active) setSnapshot(current || null);
      } catch (error) {
        if (active) setDownloadError(error);
      } finally {
        if (active) setSnapshotLoading(false);
      }
    };
    loadSnapshot();
    window.addEventListener('healthsync:offline-download-updated', loadSnapshot);
    return () => {
      active = false;
      window.removeEventListener('healthsync:offline-download-updated', loadSnapshot);
    };
  }, [offlineVaultReady, user?.role, user?.user_id]);
  useEffect(() => {
    let active = true;
    const refreshStatus = () => {
      if (typeof getOfflineStorageStatus !== 'function') return;
      Promise.resolve(getOfflineStorageStatus())
        .then((status) => {
          if (active && status && typeof status === 'object') setStorageStatus((current) => ({ ...current, ...status }));
        })
        .catch(() => {});
    };
    refreshStatus();
    window.addEventListener('healthsync:queue-changed', refreshStatus);
    window.addEventListener('healthsync:sync-complete', refreshStatus);
    return () => {
      active = false;
      window.removeEventListener('healthsync:queue-changed', refreshStatus);
      window.removeEventListener('healthsync:sync-complete', refreshStatus);
    };
  }, []);
  useEffect(() => {
    const onCacheError = (event) => setOfflineCacheError(event.detail?.message || 'Resident data could not be secured for offline use.');
    const onStorageError = (event) => setToast(event.detail?.message || 'Offline storage could not save this change.');
    const onAutoSyncError = (event) => setAutoSyncError(event.detail?.message || 'Saved changes could not be synchronized.');
    const onSyncComplete = (event) => {
      if (!event.detail?.failed) setAutoSyncError('');
    };
    window.addEventListener('healthsync:offline-cache-error', onCacheError);
    window.addEventListener('healthsync:offline-storage-error', onStorageError);
    window.addEventListener('healthsync:auto-sync-error', onAutoSyncError);
    window.addEventListener('healthsync:sync-complete', onSyncComplete);
    return () => {
      window.removeEventListener('healthsync:offline-cache-error', onCacheError);
      window.removeEventListener('healthsync:offline-storage-error', onStorageError);
      window.removeEventListener('healthsync:auto-sync-error', onAutoSyncError);
      window.removeEventListener('healthsync:sync-complete', onSyncComplete);
    };
  }, []);
  useEffect(() => { if (!drawerId) return undefined; const frame = requestAnimationFrame(() => drawerRef.current?.focus()); const key = (event) => { if (event.key === 'Escape') { setDrawerId(null); requestAnimationFrame(() => rowRefs.current[drawerId]?.focus()); } if (event.key === 'Tab' && drawerRef.current) { const focusable = drawerRef.current.querySelectorAll('button, a[href], input:not([disabled])'); if (!focusable.length) return; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }; document.addEventListener('keydown', key); return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', key); }; }, [drawerId]);

  function closeDrawer() { setDrawerId(null); requestAnimationFrame(() => rowRefs.current[drawerId]?.focus()); }
  async function downloadSnapshot() {
    setDownloading(true);
    setDownloadError('');
    setDownloadProgress({ phase: 'starting', recordsDownloaded: 0 });
    try {
      if (!syncState.online && !await checkConnection()) {
        throw new Error('The server cannot be reached right now. Your existing offline data is unchanged.');
      }
      const result = await downloadOfflineData(setDownloadProgress);
      setSnapshot(result);
      if (result.cleanupWarning) setDownloadError('The new offline data is ready, but older encrypted cache cleanup was incomplete.');
    } catch (error) {
      setDownloadError(error.response?.status
        ? `The server returned HTTP ${error.response.status}. The existing offline data remains unchanged.`
        : 'Offline data could not be refreshed. The existing offline data remains unchanged.');
    } finally {
      setDownloading(false);
    }
  }
  async function syncNow() {
    if (syncState.waiting === 0 || syncState.syncing) return;
    if (!syncState.online && !await checkConnection()) {
      setToast('The server cannot be reached right now. Your saved changes remain on this device and will retry when it is available.');
      return;
    }
    syncState.setSyncing(true);
    try {
      const result = await syncManager.runSync({ manual: true });
      setAutoSyncError('');
      if (result?.authRequired) {
        setToast('Sign in again to finish syncing. Your saved changes remain on this device.');
      } else if (Number(result?.synced) > 0) {
        setToast(`${result.synced} change${result.synced === 1 ? '' : 's'} synced${result?.failed || result?.blocked ? `; ${Number(result.failed) + Number(result.blocked)} still need attention` : ''}.`);
      } else if (Number(result?.blocked) > 0) {
        setToast(`${result.blocked} change${result.blocked === 1 ? '' : 's'} blocked waiting for a resident registration.`);
      } else if (Number(result?.failed) > 0) {
        setToast(`${result.failed} change${result.failed === 1 ? '' : 's'} couldn't be synced. Review the real error and retry after it is fixed.`);
      } else if (connectivity.state !== 'online') {
        setToast('The server is unreachable. Your saved changes remain on this device.');
      } else {
        setToast('No saved changes need synchronization.');
      }
    } catch (error) {
      setAutoSyncError('Saved changes could not be synchronized. Check your connection or sign in again.');
    } finally {
      syncState.setSyncing(false);
      await syncState.refresh();
    }
  }
  async function copyDiagnostics() {
    const queueCounts = syncState.items.reduce((counts, item) => {
      const key = String(item.status || 'UNKNOWN').toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    const diagnostics = {
      connectivity: {
        state: connectivity.state,
        lastChecked: connectivity.lastChecked,
        lastOnlineAt: connectivity.lastOnlineAt || null,
        lastError: connectivity.lastError || null,
      },
      lastSyncRun: syncState.lastSyncResult,
      queueCounts,
      storage: {
        kind: 'Encrypted IndexedDB',
        databaseVersion: 7,
        usage: storageStatus.usage,
        quota: storageStatus.quota,
        usedPercent: storageStatus.usedPercent,
      },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setDiagnosticsCopied(true);
      setToast('Diagnostics copied. No patient records or tokens are included.');
    } catch {
      setDiagnosticsCopied(false);
      setToast('Diagnostics could not be copied. Clipboard access is unavailable.');
    }
  }
  async function retryItem(item) {
    if (item.status === 'CONFLICT' && item.lastErrorCode !== 'IDEMPOTENCY_OUTCOME_UNKNOWN') {
      setToast('This change needs checking and cannot be safely resent. Verify its server status before editing or retrying.');
      return;
    }
    if (!['PENDING', 'FAILED', 'BLOCKED', 'CONFLICT'].includes(item.status)) return;
    if (item.status !== 'CONFLICT') {
      await offlineQueue.updateOperationStatus(item.offlineOperationId, {
        status: 'PENDING',
        lastError: null,
        nextRetryAt: null,
      });
    } else {
      await offlineQueue.updateOperationStatus(item.offlineOperationId, { nextRetryAt: null });
    }
    await syncNow();
  }
  async function resolveConflict(item, choice) {
    if (item.status !== 'CONFLICT') return;
    if (item.lastErrorCode === 'IDEMPOTENCY_OUTCOME_UNKNOWN') {
      setToast('Verify the server outcome before choosing a conflict resolution.');
      return;
    }
    if (choice === 'server') {
      await offlineQueue.deleteOperation(item.offlineOperationId);
      setToast('Kept the server version. The local queued copy was discarded.');
    } else {
      await offlineQueue.updateOperationStatus(item.offlineOperationId, {
        status: 'PENDING',
        lastError: 'Retrying your local version after the conflict.',
        lastErrorCode: null,
        nextRetryAt: null,
      });
      setToast('Your local version was selected for retry.');
    }
    await syncState.refresh();
  }
  async function discard() {
    if (!discardItem || !discardConfirmed) return;
    const currentItem = await offlineQueue.getOperation(discardItem.offlineOperationId);
    if (currentItem?.status === 'CONFLICT') {
      setDiscardItem(null);
      setDiscardConfirmed(false);
      setToast('This change may already be saved on the server and cannot be safely discarded.');
      return;
    }
    if (currentItem?.status === 'SYNCED') {
      setDiscardItem(null);
      setDiscardConfirmed(false);
      await syncState.refresh();
      setToast('This change has already synced and cannot be discarded.');
      return;
    }
    if (!currentItem) {
      setDiscardItem(null);
      setDiscardConfirmed(false);
      await syncState.refresh();
      return;
    }
    for (const dependent of discardDependents) {
      await offlineQueue.deleteOperation(dependent.offlineOperationId);
    }
    await offlineQueue.deleteOperation(discardItem.offlineOperationId);
    setDiscardItem(null);
    setDiscardConfirmed(false);
    setDiscardDependents([]);
    if (drawerId === discardItem.offlineOperationId) closeDrawer();
    await syncState.refresh();
    setToast('Queued change discarded');
  }
  function clearFilters() { setSearch(''); setStatusFilter('All'); setTypeFilter('All'); setOperationFilter('All'); setHistoryScope('all'); setSort('newest'); setPage(1); }
  function selectStatusFilter(value) {
    setStatusFilter(value);
    setPage(1);
    if (value !== 'Synced' && drawerId?.startsWith('sync:')) setDrawerId(null);
  }
  async function checkConnectionNow() {
    const reachable = await checkConnection();
    setToast(reachable
      ? 'HealthSync server is reachable.'
      : 'The HealthSync server could not be reached. Your saved changes remain on this device.');
  }

  const accountItems = syncState.items.filter((item) => String(item.userId ?? '') === String(user?.user_id ?? ''));
  const queueItems = accountItems.filter((item) => item.status !== 'SYNCED');
  const syncedItems = useMemo(() => sharedSyncedHistory.filter((item) => item.table_name !== 'report_remarks').map((item) => ({
    ...item,
    offlineOperationId: `sync:${item.sync_activity_id}`,
    table: item.table_name,
    createdAt: item.created_at,
    status: 'SYNCED',
    syncActivity: true,
  })), [sharedSyncedHistory]);
  const scopedSyncedItems = historyScope === 'mine'
    ? syncedItems.filter((item) => String(item.actor_id) === String(user?.user_id))
    : syncedItems;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sourceItems = statusFilter === 'Synced' ? scopedSyncedItems : queueItems;
    const result = sourceItems.filter((item) => {
      const summary = friendlySummary(item).toLowerCase();
      const matchesSearch = !query || summary.includes(query) ||
        String(item.table || '').toLowerCase().includes(query) ||
        String(item.operation || '').toLowerCase().includes(query) ||
        String(item.actor_name || '').toLowerCase().includes(query) ||
        String(item.module || '').toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'Synced' || statusFilter === 'All' ||
        (statusFilter === 'Outcome Unknown'
          ? item.status === 'CONFLICT'
          : String(item.status) === statusFilter.toUpperCase());
      const matchesType = typeFilter === 'All' || typeFilters[item.table] === typeFilter;
      const matchesOperation = operationFilter === 'All' ||
        getOperationFilterValue(item) === operationFilter.toUpperCase();
      return matchesSearch && matchesStatus && matchesType && matchesOperation;
    });
    result.sort((first, second) => sort === 'oldest'
      ? new Date(first.createdAt) - new Date(second.createdAt)
      : sort === 'failed' && statusFilter !== 'Synced'
        ? (first.status === 'FAILED' ? -1 : second.status === 'FAILED' ? 1 : new Date(second.createdAt) - new Date(first.createdAt))
        : new Date(second.createdAt) - new Date(first.createdAt));
    return result;
  }, [queueItems, scopedSyncedItems, search, statusFilter, typeFilter, operationFilter, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); const safePage = Math.min(page, totalPages); const visibleItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const activeDrawerItem = accountItems.find((item) => item.offlineOperationId === drawerId);
  const activeSyncedHistoryItem = syncedItems.find((item) => item.offlineOperationId === drawerId);
  const activeDiscardItem = discardItem && accountItems.find((item) => item.offlineOperationId === discardItem.offlineOperationId);
  const oldestWaiting = [...queueItems].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
  const oldestWarning = oldestWaiting && (Date.now() - new Date(oldestWaiting.createdAt).getTime()) > 2 * 86400000;
  const heroMode = syncState.error
    ? 'locked'
    : syncState.signInRequired
      ? 'auth'
      : syncState.syncing
        ? 'syncing'
        : connectivity.state === 'server-unreachable'
          ? 'unreachable'
          : connectivity.state === 'offline' || !syncState.online
            ? 'offline'
            : syncState.failed
              ? 'failed'
              : syncState.conflicts
                ? 'conflict'
                : syncState.waiting
                  ? 'pending'
                  : 'synced';
  const heroCopy = {
    synced: ['All changes are synced', syncState.lastSynced ? `Last synced ${relativeTime(syncState.lastSynced)}` : 'No queued changes'],
    locked: ['Private offline queue is locked', 'Unlock offline access for this account to check its saved changes.'],
    pending: [`${syncState.waiting} change${syncState.waiting === 1 ? '' : 's'} waiting to sync`, 'They will sync automatically.'],
    failed: [`${syncState.failed} change${syncState.failed === 1 ? '' : 's'} failed to sync`, 'Review the item below and retry it when the details are corrected.'],
    conflict: [`${syncState.conflicts} change${syncState.conflicts === 1 ? '' : 's'} need checking`, 'HealthSync could not confirm whether every change was saved. Check the record before trying again.'],
    offline: ['You are offline. Your work is safe on this device.', `${syncState.waiting} saved change${syncState.waiting === 1 ? '' : 's'} will sync when the connection returns.`],
    unreachable: ['Can’t reach the HealthSync server', connectivity.lastChecked
      ? `Last checked ${new Date(connectivity.lastChecked).toLocaleString()}. Your saved changes remain on this device.`
      : `${syncState.waiting} saved change${syncState.waiting === 1 ? '' : 's'} remain safe on this device.`],
    auth: ['Sign in again to sync', 'Your saved changes remain on this device until you sign in again.'],
    syncing: [`Syncing ${Number(syncState.syncingCount || 0).toLocaleString()} of ${Number(queueItems.length).toLocaleString()} changes`, 'Your saved changes are being sent securely.'],
  };
  const snapshotReadiness = getOfflineSnapshotReadiness(snapshot);
  const downloadDataset = downloadProgress?.phase === 'nutrition'
    ? `${downloadProgress.recordType} records`
    : getDownloadDataset(downloadProgress?.phase);

  const queueCounts = syncState.items.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, {});
  const statusTabs = [
    { label: 'All', value: 'All', count: queueItems.length },
    { label: 'Pending', value: 'Pending', count: syncState.pending },
    { label: 'Syncing', value: 'Syncing', count: syncState.syncingCount },
    { label: 'Needs attention', value: 'Failed', count: syncState.failed },
    { label: 'Needs checking', value: 'Outcome Unknown', count: syncState.conflicts },
    { label: 'Synced', value: 'Synced', count: scopedSyncedItems.length },
  ];
  const snapshotCounts = [
    { label: 'Residents', value: snapshot?.recordCount, icon: Users },
    { label: 'Nutrition', value: snapshot?.nutritionRecordCount, icon: HeartPulse },
    { label: 'Medical', value: snapshot?.medicalRecordCount, icon: Stethoscope },
    { label: 'Legacy clinical', value: snapshot?.legacyClinicalRecordCount, icon: ClipboardList },
    { label: 'Legacy child health', value: snapshot?.legacyChildRecordCount, icon: Baby },
    { label: 'Senior citizens', value: snapshot?.seniorCitizenRecordCount, icon: UserRound },
  ];
  const stateIcons = {
    synced: CloudCheck,
    pending: Clock3,
    syncing: RefreshCw,
    offline: WifiOff,
    unreachable: ServerOff,
    auth: LogIn,
    locked: Lock,
    failed: AlertTriangle,
    conflict: HelpCircle,
  };
  const StateIcon = stateIcons[heroMode] || CloudCheck;
  const snapshotStatus = snapshotReadiness === 'complete' ? 'Up to date' : 'Needs refresh';
  const hasFilters = Boolean(search || statusFilter !== 'All' || typeFilter !== 'All' || operationFilter !== 'All');
  const isPendingEmpty = statusFilter === 'Pending' && syncState.pending === 0;
  const hasNoQueueResults = queueItems.length === 0 || isPendingEmpty;

  function renderChangeActions(item, canRetry) {
    return (
      <div className="sync-row-actions">
        {canRetry && (
          <button
            type="button"
            className="sync-details-button"
            onClick={(event) => { event.stopPropagation(); retryItem(item); }}
            disabled={syncState.syncing}
            title={syncState.syncing ? 'A sync is already running' : 'Retry this change'}
          >
            <RotateCcw size={16} aria-hidden="true" />
            <span>Retry</span>
          </button>
        )}
        <button
          type="button"
          className="sync-icon-button"
          aria-label={`Details for ${friendlySummary(item)}`}
          title="View details and actions"
          onClick={(event) => { event.stopPropagation(); setDrawerId(item.offlineOperationId); }}
        >
          <MoreHorizontal size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return <main className="sync-status-page">
    {activeSyncedHistoryItem && <>
      <div className="sync-drawer-backdrop" onClick={closeDrawer} />
      <aside className="sync-drawer" role="dialog" aria-modal="true" aria-label="Synced record details" ref={drawerRef} tabIndex={-1}>
        <header>
          <div><p>Synced History</p><h2>{friendlySummary(activeSyncedHistoryItem)}</h2></div>
          <button className="sync-icon-button" onClick={closeDrawer} aria-label="Close details"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="sync-drawer-body">
          <section><span>Status</span><StatusBadge status="SYNCED" label="Saved to server" /></section>
          <section><h3>Synchronization details</h3><dl>
            <div><dt>Record type</dt><dd>{getRecordType(activeSyncedHistoryItem)}</dd></div>
            <div><dt>Change</dt><dd>{getSavedAction(activeSyncedHistoryItem)}</dd></div>
            <div><dt>Server record ID</dt><dd>{activeSyncedHistoryItem.server_record_id}</dd></div>
            <div><dt>Synced by</dt><dd>{activeSyncedHistoryItem.actor_name || 'BHW'}</dd></div>
            <div><dt>Synced at</dt><dd>{activeSyncedHistoryItem.created_at ? formatDateLabel(activeSyncedHistoryItem.created_at) : 'Not available'}</dd></div>
          </dl></section>
          <section><h3>Saved record details</h3>
            {syncedDetailsLoading ? <p role="status">Loading saved record</p>
              : syncedDetailsError ? <p role="alert">{syncedDetailsError}</p>
                : syncedRecordDetails?.record_details ? renderRecordDetailValue(syncedRecordDetails.record_details)
                  : <p>This record is no longer available on the server.</p>}
          </section>
        </div>
        <footer><button className="sync-secondary-button" onClick={closeDrawer}>Close</button></footer>
      </aside>
    </>}
    <PageBanner
      icon={RefreshCw}
      eyebrow="System / Sync Status"
      title="Sync Status"
      subtitle="Changes made offline are saved on this device and sent to the server when you are online."
      className="sync-page-banner"
      actions={
        <span className={`sync-connection sync-connection-${connectivity.state}`} role="status">
          <span className="sync-connection-dot" aria-hidden="true" />
        {syncState.loaded
          ? connectivity.state === 'server-unreachable' ? 'Server unreachable' : syncState.online ? 'Online' : 'Offline'
          : <span className="sync-snapshot-skeleton" aria-label="Checking connection" />}
        </span>
      }
    />
    {syncState.error && <div className="sync-locked-notice" role="alert">
      <div className="sync-alert-icon"><AlertTriangle size={20} aria-hidden="true" /></div>
      <div><strong>Offline queue unavailable</strong><p>{syncState.error} {offlineVaultMigrationRequired
        ? 'This older encrypted vault needs its existing six-digit PIN once. Its queued changes are preserved.'
        : 'The encrypted queue remains on this device and has not been counted as synchronized.'}</p></div>
      <button type="button" className="sync-secondary-button" onClick={syncState.refresh}>Retry</button>
    </div>}
    {offlineCacheError && <StatusBanner error={offlineCacheError} compact />}
    {autoSyncError && <StatusBanner error={autoSyncError} compact />}
    {(storageStatus.warning || storageStatus.critical) && <StatusBanner
      compact
      message={storageStatus.critical
        ? `Offline storage is almost full (${storageStatus.usedPercent}% used). Free device storage. Existing queued changes remain unchanged.`
        : `Offline storage is getting full (${storageStatus.usedPercent}% used). Existing queued changes remain unchanged.`}
    />}
    {toast && <div className="sync-toast" role="status" aria-live="polite">
      <span>{toast}</span>
      <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={17} aria-hidden="true" /></button>
    </div>}
    <section className={`sync-hero sync-hero-${heroMode}`} aria-live="polite" aria-busy={!syncState.loaded || syncState.syncing} data-loading={!syncState.loaded}>
      <span className="sync-hero-icon"><StateIcon size={24} strokeWidth={1.8} aria-hidden="true" /></span>
      <div className="sync-hero-copy">
        <h2>{heroCopy[heroMode][0]}</h2>
        <p title={heroMode === 'synced' && syncState.lastSynced ? new Date(syncState.lastSynced).toLocaleString() : undefined}>
        {heroCopy[heroMode][1]}
        </p>
        {heroMode === 'syncing' && <div className="sync-progress" role="progressbar" aria-label="Sync in progress"><span /></div>}
      </div>
      <div className="sync-hero-actions">
        {syncState.signInRequired
          ? <Link className="sync-secondary-button" to="/login"><LogIn size={17} aria-hidden="true" /><span>Sign in again</span></Link>
          : <button
          type="button"
          className="sync-primary-button"
          onClick={syncNow}
          disabled={syncState.waiting === 0 || syncState.syncing || syncState.signInRequired || Boolean(syncState.error)}
          title={syncState.signInRequired ? 'Sign in again before syncing' : syncState.error ? 'Unlock the offline queue before syncing' : syncState.syncing ? 'A sync is already running' : syncState.waiting === 0 ? 'There are no saved changes to sync' : undefined}
        >
          {syncState.syncing
            ? <Loader2 className="sync-spin" size={17} aria-hidden="true" />
            : <RefreshCw size={17} aria-hidden="true" />}
          <span>{syncState.syncing ? 'Syncing' : 'Sync now'}</span>
        </button>}
        <button type="button" className="sync-secondary-button" onClick={checkConnectionNow} title="Check connection">
          <Wifi size={17} aria-hidden="true" /><span>Check connection</span>
        </button>
        <button type="button" className="sync-icon-button" onClick={syncState.refresh} aria-label="Refresh saved changes" title="Refresh saved changes">
          <RotateCcw size={17} aria-hidden="true" />
        </button>
      </div>
      {(syncState.waiting === 0 || syncState.signInRequired || syncState.syncing || syncState.error) && (
        <p className="sync-action-help">
          {syncState.signInRequired ? 'Sign in again to sync your saved changes.'
            : syncState.error ? 'Unlock your encrypted offline queue to continue.'
              : syncState.syncing ? 'A synchronization is already in progress.'
              : 'No saved changes are waiting to sync.'}
        </p>
      )}
    </section>
    {syncState.failed > 0 && <div className="sync-retry-all">
      <button type="button" className="sync-secondary-button" onClick={async () => {
        for (const item of syncState.items.filter((entry) => entry.status === 'FAILED')) {
          await offlineQueue.updateOperationStatus(item.offlineOperationId, {
            status: 'PENDING',
            lastError: null,
            nextRetryAt: null,
          });
        }
        await syncNow();
      }} disabled={syncState.syncing}>
        <RotateCcw size={16} aria-hidden="true" /> Retry all eligible changes
      </button>
    </div>}

    <section className="sync-stats" aria-label="Sync queue summary" aria-busy={!syncState.loaded}>
      {[
        { label: 'Pending', value: syncState.pending, icon: Clock3, filter: 'Pending', tone: 'pending' },
        { label: 'Syncing', value: syncState.syncingCount, icon: RefreshCw, filter: 'Syncing', tone: 'syncing' },
        { label: 'Needs attention', value: syncState.failed, icon: AlertTriangle, filter: 'Failed', tone: 'attention' },
      ].map(({ label, value, icon, filter, tone }) => (
        <div className={`sync-stat-wrap ${tone === 'attention' && value > 0 ? 'has-attention' : ''}`} key={label}>
          <StatCard icon={icon} label={label} value={syncState.loaded ? value : null} />
          <button
            type="button"
            className={`sync-stat-hit ${statusFilter === filter ? 'is-selected' : ''}`}
            onClick={() => selectStatusFilter(statusFilter === filter ? 'All' : filter)}
            aria-label={`Filter saved changes by ${label}`}
            aria-pressed={statusFilter === filter}
          />
          <ChevronRight className="sync-stat-chevron" size={17} aria-hidden="true" />
        </div>
      ))}
    </section>
    {oldestWarning && <div className="sync-old-warning">
      <AlertTriangle size={17} aria-hidden="true" />
      <span><strong>Oldest waiting item: {relativeTime(oldestWaiting.createdAt)}</strong> It has been waiting longer than 2 days.</span>
    </div>}

    {user?.role === 'bhw' && <section className="sync-offline-card" aria-labelledby="offline-data-title" aria-busy={snapshotLoading}>
      <div className="sync-offline-heading">
        <span className="sync-section-icon"><HardDriveDownload size={19} aria-hidden="true" /></span>
        <div className="sync-offline-title">
          <h2 id="offline-data-title">Offline data</h2>
          <p>Download an encrypted snapshot for this device.</p>
        </div>
        <span className={`sync-offline-status ${snapshotReadiness === 'complete' ? 'ready' : 'needs-refresh'}`} aria-live="polite">
          {snapshotLoading ? <span className="sync-snapshot-skeleton" aria-label="Checking snapshot status" />
            : snapshotReadiness === 'complete'
            ? <CheckCircle2 size={16} aria-hidden="true" />
            : <AlertCircle size={16} aria-hidden="true" />}
          {!snapshotLoading && snapshotStatus}
        </span>
      </div>
      <div className="sync-snapshot-disclosure">
        <button
          type="button"
          className="sync-disclosure-button"
          aria-expanded={snapshotExpanded}
          aria-controls="sync-snapshot-contents"
          onClick={() => setSnapshotExpanded((expanded) => !expanded)}
        >
          <ChevronRight className={snapshotExpanded ? 'is-expanded' : ''} size={17} aria-hidden="true" />
          <span>What’s included in the download</span>
        </button>
        {snapshotExpanded && <div id="sync-snapshot-contents" className="sync-snapshot-content">
          <ul className="sync-offline-datasets">{offlineDatasets.map((dataset) => <li key={dataset}>{dataset}</li>)}</ul>
          <div className="sync-offline-counts">
            {snapshotCounts.map(({ label, value, icon: DatasetIcon }) => (
              <div className="sync-offline-count" key={label}>
                <span className="sync-count-icon"><DatasetIcon size={16} aria-hidden="true" /></span>
                <span>{label}:</span>{' '}
                {snapshotLoading
                  ? <span className="sync-snapshot-skeleton" aria-hidden="true" />
                  : <strong className="tabular-nums">{value === undefined || value === null ? 'Not available' : Number(value).toLocaleString()}</strong>}
              </div>
            ))}
          </div>
          {snapshot?.downloadedAt && <p className="sync-snapshot-updated">
            <Clock3 size={15} aria-hidden="true" />
            <span>Updated <time title={new Date(snapshot.downloadedAt).toLocaleString()} dateTime={snapshot.downloadedAt}>{relativeTime(snapshot.downloadedAt)}</time></span>
          </p>}
        </div>}
      </div>
      <div className="sync-offline-actions">
        <button type="button" className="sync-secondary-button sync-download-button" onClick={downloadSnapshot} disabled={!offlineVaultReady || downloading}>
          {downloading
            ? <Loader2 className="sync-spin" size={17} aria-hidden="true" />
            : <Download size={17} aria-hidden="true" />}
          <span>{downloading ? 'Refreshing offline data' : snapshot ? 'Refresh offline data' : 'Download offline data'}</span>
        </button>
        <p>{!offlineVaultReady
          ? 'Unlock the encrypted device vault to refresh this snapshot.'
          : !syncState.online
            ? 'Reconnect to download or refresh this snapshot.'
            : 'Your encrypted snapshot will be updated on this device.'}</p>
      </div>
      {downloading && downloadProgress && <div className="sync-offline-progress" role="status">
        <span>Downloading {downloadDataset}</span>
        <strong className="tabular-nums">{Number(downloadProgress.recordsDownloaded || 0).toLocaleString()}
          {downloadProgress.totalResidents === undefined && downloadProgress.totalRecords === undefined
            ? ''
            : ` of ${Number(downloadProgress.totalRecords ?? downloadProgress.totalResidents).toLocaleString()}`}
        </strong>
        {downloadProgress.totalPages !== undefined && <span>Page {Number(downloadProgress.pagesCompleted).toLocaleString()} of {Number(downloadProgress.totalPages).toLocaleString()}</span>}
      </div>}
      {downloadError && <StatusBanner error={downloadError} retry={downloadSnapshot} retrying={downloading} compact />}
    </section>}

    <section className="sync-diagnostics-card" aria-labelledby="sync-diagnostics-title">
      <button
        type="button"
        className="sync-diagnostics-toggle"
        aria-expanded={diagnosticsExpanded}
        aria-controls="sync-diagnostics-content"
        onClick={() => setDiagnosticsExpanded((expanded) => !expanded)}
      >
        <span className="sync-section-icon"><Stethoscope size={19} aria-hidden="true" /></span>
        <span className="sync-diagnostics-heading"><strong id="sync-diagnostics-title">Diagnostics</strong><small>Connection and queue health information</small></span>
        <ChevronDown className={diagnosticsExpanded ? 'is-expanded' : ''} size={18} aria-hidden="true" />
      </button>
      {diagnosticsExpanded && <div className="sync-diagnostics-content" id="sync-diagnostics-content">
        <dl className="sync-diagnostics-grid">
          <div><dt>Connectivity</dt><dd>{connectivity.state}</dd></div>
          <div><dt>Last check</dt><dd>{connectivity.lastChecked ? new Date(connectivity.lastChecked).toLocaleString() : 'Not checked'}</dd></div>
          {connectivity.lastError && <div><dt>Last check result</dt><dd>{connectivity.lastError}</dd></div>}
          <div><dt>Last sync run</dt><dd>{syncState.lastSyncResult
            ? `${syncState.lastSyncResult.synced || 0} synced, ${syncState.lastSyncResult.failed || 0} failed, ${syncState.lastSyncResult.blocked || 0} blocked`
            : 'No sync run recorded'}</dd></div>
          <div><dt>Queue counts</dt><dd>{Object.entries(queueCounts).map(([status, count]) => `${status}: ${Number(count).toLocaleString()}`).join(', ') || 'No queued items'}</dd></div>
          <div><dt>Queue version</dt><dd>{storageStatus.supported
            ? `Encrypted IndexedDB v7; ${formatStorageBytes(storageStatus.usage)} of ${formatStorageBytes(storageStatus.quota)}${storageStatus.usedPercent !== null ? ` (${storageStatus.usedPercent}%)` : ''}`
            : 'Encrypted IndexedDB v7; storage estimate unavailable'}</dd></div>
        </dl>
        <button type="button" className="sync-ghost-button" onClick={copyDiagnostics} title={diagnosticsCopied ? 'Copied' : 'Copy diagnostics'}>
          {diagnosticsCopied ? <CheckCircle2 size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          <span>{diagnosticsCopied ? 'Copied' : 'Copy diagnostics'}</span>
        </button>
      </div>}
    </section>

    <section className="sync-list-card" aria-labelledby="saved-changes-title">
      <header className="sync-list-heading">
        <span className="sync-section-icon"><ClipboardList size={19} aria-hidden="true" /></span>
        <div>
          <h2 id="saved-changes-title">Saved changes</h2>
          <p>Changes saved on this device and their sync status.</p>
        </div>
        <span className="sync-result-count" aria-live="polite">{filtered.length.toLocaleString()} {filtered.length === 1 ? 'result' : 'results'}</span>
      </header>
      <div className="sync-toolbar">
        <label className="sync-search">
          <span className="sync-sr-only">Search saved changes</span>
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder={statusFilter === 'Synced' ? 'Search record type, ID or BHW' : 'Search resident or record type'}
            aria-label="Search saved changes"
          />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={16} aria-hidden="true" /></button>}
        </label>
        <div className="sync-selects">
          <label className="sync-select-wrap"><span className="sync-sr-only">Type filter</span>
            <ClipboardList className="sync-select-leading" size={16} aria-hidden="true" />
            <select aria-label="Type filter" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}>
              <option value="All">All types</option><option>Residents</option><option>Clinical records</option><option>Child health</option><option>Nutrition</option><option>Senior registry</option>
            </select><ChevronDown size={16} aria-hidden="true" />
          </label>
          <label className="sync-select-wrap"><span className="sync-sr-only">Operation filter</span>
            <Activity className="sync-select-leading" size={16} aria-hidden="true" />
            <select aria-label="Operation filter" value={operationFilter} onChange={(event) => { setOperationFilter(event.target.value); setPage(1); }}>
              <option value="All">All operations</option><option>Create</option><option>Update</option><option>Delete</option>
            </select><ChevronDown size={16} aria-hidden="true" />
          </label>
          <label className="sync-select-wrap"><span className="sync-sr-only">Sort queue</span>
            <ArrowUpDown className="sync-select-leading" size={16} aria-hidden="true" />
            <select aria-label="Sort queue" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="failed" disabled={statusFilter === 'Synced'}>Needs attention first</option>
            </select><ChevronDown size={16} aria-hidden="true" />
          </label>
          {statusFilter === 'Synced' && <label className="sync-select-wrap">
            <span className="sync-sr-only">Synced history account filter</span>
            <UserRound className="sync-select-leading" size={16} aria-hidden="true" />
            <select aria-label="Synced history account filter" value={historyScope} onChange={(event) => { setHistoryScope(event.target.value); setPage(1); if (drawerId?.startsWith('sync:')) setDrawerId(null); }}>
              <option value="mine">My account</option><option value="all">All BHW accounts</option>
            </select><ChevronDown size={16} aria-hidden="true" />
          </label>}
        </div>
      </div>
      <div
        className="sync-filter-row"
        role="tablist"
        aria-label="Saved change status filters"
        onKeyDown={(event) => {
          const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (!direction) return;
          event.preventDefault();
          const currentIndex = statusTabs.findIndex((tab) => tab.value === statusFilter);
          const nextIndex = (currentIndex + direction + statusTabs.length) % statusTabs.length;
          event.currentTarget.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
          selectStatusFilter(statusTabs[nextIndex].value);
        }}
      >
        <div className="sync-status-chips">
          {statusTabs.map(({ label, value, count }) => (
            <button
              type="button"
              role="tab"
              aria-label={label}
              aria-selected={statusFilter === value}
              tabIndex={statusFilter === value ? 0 : -1}
              key={value}
              className={statusFilter === value ? 'active' : ''}
              onClick={() => selectStatusFilter(value)}
            >
              <span>{label}</span><span className="sync-tab-count">{Number(count || 0).toLocaleString()}</span>
            </button>
          ))}
        </div>
        {hasFilters && <button type="button" className="sync-clear" onClick={clearFilters}>Clear filters</button>}
      </div>
      {statusFilter === 'Synced' && sharedHistoryError && sharedSyncedHistory.length > 0 && <p className="sync-activity-message sync-activity-error" role="alert">{sharedHistoryError}</p>}
      {(statusFilter === 'Synced' ? sharedHistoryLoading : !syncState.loaded)
        ? <div className="sync-skeletons" role="status" aria-label={statusFilter === 'Synced' ? 'Loading synced history' : 'Loading saved changes'}>
          {[1, 2, 3].map((index) => <span key={index} />)}
        </div>
        : !filtered.length
          ? <div className="sync-empty">
            <span className="sync-empty-icon">
              {statusFilter === 'Synced' && sharedHistoryError ? <AlertTriangle size={25} aria-hidden="true" />
                : statusFilter !== 'Synced' && !queueItems.length ? <CheckCircle2 size={26} aria-hidden="true" />
                  : <SearchX size={26} aria-hidden="true" />}
            </span>
            <h3>{statusFilter === 'Synced'
              ? sharedHistoryError ? 'Synced history unavailable' : sharedSyncedHistory.length ? 'No matching synced records' : 'No synced records yet'
              : syncState.error ? 'Offline queue unavailable' : hasNoQueueResults ? 'No changes waiting to sync' : 'No changes match your filters'}</h3>
            <p>{statusFilter === 'Synced'
              ? sharedHistoryError || (sharedSyncedHistory.length ? 'Try adjusting the filters.' : historyScope === 'mine' ? 'No records from your account have completed synchronization.' : 'No BHW records have completed synchronization yet.')
              : syncState.error ? 'Unlock offline access for this account to see its local changes. They remain encrypted on this device.'
                : !hasNoQueueResults ? 'Adjust or clear the current search and filters.'
                  : 'Offline changes confirmed by HealthSync are listed in Synced history.'}</p>
            {statusFilter !== 'Synced' && hasNoQueueResults
              ? <button type="button" className="sync-ghost-button" onClick={() => selectStatusFilter('Synced')}>View Synced history</button>
              : (statusFilter === 'Synced' ? sharedSyncedHistory.length : queueItems.length) > 0 && <button type="button" className="sync-ghost-button" onClick={clearFilters}>Clear filters</button>}
          </div>
          : <>
            <div className="sync-table-wrap">
              <table className="sync-table">
                <thead><tr><th scope="col">Change</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Actions</th></tr></thead>
                <tbody>{visibleItems.map((item) => {
                  const status = String(item.status || 'PENDING').toUpperCase();
                  const canRetry = ['PENDING', 'FAILED', 'BLOCKED'].includes(status) ||
                    (status === 'CONFLICT' && item.lastErrorCode === 'IDEMPOTENCY_OUTCOME_UNKNOWN');
                  const TypeIcon = String(item.table || '').includes('bmi') || String(item.table || '').includes('timbang')
                    ? HeartPulse
                    : String(item.table || '').includes('resident') || String(item.table || '').includes('senior')
                      ? UserPlus
                      : String(item.table || '').includes('child')
                        ? Baby
                        : String(item.table || '').includes('health') || String(item.table || '').includes('clinical')
                          ? ClipboardList
                          : FileText;
                                const tooltip = [
                    item.lastError,
                    item.lastErrorCode,
                    Number(item.attempts || item.retryCount) > 0 ? `${Number(item.attempts || item.retryCount)} attempts` : '',
                                  item.lastAttemptAt ? `Last attempt ${formatDateLabel(item.lastAttemptAt)}` : '',
                                  item.nextRetryAt ? `Next retry ${formatDateLabel(item.nextRetryAt)}` : '',
                    item.status === 'BLOCKED' ? 'Waiting for resident registration' : '',
                                ].filter(Boolean).join(' · ');
                  return <tr key={item.offlineOperationId} tabIndex={0} ref={(node) => { rowRefs.current[item.offlineOperationId] = node; }} onClick={() => setDrawerId(item.offlineOperationId)}>
                    <td>
                                    <button className="sync-change-link" title={friendlySummary(item)} onClick={(event) => { event.stopPropagation(); setDrawerId(item.offlineOperationId); }} aria-label={friendlySummary(item)}>
                        <ChangeSummary item={item} />
                      </button>
                    </td>
                    <td><span className="sync-type-badge"><TypeIcon size={15} aria-hidden="true" />{getRecordType(item)}</span></td>
                    <td><span title={tooltip || undefined}><StatusBadge status={status} /></span></td>
                    <td><time title={new Date(item.createdAt).toLocaleString()} dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time></td>
                    <td>{renderChangeActions(item, canRetry)}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="sync-mobile-list">{visibleItems.map((item) => {
              const status = String(item.status || 'PENDING').toUpperCase();
              const canRetry = ['PENDING', 'FAILED', 'BLOCKED'].includes(status) ||
                (status === 'CONFLICT' && item.lastErrorCode === 'IDEMPOTENCY_OUTCOME_UNKNOWN');
              const TypeIcon = String(item.table || '').includes('bmi') || String(item.table || '').includes('timbang')
                ? HeartPulse
                : String(item.table || '').includes('resident') || String(item.table || '').includes('senior')
                  ? UserPlus
                  : String(item.table || '').includes('child')
                    ? Baby
                    : String(item.table || '').includes('health') || String(item.table || '').includes('clinical')
                      ? ClipboardList
                      : FileText;
              return <article className="sync-mobile-card" key={item.offlineOperationId} ref={(node) => { rowRefs.current[item.offlineOperationId] = node; }}>
                <div className="sync-mobile-card-top">
                  <button className="sync-change-link" title={friendlySummary(item)} onClick={() => setDrawerId(item.offlineOperationId)} aria-label={friendlySummary(item)}>
                    <ChangeSummary item={item} />
                  </button>
                  <StatusBadge status={status} />
                </div>
                <div className="sync-mobile-card-meta">
                  <span className="sync-type-badge"><TypeIcon size={15} aria-hidden="true" />{getRecordType(item)}</span>
                  <time title={new Date(item.createdAt).toLocaleString()} dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
                </div>
                {item.lastError && <small className="sync-row-error">{item.lastError}</small>}
                {renderChangeActions(item, canRetry)}
              </article>;
            })}</div>
            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              first={(safePage - 1) * pageSize + 1}
              last={Math.min(safePage * pageSize, filtered.length)}
              total={filtered.length}
              itemLabel="changes"
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
              onPageChange={setPage}
            />
          </>}
    </section>
    {activeDrawerItem && <>
      <div className="sync-drawer-backdrop" onClick={closeDrawer} />
      <aside className="sync-drawer" role="dialog" aria-modal="true" aria-label="Saved change details" ref={drawerRef} tabIndex={-1}>
        <header><div><p>{activeDrawerItem.status === 'SYNCED' ? 'Synced History' : 'Saved change'}</p><h2>{getResidentName(activeDrawerItem)}</h2></div><button className="sync-icon-button" onClick={closeDrawer} aria-label="Close details"><X size={18} aria-hidden="true" /></button></header>
        <div className="sync-drawer-body">
          <section><span>Status</span><StatusBadge status={activeDrawerItem.status} /></section>
          <section><h3>Record details</h3><dl>
            <div><dt>Record type</dt><dd>{getRecordType(activeDrawerItem)}</dd></div>
            <div><dt>Change</dt><dd>{activeDrawerItem.operation === 'UPDATE' ? 'Updated' : activeDrawerItem.operation === 'DELETE' ? 'Removed' : 'New record'}</dd></div>
            <div><dt>Created or updated</dt><dd>{formatDateLabel(activeDrawerItem.createdAt)}</dd></div>
            {activeDrawerItem.status === 'SYNCED' && <div><dt>Synced</dt><dd>{activeDrawerItem.syncedAt ? new Date(activeDrawerItem.syncedAt).toLocaleString() : 'Not available'}</dd></div>}
          </dl></section>
          {activeDrawerItem.lastError && <section><h3>Sync attempt details</h3><p>{activeDrawerItem.lastError}</p><dl>
            {activeDrawerItem.lastErrorCode && <div><dt>Error code</dt><dd>{activeDrawerItem.lastErrorCode}</dd></div>}
            {(activeDrawerItem.attempts || activeDrawerItem.retryCount) > 0 && <div><dt>Attempts</dt><dd>{Number(activeDrawerItem.attempts || activeDrawerItem.retryCount).toLocaleString()}</dd></div>}
            {activeDrawerItem.lastAttemptAt && <div><dt>Last attempt</dt><dd>{formatDateLabel(activeDrawerItem.lastAttemptAt)}</dd></div>}
            {activeDrawerItem.nextRetryAt && <div><dt>Next retry</dt><dd>{formatDateLabel(activeDrawerItem.nextRetryAt)}</dd></div>}
            {activeDrawerItem.status === 'BLOCKED' && <div><dt>Waiting for</dt><dd>Resident registration</dd></div>}
          </dl></section>}
          <section><p>{activeDrawerItem.status === 'SYNCED'
            ? 'Synced successfully. HealthSync confirmed this change was saved.'
            : activeDrawerItem.status === 'CONFLICT'
              ? 'HealthSync could not confirm whether this change was saved. Check the record before trying again.'
              : activeDrawerItem.status === 'FAILED'
                ? 'This change needs attention. Correct the saved details before retrying.'
                : activeDrawerItem.status === 'BLOCKED'
                  ? 'This change is waiting for its resident registration to sync.'
                  : 'This change is saved on this device. It will synchronize when a connection is available.'}</p></section>
          {activeDrawerItem.status === 'CONFLICT' && activeDrawerItem.lastErrorCode !== 'IDEMPOTENCY_OUTCOME_UNKNOWN' &&
            <section aria-label="Conflict resolution">
              <h3>Resolve conflict</h3>
              <p>Choose which version to keep. This server implementation does not provide a record version field, so the selected version uses last-write-wins policy.</p>
              <div className="sync-row-actions">
                <button type="button" className="sync-secondary-button" onClick={() => resolveConflict(activeDrawerItem, 'server')}>Keep server version</button>
                <button type="button" className="sync-primary-button" onClick={() => resolveConflict(activeDrawerItem, 'mine')} disabled={syncState.syncing}>Keep my version</button>
              </div>
            </section>}
        </div>
        <footer>
          <button className="sync-secondary-button" onClick={closeDrawer}>Close</button>
          {(['PENDING', 'FAILED', 'BLOCKED'].includes(activeDrawerItem.status) ||
            (activeDrawerItem.status === 'CONFLICT' && activeDrawerItem.lastErrorCode === 'IDEMPOTENCY_OUTCOME_UNKNOWN')) &&
            <button className="sync-primary-button" disabled={syncState.syncing} onClick={() => retryItem(activeDrawerItem)}><RotateCcw size={16} aria-hidden="true" /> Retry</button>}
          {!['SYNCED', 'CONFLICT'].includes(activeDrawerItem.status) && <button className="sync-danger-button" onClick={async () => {
            setDiscardConfirmed(false);
            setDiscardItem(activeDrawerItem);
            try {
              const dependents = await offlineQueue.getDependentOperations(activeDrawerItem.offlineOperationId);
              setDiscardDependents(dependents);
            } catch {
              setDiscardDependents([]);
            }
          }}>Discard</button>}
        </footer>
      </aside>
    </>}
    {activeDiscardItem && <div className="sync-modal-backdrop" role="presentation">
      <div className="sync-modal" role="dialog" aria-modal="true" aria-labelledby="discard-title">
        <h2 id="discard-title">{activeDiscardItem.status === 'CONFLICT' ? 'This change needs attention' : 'Discard this queued change?'}</h2>
        <p>{activeDiscardItem.status === 'CONFLICT'
          ? 'The server outcome is unknown. This change cannot be safely discarded until the server result is verified.'
          : discardDependents.length
            ? `This resident is waiting to sync and has ${discardDependents.length} dependent change${discardDependents.length === 1 ? '' : 's'} on this device. Discarding it will also safely remove those unsent dependents.`
            : 'This change has not been sent to the server. Deleting it will permanently discard this data.'}</p>
        {!['SYNCED', 'CONFLICT'].includes(activeDiscardItem.status) && <label className="sync-confirm-check">
          <input type="checkbox" checked={discardConfirmed} onChange={(event) => setDiscardConfirmed(event.target.checked)} />
          <span>I understand this cannot be undone</span>
        </label>}
        <div>
          <button className="sync-secondary-button" onClick={() => {
            setDiscardItem(null);
            setDiscardConfirmed(false);
            setDiscardDependents([]);
          }}>Close</button>
          {!['SYNCED', 'CONFLICT'].includes(activeDiscardItem.status) &&
            <button className="sync-danger-button" disabled={!discardConfirmed} onClick={discard}>Discard change</button>}
        </div>
      </div>
    </div>}
  </main>;
}
