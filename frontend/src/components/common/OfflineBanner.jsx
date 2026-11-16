import React, { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import networkService from '../../services/offline/networkService';
import syncManager from '../../services/offline/syncManager';
import {
  downloadOfflineData,
  getActiveResidentSnapshot,
  getOfflineSnapshotReadiness,
} from '../../services/offline/offlineDataDownloadService';

const OfflineBanner = () => {
  const { user, offlineVaultError, offlineVaultReady } = useContext(AuthContext);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [cacheError, setCacheError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const showDownloadControl = user?.role === 'bhw';
  const offlineDataReadiness = getOfflineSnapshotReadiness(snapshot);

  useEffect(() => {
    if (!showDownloadControl) {
      setSnapshot(null);
      return undefined;
    }
    let active = true;
    const loadSnapshot = async () => {
      try {
        const current = await getActiveResidentSnapshot();
        if (active) setSnapshot(current || null);
      } catch {
        if (active) setSnapshot(null);
      }
    };
    const onDownloadUpdate = () => loadSnapshot();
    loadSnapshot();
    window.addEventListener('healthsync:offline-download-updated', onDownloadUpdate);
    return () => {
      active = false;
      window.removeEventListener('healthsync:offline-download-updated', onDownloadUpdate);
    };
  }, [showDownloadControl, user?.user_id]);

  useEffect(() => {
    networkService.startNetworkMonitor();
    const unsub = networkService.subscribe(({ online }) => setOnline(online));
    const onOnline = async () => {
      if (typeof indexedDB === 'undefined' || !offlineVaultReady) return;
      setSyncing(true);
      try {
        // Give the server and authentication state a moment to become ready before retrying.
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        await syncManager.runSync();
        setSyncError('');
      } catch {
        setSyncError('Saved changes are locked or unavailable. Unlock offline access before synchronizing.');
      } finally {
        setSyncing(false);
      }
    };
    const onCacheError = (event) => {
      setCacheError(event.detail?.message || 'Resident data could not be secured for offline use.');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('healthsync:offline-cache-error', onCacheError);
    if (navigator.onLine) onOnline();
    return () => {
      unsub();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('healthsync:offline-cache-error', onCacheError);
    };
  }, [offlineVaultReady]);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError('');
    setDownloadProgress({ phase: 'starting', recordsDownloaded: 0 });
    try {
      const result = await downloadOfflineData(setDownloadProgress);
      setSnapshot(result);
      if (result.cleanupWarning) {
        setDownloadError('Resident data is ready, but older encrypted cache cleanup was incomplete.');
      }
    } catch (error) {
      setDownloadError(error.message || 'Offline data could not be downloaded. Your previous snapshot is unchanged.');
    } finally {
      setDownloading(false);
    }
  };

  if (online && !offlineVaultError && !cacheError && !syncError && !showDownloadControl) return null;

  return (
    <div className="bg-warning text-dark p-2 text-center" role={offlineVaultError || cacheError || downloadError ? 'alert' : 'status'}>
      {!online && <>● Offline — Resident and health record changes are stored on this device and will synchronize when online.{syncing && <span> Syncing...</span>}</>}
      {offlineVaultError && <div>{offlineVaultError}</div>}
      {cacheError && <div>{cacheError}</div>}
      {syncError && <div>{syncError}</div>}
      {showDownloadControl && (
        <section aria-label="Offline data download">
          <strong>Offline data</strong>
          {!offlineVaultReady && (
            <div>
              Sign in online to prepare secure offline access, then download the data to this device before disconnecting.
              {' '}<Link to="/login">Sign in online</Link>
            </div>
          )}
          <div aria-live="polite"><strong>Readiness: {offlineDataReadiness}</strong>
            {offlineDataReadiness === 'incomplete' && ' Some required data sets are missing; download again before relying on offline data.'}
            {offlineDataReadiness === 'outdated' && ' This snapshot is older than 24 hours or has no valid download time; refresh it to reduce stale data.'}
            {offlineDataReadiness === 'unavailable' && ' No complete offline snapshot is available on this device.'}
            {offlineDataReadiness === 'complete' && ' All required offline data sets are available.'}
          </div>
          <div>
            {snapshot
              ? `Residents: ${snapshot.recordCount} · Last downloaded: ${new Date(snapshot.downloadedAt).toLocaleString()}`
              : 'Resident data has not been downloaded on this device.'}
          </div>
          {snapshot && (
            <div>
              Nutrition records: {snapshot.nutritionRecordCount ?? 'not downloaded'}
              {snapshot.nutritionDownloadedAt && ` · Last downloaded: ${new Date(snapshot.nutritionDownloadedAt).toLocaleString()}`}
            </div>
          )}
          {snapshot && <div>Clinical, child, maternal, and immunization records: {snapshot.medicalRecordCount ?? 'not downloaded'}</div>}
          {snapshot && (
            <div>
              Legacy clinical records: {snapshot.legacyClinicalRecordCount ?? 'not downloaded'} ·
              Legacy child records: {snapshot.legacyChildRecordCount ?? 'not downloaded'} ·
              Senior citizens: {snapshot.seniorCitizenRecordCount ?? 'not downloaded'}
            </div>
          )}
          {downloading && downloadProgress && (
            <div role="status">
              Downloading {downloadProgress.phase === 'nutrition'
                ? `${downloadProgress.recordType} records`
                : downloadProgress.phase === 'medical-records' || downloadProgress.phase === 'medical-records-starting'
                  ? 'medical records'
                  : downloadProgress.phase === 'nutrition-starting' ? 'nutrition records'
                    : downloadProgress.phase.startsWith('legacy-clinical') ? 'legacy clinical records'
                      : downloadProgress.phase.startsWith('legacy-child') ? 'legacy child records'
                        : downloadProgress.phase.startsWith('senior-citizens') ? 'senior citizen records' : 'residents'}
              : {downloadProgress.recordsDownloaded || 0}
              {downloadProgress.totalResidents === undefined && downloadProgress.totalRecords === undefined
                ? ''
                : ` of ${downloadProgress.totalRecords ?? downloadProgress.totalResidents}`}
              {downloadProgress.totalPages === undefined ? '' : ` · page ${downloadProgress.pagesCompleted} of ${downloadProgress.totalPages}`}
            </div>
          )}
          {downloadError && <div>{downloadError}</div>}
          <button type="button" className="btn btn-primary mt-1" onClick={handleDownload} disabled={!online || !offlineVaultReady || downloading}>
            {downloading ? 'Downloading…' : 'Download Offline Data'}
          </button>
          {!online && <div>Reconnect to download or refresh resident data.</div>}
        </section>
      )}
    </div>
  );
};

export default OfflineBanner;
