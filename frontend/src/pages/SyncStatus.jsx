import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api/apiClient';
import offlineQueue from '../services/offline/offlineQueueService';
import syncManager from '../services/offline/syncManager';
import {
  downloadOfflineData,
  getActiveResidentSnapshot,
  getOfflineSnapshotReadiness,
} from '../services/offline/offlineDataDownloadService';
import useSyncStatus from '../services/offline/useSyncStatus';
import { formatDateLabel } from '../utils/dateUtils';
import './SyncStatus.css';

const statusLabel = { PENDING: 'Waiting to sync', SYNCING: 'Syncing', FAILED: 'Failed', SYNCED: 'Synced', CONFLICT: 'Outcome Unknown' };
const typeLabels = { residents: 'Residents', health_records: 'Clinical records', child_health: 'Child health', operation_timbang: 'Nutrition', adolescent_bmi: 'Nutrition', adult_bmi: 'Nutrition', senior_citizens: 'Senior registry' };

function Icon({ name, size = 18 }) { const paths = { sync:'M20 7h-5V2M4 17h5v5M6 6a8 8 0 0 1 13.66-1L20 7M4 17l-.66 2A8 8 0 0 0 18 20', online:'M5 12h14M12 5v14', refresh:'M20 7v5h-5M4 17v-5h5M6.2 8A7 7 0 0 1 18 6l2 1M18 16a7 7 0 0 1-11.8 2L4 17', search:'M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15', more:'M12 8v.01M12 12v.01M12 16v.01', close:'M6 6l12 12M18 6L6 18', check:'M20 6L9 17l-5-5', warning:'M12 9v4M12 17h.01M10.3 3.6 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z' }; return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] || paths.online} /></svg>; }

