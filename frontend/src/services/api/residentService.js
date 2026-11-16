import api from './apiClient';
import { publishNotification } from '../notifications/notificationEvents';
import {
  getOfflineRecord,
  getOfflineRecords,
  getUnlockedOfflineVaultRole,
  isOfflineVaultUnlocked,
  putOfflineRecord,
} from '../offline/offlineVaultService';
import { getOfflineSession } from '../offline/offlineSessionService';
import offlineQueue from '../offline/offlineQueueService';
import locations from '../../data/philippineLocations.json';
import { calculateAge } from '../../utils/residentUtils';
import { calculateAgeInMonths } from '../../utils/nutritionRecordAge';

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('hs_user') || 'null');
  } catch {
    throw new Error('Offline resident access is unavailable for this account.');
  }
}

function getAuthorizedOfflineAccount() {
  const user = getStoredUser();
  const grant = getOfflineSession();
  if (!user?.user_id || user.must_change_password || user.role !== 'bhw' || !grant ||
      String(grant.userId) !== String(user.user_id) || grant.role !== user.role ||
      getUnlockedOfflineVaultRole(user.user_id) !== user.role) {
    throw new Error('Unlock authorized BHW offline access before using resident data.');
  }
  return user;
}

const reportCacheFailure = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('healthsync:offline-cache-error', {
      detail: { message: 'Resident data could not be secured for offline use.' },
    }));
  }
};

const getResidentCacheCollection = async (userId) => {
  const activeSnapshot = await getOfflineRecord(userId, 'offlineMetadata', 'activeOfflineDataSnapshot');
  if (activeSnapshot?.status === 'complete' && activeSnapshot.collections?.residents) {
    return activeSnapshot.collections.residents;
  }
  const previousSnapshot = await getOfflineRecord(userId, 'offlineMetadata', 'activeResidentsSnapshot');
  return previousSnapshot?.collection || 'residents';
};

const cacheResidents = async (items = []) => {
  const user = getStoredUser();
  if (!user?.user_id || user.must_change_password || user.role !== 'bhw' || !getOfflineSession() ||
      !isOfflineVaultUnlocked(user.user_id) ||
      getUnlockedOfflineVaultRole(user.user_id) !== user.role) return;
  const collection = await getResidentCacheCollection(user.user_id);
  await Promise.all(items.map((resident) => putOfflineRecord(
    user.user_id,
    collection,
    resident.resident_id,
    resident
  )));
};

const getManilaToday = () => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const calculateResidentAge = (resident) => calculateAge(
  resident.birthdate,
  new Date(`${getManilaToday()}T00:00:00`)
);

