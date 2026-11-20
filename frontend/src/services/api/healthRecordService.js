import api from './apiClient';
import { getOfflineSnapshotRecords } from '../offline/offlineDataDownloadService';
import { calculateAge } from '../../utils/residentUtils';
import { getQueueItems } from '../offline/offlineQueueService';
import { isOffline } from '../offline/networkService';

const MEDICAL_TABLES = {
  clinical: 'patient_clinical_records',
  child: 'child_records',
  maternal: 'maternal_records',
  immunization: 'immunization_records',
};
const LABELS = {
  clinical: 'Clinical Record',
  child: 'Child Record',
  maternal: 'Maternal Record',
  immunization: 'Immunization Record',
};
async function getOfflineLegacyClinicalRecords() {
  const [records, queuedItems] = await Promise.all([
    getOfflineSnapshotRecords('legacyClinical'),
    getQueueItems(),
  ]);
  const merged = new Map(records.map((record) => [String(record.health_record_id), record]));
  queuedItems.forEach((item) => {
    if (item.table === 'health_records' && item.localRecord && item.operation !== 'DELETE') {
      merged.set(String(item.localRecord.health_record_id), item.localRecord);
    }
  });
  return [...merged.values()];
}

function getMedicalRecordDate(record) {
  const data = record.record_data || {};
  const immunizationDates = [
    'newborn_screening_date', 'hearing_screening_date', 'vitamin_k_date', 'bcg_date',
    'hepa_b1_within_24_hours_date', 'hepa_b1_after_24_hours_date', 'mcvo_date',
    'measles_date', 'mmr_date', 'vitamin_a_first_dose_date', 'vitamin_a_second_dose_date', 'visit_date',
  ];
  return String((record.record_type === 'immunization'
    ? immunizationDates.map((field) => data[field]).find(Boolean)
    : data.visit_date) || record.created_at || '').slice(0, 10);
}

function getSummary(record) {
  const fields = {
    clinical: ['assessment', 'chief_complaint', 'history_of_present_illness', 'notes', 'findings', 'plan'],
    child: ['assessment', 'history_of_present_illness', 'birth_and_immunization_history', 'immunization_history', 'notes', 'remarks'],
    maternal: ['assessment', 'chief_complaint', 'tt_status', 'notes', 'visit_date'],
    immunization: ['vaccine_summary', 'notes', 'assessment'],
  }[record.record_type] || [];
  return fields.map((field) => record.record_data?.[field]).find((value) => value !== null && value !== undefined && String(value).trim()) ||
    (record.record_type === 'immunization' ? 'Vaccine record' : '-');
}

