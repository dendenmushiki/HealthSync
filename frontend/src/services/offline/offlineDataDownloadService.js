import api from '../api/apiClient';
import {
  deleteOfflineRecords,
  getOfflineRecord,
  getOfflineRecords,
  getUnlockedOfflineVaultRole,
  putOfflineRecord,
} from './offlineVaultService';
import { getOfflineSession } from './offlineSessionService';

const RESIDENTS_PER_PAGE = 100;
const WRITE_BATCH_SIZE = 20;
const SNAPSHOT_METADATA_COLLECTION = 'offlineMetadata';
const ACTIVE_RESIDENTS_SNAPSHOT_KEY = 'activeResidentsSnapshot';
const ACTIVE_NUTRITION_SNAPSHOT_KEY = 'activeNutritionSnapshot';
const ACTIVE_OFFLINE_DATA_SNAPSHOT_KEY = 'activeOfflineDataSnapshot';
const RESIDENT_SNAPSHOT_PREFIX = 'residentSnapshot:';
const NUTRITION_SNAPSHOT_PREFIX = 'nutritionSnapshot:';
const MEDICAL_RECORDS_SNAPSHOT_PREFIX = 'medicalRecordsSnapshot:';
const LEGACY_CLINICAL_SNAPSHOT_PREFIX = 'legacyClinicalSnapshot:';
const LEGACY_CHILD_SNAPSHOT_PREFIX = 'legacyChildSnapshot:';
const SENIOR_CITIZENS_SNAPSHOT_PREFIX = 'seniorCitizensSnapshot:';
const NUTRITION_PAGE_SIZE = 100;
const MEDICAL_RECORDS_PAGE_SIZE = 100;
const LEGACY_RECORDS_PAGE_SIZE = 100;
const SENIOR_CITIZENS_PAGE_SIZE = 50;
const OFFLINE_DATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function getOfflineSnapshotReadiness(snapshot, now = Date.now()) {
  if (!snapshot) return 'unavailable';
  if (snapshot.status !== 'complete') return 'incomplete';
  const recordCounts = [
    snapshot.recordCount,
    snapshot.nutritionRecordCount,
    snapshot.medicalRecordCount,
    snapshot.legacyClinicalRecordCount,
    snapshot.legacyChildRecordCount,
    snapshot.seniorCitizenRecordCount,
  ];
  if (recordCounts.some((count) => !Number.isSafeInteger(count) || count < 0)) return 'incomplete';
  const downloadedAt = Date.parse(snapshot.downloadedAt);
  if (!Number.isFinite(downloadedAt) || now - downloadedAt > OFFLINE_DATA_MAX_AGE_MS) return 'outdated';
  return 'complete';
}

function getAuthorizedBhw() {
  let user;
  try {
    user = JSON.parse(localStorage.getItem('hs_user') || 'null');
  } catch {
    throw new Error('Offline data is unavailable for this account.');
  }
  const grant = getOfflineSession();
  if (!user?.user_id || user.role !== 'bhw' || user.must_change_password ||
      !localStorage.getItem('hs_token') || !grant ||
      String(grant.userId) !== String(user.user_id) || grant.role !== user.role ||
      getUnlockedOfflineVaultRole(user.user_id) !== user.role) {
    throw new Error('Unlock authorized BHW offline access before downloading data.');
  }
  return user;
}

