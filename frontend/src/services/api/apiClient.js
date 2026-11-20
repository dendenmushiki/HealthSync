import axios from 'axios';
import { enqueueOperation, getOperation, updateOperationStatus } from '../offline/offlineQueueService';
import { healthCheck, setBackendAvailability } from '../offline/networkService';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api',
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hs_token');
  if (token && !config.headers.Authorization && !config.headers.authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const offlineQueueRoutes = {
  '/residents': { module: 'residents', table: 'residents' },
  '/health-records': { module: 'health_records', table: 'health_records' },
  '/child-health': { module: 'child_health', table: 'child_health_records' },
  '/operation-timbang': { module: 'operation_timbang', table: 'operation_timbang' },
  '/adolescent-bmi': { module: 'adolescent_bmi', table: 'adolescent_bmi_records' },
  '/adult-bmi': { module: 'adult_bmi', table: 'adult_bmi_records' },
  '/senior-citizens': { module: 'senior_citizens', table: 'senior_citizen_records' },
  '/reports/fhsis/remarks': { module: 'report_remarks', table: 'report_remarks' },
};

const isQueueableRequest = (config) => {
  const method = String(config.method || 'get').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null;
  const path = String(config.url || '').split('?')[0].replace(/\/$/, '');
  if (/\/preview$|\/calculate$/.test(path)) return null;
  if (/\/residents\/[^/]+\/photo$/.test(path)) return null;
  const medicalRecordMatch = path.match(/\/resident-medical-records\/([^/]+)\/(clinical|child|maternal|immunization)(?:\/([^/]+))?$/);
  if (medicalRecordMatch) {
    const [, residentId, recordType, recordId] = medicalRecordMatch;
    const tableByType = {
      clinical: 'patient_clinical_records',
      child: 'child_records',
      maternal: 'maternal_records',
      immunization: 'immunization_records'
    };
    return {
      module: `${recordType}_records`,
      table: tableByType[recordType],
      payload: {
        resident_id: /^\d+$/.test(residentId) ? Number(residentId) : residentId,
        ...(recordId ? { id: /^\d+$/.test(recordId) ? Number(recordId) : recordId } : {}),
        ...(config.data?.record_data ? { record_data: config.data.record_data } : {})
      },
      recordType,
      residentId,
      recordId,
    };
  }
  return Object.entries(offlineQueueRoutes).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] || null;
};

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('hs_user') || 'null');
  } catch (error) {
    throw new Error('The active account cannot be verified for offline synchronization.');
  }
}

function getLocalRecord(config, route, operation) {
  if (config.offlineLocalRecord) return config.offlineLocalRecord;
  if (operation === 'DELETE') return null;
  const data = route.payload || config.data;
  const localRecord = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  if (route.recordType) {
    localRecord.record_type = route.recordType;
    localRecord.resident_id = route.payload.resident_id;
    if (config.data?.record_data) localRecord.record_data = config.data.record_data;
    if (route.recordId) localRecord.id = route.recordId;
  }
  if (route.table === 'adult_bmi_records') localRecord.record_type = 'Adult BMI';
  if (route.table === 'adolescent_bmi_records') localRecord.record_type = 'Adolescent BMI';
  if (route.table === 'operation_timbang') localRecord.record_type = 'Operation Timbang';
  return localRecord;
}

function getServerRecordId(responseData) {
  const data = responseData?.data;
  const record = data?.record || data;
  return data?.serverRecordId || data?.resident_id || record?.id || record?.resident_id ||
    record?.senior_id || record?.record_id || record?.timbang_id || record?.bmi_id ||
    record?.adolescent_bmi_id || record?.health_record_id || record?.server_record_id || null;
}

function activeAccountMatches(config) {
  try {
    const user = getStoredUser();
    return String(user?.user_id ?? '') === String(config.healthsyncOwnerId ?? '') &&
      localStorage.getItem('hs_token') === config.healthsyncToken;
  } catch (error) {
    return false;
  }
}

function dispatchQueueChange(name, detail) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(name, { detail }));
    window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
  }
}

function makeQueuedResponse(error) {
  const config = error.config || {};
  return {
    data: {
      success: true,
      offline: true,
      queued: true,
      offlineOperationId: config.healthsyncOperationId,
      data: {},
    },
    status: 202,
    statusText: 'Accepted',
    headers: {},
    config,
  };
}

async function saveFailedAttempt(error) {
  const config = error.config || {};
  if (!config.healthsyncOperationId || !activeAccountMatches(config)) return null;
  const status = Number(error.response?.status) || 0;
  const errorCode = error.response?.data?.errorCode;
  const safeToRetry = !error.response || errorCode === 'IDEMPOTENCY_RETRY_SAFE';
  const unknownOutcome = ['IDEMPOTENCY_OUTCOME_UNKNOWN', 'IDEMPOTENCY_KEY_CONFLICT', 'IDEMPOTENCY_KEY_REUSE']
    .includes(errorCode) || (status >= 500 && !safeToRetry);
  const nextStatus = safeToRetry ? 'PENDING' : unknownOutcome ? 'CONFLICT' : 'FAILED';
  await updateOperationStatus(config.healthsyncOperationId, {
    status: nextStatus,
    retryCount: 1,
    lastError: error.response?.data?.message || error.message || 'The server could not confirm this change.',
    syncStartedAt: null,
  }, config.healthsyncOwnerId);
  dispatchQueueChange('healthsync:offline-queued', {
    offlineOperationId: config.healthsyncOperationId,
  });
  return nextStatus;
}