const getCachedResidents = async (params = {}) => {
  const user = getAuthorizedOfflineAccount();
  const collection = await getResidentCacheCollection(user.user_id);
  const cached = await getOfflineRecords(user.user_id, collection);
  const queuedResidents = (await offlineQueue.getQueueItems(user.user_id))
    .filter((item) => item.table === 'residents' && item.localRecord && item.operation !== 'DELETE')
    .map((item) => item.localRecord);
  const residentsById = new Map(cached.map((resident) => [String(resident.resident_id), resident]));
  queuedResidents.forEach((resident) => residentsById.set(String(resident.resident_id), resident));
  const searchTokens = String(params.search || params.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const asOfDate = getManilaToday();
  let residents = [...residentsById.values()].filter((resident) => {
    const searchText = [
      resident.first_name, resident.middle_name, resident.last_name, resident.suffix,
      resident.household_no, resident.contact_no, resident.philhealth_id_no
    ].filter(Boolean).join(' ').toLowerCase();
    if (searchTokens.some((token) => !searchText.includes(token))) return false;
    if (params.status && resident.resident_status !== params.status) return false;
    if (params.sex && String(resident.sex).toLowerCase() !== String(params.sex).toLowerCase()) return false;
    if (params.sitio && resident.sitio !== params.sitio) return false;
    const age = calculateResidentAge(resident);
    const ageMonths = calculateAgeInMonths(resident.birthdate, asOfDate);
    if (params.min_age !== undefined && params.min_age !== '' && (age === null || age < Number(params.min_age))) return false;
    if (params.max_age !== undefined && params.max_age !== '' && (age === null || age > Number(params.max_age))) return false;
    if (params.min_age_months !== undefined && params.min_age_months !== '' &&
        (ageMonths === null || ageMonths < Number(params.min_age_months))) return false;
    if (params.max_age_months !== undefined && params.max_age_months !== '' &&
        (ageMonths === null || ageMonths > Number(params.max_age_months))) return false;
    const flags = Array.isArray(resident.category_flags) ? resident.category_flags : [];
    if (params.classification === 'Senior Citizen' && (age === null || age < 60)) return false;
    if (params.classification === 'PWD' && !flags.includes('PWD')) return false;
    if (['4Ps Member', '4Ps'].includes(params.classification) && ![true, 1, '1', 'true'].includes(resident.is_4ps)) return false;
    if (params.classification === 'Pregnant' && !resident.pregnant) return false;
    if (params.classification === 'Lactating' && !resident.lactating) return false;
    return true;
  });

  const sorters = {
    name: (a, b) => `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`),
    age: (a, b) => String(a.birthdate || '').localeCompare(String(b.birthdate || '')),
    sitio: (a, b) => String(a.sitio || '').localeCompare(String(b.sitio || '')),
    status: (a, b) => String(a.resident_status || '').localeCompare(String(b.resident_status || '')),
    newest: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
    oldest: (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')),
  };
  residents.sort(sorters[params.sort] || sorters.name);
  if (params.order === 'desc' && !['newest', 'oldest'].includes(params.sort)) residents.reverse();

  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.max(1, Number(params.pageSize || params.limit) || 10);
  const total = residents.length;
  const items = residents.slice((page - 1) * limit, page * limit);
  return { success: true, data: { items, total, page, limit, offline: true, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } };
};

const getCachedResident = async (user, id) => {
  const queueItems = await offlineQueue.getQueueItems(user.user_id);
  const queued = queueItems.find((item) => (
    item.table === 'residents' && item.localRecord &&
    String(item.localRecord.offlineResidentId || item.localRecord.resident_id) === String(id) &&
    item.operation !== 'DELETE'
  ));
  if (queued) return queued.localRecord;
  const numericId = Number(id);
  const cached = Number.isFinite(numericId) ? await getOfflineRecord(
    user.user_id,
    await getResidentCacheCollection(user.user_id),
    numericId
  ) : null;
  return cached;
};

export async function getResidents(params = {}) {
  if (!navigator.onLine) return getCachedResidents(params);
  try {
    const resp = await api.get('/residents', { params });
    if (resp.data?.success) {
      try {
        await cacheResidents(resp.data.data?.items);
      } catch {
        reportCacheFailure();
      }
    }
    return resp.data;
  } catch (error) {
    if (!error.response) {
      return getCachedResidents(params);
    }
    throw error;
  }
}

export async function getAllResidents(params = {}) {
  const limit = 100;
  const first = await getResidents({ ...params, page: 1, limit });
  if (!first?.success) return first;
  const residents = [...(first.data?.items || [])];
  const totalPages = first.data?.pagination?.totalPages || Math.ceil((first.data?.total || residents.length) / limit);
  for (let page = 2; page <= totalPages; page += 1) {
    const response = await getResidents({ ...params, page, limit });
    if (!response?.success) break;
    residents.push(...(response.data?.items || []));
  }
  return { ...first, data: { ...first.data, items: residents } };
}

export async function getResident(id) {
  if (!navigator.onLine) {
    const user = getAuthorizedOfflineAccount();
    const resident = await getCachedResident(user, id);
    if (resident) return { success: true, data: resident, offline: true };
    throw new Error('This resident has not been loaded on this device. Connect to the internet before editing.');
  }
  try {
    const resp = await api.get(`/residents/${id}`);
    if (resp.data?.success) {
      try {
        await cacheResidents([resp.data.data]);
      } catch {
        reportCacheFailure();
      }
    }
    return resp.data;
  } catch (error) {
    if (!error.response) {
      const user = getAuthorizedOfflineAccount();
      const resident = await getCachedResident(user, id);
      if (resident) return { success: true, data: resident, offline: true };
    }
    throw error;
  }
}

export async function getResidentSummary(id) {
  const resp = await api.get(`/residents/${id}/summary`);
  return resp.data;
}

const getOptions = (items) => Promise.resolve({
  success: true,
  data: items.map(([code, name]) => ({ code, name }))
});

export const getResidentRegions = () => getOptions(locations.regions);
export const getResidentProvinces = (regionCode) => getOptions(
  locations.provinces.filter(([, , parentRegionCode]) => parentRegionCode === regionCode)
);
export const getResidentCitiesMunicipalities = (provinceCode) => getOptions(
  locations.cities.filter(([, , parentProvinceCode]) => parentProvinceCode === provinceCode)
);
export const getResidentBarangays = (cityMunicipalityCode) => getOptions(
  locations.barangays.filter(([, , parentCityCode]) => parentCityCode === cityMunicipalityCode)
);

export async function createResident(payload) {
  const resp = await api.post('/residents', payload);
  if (resp.data?.success && !resp.data?.queued) {
    publishNotification('newResidentAlerts', 'New resident registered', 'A resident record was added to HealthSync.');
  }
  return resp.data;
}

export async function updateResident(id, payload) {
  const resp = await api.put(`/residents/${id}`, payload);
  return resp.data;
}

export async function uploadResidentPhoto(id, file) {
  const formData = new FormData();
  formData.append('photo', file);
  const resp = await api.post(`/residents/${id}/photo`, formData);
  return resp.data;
}

export async function deleteResidentPhoto(id) {
  const resp = await api.delete(`/residents/${id}/photo`);
  return resp.data;
}

export async function deleteResident(id) {
  const resp = await api.delete(`/residents/${id}`);
  return resp.data;
}