async function getOfflineOverviewRecords() {
  const [clinicalSnapshot, childSnapshot, medicalSnapshot, residents, queuedItems] = await Promise.all([
    getOfflineSnapshotRecords('legacyClinical'),
    getOfflineSnapshotRecords('legacyChild'),
    getOfflineSnapshotRecords('medicalRecords'),
    getOfflineSnapshotRecords('residents'),
    getQueueItems(),
  ]);
  const clinicalRecords = [
    ...clinicalSnapshot,
    ...queuedItems.filter((item) => item.table === 'health_records' && item.localRecord && item.operation !== 'DELETE')
      .map((item) => item.localRecord),
  ];
  const childRecords = [
    ...childSnapshot,
    ...queuedItems.filter((item) => item.table === 'child_health_records' && item.localRecord && item.operation !== 'DELETE')
      .map((item) => item.localRecord),
  ];
  const medicalRecords = [
    ...medicalSnapshot,
    ...queuedItems.filter((item) => (
      ['patient_clinical_records', 'child_records', 'maternal_records', 'immunization_records'].includes(item.table) &&
      item.localRecord && item.operation !== 'DELETE'
    )).map((item) => item.localRecord),
  ];
  const uniqueBy = (items, key) => [...new Map(items.map((item) => [String(item[key]), item])).values()];
  const uniqueClinical = uniqueBy(clinicalRecords, 'health_record_id');
  const uniqueChild = uniqueBy(childRecords, 'id');
  const uniqueMedical = uniqueBy(medicalRecords, 'id');
  const queuedResidents = queuedItems
    .filter((item) => item.table === 'residents' && item.localRecord && item.operation !== 'DELETE')
    .map((item) => item.localRecord);
  const residentsById = new Map([...residents, ...queuedResidents].map((resident) => [String(resident.resident_id), resident]));
  const legacy = [
    ...uniqueClinical.map((record) => ({ record, source_table: 'health_records', record_type: 'clinical', record_id: record.health_record_id })),
    ...uniqueChild.map((record) => ({ record, source_table: 'child_health_records', record_type: 'child', record_id: record.id })),
  ];
  const modern = uniqueMedical.map((record) => ({
    record,
    source_table: MEDICAL_TABLES[record.record_type],
    record_type: record.record_type,
    record_id: record.id,
  }));
  return [...legacy, ...modern].map(({ record, source_table, record_type, record_id }) => {
    const resident = residentsById.get(String(record.resident_id)) || record;
    const date = record.record_data ? getMedicalRecordDate(record) : String(record.record_date || '').slice(0, 10);
    const summary = record.record_data ? getSummary(record) : (
      record.assessment || record.chief_complaint || record.history_of_present_illness ||
      record.findings || record.plan || record.immunization_history || record.remarks || '-'
    );
    const searchText = record.record_data ? JSON.stringify(record.record_data) : [
      record.notes, record.assessment, record.chief_complaint, record.history_of_present_illness,
      record.findings, record.plan, record.remarks,
    ].filter(Boolean).join(' ');
    return {
      ...resident,
      resident_id: record.resident_id,
      record_id,
      record_type,
      record_label: LABELS[record_type],
      record_date: date,
      summary: String(summary),
      source_table,
      created_at: record.created_at,
      updated_at: record.updated_at,
      recorded_by: record.recorded_by,
      recorded_by_name: record.recorded_by_name,
      age: calculateAge(resident.birthdate),
      search_text: searchText,
      _record: record,
    };
  });
}

