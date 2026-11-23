import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Baby,
  CalendarClock,
  CalendarDays,
  Check,
  ClipboardList,
  Clock3,
  Copy as CopyIcon,
  ExternalLink,
  HeartPulse,
  Loader2,
  Plus,
  Ruler,
  Save,
  Syringe,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import {
  createResidentMedicalRecord,
  listResidentMedicalRecords,
  updateResidentMedicalRecord
} from '../../services/api/residentMedicalRecordService';
import { calculateAge as getResidentAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateOnly, getLocalDateInputValue, getLocalTimeInputValue, toDateInputValue } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import { medicalRecordForms } from './medicalRecordFormConfig';

const emptyDate = () => getLocalDateInputValue();
const calculateAge = (birthdate) => {
  const age = getResidentAge(birthdate);
  return age === null ? '' : String(age);
};
const blankData = (config) => {
  const values = {};
  config.demographics.forEach((item) => { values[item.name] = item.type === 'checkboxes' ? [] : ''; });
  config.sections.forEach((section) => section.fields.forEach((item) => {
    if (item.type === 'table') values[item.name] = item.options.fixedRows ? item.options.fixedRows.map((dose) => ({ dose })) : [];
    else values[item.name] = item.type === 'checkboxes' ? [] : '';
  }));
  return values;
};
const residentValue = (field, resident) => {
  if (field.options === 'full_name') return [resident.first_name, resident.middle_name, resident.last_name, resident.suffix].filter(Boolean).join(' ');
  if (field.options === 'age') return calculateAge(resident.birthdate);
  if (field.options === 'birthdate') return toDateInputValue(resident.birthdate);
  return resident[field.options] ?? '';
};

const SECTION_ICONS = {
  'Visit Details': CalendarClock,
  'Medical History': HeartPulse,
  'Parent Information': UsersRound,
  'Growth and Vital Signs': Ruler,
  'Immunization Details': Syringe,
  'Medical and Past History': HeartPulse,
};
const FIELD_UNITS = {
  blood_pressure: 'mmHg',
  pulse_rate: 'bpm',
  temperature: '°C',
  weight_kg: 'kg',
  birth_weight_kg: 'kg',
  respiratory_rate: 'breaths/min',
  height_cm: 'cm',
};
const SUBGROUPS = {
  child: {
    'Visit Details': [
      ['Visit information', ['visit_date', 'visit_time']],
      ['Visit notes', ['history_of_present_illness']],
      ['Vital signs', ['blood_pressure', 'pulse_rate', 'temperature', 'weight_kg', 'respiratory_rate', 'height_cm']],
      ['Assessment and plan', ['findings', 'assessment', 'plan']],
    ],
    'Medical History': [
      ['Medical history', ['hospitalization_history', 'medication_allergies', 'food_allergies']],
      ['Family history', ['family_medical_history']],
      ['Birth and immunization history', ['birth_and_immunization_history']],
    ],
  },
  immunization: {
    'Parent Information': [
      ['Mother', ['mother_name', 'mother_birthdate', 'mother_educational_attainment']],
      ['Father', ['father_name', 'father_birthdate', 'father_educational_attainment']],
    ],
    'Growth and Vital Signs': [['Growth records', ['growth_rows']]],
    'Immunization Details': [
      ['Screening and immunization dates', [
        'newborn_screening_date', 'hearing_screening_date', 'vitamin_k_date', 'bcg_date',
        'hepa_b1_within_24_hours_date', 'hepa_b1_after_24_hours_date', 'mcvo_date', 'measles_date',
        'mmr_date', 'vitamin_a_first_dose_date', 'vitamin_a_second_dose_date',
      ]],
      ['Vaccine doses', ['vaccine_rows']],
    ],
  },
};

