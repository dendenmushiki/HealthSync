import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
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
import { formatDateLabel } from '../utils/dateUtils';
import StatusBanner from '../components/common/StatusBanner';
import Pagination from '../components/common/Pagination';
import './SyncStatus.css';

const statusLabel = { PENDING: 'Waiting to sync', SYNCING: 'Syncing', FAILED: 'Needs attention', SYNCED: 'Synced successfully', CONFLICT: 'Needs checking' };
const typeLabels = { residents: 'Resident registration', health_records: 'Clinical record', child_health: 'Child health record', child_health_records: 'Child health record', operation_timbang: 'Operation Timbang', operation_timbang_assessments: 'Operation Timbang assessment', adolescent_bmi: 'Adolescent BMI', adolescent_bmi_records: 'Adolescent BMI', adult_bmi: 'Adult BMI', adult_bmi_records: 'Adult BMI', senior_citizens: 'Senior citizen registration', senior_citizen_records: 'Senior citizen registration', patient_clinical_records: 'Clinical record', child_records: 'Child health record', maternal_records: 'Maternal record', immunization_records: 'Immunization record' };
const typeFilters = { residents: 'Residents', health_records: 'Clinical records', child_health: 'Child health', child_health_records: 'Child health', operation_timbang: 'Nutrition', operation_timbang_assessments: 'Nutrition', adolescent_bmi: 'Nutrition', adolescent_bmi_records: 'Nutrition', adult_bmi: 'Nutrition', adult_bmi_records: 'Nutrition', senior_citizens: 'Senior registry', senior_citizen_records: 'Senior registry', patient_clinical_records: 'Clinical records', child_records: 'Clinical records', maternal_records: 'Clinical records', immunization_records: 'Clinical records' };
const recordTypeLabels = { clinical: 'Clinical record', child: 'Child health record', maternal: 'Maternal record', immunization: 'Immunization record' };

function Icon({ name, size = 18 }) { const paths = { sync:'M20 7h-5V2M4 17h5v5M6 6a8 8 0 0 1 13.66-1L20 7M4 17l-.66 2A8 8 0 0 0 18 20', online:'M5 12h14M12 5v14', refresh:'M20 7v5h-5M4 17v-5h5M6.2 8A7 7 0 0 1 18 6l2 1M18 16a7 7 0 0 1-11.8 2L4 17', search:'M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15', more:'M12 8v.01M12 12v.01M12 16v.01', close:'M6 6l12 12M18 6L6 18', check:'M20 6L9 17l-5-5', warning:'M12 9v4M12 17h.01M10.3 3.6 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z' }; return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] || paths.online} /></svg>; }

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
  if (value === null || value === undefined || value === '') return '—';
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
      : '—';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length
      ? <dl className="sync-record-detail-list">{entries.map(([key, entry]) => <div key={key}><dt>{detailLabel(key)}</dt><dd>{renderRecordDetailValue(entry)}</dd></div>)}</dl>
      : '—';
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

