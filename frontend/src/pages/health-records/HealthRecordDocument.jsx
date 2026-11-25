import React, { useEffect } from 'react';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateLabel } from '../../utils/dateUtils';
import { medicalRecordForms } from '../residents/medicalRecordFormConfig';
import './HealthRecordDocument.css';

const EMPTY_VALUE = '—';
const INTERNAL_FIELDS = new Set([
  'id', 'health_record_id', 'resident_id', 'recorded_by', 'recorded_by_name',
  'created_at', 'updated_at', 'record_date', 'record_data', 'record_type',
  'record_label', 'source_table', 'sync_status', 'offline', 'first_name',
  'middle_name', 'last_name', 'suffix', 'birthdate', 'sex', 'age',
  'household_no', 'profile_photo', 'resident_status', 'civil_status',
  'address', 'sitio', 'contact_no', 'philhealth_id_no', 'occupation',
  'religion', 'birthplace', 'educational_attainment'
]);

const humanize = (value) => String(value || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';

function displayValue(value, field = {}) {
  if (!hasValue(value)) return EMPTY_VALUE;
  if (field.type === 'date' || /date|birthdate|lmp|edc/i.test(field.name || '')) {
    return formatDateLabel(value) || String(value);
  }
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => typeof item === 'object' ? Object.values(item).filter(hasValue).join(' · ') : String(item)).join(', ') : EMPTY_VALUE;
  }
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${humanize(key)}: ${displayValue(item)}`).join(' · ');
  return String(value);
}

function getResidentField(field, resident, data) {
  if (hasValue(data[field.name])) return data[field.name];
  if (field.options === 'full_name') return formatResidentName(resident);
  if (field.options === 'age') return calculateAge(resident?.birthdate);
  if (field.options === 'birthdate') return resident?.birthdate;
  return resident?.[field.options];
}

export function HealthRecordDocumentField({ label, value, field }) {
  return <div className="health-record-document-field">
    <dt>{label}</dt>
    <dd>{displayValue(value, field)}</dd>
  </div>;
}

export function HealthRecordDocumentSection({ title, children }) {
  return <section className="health-record-document-section">
    <h2>{title}</h2>
    {children}
  </section>;
}

function ConfiguredField({ field, data }) {
  const value = data[field.name];
  const columns = field.options?.columns;
  if (field.type === 'table' && Array.isArray(value) && columns) {
    return <div className="health-record-document-table-wrap">
      <table className="health-record-document-table">
        <thead><tr>{columns.map((column) => <th key={column.name}>{column.label}</th>)}</tr></thead>
        <tbody>
          {value.length ? value.map((row, index) => <tr key={`${field.name}-${index}`}>
            {columns.map((column) => <td key={column.name}>{displayValue(row?.[column.name], column)}</td>)}
          </tr>) : <tr><td colSpan={columns.length}>{EMPTY_VALUE}</td></tr>}
        </tbody>
      </table>
    </div>;
  }
  return <HealthRecordDocumentField label={field.label} value={value} field={field} />;
}

function PatientInformation({ type, resident, data }) {
  const config = medicalRecordForms[type];
  if (config) {
    return <HealthRecordDocumentSection title="Patient Information">
      <dl className="health-record-document-grid">
        {config.demographics.map((field) => <HealthRecordDocumentField key={field.name} label={field.name === 'sex' ? 'Sex' : field.name === 'family_serial_number' ? 'Family Serial Number' : field.name === 'philhealth_number' ? 'PhilHealth Number' : field.name === 'contact_number' ? 'Contact Number' : field.label} value={getResidentField(field, resident, data)} field={field} />)}
      </dl>
    </HealthRecordDocumentSection>;
  }

  const patientFields = [
    ['Full name', formatResidentName(resident)],
    ['Age', resident?.age ?? calculateAge(resident?.birthdate)],
    ['Date of birth', resident?.birthdate],
    ['Sex', resident?.sex],
    ['Civil status', resident?.civil_status],
    ['Address', resident?.address],
    ['Sitio / Purok', resident?.sitio],
    ['Household information', resident?.household_no],
    ['Contact number', resident?.contact_no],
    ['PhilHealth number', resident?.philhealth_id_no],
    ['Occupation', resident?.occupation],
  ];
  return <HealthRecordDocumentSection title="Patient Information">
    <dl className="health-record-document-grid">
      {patientFields.map(([label, value]) => <HealthRecordDocumentField key={label} label={label} value={value} field={{ name: label }} />)}
    </dl>
  </HealthRecordDocumentSection>;
}

function ConfiguredRecordBody({ type, data, clinicalVitals }) {
  const config = medicalRecordForms[type];
  const representedFields = new Set([
    ...config.demographics.map((field) => field.name),
    ...config.sections.flatMap((section) => section.fields.map((field) => field.name))
  ]);
  const additionalFields = Object.entries(data).filter(([key, value]) => (
    !representedFields.has(key) && !INTERNAL_FIELDS.has(key) && hasValue(value)
  ));

  if (type === 'clinical') {
    const clinicalFields = config.sections[0].fields;
    const fieldByName = new Map(clinicalFields.map((field) => [field.name, field]));
    const clinicalGroups = [
      ['Clinical Notes', ['visit_date', 'visit_time', 'history_of_present_illness']],
      ['Findings', ['findings']],
      ['Assessment', ['assessment']],
      ['Plan', ['plan']]
    ];
    return <>
      {clinicalGroups.slice(0, 1).map(([title, names]) => <HealthRecordDocumentSection key={title} title={title}>
        <dl className="health-record-document-grid">{names.map((name) => {
          const field = fieldByName.get(name);
          return <HealthRecordDocumentField key={name} label={field.label} value={data[name]} field={field} />;
        })}</dl>
      </HealthRecordDocumentSection>)}
      {clinicalVitals}
      {clinicalGroups.slice(1).map(([title, names]) => <HealthRecordDocumentSection key={title} title={title}>
        <dl className="health-record-document-grid">{names.map((name) => {
          const field = fieldByName.get(name);
          return <HealthRecordDocumentField key={name} label={field.label} value={data[name]} field={field} />;
        })}</dl>
      </HealthRecordDocumentSection>)}
      {config.sections.slice(1).map((section) => <HealthRecordDocumentSection key={section.title} title={section.title}>
        <dl className="health-record-document-grid">
          {section.fields.map((field) => <ConfiguredField key={field.name} field={field} data={data} />)}
        </dl>
      </HealthRecordDocumentSection>)}
      {additionalFields.length > 0 && <HealthRecordDocumentSection title="Additional Saved Information">
        <div className="health-record-document-grid">
          {additionalFields.map(([key, value]) => <AdditionalSavedField key={key} field={key} value={value} />)}
        </div>
      </HealthRecordDocumentSection>}
    </>;
  }

  return <>
    {config.sections.map((section) => <HealthRecordDocumentSection key={section.title} title={section.title}>
      {section.fields.some((field) => field.type === 'table' && Array.isArray(data[field.name]))
        ? <div className="health-record-document-grid">
          {section.fields.map((field) => <ConfiguredField key={field.name} field={field} data={data} />)}
        </div>
        : <dl className="health-record-document-grid">
          {section.fields.map((field) => <ConfiguredField key={field.name} field={field} data={data} />)}
        </dl>}
    </HealthRecordDocumentSection>)}
    {additionalFields.length > 0 && <HealthRecordDocumentSection title="Additional Saved Information">
      <div className="health-record-document-grid">
        {additionalFields.map(([key, value]) => <AdditionalSavedField key={key} field={key} value={value} />)}
      </div>
    </HealthRecordDocumentSection>}
  </>;
}

function LegacyRecordBody({ data }) {
  const fields = Object.entries(data).filter(([key]) => !INTERNAL_FIELDS.has(key));
  return <HealthRecordDocumentSection title="Clinical Record Details">
    <dl className="health-record-document-grid">
      {fields.map(([key, value]) => <HealthRecordDocumentField key={key} label={humanize(key)} value={value} field={{ name: key }} />)}
    </dl>
  </HealthRecordDocumentSection>;
}

function AdditionalSavedField({ field, value }) {
  const columns = Array.isArray(value) && value.some((row) => row && typeof row === 'object')
    ? [...new Set(value.flatMap((row) => row && typeof row === 'object' ? Object.keys(row) : []))]
    : [];
  if (!columns.length) return <HealthRecordDocumentField label={humanize(field)} value={value} field={{ name: field }} />;
  return <div className="health-record-document-full-field">
    <span>{humanize(field)}</span>
    <div className="health-record-document-table-wrap">
      <table className="health-record-document-table">
        <thead><tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}</tr></thead>
        <tbody>{value.map((row, index) => <tr key={`${field}-${index}`}>
          {columns.map((column) => <td key={column}>{displayValue(row?.[column], { name: column })}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

export default function HealthRecordDocument({
  type,
  title,
  date,
  record,
  resident,
  data = {},
  relatedRecords = [],
  children,
  clinicalVitals,
  hideUnconfiguredFields = false,
}) {
  useEffect(() => {
    document.body.classList.add('healthsync-print-health-record');
    return () => document.body.classList.remove('healthsync-print-health-record');
  }, []);

  const recordId = record?.id || record?.health_record_id;
  const recordStatus = record?.status || data.status;
  const clinicalVisits = relatedRecords.filter((item) => item.record_type === 'clinical');
  const isConfiguredRecord = Boolean(medicalRecordForms[type]);

  return <article className="health-record-document-sheet">
    <header className="health-record-document-header">
      <div className="health-record-document-brand">
        <img className="health-record-document-mark" src="/images/healthsynclogo.png" alt="" />
        <span><strong>HealthSync</strong><small>Barangay Health Monitoring</small></span>
      </div>
      <div className="health-record-document-office">
        <strong>Barangay Estancia</strong>
        <span>Kalibo, Aklan</span>
      </div>
      <div className="health-record-document-title">
        <span>HEALTH RECORD</span>
        <h1>{title}</h1>
        {(record?.offline === true || record?.sync_status === 'PENDING' || data?.offline === true || data?.sync_status === 'PENDING') &&
          <span className="healthsync-not-synced-badge">Not synced</span>}
      </div>
      <div className="health-record-document-reference">
        <span>Record / Reference No.</span><strong>{recordId ?? EMPTY_VALUE}</strong>
        <span>Date of visit / assessment</span><strong>{displayValue(date, { type: 'date' })}</strong>
      </div>
    </header>

    <PatientInformation type={type} resident={resident} data={data} />

    {isConfiguredRecord
      ? <ConfiguredRecordBody type={type} data={data} clinicalVitals={clinicalVitals} />
      : !hideUnconfiguredFields && <LegacyRecordBody data={data} />}
    {!isConfiguredRecord && clinicalVitals}
    {children}

    {type === 'clinical' && <HealthRecordDocumentSection title="Visit History">
      {clinicalVisits.length ? <div className="health-record-document-table-wrap">
        <table className="health-record-document-table">
          <thead><tr><th>Date</th><th>Record type</th><th>Recorded by</th><th>Status</th></tr></thead>
          <tbody>{clinicalVisits.map((visit) => <tr key={`${visit.source_table}-${visit.record_id}`}>
            <td>{displayValue(visit.record_date, { type: 'date' })}</td>
            <td>{visit.record_label || 'Clinical Record'}</td>
            <td>{displayValue(visit.recorded_by_name)}</td>
            <td>{displayValue(visit.status)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="health-record-document-empty">No previous clinical visits are available.</p>}
    </HealthRecordDocumentSection>}

    <footer className="health-record-document-footer">
      <div className="health-record-document-footer-meta">
        <span>Recorded by <strong>{displayValue(record?.recorded_by_name)}</strong></span>
        <span>Date recorded <strong>{displayValue(record?.created_at, { type: 'date' })}</strong></span>
        <span>Last updated <strong>{displayValue(record?.updated_at, { type: 'date' })}</strong></span>
        <span>Record status <strong>{displayValue(recordStatus)}</strong></span>
      </div>
      <div className="health-record-document-signature">
        <span>Responsible health worker</span>
        <i aria-hidden="true" />
        <small>Signature / printed name</small>
      </div>
      <p>Generated from the HealthSync health record system. This document does not represent an electronic signature.</p>
    </footer>
  </article>;
}