function paginate(items, params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const requestedSize = Number(params.pageSize || params.limit) || 10;
  const limit = [10, 25, 50].includes(requestedSize) ? requestedSize : 10;
  const total = items.length;
  return {
    items: items.slice((page - 1) * limit, page * limit),
    total,
    page,
    pageSize: limit,
    limit,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function listHealthRecords(params = {}) {
  if (isOffline()) {
    const records = await getOfflineLegacyClinicalRecords();
    let items = records.filter((record) => (
      (!params.resident_id || String(record.resident_id) === String(params.resident_id)) &&
      (!params.record_type || record.record_type === params.record_type) &&
      (!params.startDate || String(record.record_date || '') >= params.startDate) &&
      (!params.endDate || String(record.record_date || '') <= params.endDate)
    )).sort((first, second) => String(second.record_date || '').localeCompare(String(first.record_date || '')));
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Number(params.limit) || 25);
    const total = items.length;
    items = items.slice((page - 1) * limit, page * limit);
    return { success: true, data: { items, total, page, limit }, offline: true };
  }
  const response = await api.get('/health-records', { params });
  return response.data;
}

export async function listAllHealthRecords(params = {}) {
  if (isOffline()) {
    const allRecords = await getOfflineOverviewRecords();
    const search = String(params.search || '').trim().toLowerCase();
    const startDate = String(params.from || '');
    const endDate = String(params.to || '');
    const common = allRecords.filter((record) => (
      (!search || `${record.first_name || ''} ${record.middle_name || ''} ${record.last_name || ''} ${record.suffix || ''} ${record.record_label} ${record.record_type} ${record.record_date} ${record.summary} ${record.search_text}`.toLowerCase().includes(search)) &&
      (!startDate || record.record_date >= startDate) &&
      (!endDate || record.record_date <= endDate)
    ));
    const typeCounts = { clinical: 0, child: 0, maternal: 0, immunization: 0 };
    common.forEach((record) => { typeCounts[record.record_type] += 1; });
    let items = common.filter((record) => !params.type || record.record_type === params.type);
    const order = params.order === 'asc' ? 1 : -1;
    const sorters = {
      date: (first, second) => String(first.record_date).localeCompare(String(second.record_date)),
      resident: (first, second) => `${first.last_name || ''} ${first.first_name || ''}`.localeCompare(`${second.last_name || ''} ${second.first_name || ''}`),
      type: (first, second) => first.record_type.localeCompare(second.record_type),
    };
    items.sort((first, second) => order * (sorters[params.sort] || sorters.date)(first, second) ||
      String(second.created_at || '').localeCompare(String(first.created_at || '')) ||
      Number(second.record_id) - Number(first.record_id));
    const data = paginate(items, params);
    return {
      success: true,
      data: {
        ...data,
        items: data.items.map(({ _record, ...record }) => record),
        typeCounts,
        offline: true,
      },
    };
  }
  const response = await api.get('/health-records/overview', { params });
  return response.data;
}

export async function getHealthRecordDetails(sourceTable, recordId) {
  if (isOffline()) {
    const records = (await getOfflineOverviewRecords()).sort((first, second) => (
      String(second.record_date || '').localeCompare(String(first.record_date || '')) ||
      String(second.created_at || '').localeCompare(String(first.created_at || '')) ||
      Number(second.record_id) - Number(first.record_id)
    ));
    const currentIndex = records.findIndex((record) => (
      record.source_table === sourceTable && String(record.record_id) === String(recordId)
    ));
    if (currentIndex < 0) throw new Error('This health record has not been downloaded to this device.');
    const selected = records[currentIndex];
    const source = selected._record;
    const record = source.record_data
      ? {
        id: source.id,
        resident_id: source.resident_id,
        record_data: source.record_data,
        recorded_by: source.recorded_by,
        created_at: source.created_at,
        updated_at: source.updated_at,
      }
      : source;
    record.record_type = selected.record_type;
    record.record_label = selected.record_label;
    record.source_table = selected.source_table;
    record.record_date = selected.record_date;
    const residentRecords = records.filter((item) => String(item.resident_id) === String(selected.resident_id));
    const residentIndex = residentRecords.indexOf(selected);
    const recordKey = (item) => ({ type: item.record_type, sourceTable: item.source_table, recordId: item.record_id });
    const toPublicRecord = ({ _record, ...item }) => item;
    return {
      success: true,
      offline: true,
      data: {
        record: {
          ...record,
          ...(selected._record.record_data ? { record_data: selected._record.record_data } : {}),
        },
        resident: {
          resident_id: selected.resident_id,
          first_name: selected.first_name,
          middle_name: selected.middle_name,
          last_name: selected.last_name,
          suffix: selected.suffix,
          birthdate: selected.birthdate,
          sex: selected.sex,
          age: selected.age,
          household_no: selected.household_no,
          profile_photo: selected.profile_photo,
        },
        previousRecord: residentIndex > 0 ? recordKey(residentRecords[residentIndex - 1]) : null,
        nextRecord: residentIndex < residentRecords.length - 1 ? recordKey(residentRecords[residentIndex + 1]) : null,
        otherRecords: residentRecords.filter((_, index) => index !== residentIndex).slice(0, 5).map(toPublicRecord),
      },
    };
  }
  const response = await api.get(`/health-records/details/${encodeURIComponent(sourceTable)}/${recordId}`);
  return response.data;
}

export async function getHealthRecord(id) {
  if (isOffline()) {
    const records = await getOfflineLegacyClinicalRecords();
    const record = records.find((item) => String(item.health_record_id) === String(id));
    if (!record) throw new Error('This clinical record has not been downloaded to this device.');
    return { success: true, data: record, offline: true };
  }
  const response = await api.get(`/health-records/${id}`);
  return response.data;
}

export async function createHealthRecord(payload) {
  const offlineLocalRecord = {
    ...payload,
    record_type: payload.record_type || 'clinical',
    created_at: new Date().toISOString(),
    offline: true,
    sync_status: 'PENDING',
  };
  const response = await api.post('/health-records', payload, { offlineLocalRecord });
  return response.data;
}

export async function updateHealthRecord(id, payload) {
  const response = await api.put(`/health-records/${id}`, payload);
  return response.data;
}

export async function deleteHealthRecord(id) {
  const response = await api.delete(`/health-records/${id}`);
  return response.data;
}