function getSnapshotStatus(readiness) {
  return {
    complete: 'Ready',
    outdated: 'Needs refresh',
    incomplete: 'Incomplete',
    unavailable: 'Not downloaded',
  }[readiness] || 'Unavailable';
}

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
  const [toast, setToast] = useState(null);
  const [sharedSyncedHistory, setSharedSyncedHistory] = useState([]);
  const [sharedHistoryLoading, setSharedHistoryLoading] = useState(false);
  const [sharedHistoryError, setSharedHistoryError] = useState('');
  const [syncedRecordDetails, setSyncedRecordDetails] = useState(null);
  const [syncedDetailsLoading, setSyncedDetailsLoading] = useState(false);
  const [syncedDetailsError, setSyncedDetailsError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [offlineCacheError, setOfflineCacheError] = useState('');
  const [autoSyncError, setAutoSyncError] = useState('');
  const drawerRef = useRef(null);
  const rowRefs = useRef({});

  useEffect(() => { const timer = setTimeout(() => setSearch(searchParams.get('search') || ''), 300); return () => clearTimeout(timer); }, [searchParams]);
  useEffect(() => { const next = new URLSearchParams(); if (search) next.set('search', search); if (statusFilter !== 'All') next.set('status', statusFilter); if (typeFilter !== 'All') next.set('type', typeFilter); if (operationFilter !== 'All') next.set('operation', operationFilter); if (statusFilter === 'Synced' && historyScope !== 'all') next.set('historyScope', historyScope); if (sort !== 'newest') next.set('sort', sort); if (page !== 1) next.set('page', String(page)); if (pageSize !== 10) next.set('pageSize', String(pageSize)); setSearchParams(next, { replace: true }); }, [search, statusFilter, typeFilter, operationFilter, historyScope, sort, page, pageSize, setSearchParams]);
  useEffect(() => { const onComplete = (event) => { const detail = event.detail || {}; setToast(detail.synced ? `${detail.synced} change${detail.synced === 1 ? '' : 's'} synced` : 'Sync attempt finished'); }; window.addEventListener('healthsync:sync-complete', onComplete); return () => window.removeEventListener('healthsync:sync-complete', onComplete); }, []);
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
      return undefined;
    }
    let active = true;
    const loadSnapshot = async () => {
      try {
        const current = await getActiveResidentSnapshot();
        if (active) setSnapshot(current || null);
      } catch (error) {
        if (active) setDownloadError(error);
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
    const onCacheError = (event) => setOfflineCacheError(event.detail?.message || 'Resident data could not be secured for offline use.');
    const onAutoSyncError = (event) => setAutoSyncError(event.detail?.message || 'Saved changes could not be synchronized.');
    const onSyncComplete = (event) => {
      if (!event.detail?.failed) setAutoSyncError('');
    };
    window.addEventListener('healthsync:offline-cache-error', onCacheError);
    window.addEventListener('healthsync:auto-sync-error', onAutoSyncError);
    window.addEventListener('healthsync:sync-complete', onSyncComplete);
    return () => {
      window.removeEventListener('healthsync:offline-cache-error', onCacheError);
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
      const result = await downloadOfflineData(setDownloadProgress);
      setSnapshot(result);
      if (result.cleanupWarning) setDownloadError('The new offline data is ready, but older encrypted cache cleanup was incomplete.');
    } catch (error) {
      console.error('Unable to download offline data.', error);
      setDownloadError(error);
    } finally {
      setDownloading(false);
    }
  }
  async function syncNow() {
    if (!syncState.online || syncState.waiting === 0) return;
    syncState.setSyncing(true);
    try {
      await syncManager.runSync();
      setAutoSyncError('');
    } catch (error) {
      console.error('Unable to synchronize saved changes.', error);
      setAutoSyncError(error);
    } finally {
      syncState.setSyncing(false);
      await syncState.refresh();
    }
  }
  async function retryItem(item) {
    if (item.status === 'CONFLICT') {
      setToast('The server outcome is unknown. Verify whether this change was saved before retrying.');
      return;
    }
    if (!syncState.online || !['PENDING', 'FAILED'].includes(item.status)) return;
    await offlineQueue.updateOperationStatus(item.offlineOperationId, { status: 'PENDING', lastError: null });
    await syncNow();
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
    await offlineQueue.deleteOperation(discardItem.offlineOperationId);
    setDiscardItem(null);
    setDiscardConfirmed(false);
    if (drawerId === discardItem.offlineOperationId) closeDrawer();
    await syncState.refresh();
    setToast('Queued change discarded');
  }
  function clearFilters() { setSearch(''); setStatusFilter('All'); setTypeFilter('All'); setOperationFilter('All'); setHistoryScope('all'); setSort('newest'); setPage(1); }

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
  const heroMode = syncState.error ? 'locked' : syncState.syncing ? 'syncing' : !syncState.online ? 'offline' : syncState.failed ? 'failed' : syncState.conflicts ? 'conflict' : syncState.waiting ? 'pending' : 'synced';
  const heroCopy = {
    synced: ['All changes are synced', syncState.lastSynced ? `Last synced ${relativeTime(syncState.lastSynced)}` : 'No queued changes'],
    locked: ['Private offline queue is locked', 'Unlock offline access for this account to check its saved changes.'],
    pending: [`${syncState.waiting} change${syncState.waiting === 1 ? '' : 's'} waiting to sync`, 'Your work is saved and ready to send.'],
    failed: [`${syncState.failed} change${syncState.failed === 1 ? '' : 's'} failed to sync`, 'Review the item below and retry it when the details are corrected.'],
    conflict: [`${syncState.conflicts} change${syncState.conflicts === 1 ? '' : 's'} need checking`, 'HealthSync could not confirm whether every change was saved. Check the record before trying again.'],
    offline: ['You are offline. Your work is safe on this device.', `${syncState.waiting} saved change${syncState.waiting === 1 ? '' : 's'} will sync when the connection returns.`],
    syncing: ['Sending saved changes', `${syncState.waiting} item${syncState.waiting === 1 ? '' : 's'} remaining`],
  };
  const snapshotReadiness = getOfflineSnapshotReadiness(snapshot);
  const downloadDataset = downloadProgress?.phase === 'nutrition'
    ? `${downloadProgress.recordType} records`
    : getDownloadDataset(downloadProgress?.phase);

  return <main className="sync-status-page">
    {activeSyncedHistoryItem && <><div className="sync-drawer-backdrop" onClick={closeDrawer}/><aside className="sync-drawer" role="dialog" aria-modal="true" aria-label="Synced record details" ref={drawerRef} tabIndex={-1}>
      <header><div><p>Synced History</p><h2>{friendlySummary(activeSyncedHistoryItem)}</h2></div><button className="sync-icon-button" onClick={closeDrawer} aria-label="Close details"><Icon name="close"/></button></header>
      <div className="sync-drawer-body">
        <section><span>Status</span><strong className="sync-status-badge status-synced">Saved to server</strong></section>
        <section><h3>Synchronization details</h3><dl>
          <div><dt>Record type</dt><dd>{getRecordType(activeSyncedHistoryItem)}</dd></div>
          <div><dt>Change</dt><dd>{getSavedAction(activeSyncedHistoryItem)}</dd></div>
          <div><dt>Server record ID</dt><dd>{activeSyncedHistoryItem.server_record_id}</dd></div>
          <div><dt>Synced by</dt><dd>{activeSyncedHistoryItem.actor_name || 'BHW'}</dd></div>
          <div><dt>Synced at</dt><dd>{activeSyncedHistoryItem.created_at ? formatDateLabel(activeSyncedHistoryItem.created_at) : '—'}</dd></div>
        </dl></section>
        <section><h3>Saved record details</h3>
          {syncedDetailsLoading ? <p role="status">Loading saved record…</p>
            : syncedDetailsError ? <p role="alert">{syncedDetailsError}</p>
              : syncedRecordDetails?.record_details ? renderRecordDetailValue(syncedRecordDetails.record_details)
                : <p>This record is no longer available on the server.</p>}
        </section>
      </div>
      <footer><button className="sync-secondary-button" onClick={closeDrawer}>Close</button></footer>
    </aside></>}
    <header className="sync-page-header"><div><p className="sync-eyebrow">System</p><h1>Sync status</h1><p>Changes made offline are saved on this device and sent to the server when you are online.</p></div><div className={`sync-connection ${syncState.online ? 'online' : 'offline'}`}><span aria-hidden="true" />{syncState.online ? 'Online' : 'Offline'}</div></header>
    {syncState.error && <div className="sync-locked-notice" role="alert">
      <div><strong>Offline queue unavailable</strong><p>{syncState.error} {offlineVaultMigrationRequired
        ? 'This older encrypted vault needs its existing six-digit PIN once. Its queued changes are preserved.'
        : 'The encrypted queue remains on this device and has not been counted as synchronized.'}</p></div>
    </div>}
    {offlineCacheError && <StatusBanner error={offlineCacheError} compact />}
    {autoSyncError && <StatusBanner error={autoSyncError} compact />}
    {toast && <div className="sync-toast" role="status">{toast}<button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}
    <section className={`sync-hero sync-hero-${heroMode}`} aria-live="polite"><div className="sync-hero-icon"><Icon name={heroMode === 'synced' ? 'check' : ['failed', 'locked'].includes(heroMode) ? 'warning' : 'sync'} size={26}/></div><div className="sync-hero-copy"><strong>{heroCopy[heroMode][0]}</strong><span>{heroCopy[heroMode][1]}</span>{heroMode === 'syncing' && <div className="sync-progress" aria-label="Sync in progress"><span /></div>}</div><div className="sync-hero-actions"><button type="button" className="sync-primary-button" onClick={syncNow} disabled={!syncState.online || syncState.waiting === 0 || syncState.syncing}><Icon name="sync"/> {syncState.syncing ? 'Syncing…' : 'Sync now'}</button>{syncState.failed > 0 && <button type="button" className="sync-secondary-button" onClick={async () => { for (const item of syncState.items.filter(i => i.status === 'FAILED')) await offlineQueue.updateOperationStatus(item.offlineOperationId, { status:'PENDING', lastError:null }); await syncNow(); }}>Retry failed</button>}<button type="button" className="sync-icon-button" onClick={syncState.refresh} aria-label="Refresh sync queue"><Icon name="refresh"/></button></div></section>
    {user?.role === 'bhw' && <section className="sync-offline-card" aria-label="Offline data download">
      <div className="sync-offline-heading">
        <div><h2>Offline data</h2><p>Download an encrypted snapshot for this device.</p></div>
        <span className={`sync-offline-status ${snapshotReadiness === 'complete' ? 'ready' : ''}`} aria-live="polite">Snapshot: {getSnapshotStatus(snapshotReadiness)}</span>
      </div>
      <details className="sync-offline-datasets">
        <summary>What’s included in the download</summary>
        <ul>{offlineDatasets.map((dataset) => <li key={dataset}>{dataset}</li>)}</ul>
      </details>
      {snapshot && <div className="sync-offline-counts">
        <span>Residents: {snapshot.recordCount ?? '—'}</span>
        <span>Nutrition: {snapshot.nutritionRecordCount ?? '—'}</span>
        <span>Medical: {snapshot.medicalRecordCount ?? '—'}</span>
        <span>Legacy clinical: {snapshot.legacyClinicalRecordCount ?? '—'}</span>
        <span>Legacy child health: {snapshot.legacyChildRecordCount ?? '—'}</span>
        <span>Senior citizens: {snapshot.seniorCitizenRecordCount ?? '—'}</span>
        {snapshot.downloadedAt && <span>Updated {new Date(snapshot.downloadedAt).toLocaleString()}</span>}
      </div>}
      <div className="sync-offline-actions">
        <button type="button" className="sync-primary-button" onClick={downloadSnapshot} disabled={!syncState.online || !offlineVaultReady || downloading}>
          {downloading ? 'Downloading…' : snapshot ? 'Refresh offline data' : 'Download offline data'}
        </button>
        {!offlineVaultReady && <span>The encrypted queue and offline downloads are unavailable while this account’s vault is locked.</span>}
        {!syncState.online && <span>Reconnect to download or refresh this snapshot.</span>}
      </div>
      {downloading && downloadProgress && <div className="sync-offline-progress" role="status">
        Downloading {downloadDataset}: {downloadProgress.recordsDownloaded || 0}
        {downloadProgress.totalResidents === undefined && downloadProgress.totalRecords === undefined ? '' : ` of ${downloadProgress.totalRecords ?? downloadProgress.totalResidents}`}
        {downloadProgress.totalPages === undefined ? '' : ` · page ${downloadProgress.pagesCompleted} of ${downloadProgress.totalPages}`}
      </div>}
      {downloadError && <StatusBanner error={downloadError} retry={downloadSnapshot} retrying={downloading} compact />}
    </section>}
    <section className="sync-stats" aria-label="Sync queue summary"><button className={statusFilter === 'Pending' ? 'selected' : ''} onClick={() => setStatusFilter(statusFilter === 'Pending' ? 'All' : 'Pending')}><span>Pending</span><strong>{syncState.pending}</strong></button><button className={statusFilter === 'Syncing' ? 'selected' : ''} onClick={() => setStatusFilter(statusFilter === 'Syncing' ? 'All' : 'Syncing')}><span>Syncing</span><strong>{syncState.syncingCount}</strong></button><button className={statusFilter === 'Failed' ? 'selected' : ''} onClick={() => setStatusFilter(statusFilter === 'Failed' ? 'All' : 'Failed')}><span>Needs attention</span><strong>{syncState.failed + syncState.conflicts}</strong></button></section>
    {oldestWarning && <div className="sync-old-warning"><Icon name="warning"/><span><strong>Oldest waiting item: {relativeTime(oldestWaiting.createdAt)}</strong> It has been waiting longer than 2 days.</span></div>}
    <section className="sync-list-card">
      <div className="sync-toolbar"><label className="sync-search"><Icon name="search"/><span className="sr-only">Search saved changes</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={statusFilter === 'Synced' ? 'Search record type, ID or BHW' : 'Search resident or record type'} />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button>}</label><div className="sync-selects"><select aria-label="Type filter" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}><option>All</option><option>Residents</option><option>Clinical records</option><option>Child health</option><option>Nutrition</option><option>Senior registry</option></select><select aria-label="Operation filter" value={operationFilter} onChange={(event) => { setOperationFilter(event.target.value); setPage(1); }}><option>All</option><option>Create</option><option>Update</option><option>Delete</option></select><select aria-label="Sort queue" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="failed" disabled={statusFilter === 'Synced'}>Needs attention first</option></select>{statusFilter === 'Synced' && <select aria-label="Synced history account filter" value={historyScope} onChange={(event) => { setHistoryScope(event.target.value); setPage(1); if (drawerId?.startsWith('sync:')) setDrawerId(null); }}><option value="mine">My account</option><option value="all">All BHW accounts</option></select>}</div></div>
      <div className="sync-filter-row"><div className="sync-status-chips" role="group" aria-label="Status filters">{[['All', 'All'], ['Pending', 'Pending'], ['Syncing', 'Syncing'], ['Needs attention', 'Failed'], ['Needs checking', 'Outcome Unknown'], ['Synced', 'Synced']].map(([label, value]) => <button key={value} className={statusFilter === value ? 'active' : ''} aria-pressed={statusFilter === value} onClick={() => { setStatusFilter(value); setPage(1); if (value !== 'Synced' && drawerId?.startsWith('sync:')) setDrawerId(null); }}>{label}</button>)}</div><span className="sync-result-count" aria-live="polite">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>{(search || statusFilter !== 'All' || typeFilter !== 'All' || operationFilter !== 'All') && <button className="sync-clear" onClick={clearFilters}>Clear all</button>}</div>
      {statusFilter === 'Synced' && sharedHistoryError && sharedSyncedHistory.length > 0 && <p className="sync-activity-message sync-activity-error" role="alert">{sharedHistoryError}</p>}
      {(statusFilter === 'Synced' ? sharedHistoryLoading : !syncState.loaded) ? <div className="sync-skeletons" aria-label={statusFilter === 'Synced' ? 'Loading synced history' : 'Loading sync queue'}>{[1,2,3].map(i => <span key={i}/>)}</div> : !filtered.length ? <div className="sync-empty"><div><Icon name={filtered.length || (statusFilter === 'Synced' ? sharedSyncedHistory.length : queueItems.length) ? 'search' : 'check'} size={28}/></div><strong>{statusFilter === 'Synced' ? sharedHistoryError ? 'Synced history unavailable' : sharedSyncedHistory.length ? 'No matching synced records' : 'No synced records yet' : syncState.error ? 'Offline queue unavailable' : queueItems.length ? 'No matching changes' : 'No changes waiting to sync'}</strong><p>{statusFilter === 'Synced' ? sharedHistoryError || (sharedSyncedHistory.length ? 'Try adjusting the filters.' : historyScope === 'mine' ? 'No records from your account have completed synchronization.' : 'No BHW records have completed synchronization yet.') : syncState.error ? 'Unlock offline access for this account to see its local changes. They remain encrypted on this device.' : queueItems.length ? 'Try clearing the filters.' : 'Offline changes confirmed by HealthSync are listed in Synced History.'}</p>{(statusFilter === 'Synced' ? sharedSyncedHistory.length : queueItems.length) > 0 && <button className="sync-secondary-button" onClick={clearFilters}>Clear filters</button>}</div> : <><div className="sync-table-wrap"><table className="sync-table"><thead><tr><th scope="col">Change</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col">Actions</th></tr></thead><tbody>{visibleItems.map((item) => { const status = String(item.status || 'PENDING'); return <tr key={item.offlineOperationId} tabIndex={0} ref={(node) => { rowRefs.current[item.offlineOperationId] = node; }} onClick={() => setDrawerId(item.offlineOperationId)}><td><button className="sync-change-link" onClick={(event) => { event.stopPropagation(); setDrawerId(item.offlineOperationId); }}>{friendlySummary(item)}</button></td><td><span className="sync-type-badge">{getRecordType(item)}</span></td><td><span className={`sync-status-badge status-${status.toLowerCase()}`}>{statusLabel[status] || status}</span></td><td><time title={new Date(item.createdAt).toLocaleString()} dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time></td><td><div className="sync-row-actions">{['PENDING', 'FAILED'].includes(status) && <button type="button" className="sync-details-button" onClick={(event) => { event.stopPropagation(); retryItem(item); }} disabled={!syncState.online}>Retry</button>}<button type="button" className="sync-icon-button" aria-label={`Details for ${friendlySummary(item)}`} onClick={(event) => { event.stopPropagation(); setDrawerId(item.offlineOperationId); }}>⋯</button></div></td></tr> })}</tbody></table></div><div className="sync-mobile-list">{visibleItems.map((item) => <article className="sync-mobile-card" key={item.offlineOperationId} ref={(node) => { rowRefs.current[item.offlineOperationId] = node; }} tabIndex={0} onClick={() => setDrawerId(item.offlineOperationId)}><div><strong>{friendlySummary(item)}</strong><button type="button" aria-label="More actions" onClick={(event) => { event.stopPropagation(); setDrawerId(item.offlineOperationId); }}>⋯</button></div><span className="sync-type-badge">{getRecordType(item)}</span><span className={`sync-status-badge status-${String(item.status).toLowerCase()}`}>{statusLabel[item.status] || item.status}</span><time>{relativeTime(item.createdAt)}</time></article>)}</div><Pagination currentPage={safePage} totalPages={totalPages} first={filtered.length ? (safePage - 1) * pageSize + 1 : 0} last={Math.min(safePage * pageSize, filtered.length)} total={filtered.length} itemLabel="changes" pageSize={pageSize} pageSizeOptions={[10, 25, 50]} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} onPageChange={setPage} /></>}
    </section>
    {activeDiscardItem && <div className="sync-modal-backdrop" role="presentation"><div className="sync-modal" role="dialog" aria-modal="true" aria-labelledby="discard-title"><h2 id="discard-title">{activeDiscardItem.status === 'SYNCED' ? 'This change has already synced' : activeDiscardItem.status === 'CONFLICT' ? 'This change needs attention' : 'Discard this queued change?'}</h2><p>{activeDiscardItem.status === 'SYNCED' ? 'This change was sent to the server and is saved. It cannot be discarded from Sync Status.' : activeDiscardItem.status === 'CONFLICT' ? 'The server outcome is unknown. This change cannot be safely retried or discarded until the server result is verified.' : 'This change has not been sent to the server. Deleting it will permanently discard this data.'}</p>{!['SYNCED', 'CONFLICT'].includes(activeDiscardItem.status) && <label className="sync-confirm-check"><input type="checkbox" checked={discardConfirmed} onChange={(event) => setDiscardConfirmed(event.target.checked)} /> I understand this cannot be undone</label>}<div><button className="sync-secondary-button" onClick={() => { setDiscardItem(null); setDiscardConfirmed(false); }}>Close</button>{!['SYNCED', 'CONFLICT'].includes(activeDiscardItem.status) && <button className="sync-danger-button" disabled={!discardConfirmed} onClick={discard}>Discard change</button>}</div></div></div>}
    {activeDrawerItem && <><div className="sync-drawer-backdrop" onClick={closeDrawer}/><aside className="sync-drawer" role="dialog" aria-modal="true" aria-label="Saved change details" ref={drawerRef} tabIndex={-1}><header><div><p>{activeDrawerItem.status === 'SYNCED' ? 'Synced History' : 'Saved change'}</p><h2>{getResidentName(activeDrawerItem)}</h2></div><button className="sync-icon-button" onClick={closeDrawer} aria-label="Close details"><Icon name="close"/></button></header><div className="sync-drawer-body"><section><span>Status</span><strong className={`sync-status-badge status-${String(activeDrawerItem.status).toLowerCase()}`}>{statusLabel[activeDrawerItem.status] || 'Needs attention'}</strong></section><section><h3>Record details</h3><dl><div><dt>Record type</dt><dd>{getRecordType(activeDrawerItem)}</dd></div><div><dt>Change</dt><dd>{activeDrawerItem.operation === 'UPDATE' ? 'Updated' : activeDrawerItem.operation === 'DELETE' ? 'Removed' : 'New record'}</dd></div><div><dt>Created or updated</dt><dd>{formatDateLabel(activeDrawerItem.createdAt)}</dd></div>{activeDrawerItem.status === 'SYNCED' && <div><dt>Synced</dt><dd>{new Date(activeDrawerItem.syncedAt).toLocaleString()}</dd></div>}</dl></section><section><p>{activeDrawerItem.status === 'SYNCED' ? 'Synced successfully. HealthSync confirmed this change was saved.' : activeDrawerItem.status === 'CONFLICT' ? 'HealthSync could not confirm whether this change was saved. Check the record before trying again.' : activeDrawerItem.status === 'FAILED' ? 'This change could not be sent yet. Try again when you have a connection.' : 'This change is saved on this device. It will synchronize when a connection is available.'}</p></section></div><footer><button className="sync-secondary-button" onClick={closeDrawer}>Close</button>{['PENDING', 'FAILED'].includes(activeDrawerItem.status) && <button className="sync-primary-button" disabled={!syncState.online} onClick={() => retryItem(activeDrawerItem)}>Retry</button>}{!['SYNCED', 'CONFLICT'].includes(activeDrawerItem.status) && <button className="sync-danger-button" onClick={() => { setDiscardConfirmed(false); setDiscardItem(activeDrawerItem); }}>Discard</button>}</footer></aside></>}
  </main>;
}