function relativeTime(value) { if (!value) return 'Unknown'; const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); if (minutes < 1) return 'Just now'; if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`; const days = Math.floor(hours / 24); return `${days} day${days === 1 ? '' : 's'} ago`; }

function friendlySummary(item) { const payload = item.payload || {}; const name = [payload.last_name, payload.first_name].filter(Boolean).join(', ') || payload.name || payload.full_name; if (item.operation === 'CREATE') return name ? `Added ${item.table === 'residents' ? 'resident: ' : ''}${name}` : `Create on ${item.table || 'records'}`; if (item.operation === 'UPDATE') return name ? `Updated ${item.table === 'residents' ? 'resident: ' : 'record for '}${name}` : `Update on ${item.table || 'records'}`; if (item.operation === 'DELETE') return name ? `Deleted ${item.table === 'residents' ? 'resident: ' : 'record for '}${name}` : `Delete on ${item.table || 'records'}`; return `${item.operation || 'Change'} on ${item.table || 'records'}`; }

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
  const [sort, setSort] = useState(searchParams.get('sort') || 'newest');
  const [page, setPage] = useState(Number(searchParams.get('page') || 1));
  const [pageSize, setPageSize] = useState(Number(searchParams.get('pageSize') || 10));
  const [drawerId, setDrawerId] = useState(searchParams.get('item') || location.state?.queuedOperationId || null);
  const [discardItem, setDiscardItem] = useState(null);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [toast, setToast] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [offlineCacheError, setOfflineCacheError] = useState('');
  const [autoSyncError, setAutoSyncError] = useState('');
  const [serverActivity, setServerActivity] = useState([]);
  const [serverActivityError, setServerActivityError] = useState('');
  const drawerRef = useRef(null);
  const rowRefs = useRef({});

  useEffect(() => { const timer = setTimeout(() => setSearch(searchParams.get('search') || ''), 300); return () => clearTimeout(timer); }, [searchParams]);
  useEffect(() => { const next = new URLSearchParams(); if (search) next.set('search', search); if (statusFilter !== 'All') next.set('status', statusFilter); if (typeFilter !== 'All') next.set('type', typeFilter); if (operationFilter !== 'All') next.set('operation', operationFilter); if (sort !== 'newest') next.set('sort', sort); if (page !== 1) next.set('page', String(page)); if (pageSize !== 10) next.set('pageSize', String(pageSize)); if (drawerId) next.set('item', drawerId); setSearchParams(next, { replace: true }); }, [search, statusFilter, typeFilter, operationFilter, sort, page, pageSize, drawerId, setSearchParams]);
  useEffect(() => { const onComplete = (event) => { const detail = event.detail || {}; setToast(detail.synced ? `${detail.synced} change${detail.synced === 1 ? '' : 's'} synced` : 'Sync attempt finished'); }; window.addEventListener('healthsync:sync-complete', onComplete); return () => window.removeEventListener('healthsync:sync-complete', onComplete); }, []);
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
        if (active) setDownloadError(error.message || 'Offline snapshot status could not be loaded.');
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
    if (user?.role !== 'bhw' || !syncState.online) {
      if (user?.role !== 'bhw') setServerActivity([]);
      return undefined;
    }
    let active = true;
    api.get('/sync/activity')
      .then((response) => {
        if (active) {
          setServerActivity(response.data?.data?.items || []);
          setServerActivityError('');
        }
      })
      .catch((error) => {
        if (active) setServerActivityError(error.response?.data?.message || 'Shared sync activity is unavailable.');
      });
    return () => { active = false; };
  }, [syncState.online, user?.role]);
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
      setDownloadError(error.message || 'Offline data could not be downloaded. The previous snapshot is unchanged.');
    } finally {
      setDownloading(false);
    }
  }
  async function syncNow() {
    if (!syncState.online || syncState.pending === 0) return;
    syncState.setSyncing(true);
    try {
      await syncManager.runSync();
      setAutoSyncError('');
    } catch (error) {
      setAutoSyncError(error.message || 'Saved changes could not be synchronized.');
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
  function clearFilters() { setSearch(''); setStatusFilter('All'); setTypeFilter('All'); setOperationFilter('All'); setSort('newest'); setPage(1); }

  const filtered = useMemo(() => { const query = search.trim().toLowerCase(); let result = syncState.items.filter((item) => { const summary = friendlySummary(item).toLowerCase(); const matchesSearch = !query || summary.includes(query) || String(item.table || '').toLowerCase().includes(query) || String(item.operation || '').toLowerCase().includes(query) || String(item.module || '').toLowerCase().includes(query); const matchesStatus = statusFilter === 'All' || (statusFilter === 'Outcome Unknown' ? item.status === 'CONFLICT' : String(item.status) === statusFilter.toUpperCase()); const matchesType = typeFilter === 'All' || (typeLabels[item.table] || item.table) === typeFilter; const matchesOperation = operationFilter === 'All' || String(item.operation).toUpperCase() === operationFilter.toUpperCase(); return matchesSearch && matchesStatus && matchesType && matchesOperation; }); result.sort((a, b) => sort === 'oldest' ? new Date(a.createdAt) - new Date(b.createdAt) : sort === 'failed' ? (a.status === 'FAILED' ? -1 : b.status === 'FAILED' ? 1 : new Date(b.createdAt) - new Date(a.createdAt)) : new Date(b.createdAt) - new Date(a.createdAt)); return result; }, [syncState.items, search, statusFilter, typeFilter, operationFilter, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); const safePage = Math.min(page, totalPages); const visibleItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const activeDrawerItem = syncState.items.find((item) => item.offlineOperationId === drawerId);
  const activeDiscardItem = discardItem && (syncState.items.find((item) => item.offlineOperationId === discardItem.offlineOperationId) || discardItem);
  const oldestWaiting = syncState.items.filter((item) => item.status !== 'SYNCED').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
  const oldestWarning = oldestWaiting && (Date.now() - new Date(oldestWaiting.createdAt).getTime()) > 2 * 86400000;
  const heroMode = syncState.error ? 'locked' : syncState.syncing ? 'syncing' : !syncState.online ? 'offline' : syncState.failed ? 'failed' : syncState.conflicts ? 'conflict' : syncState.waiting ? 'pending' : 'synced';
  const heroCopy = {
    synced: ['All changes are synced', syncState.lastSynced ? `Last synced ${relativeTime(syncState.lastSynced)}` : 'No queued changes'],
    locked: ['Private offline queue is locked', 'Unlock offline access for this account to check its saved changes.'],
    pending: [`${syncState.waiting} change${syncState.waiting === 1 ? '' : 's'} waiting to sync`, 'Your work is saved and ready to send.'],
    failed: [`${syncState.failed} change${syncState.failed === 1 ? '' : 's'} failed to sync`, 'Review the item below and retry it when the details are corrected.'],
    conflict: [`${syncState.conflicts} change${syncState.conflicts === 1 ? '' : 's'} have an unknown outcome`, 'The request may have reached the server. Verify whether the record was saved before taking further action.'],
    offline: ['You are offline. Your work is safe on this device.', `${syncState.waiting} saved change${syncState.waiting === 1 ? '' : 's'} will sync when the connection returns.`],
    syncing: ['Sending saved changes', `${syncState.waiting} item${syncState.waiting === 1 ? '' : 's'} remaining`],
  };
  const snapshotReadiness = getOfflineSnapshotReadiness(snapshot);
  const downloadDataset = downloadProgress?.phase === 'nutrition'
    ? `${downloadProgress.recordType} records`
    : getDownloadDataset(downloadProgress?.phase);

  return <main className="sync-status-page">
    <header className="sync-page-header"><div><p className="sync-eyebrow">System</p><h1>Sync status</h1><p>Changes made offline are saved on this device and sent to the server when you are online.</p></div><div className={`sync-connection ${syncState.online ? 'online' : 'offline'}`}><span aria-hidden="true" />{syncState.online ? 'Online' : 'Offline'}</div></header>
    {syncState.error && <div className="sync-locked-notice" role="alert">
      <div><strong>Offline queue unavailable</strong><p>{syncState.error} {offlineVaultMigrationRequired
        ? 'This older encrypted vault needs its existing six-digit PIN once. Its queued changes are preserved.'
        : 'The encrypted queue remains on this device and has not been counted as synchronized.'}</p></div>
    </div>}
    {offlineCacheError && <div className="sync-toast" role="alert">{offlineCacheError}</div>}
    {autoSyncError && <div className="sync-toast" role="alert">{autoSyncError}</div>}
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
      {downloadError && <p className="sync-offline-error" role="alert">{downloadError}</p>}
    </section>}
    {user?.role === 'bhw' && <section className="sync-team-activity" aria-label="Server-confirmed sync activity">
      <header><div><h2>Server-confirmed activity</h2><p>Recent changes received by HealthSync from authorized BHW accounts.</p></div></header>
      {serverActivityError && <p className="sync-offline-error" role="alert">{serverActivityError}</p>}
      {!serverActivityError && serverActivity.length === 0 && <p className="sync-activity-empty">No confirmed sync activity is available yet.</p>}
      {serverActivity.length > 0 && <ul>{serverActivity.map((item) => <li key={`${item.table_name}-${item.server_record_id}-${item.created_at}`}>
        <div><strong>{item.table_name === 'adult_bmi_records' ? 'Adult BMI record' : (item.table_name || 'Record').replaceAll('_', ' ')}</strong><span>Synced by {item.actor_name || 'a BHW'} · {relativeTime(item.created_at)}</span></div>
        {item.table_name === 'adult_bmi_records' && <Link to="/nutrition?type=Adult%20BMI">Open nutrition records</Link>}
      </li>)}</ul>}
    </section>}
    <section className="sync-stats" aria-label="Sync queue summary"><button className={statusFilter === 'Pending' ? 'selected' : ''} onClick={() => setStatusFilter(statusFilter === 'Pending' ? 'All' : 'Pending')}><span>Pending</span><strong>{syncState.pending}</strong></button><button className={statusFilter === 'Syncing' ? 'selected' : ''} onClick={() => setStatusFilter(statusFilter === 'Syncing' ? 'All' : 'Syncing')}><span>Syncing</span><strong>{syncState.syncingCount}</strong></button><button className={statusFilter === 'Failed' ? 'selected' : ''} onClick={() => setStatusFilter(statusFilter === 'Failed' ? 'All' : 'Failed')}><span>Failed</span><strong>{syncState.failed}</strong></button><button className={statusFilter === 'Synced' ? 'selected' : ''} onClick={() => setStatusFilter(statusFilter === 'Synced' ? 'All' : 'Synced')}><span>Synced today</span><strong>{syncState.syncedToday}</strong></button>{syncState.conflicts > 0 && <button className={statusFilter === 'Outcome Unknown' ? 'selected' : ''} onClick={() => setStatusFilter(statusFilter === 'Outcome Unknown' ? 'All' : 'Outcome Unknown')}><span>Outcome Unknown</span><strong>{syncState.conflicts}</strong></button>}</section>
    {oldestWarning && <div className="sync-old-warning"><Icon name="warning"/><span><strong>Oldest waiting item: {relativeTime(oldestWaiting.createdAt)}</strong> It has been waiting longer than 2 days.</span></div>}
    <section className="sync-list-card">
      <div className="sync-toolbar"><label className="sync-search"><Icon name="search"/><span className="sr-only">Search sync queue</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search resident, table, or record type" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button>}</label><div className="sync-selects"><select aria-label="Type filter" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}><option>All</option><option>Residents</option><option>Clinical records</option><option>Child health</option><option>Nutrition</option><option>Senior registry</option></select><select aria-label="Operation filter" value={operationFilter} onChange={(event) => { setOperationFilter(event.target.value); setPage(1); }}><option>All</option><option>Create</option><option>Update</option><option>Delete</option></select><select aria-label="Sort queue" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="failed">Failed first</option></select></div></div>
      <div className="sync-filter-row"><div className="sync-status-chips" role="group" aria-label="Status filters">{['All','Pending','Syncing','Failed','Synced','Outcome Unknown'].map((value) => <button key={value} className={statusFilter === value ? 'active' : ''} onClick={() => { setStatusFilter(value); setPage(1); }}>{value}</button>)}</div><span className="sync-result-count" aria-live="polite">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>{(search || statusFilter !== 'All' || typeFilter !== 'All' || operationFilter !== 'All') && <button className="sync-clear" onClick={clearFilters}>Clear all</button>}</div>
      {!syncState.loaded ? <div className="sync-skeletons" aria-label="Loading sync queue">{[1,2,3].map(i => <span key={i}/>)}</div> : !filtered.length ? <div className="sync-empty"><div><Icon name={syncState.items.length ? 'search' : 'check'} size={28}/></div><strong>{syncState.error ? 'Offline queue unavailable' : syncState.items.length ? 'No matching changes' : 'Everything is synced'}</strong><p>{syncState.error ? 'Unlock offline access for this account to see its local changes. They remain encrypted on this device.' : syncState.items.length ? 'Try clearing the filters.' : 'There are no saved changes waiting on this device.'}</p>{syncState.items.length > 0 && <button className="sync-secondary-button" onClick={clearFilters}>Clear filters</button>}</div> : <><div className="sync-table-wrap"><table className="sync-table"><thead><tr><th scope="col">Change</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Attempts / last error</th><th scope="col">Actions</th></tr></thead><tbody>{visibleItems.map((item) => { const status = String(item.status || 'PENDING'); return <tr key={item.offlineOperationId} tabIndex={0} ref={(node) => { rowRefs.current[item.offlineOperationId] = node; }} onClick={() => setDrawerId(item.offlineOperationId)}><td><button className="sync-change-link" onClick={(event) => { event.stopPropagation(); setDrawerId(item.offlineOperationId); }}>{friendlySummary(item)}</button></td><td><span className="sync-type-badge">{typeLabels[item.table] || item.table || 'Record'}</span></td><td><span className={`sync-status-badge status-${status.toLowerCase()}`}><span aria-hidden="true">{status === 'SYNCED' ? '✓' : status === 'FAILED' ? '!' : status === 'SYNCING' ? '↻' : '○'}</span>{statusLabel[status] || status}</span></td><td><time title={new Date(item.createdAt).toLocaleString()} dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time></td><td><div className="sync-error"><span>{item.retryCount || 0} attempt{item.retryCount === 1 ? '' : 's'}</span>{item.lastError && <small title={item.lastError}>• {item.lastError}</small>}</div></td><td><div className="sync-row-actions">{status !== 'SYNCED' && <button type="button" className="sync-details-button" onClick={(event) => { event.stopPropagation(); retryItem(item); }} disabled={!syncState.online}>Retry</button>}<button type="button" className="sync-icon-button" aria-label={`Details for ${friendlySummary(item)}`} onClick={(event) => { event.stopPropagation(); setDrawerId(item.offlineOperationId); }}>⋯</button></div></td></tr> })}</tbody></table></div><div className="sync-mobile-list">{visibleItems.map((item) => <article className="sync-mobile-card" key={item.offlineOperationId} ref={(node) => { rowRefs.current[item.offlineOperationId] = node; }} tabIndex={0} onClick={() => setDrawerId(item.offlineOperationId)}><div><strong>{friendlySummary(item)}</strong><button type="button" aria-label="More actions" onClick={(event) => { event.stopPropagation(); setDrawerId(item.offlineOperationId); }}>⋯</button></div><span className="sync-type-badge">{typeLabels[item.table] || item.table}</span><span className={`sync-status-badge status-${String(item.status).toLowerCase()}`}>{statusLabel[item.status] || item.status}</span><time>{relativeTime(item.createdAt)}</time></article>)}</div><footer className="sync-pagination"><span>Showing {filtered.length ? (safePage - 1) * pageSize + 1 : 0}-{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}</span><label>Rows<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>10</option><option>25</option><option>50</option></select></label><div>{safePage > 1 && <button onClick={() => setPage(safePage - 1)}>Previous</button>}<span>Page {safePage} of {totalPages}</span>{safePage < totalPages && <button onClick={() => setPage(safePage + 1)}>Next</button>}</div></footer></>}
    </section>
    {activeDiscardItem && <div className="sync-modal-backdrop" role="presentation"><div className="sync-modal" role="dialog" aria-modal="true" aria-labelledby="discard-title"><h2 id="discard-title">{activeDiscardItem.status === 'SYNCED' ? 'This change has already synced' : activeDiscardItem.status === 'CONFLICT' ? 'This change needs attention' : 'Discard this queued change?'}</h2><p>{activeDiscardItem.status === 'SYNCED' ? 'This change was sent to the server and is saved. It cannot be discarded from Sync Status.' : activeDiscardItem.status === 'CONFLICT' ? 'The server outcome is unknown. This change cannot be safely retried or discarded until the server result is verified.' : 'This change has not been sent to the server. Deleting it will permanently discard this data.'}</p>{!['SYNCED', 'CONFLICT'].includes(activeDiscardItem.status) && <label className="sync-confirm-check"><input type="checkbox" checked={discardConfirmed} onChange={(event) => setDiscardConfirmed(event.target.checked)} /> I understand this cannot be undone</label>}<div><button className="sync-secondary-button" onClick={() => { setDiscardItem(null); setDiscardConfirmed(false); }}>Close</button>{!['SYNCED', 'CONFLICT'].includes(activeDiscardItem.status) && <button className="sync-danger-button" disabled={!discardConfirmed} onClick={discard}>Discard change</button>}</div></div></div>}
    {activeDrawerItem && <><div className="sync-drawer-backdrop" onClick={closeDrawer}/><aside className="sync-drawer" role="dialog" aria-modal="true" aria-label="Sync change details" ref={drawerRef} tabIndex={-1}><header><div><p>Queued change</p><h2>{friendlySummary(activeDrawerItem)}</h2></div><button className="sync-icon-button" onClick={closeDrawer} aria-label="Close details"><Icon name="close"/></button></header><div className="sync-drawer-body"><section><span>Status</span><strong className={`sync-status-badge status-${String(activeDrawerItem.status).toLowerCase()}`}>{statusLabel[activeDrawerItem.status] || activeDrawerItem.status}</strong></section><section><h3>Timeline</h3><dl><div><dt>Created</dt><dd>{formatDateLabel(activeDrawerItem.createdAt)} · {relativeTime(activeDrawerItem.createdAt)}</dd></div><div><dt>Last attempt</dt><dd>{activeDrawerItem.retryCount ? relativeTime(activeDrawerItem.updatedAt || activeDrawerItem.createdAt) : 'Not attempted'}</dd></div><div><dt>Synced</dt><dd>{activeDrawerItem.syncedAt ? relativeTime(activeDrawerItem.syncedAt) : 'Not yet'}</dd></div></dl></section><section><h3>Error</h3><p>{activeDrawerItem.lastError || 'No errors recorded.'}</p>{activeDrawerItem.lastError && <small>Check the highlighted data and retry the change.</small>}</section><section><div className="sync-payload-heading"><h3>Payload</h3><button className="sync-secondary-button" onClick={() => setShowPayload((value) => !value)}>{showPayload ? 'Hide' : 'Show'} sensitive values</button></div><dl>{Object.entries(showPayload ? activeDrawerItem.payload || {} : Object.fromEntries(Object.entries(activeDrawerItem.payload || {}).map(([key, value]) => [/contact|phone|birth/i.test(key) ? key : key, /contact|phone|birth/i.test(key) ? '••••••••' : value]))).map(([key,value]) => <div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</dd></div>)}</dl></section><section><button className="sync-secondary-button" onClick={async () => { await navigator.clipboard?.writeText(JSON.stringify(activeDrawerItem, null, 2)); setToast('Technical details copied'); }}>Copy technical details</button><details><summary>Raw JSON</summary><pre>{JSON.stringify(activeDrawerItem, null, 2)}</pre></details></section><section><h3>Technical ID</h3><code>{activeDrawerItem.offlineOperationId}</code></section></div><footer><button className="sync-secondary-button" onClick={closeDrawer}>Close</button>{activeDrawerItem.status !== 'SYNCED' && <button className="sync-primary-button" disabled={!syncState.online} onClick={() => retryItem(activeDrawerItem)}>Retry</button>}{activeDrawerItem.status !== 'SYNCED' && <button className="sync-danger-button" onClick={() => { setDiscardConfirmed(false); setDiscardItem(activeDrawerItem); }}>Discard</button>}</footer></aside></>}
  </main>;
}
