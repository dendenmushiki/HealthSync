import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { enqueueOperation, updateOperationStatus } from '../offline/offlineQueueService';
import { setBackendAvailability } from '../offline/networkService';

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
  const operationId = config.healthsyncOperationId || config.healthsyncProvisionalOperationId;
  if (!operationId || !activeAccountMatches(config)) return null;
  const status = Number(error.response?.status) || 0;
  const errorCode = error.response?.data?.errorCode;
  const isAlreadyQueued = Boolean(config.healthsyncOperationId);
  if (status === 401) {
    if (!isAlreadyQueued) {
      const queued = await enqueueOperation({
        ...config.healthsyncQueueDetails,
        offlineOperationId: operationId,
        userId: config.healthsyncOwnerId,
      });
      config.healthsyncOperationId = queued.offlineOperationId;
    }
    await updateOperationStatus(operationId, {
      status: 'PENDING',
      retryCount: 1,
      attempts: 1,
      lastError: 'Sign in again to sync this saved change.',
      lastErrorCode: errorCode || 'AUTH_REQUIRED',
      syncStartedAt: null,
    }, config.healthsyncOwnerId);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('healthsync:sync-auth-required'));
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
    }
    return 'PENDING';
  }
  const safeToRetry = !error.response || errorCode === 'IDEMPOTENCY_RETRY_SAFE';
  const unknownOutcome = ['IDEMPOTENCY_OUTCOME_UNKNOWN', 'IDEMPOTENCY_KEY_CONFLICT', 'IDEMPOTENCY_KEY_REUSE']
    .includes(errorCode) || (status >= 500 && !safeToRetry);
  if (!isAlreadyQueued && !safeToRetry && !unknownOutcome) return null;
  const nextStatus = safeToRetry ? 'PENDING' : unknownOutcome ? 'CONFLICT' : 'FAILED';
  if (!isAlreadyQueued) {
    const queued = await enqueueOperation({
      ...config.healthsyncQueueDetails,
      offlineOperationId: operationId,
      userId: config.healthsyncOwnerId,
    });
    config.healthsyncOperationId = queued.offlineOperationId;
  }
  await updateOperationStatus(operationId, {
    status: nextStatus,
    retryCount: 1,
    attempts: 1,
    lastAttemptAt: new Date().toISOString(),
    lastError: status ? `The server returned HTTP ${status}. Review this saved change and retry when corrected.` :
      'The connection was interrupted. The saved change will retry with its original operation key.',
    syncStartedAt: null,
  }, config.healthsyncOwnerId);
  dispatchQueueChange('healthsync:offline-queued', {
    offlineOperationId: operationId,
  });
  return nextStatus;
}

api.interceptors.request.use(async (config) => {
  const route = isQueueableRequest(config);
  if (!route) return config;
  const headers = config.headers || {};
  const existingKey = headers['X-Idempotency-Key'] || headers['x-idempotency-key'] ||
    (typeof headers.get === 'function' && headers.get('X-Idempotency-Key'));
  if (existingKey || config.healthsyncOperationId || config.healthsyncProvisionalOperationId) return config;
  const user = getStoredUser();
  if (!user?.user_id || user.role !== 'bhw') return config;

  const method = String(config.method || 'post').toUpperCase();
  const operation = method === 'POST' ? 'CREATE' : method === 'DELETE' ? 'DELETE' : 'UPDATE';
  const operationId = uuidv4();
  config.healthsyncProvisionalOperationId = operationId;
  config.healthsyncOwnerId = String(user.user_id);
  config.healthsyncToken = localStorage.getItem('hs_token');
  config.healthsyncQueueDetails = {
    operation,
    module: route.module,
    table: route.table,
    payload: route.payload || config.data || {},
    request: { method, url: config.url, params: config.params, data: config.data },
    localRecord: getLocalRecord(config, route, operation),
  };
  config.headers = config.headers || {};
  config.headers['X-Idempotency-Key'] = operationId;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const queued = await enqueueOperation({
      ...config.healthsyncQueueDetails,
      offlineOperationId: operationId,
      userId: config.healthsyncOwnerId,
    });
    config.healthsyncOperationId = queued.offlineOperationId;
    const queuedError = new Error('Request saved for synchronization.');
    queuedError.offlineQueued = true;
    queuedError.config = config;
    throw queuedError;
  }
  return config;
});

api.interceptors.response.use(async (response) => {
  setBackendAvailability(true, response.status);
  const config = response.config || {};
  if (config.healthsyncProvisionalOperationId && response.status < 400 &&
      response.data?.success !== true && activeAccountMatches(config)) {
    try {
      await enqueueOperation({
        ...config.healthsyncQueueDetails,
        offlineOperationId: config.healthsyncProvisionalOperationId,
        userId: config.healthsyncOwnerId,
      });
      await updateOperationStatus(config.healthsyncProvisionalOperationId, {
        status: 'CONFLICT',
        lastError: 'The server did not confirm whether this change was saved.',
        syncStartedAt: null,
      }, config.healthsyncOwnerId);
      dispatchQueueChange('healthsync:offline-queued', {
        offlineOperationId: config.healthsyncProvisionalOperationId,
      });
    } catch (error) {
      console.error('Could not preserve a record request without a confirmed server result.', {
        operationId: config.healthsyncProvisionalOperationId,
        error: error.message,
      });
    }
    return response;
  }
  return response;
}, async (error) => {
  if (error.response) setBackendAvailability(true, error.response.status);
  else setBackendAvailability(false);
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
  if (error.config?.healthsyncOperationId || error.config?.healthsyncProvisionalOperationId) {
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