const MedicalField = ({ field, value, onChange, disabled = false }) => {
  const id = `medical-${field.name}`;
  if (field.type === 'table') {
    const columns = field.options.columns;
    const rows = Array.isArray(value) ? value : [];
    const addRow = () => onChange([...rows, Object.fromEntries(columns.filter((column) => column.type !== 'readonly').map((column) => [column.name, '']))]);
    const updateCell = (rowIndex, columnName, nextValue) => onChange(rows.map((row, index) => index === rowIndex ? { ...row, [columnName]: nextValue } : row));
    return <div className="clinical-field clinical-table-field" role="group" aria-labelledby={`${id}-label`}>
      <span className="clinical-table-label" id={`${id}-label`}>{field.label}</span>
      <div className="clinical-table-wrap">
        <table className="clinical-data-table">
          <thead><tr>{columns.map((column) => <th key={column.name}>{column.label}</th>)}{!field.options.fixedRows && <th aria-label="Actions" />}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${field.name}-${index}`}>
            {columns.map((column) => <td key={column.name}>{column.type === 'readonly'
              ? row[column.name] ?? index + 1
              : <input
                aria-label={`${field.label} ${index + 1} ${column.label}`}
                name={`${field.name}.${index}.${column.name}`}
                type={['date', 'number'].includes(column.type) ? column.type : 'text'}
                step={column.type === 'number' ? 'any' : undefined}
                inputMode={column.type === 'number' ? 'decimal' : undefined}
                className="clinical-control"
                disabled={disabled}
                value={row[column.name] || ''}
                onChange={(event) => updateCell(index, column.name, event.target.value)}
              />}
            </td>)}
            {!field.options.fixedRows && <td><button
              className="clinical-icon-button danger"
              type="button"
              aria-label={`Remove ${field.label} row ${index + 1}`}
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
            ><Trash2 size={17} strokeWidth={1.8} aria-hidden="true" /></button></td>}
          </tr>)}</tbody>
        </table>
      </div>
      {field.options.addLabel && <button type="button" className="clinical-add-operation" disabled={disabled} onClick={addRow}><Plus size={16} strokeWidth={1.9} aria-hidden="true" />{field.options.addLabel}</button>}
    </div>;
  }

  if (field.type === 'checkboxes') {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset className="clinical-field clinical-choice-field"><legend>{field.label}</legend><div className="clinical-card-choice-grid">{field.options.map((option) => <label className={`clinical-card-choice ${selected.includes(option.value) ? 'selected' : ''}`} key={option.value}><input type="checkbox" name={field.name} value={option.value} checked={selected.includes(option.value)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))} /><span className="clinical-card-choice-check" aria-hidden="true">{selected.includes(option.value) && <Check size={14} strokeWidth={2} />}</span><strong>{option.label}</strong></label>)}</div></fieldset>;
  }

  if (field.type === 'radio') {
    return <fieldset className="clinical-field clinical-choice-field"><legend>{field.label}</legend><div className="clinical-segment-control">{field.options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} className={value === option.value ? 'selected' : ''} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></fieldset>;
  }

  const common = { id, name: field.name, className: 'clinical-control', value: value ?? '', disabled, onChange: (event) => onChange(event.target.value) };
  const isDate = field.type === 'date';
  const isTime = field.type === 'time';
  const suffix = FIELD_UNITS[field.name];
  const input = field.type === 'textarea'
    ? <textarea {...common} className="clinical-control clinical-textarea" rows="3" />
    : field.type === 'select'
      ? <select {...common}><option value="">Select</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : <input {...common} type={field.type} step={field.type === 'number' ? 'any' : undefined} inputMode={field.type === 'number' ? 'decimal' : undefined} />;
  return <div className={`clinical-field ${field.type === 'textarea' ? 'clinical-field-wide' : ''}`}><label htmlFor={id}>{field.label}</label>
    {isDate || isTime
      ? <div className="clinical-date-action">
        <span className="clinical-input-icon">{isDate ? <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" /> : <Clock3 size={17} strokeWidth={1.8} aria-hidden="true" />}</span>
        {input}
        <button type="button" className="clinical-text-button" disabled={disabled} onClick={() => onChange(isDate ? getLocalDateInputValue() : getLocalTimeInputValue())}>Now</button>
      </div>
      : suffix ? <div className="clinical-unit-control">{input}<span aria-hidden="true">{suffix}</span></div> : input}
  </div>;
};

const MedicalRecordForm = ({ recordType, resident }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRecordId = searchParams.get('recordId');
  const config = medicalRecordForms[recordType];
  const recordNoun = config.title.replace(/ Record$/, '').toLowerCase();
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(() => blankData(config));
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const defaultForm = useMemo(() => {
    const initial = blankData(config);
    config.demographics.forEach((item) => {
      if (item.type === 'resident') initial[item.name] = residentValue(item, resident);
    });
    config.sections.forEach((section) => section.fields.forEach((item) => {
      if (item.name === 'visit_date') initial[item.name] = emptyDate();
    }));
    return initial;
  }, [config, resident]);
  const baselineRef = useRef(JSON.stringify(defaultForm));
  const modalStayRef = useRef(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [copied, setCopied] = useState('');
  const dirty = JSON.stringify(form) !== baselineRef.current;

  useEffect(() => {
    setForm(defaultForm);
    setEditingId(null);
    baselineRef.current = JSON.stringify(defaultForm);
  }, [config, defaultForm]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listResidentMedicalRecords(resident.resident_id, recordType);
      if (!response?.success) throw new Error(response?.message || 'Unable to load records.');
      setRecords(response.data || []);
      setError('');
    } catch (fetchError) {
      setError(fetchError.response?.data?.message || fetchError.message || 'Unable to load records.');
    } finally {
      setLoading(false);
    }
  }, [recordType, resident.resident_id]);

  useEffect(() => { refresh(); }, [refresh]);

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const resetForm = useCallback(() => {
    setForm(defaultForm);
    baselineRef.current = JSON.stringify(defaultForm);
    setEditingId(null);
    if (requestedRecordId) {
      const next = new URLSearchParams(searchParams);
      next.delete('recordId');
      setSearchParams(next, { replace: true });
    }
    setError('');
    setMessage('');
  }, [defaultForm, requestedRecordId, searchParams, setSearchParams]);

  const requestReset = useCallback(() => {
    if (dirty) {
      setPendingAction(() => resetForm);
      setShowDiscardDialog(true);
    } else {
      resetForm();
    }
  }, [dirty, resetForm]);

  const requestDiscard = useCallback(() => {
    const leaveForm = () => navigate(`/residents/${resident.resident_id}`);
    if (dirty) {
      setPendingAction(() => leaveForm);
      setShowDiscardDialog(true);
    } else {
      leaveForm();
    }
  }, [dirty, navigate, resident.resident_id]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (showDiscardDialog) modalStayRef.current?.focus();
  }, [showDiscardDialog]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = editingId
        ? await updateResidentMedicalRecord(resident.resident_id, recordType, editingId, form)
        : await createResidentMedicalRecord(resident.resident_id, recordType, form);
      if (!result?.success) throw new Error(result?.message || 'Unable to save record.');
      setForm(defaultForm);
      baselineRef.current = JSON.stringify(defaultForm);
      setEditingId(null);
      if (requestedRecordId) {
        const next = new URLSearchParams(searchParams);
        next.delete('recordId');
        setSearchParams(next, { replace: true });
      }
      setMessage(result.offline
        ? 'Record saved on this device. It will synchronize when the connection is restored.'
        : editingId ? 'Record updated successfully.' : 'Record saved successfully.');
      await refresh();
    } catch (saveError) {
      setError(saveError.response?.data?.message || saveError.message || 'Unable to save record.');
    } finally {
      setSaving(false);
    }
  };

  const loadRecord = useCallback((record) => {
    const saved = record.record_data || {};
    const liveDemographics = Object.fromEntries(config.demographics
      .filter((item) => item.type === 'resident')
      .map((item) => [item.name, residentValue(item, resident)]));
    const nextForm = { ...defaultForm, ...saved, ...liveDemographics };
    setForm(nextForm);
    baselineRef.current = JSON.stringify(nextForm);
    setEditingId(record.id);
    setError('');
    setMessage('');
  }, [defaultForm, resident, config]);

  useEffect(() => {
    if (!requestedRecordId || loading) return;
    const requestedRecord = records.find((item) => String(item.id) === requestedRecordId);
    if (requestedRecord) loadRecord(requestedRecord);
    else if (!error) setError(`The requested ${recordNoun} record was not found.`);
  }, [error, loadRecord, loading, records, requestedRecordId, recordNoun]);

  const profileFields = config.demographics.filter((item) => item.type === 'resident');
  const editableDemographics = config.demographics.filter((item) => item.type !== 'resident');
  const displayProfileValue = (field) => {
    const value = form[field.name];
    if (!value) return '';
    if (field.options === 'birthdate') return formatDateOnly(value);
    if (field.options === 'age') return `${value} years`;
    if (field.options === 'sex' && value) return `${String(value).charAt(0).toUpperCase()}${String(value).slice(1).toLowerCase()}`;
    return value;
  };
  const sectionGroups = (section) => {
    const configured = SUBGROUPS[recordType]?.[section.title];
    if (!configured) return [{ title: '', fields: section.fields }];
    const groups = configured.map(([title, names]) => ({
      title,
      fields: names.map((name) => section.fields.find((field) => field.name === name)).filter(Boolean),
    }));
    const assigned = new Set(configured.flatMap(([, names]) => names));
    const remaining = section.fields.filter((field) => !assigned.has(field.name));
    if (remaining.length) groups.push({ title: 'Additional details', fields: remaining });
    return groups;
  };
  const copyValue = async (label, value) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(value));
      } else {
        const input = document.createElement('textarea');
        input.value = String(value);
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copiedValue = document.execCommand('copy');
        input.remove();
        if (!copiedValue) throw new Error('Clipboard copy was not available.');
      }
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch (copyError) {
      setError(copyError.message || `Unable to copy ${label.toLowerCase()}.`);
    }
  };

  if (loading) return <div className="clinical-loading" aria-busy="true" aria-label={`Loading ${config.title.toLowerCase()} records`}><span /><span /><span /></div>;

  const patientAge = getResidentAge(resident.birthdate);
  const patientGender = resident.sex
    ? `${String(resident.sex).charAt(0).toUpperCase()}${String(resident.sex).slice(1).toLowerCase()}`
    : 'Gender not recorded';

  return <div className="clinical-record-workspace medical-record-workspace">
    {error && <div className="clinical-error-banner" role="alert"><span aria-hidden="true">!</span>{error}<button type="button" onClick={refresh}>Try again</button></div>}
    {message && <div className="clinical-success-banner" role="status">{message}</div>}

    <div className="clinical-patient-banner">
      <div className="clinical-patient-avatar">{resident.profile_photo ? <img src={getProfilePhotoUrl(resident.profile_photo)} alt="" /> : <span>{`${resident.first_name?.charAt(0) || ''}${resident.last_name?.charAt(0) || ''}`.toUpperCase()}</span>}</div>
      <div className="clinical-patient-identification"><strong>{formatResidentName(resident)}</strong><span>{patientAge === null ? 'Age unknown' : `${patientAge} ${patientAge === 1 ? 'year' : 'years'}`} · {patientGender}</span></div>
      {editingId && <button type="button" className="clinical-primary-button" onClick={requestReset} disabled={saving}><Plus size={17} strokeWidth={1.9} aria-hidden="true" />New record</button>}
      <span className="clinical-patient-chip">Resident ID · {resident.resident_id}</span>
    </div>

    <div className="clinical-workspace-layout">
      <form className="clinical-form-content" onSubmit={save} noValidate>
        <section id="medical-demographics" className="clinical-card clinical-card-full">
          <div className="clinical-card-heading clinical-card-heading-with-action">
            <span>{recordType === 'child' ? <Baby size={18} strokeWidth={1.8} aria-hidden="true" /> : <UserRound size={18} strokeWidth={1.8} aria-hidden="true" />}</span>
            <div><h2>Patient Demographics</h2><p>Profile details are read-only; record-specific information can be completed below.</p></div>
            <Link to={`/residents/${resident.resident_id}/edit`} className="clinical-edit-profile-link"><ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />Edit in resident profile</Link>
          </div>
          <div className="clinical-section-body">
            <dl className="clinical-demographics-summary">{profileFields.map((field) => {
              const value = displayProfileValue(field);
              const missing = value === null || value === undefined || String(value).trim() === '';
              const label = field.name === 'sex' ? 'Gender' : field.label;
              const copyable = !missing && ['family_serial_number', 'philhealth_number'].includes(field.name);
              return <div className={`clinical-demographic-item ${missing ? 'is-missing' : ''}`} key={field.name}>
                <dt>{label}</dt>
                <dd className="clinical-demographic-value">
                  <strong>{missing ? <em>Not provided</em> : value}</strong>
                  {copyable && <button type="button" className="clinical-copy-button" aria-label={copied === label ? `${label} copied` : `Copy ${label}`} title={copied === label ? 'Copied' : `Copy ${label}`} onClick={() => copyValue(label, value)}>{copied === label ? <Check size={16} strokeWidth={1.9} aria-hidden="true" /> : <CopyIcon size={16} strokeWidth={1.8} aria-hidden="true" />}{copied === label && <span role="status">Copied</span>}</button>}
                </dd>
              </div>;
            })}</dl>
            {editableDemographics.length > 0 && <>
              <div className="clinical-subgroup-heading"><h3>Additional information</h3></div>
              <div className="clinical-form-grid clinical-editable-demographics">{editableDemographics.map((field) => <MedicalField key={field.name} field={field} value={form[field.name]} onChange={(value) => setField(field.name, value)} disabled={saving} />)}</div>
            </>}
          </div>
        </section>

        {config.sections.map((section) => {
          const SectionIcon = SECTION_ICONS[section.title] || ClipboardList;
          const sectionId = `medical-section-${section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          return <section id={sectionId} className="clinical-card clinical-card-full" key={section.title} aria-labelledby={`${sectionId}-heading`}>
            <div className="clinical-card-heading"><span><SectionIcon size={18} strokeWidth={1.8} aria-hidden="true" /></span><div><h2 id={`${sectionId}-heading`}>{section.title}</h2><p>Complete the relevant details for this {recordNoun} record.</p></div></div>
            <div className="clinical-section-body">
              {sectionGroups(section).map((group) => <div key={group.title || section.title}>
                {group.title && <div className="clinical-subgroup-heading"><h3>{group.title}</h3></div>}
                <div className="clinical-form-grid">{group.fields.map((field) => <MedicalField key={field.name} field={field} value={form[field.name]} onChange={(value) => setField(field.name, value)} disabled={saving} />)}</div>
              </div>)}
            </div>
          </section>;
        })}
        <div className="clinical-action-bar">
          <div className={`clinical-action-status ${dirty ? 'is-dirty' : ''}`} role="status" aria-live="polite" aria-atomic="true">{dirty ? <><span className="clinical-unsaved-dot" />Unsaved changes</> : saving ? 'Saving…' : message || 'All changes saved'}</div>
          <div className="clinical-action-buttons">
            <button type="button" className="clinical-secondary-button" onClick={requestDiscard} disabled={saving}><X size={16} strokeWidth={1.9} aria-hidden="true" />Discard</button>
            <button type="submit" className="clinical-primary-button" disabled={saving || !dirty}>{saving ? <Loader2 className="is-loading" size={16} strokeWidth={2} aria-hidden="true" /> : <Save size={16} strokeWidth={1.9} aria-hidden="true" />}{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save record'}</button>
          </div>
        </div>
      </form>
    </div>

    {showDiscardDialog && <div className="clinical-modal-backdrop" role="presentation"><section className="clinical-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="medical-discard-title" aria-describedby="medical-discard-description">
      <h2 id="medical-discard-title">Discard changes?</h2><p id="medical-discard-description">Your entered information will be lost.</p>
      <div><button ref={modalStayRef} type="button" className="clinical-secondary-button" onClick={() => { setShowDiscardDialog(false); setPendingAction(null); }}>Keep editing</button><button type="button" className="clinical-danger-button" onClick={() => { const action = pendingAction; setShowDiscardDialog(false); setPendingAction(null); action?.(); }}>Discard</button></div>
    </section></div>}
  </div>;
};

export default MedicalRecordForm;