function createSnapshotCollection() {
  return `${RESIDENT_SNAPSHOT_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function dispatchDownloadUpdate(detail) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('healthsync:offline-download-updated', { detail }));
  }
}

function validateResidentPage(response, requestedPage) {
  const body = response?.data;
  const result = body?.data;
  const pagination = result?.pagination;
  const items = result?.items;
  const totalPages = Number(pagination?.totalPages);
  const total = Number(pagination?.total ?? result?.total);
  if (body?.success !== true || !Array.isArray(items) ||
      !Number.isInteger(totalPages) || totalPages < 0 ||
      !Number.isInteger(total) || total < 0 ||
      (result.page !== undefined && Number(result.page) !== requestedPage) ||
      (totalPages === 0 && (total !== 0 || items.length !== 0)) ||
      (totalPages > 0 && total === 0)) {
    throw new Error('The server returned incomplete resident pagination data.');
  }
  return { items, total, totalPages };
}

function validateNutritionPage(response, requestedPage) {
  const body = response?.data;
  const result = body?.data;
  const items = result?.items;
  const total = Number(result?.total);
  const pageSize = Number(result?.limit);
  if (body?.success !== true || !Array.isArray(items) ||
      !Number.isInteger(total) || total < 0 ||
      pageSize !== NUTRITION_PAGE_SIZE ||
      (result.page !== undefined && Number(result.page) !== requestedPage) ||
      (total === 0 && items.length !== 0)) {
    throw new Error('The server returned incomplete nutrition pagination data.');
  }
  return { items, total, totalPages: Math.ceil(total / pageSize) };
}

function normalizeNutritionRecord(recordType, record) {
  if (recordType === 'Operation Timbang') {
    const indicators = [
      { code: 'WAZ', status: record.wfa_status || 'Normal' },
      { code: 'HAZ', status: record.hfa_status || 'Normal' },
      { code: 'WHZ', status: record.wflh_status || 'Normal' },
    ];
    const rank = {
      'Severely stunted': 7,
      'Severely wasted/SAM': 7,
      'Severely underweight': 7,
      'Moderately stunted': 6,
      'Moderately wasted/MAM': 6,
      'Moderately underweight': 6,
      Underweight: 5,
      Wasted: 5,
      Stunted: 5,
      Tall: 4,
      Overweight: 3,
      Obese: 3,
      Normal: 0,
    };
    indicators.sort((first, second) => (rank[second.status] || 1) - (rank[first.status] || 1));
    return {
      ...record,
      id: record.timbang_id,
      record_type: recordType,
      record_date: String(record.date_recorded || '').slice(0, 10),
      height_cm: record.measurement_cm,
      status: indicators[0].status,
      indicators,
    };
  }
  if (recordType === 'Adult BMI') {
    return {
      ...record,
      id: record.bmi_id,
      record_type: recordType,
      record_date: String(record.date_recorded || '').slice(0, 10),
      status: record.bmi_category,
      indicators: [],
    };
  }
  return {
    ...record,
    id: record.record_id,
    record_type: recordType,
    record_date: String(record.record_date || '').slice(0, 10),
    status: record.bmi_for_age_category,
    indicators: [],
  };
}

async function downloadNutritionSnapshot(user, onProgress) {
  const collection = `${NUTRITION_SNAPSHOT_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const seenRecordIds = new Set();
  let totalRecords = 0;
  let recordsDownloaded = 0;

  try {
    const datasets = [
      { path: '/operation-timbang', recordType: 'Operation Timbang' },
      { path: '/adult-bmi', recordType: 'Adult BMI' },
      { path: '/adolescent-bmi', recordType: 'Adolescent BMI' },
    ];
    for (const dataset of datasets) {
      let totalPages = null;
      let datasetTotal = null;
      let datasetDownloaded = 0;
      for (let page = 1; totalPages === null || page <= totalPages; page += 1) {
        let response;
        try {
          response = await api.get(dataset.path, {
            params: { page, limit: NUTRITION_PAGE_SIZE },
          });
        } catch {
          throw new Error('Nutrition records could not be downloaded. The previous nutrition snapshot is unchanged.');
        }

        const current = validateNutritionPage(response, page);
        if (totalPages === null) {
          totalPages = current.totalPages;
          datasetTotal = current.total;
          totalRecords += current.total;
        } else if (current.totalPages !== totalPages || current.total !== datasetTotal) {
          throw new Error('Nutrition data changed during download. The previous nutrition snapshot is unchanged; retry.');
        }

        const uniqueItems = [];
        for (const sourceRecord of current.items) {
          const record = normalizeNutritionRecord(dataset.recordType, sourceRecord);
          if (record.id === undefined || record.id === null ||
              record.resident_id === undefined || record.resident_id === null) {
            throw new Error('A nutrition record is missing its identifier. The previous nutrition snapshot is unchanged.');
          }
          const key = `${record.record_type}:${record.id}`;
          if (seenRecordIds.has(key)) continue;
          seenRecordIds.add(key);
          uniqueItems.push(record);
        }

        for (let offset = 0; offset < uniqueItems.length; offset += WRITE_BATCH_SIZE) {
          const batch = uniqueItems.slice(offset, offset + WRITE_BATCH_SIZE);
          await Promise.all(batch.map((record) => putOfflineRecord(
            user.user_id,
            collection,
            `${record.record_type}:${record.id}`,
            record
          )));
          datasetDownloaded += batch.length;
          recordsDownloaded += batch.length;
        }
        onProgress({
          phase: 'nutrition',
          recordType: dataset.recordType,
          pagesCompleted: page,
          totalPages,
          recordsDownloaded: datasetDownloaded,
          totalRecords: datasetTotal,
        });
        if (totalPages === 0) break;
      }

      if (datasetDownloaded !== datasetTotal) {
        throw new Error('The downloaded nutrition count did not match the server. The previous nutrition snapshot is unchanged; retry.');
      }
    }

    if (recordsDownloaded !== totalRecords) {
      throw new Error('The downloaded nutrition count did not match the server. The previous nutrition snapshot is unchanged; retry.');
    }

    return {
      collection,
      dataset: 'nutrition',
      status: 'complete',
      recordCount: recordsDownloaded,
      downloadedAt: new Date().toISOString(),
    };
  } catch (error) {
    try {
      await deleteOfflineRecords(user.user_id, collection);
    } catch {
      throw new Error('Nutrition download failed and incomplete encrypted data could not be cleaned up. The previous nutrition snapshot remains active.');
    }
    throw error;
  }
}

async function downloadMedicalRecordsSnapshot(user, onProgress) {
  const collection = `${MEDICAL_RECORDS_SNAPSHOT_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const recordTypes = new Set(['clinical', 'child', 'maternal', 'immunization']);
  const seenRecordIds = new Set();
  let totalPages = null;
  let totalRecords = null;
  let recordsDownloaded = 0;

  try {
    for (let page = 1; totalPages === null || page <= totalPages; page += 1) {
      let response;
      try {
        response = await api.get('/resident-medical-records', {
          params: { page, limit: MEDICAL_RECORDS_PAGE_SIZE },
        });
      } catch {
        throw new Error('Clinical, child, maternal, and immunization records could not be downloaded. Previous offline data is unchanged.');
      }

      const current = validateResidentPage(response, page);
      if (totalPages === null) {
        totalPages = current.totalPages;
        totalRecords = current.total;
      } else if (current.totalPages !== totalPages || current.total !== totalRecords) {
        throw new Error('Medical records changed during download. Previous offline data is unchanged; retry.');
      }

      const uniqueItems = [];
      for (const record of current.items) {
        if (!recordTypes.has(record?.record_type) ||
            record.id === undefined || record.id === null ||
            record.resident_id === undefined || record.resident_id === null ||
            !record.record_data || typeof record.record_data !== 'object' || Array.isArray(record.record_data)) {
          throw new Error('The server returned incomplete medical record data. Previous offline data is unchanged.');
        }
        const key = `${record.resident_id}:${record.record_type}:${record.id}`;
        if (seenRecordIds.has(key)) continue;
        seenRecordIds.add(key);
        uniqueItems.push(record);
      }

      for (let offset = 0; offset < uniqueItems.length; offset += WRITE_BATCH_SIZE) {
        const batch = uniqueItems.slice(offset, offset + WRITE_BATCH_SIZE);
        await Promise.all(batch.map((record) => putOfflineRecord(
          user.user_id,
          collection,
          `${record.resident_id}:${record.record_type}:${record.id}`,
          record
        )));
        recordsDownloaded += batch.length;
      }
      onProgress({ phase: 'medical-records', pagesCompleted: page, totalPages, recordsDownloaded, totalRecords });
      if (totalPages === 0) break;
    }

    if (recordsDownloaded !== totalRecords) {
      throw new Error('The downloaded medical record count did not match the server. Previous offline data is unchanged; retry.');
    }
    return {
      collection,
      dataset: 'medicalRecords',
      status: 'complete',
      recordCount: recordsDownloaded,
      downloadedAt: new Date().toISOString(),
    };
  } catch (error) {
    try {
      await deleteOfflineRecords(user.user_id, collection);
    } catch {
      throw new Error('Medical record download failed and incomplete encrypted data could not be cleaned up. The previous snapshot remains active.');
    }
    throw error;
  }
}

async function downloadPagedSnapshotDataset(user, {
  path,
  collectionPrefix,
  pageSize,
  phase,
  keyField,
  requestParams = {},
}, onProgress) {
  const collection = `${collectionPrefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const seenRecordIds = new Set();
  let totalPages = null;
  let totalRecords = null;
  let recordsDownloaded = 0;

  try {
    for (let page = 1; totalPages === null || page <= totalPages; page += 1) {
      let response;
      try {
        response = await api.get(path, {
          params: { page, limit: pageSize, ...requestParams },
        });
      } catch {
        throw new Error(`${phase} could not be downloaded. Previous offline data is unchanged.`);
      }

      const body = response?.data;
      const result = body?.data;
      const items = result?.items;
      const total = Number(result?.total);
      const returnedPageSize = Number(result?.limit ?? result?.pageSize);
      if (body?.success !== true || !Array.isArray(items) ||
          !Number.isSafeInteger(total) || total < 0 ||
          returnedPageSize !== pageSize ||
          (result.page !== undefined && Number(result.page) !== page) ||
          (total === 0 && items.length !== 0)) {
        throw new Error(`The server returned incomplete ${phase.toLowerCase()} pagination data.`);
      }

      const currentTotalPages = Math.ceil(total / pageSize);
      if (totalPages === null) {
        totalPages = currentTotalPages;
        totalRecords = total;
      } else if (currentTotalPages !== totalPages || total !== totalRecords) {
        throw new Error(`${phase} changed during download. Previous offline data is unchanged; retry.`);
      }

      const uniqueItems = [];
      for (const record of items) {
        const recordId = record?.[keyField];
        if (recordId === undefined || recordId === null || String(recordId).trim() === '') {
          throw new Error(`A ${phase.toLowerCase()} record is missing its identifier.`);
        }
        const key = String(recordId);
        if (seenRecordIds.has(key)) continue;
        seenRecordIds.add(key);
        uniqueItems.push(record);
      }

      for (let offset = 0; offset < uniqueItems.length; offset += WRITE_BATCH_SIZE) {
        const batch = uniqueItems.slice(offset, offset + WRITE_BATCH_SIZE);
        await Promise.all(batch.map((record) => putOfflineRecord(
          user.user_id,
          collection,
          record[keyField],
          record
        )));
        recordsDownloaded += batch.length;
      }
      onProgress({ phase, pagesCompleted: page, totalPages, recordsDownloaded, totalRecords });
      if (totalPages === 0) break;
    }

    if (recordsDownloaded !== totalRecords) {
      throw new Error(`The downloaded ${phase.toLowerCase()} count did not match the server. Previous offline data is unchanged; retry.`);
    }
    return { collection, recordCount: recordsDownloaded };
  } catch (error) {
    try {
      await deleteOfflineRecords(user.user_id, collection);
    } catch {
      throw new Error(`${phase} download failed and incomplete encrypted data could not be cleaned up. The previous snapshot remains active.`);
    }
    throw error;
  }
}

export async function getActiveResidentSnapshot() {
  const user = getAuthorizedBhw();
  const [activeSnapshot, legacyResidentSnapshot, legacyNutritionSnapshot] = await Promise.all([
    getOfflineRecord(user.user_id, SNAPSHOT_METADATA_COLLECTION, ACTIVE_OFFLINE_DATA_SNAPSHOT_KEY),
    getOfflineRecord(user.user_id, SNAPSHOT_METADATA_COLLECTION, ACTIVE_RESIDENTS_SNAPSHOT_KEY),
    getOfflineRecord(user.user_id, SNAPSHOT_METADATA_COLLECTION, ACTIVE_NUTRITION_SNAPSHOT_KEY),
  ]);
  const residentCollection = activeSnapshot?.collections?.residents || legacyResidentSnapshot?.collection;
  if (!residentCollection) return null;
  const nutritionCollection = activeSnapshot?.collections?.nutrition || legacyNutritionSnapshot?.collection;
  return {
    ...(activeSnapshot || legacyResidentSnapshot),
    collection: residentCollection,
    recordCount: activeSnapshot?.recordCounts?.residents ?? legacyResidentSnapshot?.recordCount,
    downloadedAt: activeSnapshot?.downloadedAt || legacyResidentSnapshot?.downloadedAt,
    nutritionCollection,
    nutritionRecordCount: activeSnapshot?.recordCounts?.nutrition ?? legacyNutritionSnapshot?.recordCount ?? null,
    nutritionDownloadedAt: activeSnapshot?.downloadedAt || legacyNutritionSnapshot?.downloadedAt || null,
    medicalRecordCount: activeSnapshot?.recordCounts?.medicalRecords ?? null,
    legacyClinicalRecordCount: activeSnapshot?.recordCounts?.legacyClinical ?? null,
    legacyChildRecordCount: activeSnapshot?.recordCounts?.legacyChild ?? null,
    seniorCitizenRecordCount: activeSnapshot?.recordCounts?.seniorCitizens ?? null,
  };
}

export async function getOfflineSnapshotRecords(dataset) {
  const user = getAuthorizedBhw();
  const snapshot = await getOfflineRecord(user.user_id, SNAPSHOT_METADATA_COLLECTION, ACTIVE_OFFLINE_DATA_SNAPSHOT_KEY);
  const collection = snapshot?.collections?.[dataset];
  if (snapshot?.status !== 'complete' || !collection) {
    throw new Error('This data has not been downloaded for offline use.');
  }
  return getOfflineRecords(user.user_id, collection);
}

export async function downloadOfflineData(onProgress = () => {}) {
  if (typeof navigator === 'undefined' || !navigator.onLine) {
    throw new Error('Connect to the internet before downloading offline data.');
  }
  const user = getAuthorizedBhw();
  const [previousSnapshot, previousResidents, previousNutrition] = await Promise.all([
    getOfflineRecord(user.user_id, SNAPSHOT_METADATA_COLLECTION, ACTIVE_OFFLINE_DATA_SNAPSHOT_KEY),
    getOfflineRecord(user.user_id, SNAPSHOT_METADATA_COLLECTION, ACTIVE_RESIDENTS_SNAPSHOT_KEY),
    getOfflineRecord(user.user_id, SNAPSHOT_METADATA_COLLECTION, ACTIVE_NUTRITION_SNAPSHOT_KEY),
  ]);
  const collection = createSnapshotCollection();
  const seenResidentIds = new Set();
  let pagesCompleted = 0;
  let totalPages = null;
  let totalResidents = null;
  let recordsDownloaded = 0;
  let activated = false;
  let nutritionSnapshot = null;
  let medicalRecordsSnapshot = null;
  let legacyClinicalSnapshot = null;
  let legacyChildSnapshot = null;
  let seniorCitizensSnapshot = null;

  try {
    for (let page = 1; totalPages === null || page <= totalPages; page += 1) {
      let response;
      try {
        response = await api.get('/residents', {
          params: {
            page,
            limit: RESIDENTS_PER_PAGE,
            sort: 'oldest',
            order: 'asc',
          },
        });
      } catch {
        throw new Error('A resident page could not be downloaded. The previous offline data is unchanged.');
      }

      const current = validateResidentPage(response, page);
      if (totalPages === null) {
        totalPages = current.totalPages;
        totalResidents = current.total;
      } else if (current.totalPages !== totalPages || current.total !== totalResidents) {
        throw new Error('Resident data changed during download. The previous offline data is unchanged; retry.');
      }

      const uniqueItems = [];
      for (const resident of current.items) {
        if (resident?.resident_id === undefined || resident?.resident_id === null ||
            String(resident.resident_id).trim() === '') {
          throw new Error('A resident record is missing its identifier. The previous offline data is unchanged.');
        }
        const key = String(resident.resident_id);
        if (seenResidentIds.has(key)) continue;
        seenResidentIds.add(key);
        uniqueItems.push(resident);
      }

      for (let offset = 0; offset < uniqueItems.length; offset += WRITE_BATCH_SIZE) {
        const batch = uniqueItems.slice(offset, offset + WRITE_BATCH_SIZE);
        await Promise.all(batch.map((resident) => putOfflineRecord(
          user.user_id,
          collection,
          resident.resident_id,
          resident
        )));
        recordsDownloaded += batch.length;
      }

      pagesCompleted = page;
      onProgress({ phase: 'downloading', pagesCompleted, totalPages, recordsDownloaded, totalResidents });
      if (totalPages === 0) break;
    }

    if (recordsDownloaded !== totalResidents) {
      throw new Error('The downloaded resident count did not match the server. The previous offline data is unchanged; retry.');
    }

    onProgress({ phase: 'nutrition-starting', recordsDownloaded: 0 });
    nutritionSnapshot = await downloadNutritionSnapshot(user, onProgress);
    onProgress({ phase: 'medical-records-starting', recordsDownloaded: 0 });
    medicalRecordsSnapshot = await downloadMedicalRecordsSnapshot(user, onProgress);
    onProgress({ phase: 'legacy-clinical-starting', recordsDownloaded: 0 });
    legacyClinicalSnapshot = await downloadPagedSnapshotDataset(user, {
      path: '/health-records',
      collectionPrefix: LEGACY_CLINICAL_SNAPSHOT_PREFIX,
      pageSize: LEGACY_RECORDS_PAGE_SIZE,
      phase: 'legacy-clinical',
      keyField: 'health_record_id',
    }, onProgress);
    onProgress({ phase: 'legacy-child-starting', recordsDownloaded: 0 });
    legacyChildSnapshot = await downloadPagedSnapshotDataset(user, {
      path: '/child-health',
      collectionPrefix: LEGACY_CHILD_SNAPSHOT_PREFIX,
      pageSize: LEGACY_RECORDS_PAGE_SIZE,
      phase: 'legacy-child',
      keyField: 'id',
    }, onProgress);
    onProgress({ phase: 'senior-citizens-starting', recordsDownloaded: 0 });
    seniorCitizensSnapshot = await downloadPagedSnapshotDataset(user, {
      path: '/senior-citizens',
      collectionPrefix: SENIOR_CITIZENS_SNAPSHOT_PREFIX,
      pageSize: SENIOR_CITIZENS_PAGE_SIZE,
      phase: 'senior-citizens',
      keyField: 'senior_id',
      requestParams: { pageSize: SENIOR_CITIZENS_PAGE_SIZE },
    }, onProgress);
    const snapshot = {
      status: 'complete',
      collections: {
        residents: collection,
        nutrition: nutritionSnapshot.collection,
        medicalRecords: medicalRecordsSnapshot.collection,
        legacyClinical: legacyClinicalSnapshot.collection,
        legacyChild: legacyChildSnapshot.collection,
        seniorCitizens: seniorCitizensSnapshot.collection,
      },
      recordCounts: {
        residents: recordsDownloaded,
        nutrition: nutritionSnapshot.recordCount,
        medicalRecords: medicalRecordsSnapshot.recordCount,
        legacyClinical: legacyClinicalSnapshot.recordCount,
        legacyChild: legacyChildSnapshot.recordCount,
        seniorCitizens: seniorCitizensSnapshot.recordCount,
      },
      downloadedAt: new Date().toISOString(),
    };
    await putOfflineRecord(
      user.user_id,
      SNAPSHOT_METADATA_COLLECTION,
      ACTIVE_OFFLINE_DATA_SNAPSHOT_KEY,
      snapshot
    );
    activated = true;

    let cleanupWarning = false;
    const preserveCollections = new Set();
    try {
      await putOfflineRecord(
        user.user_id,
        SNAPSHOT_METADATA_COLLECTION,
        ACTIVE_RESIDENTS_SNAPSHOT_KEY,
        {
          collection,
          dataset: 'residents',
          status: 'complete',
          recordCount: recordsDownloaded,
          downloadedAt: snapshot.downloadedAt,
        }
      );
    } catch {
      cleanupWarning = true;
      if (previousResidents?.collection) preserveCollections.add(previousResidents.collection);
    }
    try {
      await putOfflineRecord(
        user.user_id,
        SNAPSHOT_METADATA_COLLECTION,
        ACTIVE_NUTRITION_SNAPSHOT_KEY,
        nutritionSnapshot
      );
    } catch {
      cleanupWarning = true;
      if (previousNutrition?.collection) preserveCollections.add(previousNutrition.collection);
    }

    const oldCollections = new Set(['residents']);
    [
      previousSnapshot?.collections?.residents,
      previousSnapshot?.collections?.nutrition,
      previousSnapshot?.collections?.medicalRecords,
      previousSnapshot?.collections?.legacyClinical,
      previousSnapshot?.collections?.legacyChild,
      previousSnapshot?.collections?.seniorCitizens,
      previousResidents?.collection,
      previousNutrition?.collection,
    ].forEach((oldCollection) => {
      if (oldCollection?.startsWith(RESIDENT_SNAPSHOT_PREFIX) ||
          oldCollection?.startsWith(NUTRITION_SNAPSHOT_PREFIX) ||
          oldCollection?.startsWith(MEDICAL_RECORDS_SNAPSHOT_PREFIX) ||
          oldCollection?.startsWith(LEGACY_CLINICAL_SNAPSHOT_PREFIX) ||
          oldCollection?.startsWith(LEGACY_CHILD_SNAPSHOT_PREFIX) ||
          oldCollection?.startsWith(SENIOR_CITIZENS_SNAPSHOT_PREFIX)) oldCollections.add(oldCollection);
    });
    oldCollections.delete(collection);
    oldCollections.delete(nutritionSnapshot.collection);
    oldCollections.delete(medicalRecordsSnapshot.collection);
    oldCollections.delete(legacyClinicalSnapshot.collection);
    oldCollections.delete(legacyChildSnapshot.collection);
    oldCollections.delete(seniorCitizensSnapshot.collection);
    preserveCollections.forEach((oldCollection) => oldCollections.delete(oldCollection));
    for (const oldCollection of oldCollections) {
      try {
        await deleteOfflineRecords(user.user_id, oldCollection);
      } catch {
        cleanupWarning = true;
      }
    }

    const result = {
      ...snapshot,
      collection,
      recordCount: recordsDownloaded,
      nutritionRecordCount: nutritionSnapshot.recordCount,
      nutritionCollection: nutritionSnapshot.collection,
      nutritionDownloadedAt: snapshot.downloadedAt,
      medicalRecordCount: medicalRecordsSnapshot.recordCount,
      medicalRecordsCollection: medicalRecordsSnapshot.collection,
      legacyClinicalRecordCount: legacyClinicalSnapshot.recordCount,
      legacyChildRecordCount: legacyChildSnapshot.recordCount,
      seniorCitizenRecordCount: seniorCitizensSnapshot.recordCount,
      cleanupWarning,
    };
    onProgress({
      phase: 'complete',
      pagesCompleted,
      totalPages,
      recordsDownloaded,
      totalResidents,
      nutritionRecordsDownloaded: nutritionSnapshot.recordCount,
      medicalRecordsDownloaded: medicalRecordsSnapshot.recordCount,
      legacyClinicalRecordsDownloaded: legacyClinicalSnapshot.recordCount,
      legacyChildRecordsDownloaded: legacyChildSnapshot.recordCount,
      seniorCitizensDownloaded: seniorCitizensSnapshot.recordCount,
    });
    dispatchDownloadUpdate(result);
    return result;
  } catch (error) {
    if (!activated) {
      let cleanupFailed = false;
      const stagedCollections = [
        collection,
        nutritionSnapshot?.collection,
        medicalRecordsSnapshot?.collection,
        legacyClinicalSnapshot?.collection,
        legacyChildSnapshot?.collection,
        seniorCitizensSnapshot?.collection,
      ].filter(Boolean);
      for (const stagedCollection of stagedCollections) {
        try {
          await deleteOfflineRecords(user.user_id, stagedCollection);
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed) {
        throw new Error('Download failed and incomplete encrypted data could not be cleaned up. The previous snapshot remains active.');
      }
    }
    dispatchDownloadUpdate({ status: 'failed' });
    throw error;
  }
}

export async function getOfflineResidentSnapshotRecords() {
  const snapshot = await getActiveResidentSnapshot();
  if (!snapshot?.collection || snapshot.status !== 'complete') return null;
  const user = getAuthorizedBhw();
  return getOfflineRecords(user.user_id, snapshot.collection);
}
