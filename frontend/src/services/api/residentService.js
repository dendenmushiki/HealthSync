import api from './apiClient';
import { publishNotification } from '../notifications/notificationEvents';
import idb from '../offline/indexedDbService';
import locations from '../../data/philippineLocations.json';
import { calculateAge } from '../../utils/residentUtils';

const cacheResidents = async (items = []) => {
  await Promise.all(items.map((resident) => idb.putToStore('cachedResidents', resident).catch(() => {})));
};

const calculateResidentAge = (resident) => {
  if (resident.age !== undefined && resident.age !== null) return Number(resident.age);
  return calculateAge(resident.birthdate);
};

const getCachedResidents = async (params = {}) => {
  const cached = await idb.getAllFromStore('cachedResidents');
  const searchTokens = String(params.search || params.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  let residents = cached.filter((resident) => {
    const searchText = [
      resident.first_name, resident.middle_name, resident.last_name, resident.suffix,
      resident.household_no, resident.contact_no, resident.philhealth_id_no
    ].filter(Boolean).join(' ').toLowerCase();
    if (searchTokens.some((token) => !searchText.includes(token))) return false;
    if (params.status && resident.resident_status !== params.status) return false;
    if (params.sex && String(resident.sex).toLowerCase() !== String(params.sex).toLowerCase()) return false;
    if (params.sitio && resident.sitio !== params.sitio) return false;
    const age = calculateResidentAge(resident);
    if (params.min_age !== undefined && params.min_age !== '' && (age === null || age < Number(params.min_age))) return false;
    if (params.max_age !== undefined && params.max_age !== '' && (age === null || age > Number(params.max_age))) return false;
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

export async function getResidents(params = {}) {
  if (!navigator.onLine) return getCachedResidents(params);
  try {
    const resp = await api.get('/residents', { params });
    if (resp.data?.success) await cacheResidents(resp.data.data?.items);
    return resp.data;
  } catch (error) {
    if (!error.response) {
      try { return await getCachedResidents(params); } catch (cacheError) { /* Keep the original network error. */ }
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
    const resident = await idb.getFromStore('cachedResidents', Number(id));
    if (resident) return { success: true, data: resident, offline: true };
    throw new Error('This resident has not been loaded on this device. Connect to the internet before editing.');
  }
  try {
    const resp = await api.get(`/residents/${id}`);
    if (resp.data?.success) await cacheResidents([resp.data.data]);
    return resp.data;
  } catch (error) {
    if (!error.response) {
      const resident = await idb.getFromStore('cachedResidents', Number(id)).catch(() => null);
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