api.interceptors.request.use(async (config) => {
  const route = isQueueableRequest(config);
  if (!route) return config;
  const headers = config.headers || {};
  const existingKey = headers['X-Idempotency-Key'] || headers['x-idempotency-key'] ||
    (typeof headers.get === 'function' && headers.get('X-Idempotency-Key'));
  if (existingKey) return config;
  const user = getStoredUser();
  if (!user?.user_id || user.role !== 'bhw') return config;

  const method = String(config.method || 'post').toUpperCase();
  const operation = method === 'POST' ? 'CREATE' : method === 'DELETE' ? 'DELETE' : 'UPDATE';
  const queued = await enqueueOperation({
    operation,
    module: route.module,
    table: route.table,
    payload: route.payload || config.data || {},
    userId: String(user.user_id),
    request: { method, url: config.url, params: config.params, data: config.data },
    localRecord: getLocalRecord(config, route, operation),
  });
  config.healthsyncOperationId = queued.offlineOperationId;
  config.healthsyncOwnerId = String(user.user_id);
  config.healthsyncToken = localStorage.getItem('hs_token');
  config.headers = config.headers || {};
  config.headers['X-Idempotency-Key'] = queued.offlineOperationId;

  const backendAvailable = typeof navigator === 'undefined' || navigator.onLine
    ? await healthCheck()
    : false;
  if ((typeof navigator !== 'undefined' && !navigator.onLine) || !backendAvailable) {
    const queuedError = new Error('Request saved for synchronization.');
    queuedError.offlineQueued = true;
    queuedError.config = config;
    throw queuedError;
  }
  return config;
});

api.interceptors.response.use(async (response) => {
  setBackendAvailability(true);
  const config = response.config || {};
  if (config.healthsyncOperationId && activeAccountMatches(config)) {
    const data = response.data;
    const success = data?.success === true && response.status < 400;
    const serverRecordId = success ? getServerRecordId(data) : null;
    const queuedItem = success
      ? await getOperation(config.healthsyncOperationId, config.healthsyncOwnerId).catch(() => null)
      : null;
    const serverRecord = data?.data?.record || data?.data;
    const idFieldByTable = {
      health_records: 'health_record_id',
      child_health_records: 'id',
      senior_citizen_records: 'record_id',
      operation_timbang: 'operation_timbang_id',
      adult_bmi_records: 'record_id',
      adolescent_bmi_records: 'record_id',
      patient_clinical_records: 'id',
      child_records: 'id',
      maternal_records: 'id',
      immunization_records: 'id',
    };
    const localRecord = queuedItem?.localRecord && success
      ? {
        ...queuedItem.localRecord,
        ...(serverRecord && typeof serverRecord === 'object' ? serverRecord : {}),
        ...(serverRecordId ? {
          id: serverRecordId,
          [idFieldByTable[queuedItem.table] || 'id']: serverRecordId,
          ...(queuedItem.table === 'residents' ? { resident_id: serverRecordId } : {}),
        } : {}),
        offline: false,
        sync_status: 'SYNCED',
      }
      : queuedItem?.localRecord;
    const updates = success
      ? {
        status: 'SYNCED',
        syncComplete: true,
        serverResponse: data,
        serverRecordId,
        ...(localRecord ? { localRecord } : {}),
        syncedAt: new Date().toISOString(),
        lastError: null,
        syncStartedAt: null,
      }
      : {
        status: 'FAILED',
        lastError: data?.message || 'The server did not confirm this change.',
        syncStartedAt: null,
      };
    try {
      await updateOperationStatus(config.healthsyncOperationId, updates, config.healthsyncOwnerId);
      dispatchQueueChange('healthsync:queue-changed');
    } catch (error) {
      console.error('Could not update the saved operation after its server response.', {
        operationId: config.healthsyncOperationId,
        error: error.message,
      });
    }
  }
  return response;
}, async (error) => {
  if (!error.response) setBackendAvailability(false);
  if (error?.response?.data?.errorCode === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('healthsync:password-change-required'));
  }
  if (['DEVICE_REVOKED', 'ACCOUNT_DEACTIVATED'].includes(error?.response?.data?.errorCode) &&
      typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('healthsync:offline-authorization-revoked', {
      detail: { reason: error.response.data.errorCode },
    }));
  }
  if (error?.offlineQueued) {
    dispatchQueueChange('healthsync:offline-queued', {
      offlineOperationId: error.config?.healthsyncOperationId,
    });
    return makeQueuedResponse(error);
  }
  if (error.config?.healthsyncOperationId) {
    try {
      const status = await saveFailedAttempt(error);
      if (status === 'PENDING') return makeQueuedResponse(error);
    } catch (storageError) {
      console.error('Could not preserve a failed record request in the offline queue.', {
        operationId: error.config.healthsyncOperationId,
        error: storageError.message,
      });
    }
  }
  return Promise.reject(error);
});

export default api;
