import axios from 'axios';
import { enqueueOperation } from '../offline/offlineQueueService';

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
      }
    };
  }
  return Object.entries(offlineQueueRoutes).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] || null;
};

api.interceptors.request.use(async (config) => {
  if (typeof navigator === 'undefined' || navigator.onLine) return config;
  const route = isQueueableRequest(config);
  if (!route) return config;

  let userId = null;
  try {
    userId = JSON.parse(localStorage.getItem('hs_user') || 'null')?.user_id || null;
  } catch (error) {
    userId = null;
  }
  const method = String(config.method || 'post').toUpperCase();
  const operation = method === 'POST' ? 'CREATE' : method === 'DELETE' ? 'DELETE' : 'UPDATE';
  const queued = await enqueueOperation({
    operation,
    module: route.module,
    table: route.table,
    payload: route.payload || config.data || {},
    userId,
    request: { method, url: config.url, params: config.params, data: config.data },
    localRecord: config.offlineLocalRecord || null,
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('healthsync:offline-queued', { detail: { offlineOperationId: queued.offlineOperationId } }));
  }
  const queuedError = new Error('Request saved for synchronization.');
  queuedError.offlineQueued = true;
  queuedError.offlineOperationId = queued.offlineOperationId;
  queuedError.config = config;
  throw queuedError;
});

api.interceptors.response.use((response) => response, (error) => {
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
    return {
      data: {
        success: true,
        offline: true,
        queued: true,
        offlineOperationId: error.offlineOperationId,
        data: {},
      },
      status: 202,
      statusText: 'Accepted',
      headers: {},
      config: error.config,
    };
  }
  return Promise.reject(error);
});

export default api;
