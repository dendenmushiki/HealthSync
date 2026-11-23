import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Pencil, Printer } from 'lucide-react';
import { getHealthRecordDetails } from '../../services/api/healthRecordService';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateLabel } from '../../utils/dateUtils';
import StatusBanner from '../../components/common/StatusBanner';
import HealthRecordDocument from './HealthRecordDocument';

const TYPES = {
  clinical: { label: 'Clinical Record', title: 'Clinical record' },
  child: { label: 'Child Record', title: 'Child record' },
  maternal: { label: 'Maternal Record', title: 'Maternal record' },
  immunization: { label: 'Immunization Record', title: 'Immunization record' }
};
const SOURCE_TYPES = {
  health_records: 'clinical',
  patient_clinical_records: 'clinical',
  child_health_records: 'child',
  child_records: 'child',
  maternal_records: 'maternal',
  immunization_records: 'immunization'
};

const parseRecordKey = (recordKey) => {
  const match = String(recordKey || '').match(/^(health_records|child_health_records|patient_clinical_records|child_records|maternal_records|immunization_records)-(\d+)$/);
  return match ? { sourceTable: match[1], recordId: match[2] } : null;
};

const pathForRelatedRecord = (record) => `/health-records/${record.type}/${encodeURIComponent(`${record.sourceTable}-${record.recordId}`)}`;
const emptyValue = (value) => value === null || value === undefined || String(value).trim() === '' ? '—' : value;

function getVitalFlag(label, value, age) {
  const key = label.startsWith('BP') ? 'blood_pressure'
    : label.startsWith('HR') ? 'heart_rate'
      : label.startsWith('RR') ? 'respiratory_rate'
        : label.startsWith('Temperature') ? 'temperature' : '';
  if (!key || !emptyValue(value) || emptyValue(value) === '—') return '';
  if (age !== null && age < 18 && ['blood_pressure', 'heart_rate', 'respiratory_rate'].includes(key)) return '';
  if (key === 'heart_rate') {
    const number = Number.parseFloat(String(value));
    if (number > 100) return 'High';
    if (number < 60) return 'Low';
  }
  if (key === 'respiratory_rate') {
    const number = Number.parseFloat(String(value));
    if (number > 20 || number < 12) return 'Check value';
  }
  if (key === 'temperature') {
    const number = Number.parseFloat(String(value));
    if (number >= 38) return 'High';
    if (number < 35) return 'Low';
  }
  if (key === 'blood_pressure') {
    const [systolic, diastolic] = String(value).split('/').map(Number);
    if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return '';
    if (systolic >= 130 || diastolic >= 80) return 'High';
    if (systolic >= 120 && diastolic < 80) return 'Elevated';
    if (systolic < 90 || diastolic < 60) return 'Check value';
  }
  return '';
}

