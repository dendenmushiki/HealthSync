import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { deleteHealthRecord, getHealthRecordDetails } from '../../services/api/healthRecordService';
import { deleteChildHealthRecord } from '../../services/api/childHealthService';
import { deleteResidentMedicalRecord } from '../../services/api/residentMedicalRecordService';
import ConfirmModal from '../../components/common/ConfirmModal';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { formatBirthdate, formatDateLabel, formatDateOnly } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';

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
const IMMUNIZATION_FIELDS = [
  ['newborn_screening_date', 'Newborn screening'],
  ['hearing_screening_date', 'Hearing screening'],
  ['vitamin_k_date', 'Vitamin K'],
  ['bcg_date', 'BCG'],
  ['hepa_b1_within_24_hours_date', 'Hepatitis B (within 24 hours)'],
  ['hepa_b1_after_24_hours_date', 'Hepatitis B (after 24 hours)'],
  ['mcvo_date', 'MCV0'],
  ['measles_date', 'Measles'],
  ['mmr_date', 'MMR'],
  ['vitamin_a_first_dose_date', 'Vitamin A · first dose'],
  ['vitamin_a_second_dose_date', 'Vitamin A · second dose']
];

const humanize = (value) => String(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const firstValue = (data, fields) => fields.map((field) => data[field]).find((value) => value !== null && value !== undefined && String(value).trim() !== '');
const formatValue = (value, key = '') => {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (/date|birthdate/i.test(key) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return formatDateLabel(value) || String(value);
  return String(value);
};
const parseRecordKey = (recordKey) => {
  const match = String(recordKey || '').match(/^(health_records|child_health_records|patient_clinical_records|child_records|maternal_records|immunization_records)-(\d+)$/);
  return match ? { sourceTable: match[1], recordId: match[2] } : null;
};
const pathForRelatedRecord = (record) => `/health-records/${record.type}/${encodeURIComponent(`${record.sourceTable}-${record.recordId}`)}`;

const TypeBadge = ({ type }) => <span className={`health-record-type-badge health-record-type-${type}`}><span className="health-record-type-icon" aria-hidden="true">{({ clinical: '✚', child: '⌂', maternal: '♡', immunization: '✓' })[type] || '•'}</span>{TYPES[type]?.label || 'Health Record'}</span>;

const RecordSection = ({ title, icon, children, className = '' }) => <section className={`health-record-detail-section ${className}`}>
  <header><span className="health-record-section-icon" aria-hidden="true">{icon}</span><h2>{title}</h2></header>
  {children}
</section>;

const Field = ({ label, value, date = false }) => <div className="health-record-detail-field">
  <dt>{label}</dt>
  <dd>{value ? (date ? formatDateLabel(value) || value : value) : <span className="health-record-muted">Not recorded</span>}</dd>
</div>;

const VitalTile = ({ label, value, unit, flag, icon }) => <div className={`health-record-vital-tile ${flag ? 'has-flag' : ''}`}>
  <span className="health-record-vital-icon" aria-hidden="true">{icon}</span>
  <span className="health-record-vital-label">{label}</span>
  <strong>{value === null || value === undefined || value === '' ? <span className="health-record-muted">Not recorded</span> : <>{value}<small>{unit}</small></>}</strong>
  {flag && <span className={`health-record-vital-flag ${flag.level}`}><span aria-hidden="true">!</span>{flag.label}</span>}
</div>;

function getVitalFlag(key, rawValue, age) {
  const value = Number.parseFloat(String(rawValue || '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(value)) return null;
  if (age !== null && age < 18 && ['blood_pressure', 'heart_rate', 'respiratory_rate'].includes(key)) return null;
  if (key === 'heart_rate' && (value > 100 || value < 60)) return { label: value > 100 ? 'High' : 'Low', level: 'warning' };
  if (key === 'respiratory_rate' && (value > 20 || value < 12)) return { label: 'Check value', level: 'warning' };
  if (key === 'temperature' && (value >= 38 || value < 35)) return { label: value >= 38 ? 'High' : 'Low', level: 'warning' };
  if (key === 'blood_pressure') {
    const [systolic, diastolic] = String(rawValue).split('/').map(Number);
    if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return null;
    if (systolic >= 130 || diastolic >= 80) return { label: 'High', level: 'warning' };
    if (systolic >= 120 && diastolic < 80) return { label: 'Elevated', level: 'warning' };
    if (systolic < 90 || diastolic < 60) return { label: 'Check value', level: 'warning' };
  }
  return null;
}

const HealthRecordDetailPage = () => {
  const { type, recordKey } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const parsedKey = useMemo(() => parseRecordKey(recordKey), [recordKey]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
          setError(loadError.response?.data?.message || loadError.message || 'Unable to load health record.');
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
  const sex = resident?.sex ? `${String(resident.sex).charAt(0).toUpperCase()}${String(resident.sex).slice(1).toLowerCase()}` : 'Sex not recorded';
  const birthdate = resident?.birthdate ? formatBirthdate(resident.birthdate) : null;
  const sourceTable = parsedKey?.sourceTable;
  const editHref = !resident ? '/health-records'
    : sourceTable === 'health_records' ? `/residents/${resident.resident_id}/clinical-records-legacy?recordId=${record?.health_record_id}`
      : sourceTable === 'child_health_records' ? `/residents/${resident.resident_id}/child-health-records-legacy?recordId=${record?.id}`
        : `/residents/${resident.resident_id}/medical-records/${type}?recordId=${record?.id}`;
  const clinicalVitals = [
    ['blood_pressure', 'Blood pressure', 'mmHg', '♥'],
    ['heart_rate', 'Heart rate', 'bpm', '♡'],
    ['respiratory_rate', 'Respiratory rate', 'breaths/min', '↗'],
    ['temperature', 'Temperature', '°C', '°'],
    ['weight_kg', 'Weight', 'kg', '⚖'],
    ['height_cm', 'Height', 'cm', '↕']
  ];
  const latestGrowth = Array.isArray(data.growth_rows) ? data.growth_rows[data.growth_rows.length - 1] : null;
  const vitalValues = {
    blood_pressure: firstValue(data, ['blood_pressure']),
    heart_rate: firstValue(data, ['heart_rate', 'pulse_rate']),
    respiratory_rate: firstValue(data, ['respiratory_rate']),
    temperature: firstValue(data, ['temperature']),
    weight_kg: firstValue(data, ['weight_kg']) || latestGrowth?.weight,
    height_cm: firstValue(data, ['height_cm']) || latestGrowth?.height
  };
  const weight = Number.parseFloat(vitalValues.weight_kg);
  const height = Number.parseFloat(vitalValues.height_cm);
  const bmi = weight > 0 && height > 0 ? weight / ((height / 100) ** 2) : null;
  const bmiCategory = bmi === null ? '' : bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';

  const soapFields = [
    ['S', 'Subjective', firstValue(data, ['history_of_present_illness', 'chief_complaint'])],
    ['O', 'Objective', firstValue(data, ['findings'])],
    ['A', 'Assessment', firstValue(data, ['assessment'])],
    ['P', 'Plan', firstValue(data, ['plan'])]
  ];
  const medicalHistory = firstValue(data, ['medical_history', 'past_medical_history', 'medical_conditions']);
  const remarks = firstValue(data, ['remarks', 'notes']);
  const maternalFields = [
    ['Gravida', firstValue(data, ['gravida'])],
    ['Para', firstValue(data, ['para'])],
    ['Abortion', firstValue(data, ['abortion'])],
    ['Last menstrual period', firstValue(data, ['lmp', 'last_menstrual_period'])],
    ['Age of gestation', firstValue(data, ['aog'])],
    ['Fetal heart tone', firstValue(data, ['fht_cm'])],
    ['Fetal heart beat', firstValue(data, ['fhb_bpm'])],
    ['Presentation', firstValue(data, ['presentation'])],
    ['Mid-upper arm circumference', firstValue(data, ['muac_cm'])],
    ['Pregnancy history', firstValue(data, ['pregnancy_history', 'obstetric_history', 'gravida_para'])],
    ['Menstrual history', firstValue(data, ['menstrual_history', 'menarche', 'menstrual_duration'])],
    ['Family planning', firstValue(data, ['family_planning_history', 'family_planning_method'])],
    ['Tetanus toxoid status', firstValue(data, ['tt_status'])],
    ['Past medical history', firstValue(data, ['pmh_history'])],
    ['Family medical history', firstValue(data, ['fmh_history'])],
    ['Maintenance medications', firstValue(data, ['maintenance_medications'])],
    ['Hospitalization history', firstValue(data, ['hospitalization_history'])]
  ];
  const childFields = [
    ['Birth history', firstValue(data, ['birth_history', 'birth_and_immunization_history'])],
    ['Immunization history', firstValue(data, ['immunization_history'])],
    ['Hospitalization history', firstValue(data, ['hospitalization_history'])],
    ['Medication allergies', firstValue(data, ['medication_allergies'])],
    ['Food allergies', firstValue(data, ['food_allergies'])],
    ['Family medical history', firstValue(data, ['family_medical_history'])],
    ['School', firstValue(data, ['school_name'])],
    ['Parent / guardian', firstValue(data, ['parent_guardian_name']) || [data.parent_first_name, data.parent_middle_name, data.parent_last_name].filter(Boolean).join(' ')]
  ];
  const immunizationFields = IMMUNIZATION_FIELDS.map(([key, label]) => [label, data[key]]).filter(([, value]) => value);
  if (Array.isArray(data.vaccine_rows)) {
    data.vaccine_rows.forEach((row, index) => {
      ['penta_hib', 'opv_ipv', 'pcv_1_3'].forEach((key) => {
        if (row[key]) immunizationFields.push([`${humanize(key)} · dose ${row.dose || index + 1}`, row[key]]);
      });
    });
  }

  const removeRecord = async () => {
    if (!record) return;
    setDeleting(true);
    try {
      if (sourceTable === 'health_records') await deleteHealthRecord(record.health_record_id);
      else if (sourceTable === 'child_health_records') await deleteChildHealthRecord(record.id);
      else await deleteResidentMedicalRecord(record.resident_id, type, record.id);
      navigate(location.state?.from || '/health-records', { replace: true, state: { recordToast: 'Record deleted.' } });
    } catch (deleteError) {
      setError(deleteError.response?.data?.message || 'Unable to delete health record.');
      setRecordToDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <main className="health-record-detail-page" aria-busy="true" aria-label="Loading health record">
    <div className="health-record-detail-skeleton"><span /><span /><span /><div /></div>
  </main>;
  if (notFound) return <main className="health-record-detail-page"><section className="health-record-state-card"><span className="health-record-empty-icon" aria-hidden="true">?</span><h1>Record not found</h1><p>This health record may have been deleted or is no longer available.</p><Link className="health-record-secondary-button" to={location.state?.from || '/health-records'}>Back to health records</Link></section></main>;
  if (error && !detail) return <main className="health-record-detail-page"><section className="health-record-state-card" role="alert"><h1>Unable to load health record</h1><p>{error}</p><button className="health-record-secondary-button" type="button" onClick={() => setRetry((current) => current + 1)}>Try again</button></section></main>;
  if (!record || !resident) return null;

  return <main className="health-record-detail-page">
    <nav className="health-record-breadcrumb" aria-label="Breadcrumb">
      <Link to={location.state?.from || '/health-records'}>Health records</Link><span aria-hidden="true">/</span>
      <Link to={`/residents/${resident.resident_id}`}>{residentName}</Link><span aria-hidden="true">/</span>
      <span aria-current="page">{TYPES[type]?.title || 'Health record'} · {dateLabel}</span>
    </nav>
    <header className="health-record-profile-card">
      <div className="health-record-profile-main">
        <span className="health-record-profile-avatar">{resident.profile_photo && <img src={getProfilePhotoUrl(resident.profile_photo)} alt="" onError={(event) => event.currentTarget.remove()} />}{`${resident.first_name?.charAt(0) || ''}${resident.last_name?.charAt(0) || ''}`.toUpperCase()}</span>
        <div className="health-record-profile-copy">
          <TypeBadge type={type} />
          <h1><Link to={`/residents/${resident.resident_id}`}>{residentName}</Link></h1>
          <p>{age === null ? 'Age unknown' : `${age} years`} <span aria-hidden="true">·</span> {sex}</p>
          <div className="health-record-profile-meta"><span>{dateLabel}{(data.visit_time || data.record_time) ? ` · ${data.visit_time || data.record_time}` : ''}</span><span>Recorded by {record.recorded_by_name || 'Not recorded'}</span></div>
        </div>
      </div>
      <div className="health-record-profile-actions">
        {detail.previousRecord && <Link className="health-record-secondary-button" to={pathForRelatedRecord(detail.previousRecord)} state={{ from: location.state?.from }}>← Previous record</Link>}
        {detail.nextRecord && <Link className="health-record-secondary-button" to={pathForRelatedRecord(detail.nextRecord)} state={{ from: location.state?.from }}>Next record →</Link>}
        <Link className="health-record-primary-button" to={editHref}>Edit</Link>
        <Link className="health-record-secondary-button" to={`/residents/${resident.resident_id}`}>View resident</Link>
        <button type="button" className="health-record-secondary-button" onClick={() => window.print()}>Print</button>
        <div className="health-record-detail-menu">
          <button type="button" className="health-record-icon-button" aria-label="More record actions" aria-expanded={showMenu} onClick={() => setShowMenu((open) => !open)}>⋯</button>
          {showMenu && <div className="health-record-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setShowMenu(false); setRecordToDelete(true); }}>Delete record</button></div>}
        </div>
      </div>
    </header>

    {error && <div className="health-record-error" role="alert">{error}</div>}
    <div className="health-record-detail-layout">
      <div className="health-record-detail-main">
        {type !== 'immunization' && <RecordSection title="Vitals" icon="＋">
          <div className="health-record-vitals-grid">
            {clinicalVitals.map(([key, label, unit, icon]) => <VitalTile key={key} label={label} value={vitalValues[key]} unit={unit} icon={icon} flag={getVitalFlag(key, vitalValues[key], age)} />)}
            {bmi !== null && <div className="health-record-vital-tile health-record-bmi-tile"><span className="health-record-vital-icon" aria-hidden="true">BMI</span><span className="health-record-vital-label">Body mass index</span><strong>{bmi.toFixed(1)}<small>kg/m²</small></strong><span className={`health-record-bmi-badge ${bmiCategory.toLowerCase()}`}>{age !== null && age < 18 ? 'Age-specific review' : bmiCategory}</span></div>}
          </div>
          <p className="health-record-screening-note">Vital flags and BMI categories are screening hints, not diagnoses.</p>
        </RecordSection>}

        {(type === 'clinical' || type === 'child' || type === 'maternal') && <RecordSection title="Clinical notes" icon="✎">
          <div className="health-record-soap-list">
            {soapFields.map(([letter, label, value]) => <article className={`health-record-soap-item ${value ? '' : 'is-empty'}`} key={letter}>
              <span className="health-record-soap-letter">{letter}</span><div><h3>{label}</h3><p>{value ? formatValue(value) : <span className="health-record-muted">Not recorded</span>}</p></div>
            </article>)}
          </div>
        </RecordSection>}

        {type === 'clinical' && <RecordSection title="History" icon="◷">
          <dl className="health-record-fields-grid">
            <Field label="Medical history" value={medicalHistory} />
            <Field label="Remarks" value={remarks} />
          </dl>
        </RecordSection>}

        {type === 'child' && <RecordSection title="Child health and growth" icon="⌂">
          <dl className="health-record-fields-grid">
            {childFields.map(([label, value]) => <Field key={label} label={label} value={value && formatValue(value)} />)}
            <Field label="Birth weight" value={data.birth_weight_kg ? `${data.birth_weight_kg} kg` : ''} />
          </dl>
          {Array.isArray(data.growth_rows) && data.growth_rows.length > 0 && <div className="health-record-growth-table-wrap"><table className="health-record-growth-table"><thead><tr><th scope="col">Date</th><th scope="col">Age</th><th scope="col">Weight</th><th scope="col">Height</th><th scope="col">MUAC</th><th scope="col">Remarks</th></tr></thead><tbody>{data.growth_rows.map((row, index) => <tr key={`growth-${index}`}><td>{formatDateLabel(row.date) || 'Not recorded'}</td><td>{row.age || '—'}</td><td>{row.weight ? `${row.weight} kg` : '—'}</td><td>{row.height ? `${row.height} cm` : '—'}</td><td>{row.muac ? `${row.muac} cm` : '—'}</td><td>{row.remarks || '—'}</td></tr>)}</tbody></table></div>}
        </RecordSection>}

        {type === 'maternal' && <RecordSection title="Maternal health" icon="♡">
          <dl className="health-record-fields-grid">
            {maternalFields.map(([label, value]) => <Field key={label} label={label} value={value && formatValue(value)} date={label === 'Last menstrual period'} />)}
            <Field label="Medical history" value={medicalHistory} />
            <Field label="Remarks" value={remarks} />
          </dl>
        </RecordSection>}

        {type === 'immunization' && <RecordSection title="Immunizations" icon="＋">
          {immunizationFields.length ? <dl className="health-record-fields-grid">
            {immunizationFields.map(([label, value]) => <Field key={label} label={label} value={formatValue(value, label)} date={true} />)}
          </dl> : <p className="health-record-not-recorded">No immunization doses were recorded.</p>}
        </RecordSection>}

        <RecordSection title="Patient and visit information" icon="i">
          <dl className="health-record-fields-grid">
            <Field label="Birthdate" value={birthdate} />
            <Field label="Sex" value={sex === 'Sex not recorded' ? '' : sex} />
            <Field label="Record date" value={dateLabel === 'Date not recorded' ? '' : dateLabel} />
            <Field label="Record type" value={data.record_type || data.client_type || TYPES[type]?.label} />
            <Field label="Recorded by" value={record.recorded_by_name} />
            <Field label="Household number" value={resident.household_no} />
            {data.visit_time && <Field label="Visit time" value={data.visit_time} />}
          </dl>
          <p className="health-record-timestamp-footer">
            {record.created_at && <>Created {formatDateOnly(record.created_at, { month: 'short' }) || 'date unavailable'}</>}
            {record.updated_at && <> · Last updated {formatDateOnly(record.updated_at, { month: 'short' }) || 'date unavailable'}</>}
          </p>
        </RecordSection>
      </div>

      <aside className="health-record-detail-aside">
        <section className="health-record-related-card"><header><h2>Other records for this resident</h2><span>Recent</span></header>
          {detail.otherRecords?.length ? <ul>{detail.otherRecords.map((item) => <li key={`${item.source_table}-${item.record_id}`}>
            <Link to={pathForRelatedRecord({ type: item.record_type, sourceTable: item.source_table, recordId: item.record_id })} state={{ from: location.state?.from }}>
              <span><TypeBadge type={item.record_type} /><strong>{item.record_label || TYPES[item.record_type]?.label}</strong><small>{formatDateLabel(item.record_date) || 'Date not recorded'}</small></span><span aria-hidden="true">→</span>
            </Link>
          </li>)}</ul> : <p className="health-record-not-recorded">No other records available.</p>}
        </section>
      </aside>
    </div>
    <ConfirmModal open={recordToDelete} title="Delete health record?" message={`Delete ${TYPES[type]?.label || 'health record'} dated ${dateLabel}? This cannot be undone.`} busy={deleting} onCancel={() => setRecordToDelete(false)} onConfirm={removeRecord} />
  </main>;
};

export default HealthRecordDetailPage;