function VitalSummary({ data, age }) {
  const values = [
    ['BP (mmHg)', data.blood_pressure],
    ['HR (bpm)', data.heart_rate ?? data.pulse_rate],
    ['RR (breaths/min)', data.respiratory_rate],
    ['Height (cm)', data.height_cm],
    ['Weight (kg)', data.weight_kg],
    ['Temperature (°C)', data.temperature]
  ];
  const weight = Number.parseFloat(data.weight_kg);
  const height = Number.parseFloat(data.height_cm);
  const bmi = weight > 0 && height > 0 ? weight / ((height / 100) ** 2) : null;
  const bmiCategory = bmi === null ? '' : bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';

  return <section className="health-record-document-section health-record-document-screening">
    <h2>Objective / Vitals</h2>
    <div className="health-record-document-table-wrap">
      <table className="health-record-document-table">
        <thead><tr>{values.map(([label]) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody><tr>{values.map(([label, value]) => {
          const flag = getVitalFlag(label, value, age);
          return <td key={label}>{emptyValue(value)}{flag && <small className="health-record-document-vital-flag">{flag}</small>}</td>;
        })}</tr></tbody>
      </table>
    </div>
    {bmi !== null && <>
      <p className="health-record-document-bmi"><span>BMI</span><strong>{bmi.toFixed(1)} kg/m²</strong><span>{age !== null && age < 18 ? 'Age-specific review' : bmiCategory}</span></p>
      <p className="health-record-document-screening-note">Screening information only; not a diagnosis.</p>
    </>}
  </section>;
}

const HealthRecordDetailPage = () => {
  const { type, recordKey } = useParams();
  const location = useLocation();
  const parsedKey = useMemo(() => parseRecordKey(recordKey), [recordKey]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    if (!parsedKey || SOURCE_TYPES[parsedKey.sourceTable] !== type) {
      setLoading(false);
      setNotFound(true);
      return undefined;
    }
    const load = async () => {
      setLoading(true);
      setError('');
      setDetail(null);
      setNotFound(false);
      try {
        const response = await getHealthRecordDetails(parsedKey.sourceTable, parsedKey.recordId);
        if (!response?.success || !response.data) throw new Error(response?.message || 'Unable to load health record.');
        if (active) setDetail(response.data);
      } catch (loadError) {
        if (active) {
          setNotFound(loadError.response?.status === 404);
          console.error('Unable to load health record.', loadError);
          setError(loadError);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [parsedKey, retry, type]);

  const record = detail?.record;
  const resident = detail?.resident || record;
  const data = record?.record_data && typeof record.record_data === 'object' ? record.record_data : (record || {});
  const recordDate = record && (record.record_date || record.visit_date || data.visit_date || record.created_at);
  const dateLabel = formatDateLabel(recordDate) || 'Date not recorded';
  const residentName = resident ? formatResidentName(resident) || 'Resident' : 'Resident';
  const age = resident?.age ?? calculateAge(resident?.birthdate);
  const sourceTable = parsedKey?.sourceTable;
  const editHref = !resident ? '/health-records'
    : sourceTable === 'health_records' ? `/residents/${resident.resident_id}/clinical-records-legacy?recordId=${record?.health_record_id}`
      : sourceTable === 'child_health_records' ? `/residents/${resident.resident_id}/child-health-records-legacy?recordId=${record?.id}`
        : `/residents/${resident.resident_id}/medical-records/${type}?recordId=${record?.id}`;
  const previousRecord = detail?.previousRecord;
  const nextRecord = detail?.nextRecord;
  const recordTypeLabel = TYPES[type]?.label || 'Health Record';

  if (loading) return <main className="health-record-detail-page" aria-busy="true" aria-label="Loading health record">
    <div className="health-record-detail-skeleton"><span /><span /><span /><div /></div>
  </main>;
  if (notFound) return <main className="health-record-detail-page"><section className="health-record-state-card"><h1>Record not found</h1><p>This health record may have been deleted or is no longer available.</p><Link className="health-record-secondary-button" to={location.state?.from || '/health-records'}>Back to health records</Link></section></main>;
  if (error && !detail) return <main className="health-record-detail-page"><section className="health-record-state-card"><h1>Unable to load health record</h1><StatusBanner error={error} retry={() => setRetry((current) => current + 1)} /></section></main>;
  if (!record || !resident) return null;

  const clinicalVisits = (detail.clinicalVisits || detail.otherRecords || []).filter((visit) => (
    visit.record_type === 'clinical' &&
    !(visit.source_table === sourceTable && String(visit.record_id) === String(record.id || record.health_record_id))
  ));

  return <main className="health-record-detail-page health-record-document-page">
    <div className="health-record-document-toolbar">
      <div className="health-record-document-toolbar-meta">
        <h1>{residentName}</h1>
        <span>{recordTypeLabel} · {dateLabel} · Status: {emptyValue(record.status || data.status)}</span>
      </div>
      <div className="health-record-document-toolbar-actions">
        <Link to={location.state?.from || '/health-records'}><ArrowLeft size={16} aria-hidden="true" />Back to Health Records</Link>
        {previousRecord && <Link aria-label="Previous record" to={pathForRelatedRecord(previousRecord)} state={{ from: location.state?.from }}><ArrowLeft size={16} aria-hidden="true" />Previous</Link>}
        {nextRecord && <Link aria-label="Next record" to={pathForRelatedRecord(nextRecord)} state={{ from: location.state?.from }}>Next<ArrowRight size={16} aria-hidden="true" /></Link>}
        <Link className="health-record-document-edit" to={editHref}><Pencil size={15} aria-hidden="true" />Edit Record</Link>
        <button type="button" onClick={() => window.print()}><Printer size={15} aria-hidden="true" />Print / Save PDF</button>
      </div>
    </div>

    {error && <StatusBanner error={error} compact />}
    <HealthRecordDocument
      type={type}
      title={record.record_label || recordTypeLabel}
      date={recordDate}
      record={record}
      resident={resident}
      data={data}
      relatedRecords={clinicalVisits}
      clinicalVitals={type === 'clinical' ? <VitalSummary data={data} age={age} /> : null}
    >
      {clinicalVisits.length > 0 && <section className="health-record-document-section">
        <h2>Open a previous clinical record</h2>
        <ul className="health-record-document-history-links">
          {clinicalVisits.filter((visit) => visit.source_table && visit.record_id).map((visit) => (
            <li key={`${visit.source_table}-${visit.record_id}`}>
              <Link to={pathForRelatedRecord({ type: visit.record_type, sourceTable: visit.source_table, recordId: visit.record_id })}>
                {formatDateLabel(visit.record_date) || 'Date not recorded'} · {visit.record_label || 'Clinical Record'} · {emptyValue(visit.recorded_by_name)}
              </Link>
            </li>
          ))}
        </ul>
      </section>}
    </HealthRecordDocument>
  </main>;
};

export default HealthRecordDetailPage;
