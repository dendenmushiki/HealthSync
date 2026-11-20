import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createResidentMedicalRecord,
  deleteResidentMedicalRecord,
  listResidentMedicalRecords,
  updateResidentMedicalRecord
} from '../../services/api/residentMedicalRecordService';
import { calculateAge as getResidentAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateLabel, formatDateOnly, getLocalDateInputValue, toDateInputValue } from '../../utils/dateUtils';
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

const MedicalField = ({ field, value, onChange }) => {
  const id = `medical-${field.name}`;
  if (field.type === 'table') {
    const columns = field.options.columns;
    const rows = Array.isArray(value) ? value : [];
    const addRow = () => onChange([...rows, Object.fromEntries(columns.filter((column) => column.type !== 'readonly').map((column) => [column.name, '']))]);
    const updateCell = (rowIndex, columnName, nextValue) => onChange(rows.map((row, index) => index === rowIndex ? { ...row, [columnName]: nextValue } : row));
    return <div className="clinical-field clinical-table-field"><label>{field.label}</label><div className="clinical-table-wrap"><table className="clinical-data-table"><thead><tr>{columns.map((column) => <th key={column.name}>{column.label}</th>)}{!field.options.fixedRows && <th aria-label="Actions" />}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${field.name}-${index}`}>{columns.map((column) => <td key={column.name}>{column.type === 'readonly' ? row[column.name] : <input aria-label={`${field.label} ${index + 1} ${column.label}`} type={['date', 'number'].includes(column.type) ? column.type : 'text'} step={column.type === 'number' ? 'any' : undefined} className="clinical-control" value={row[column.name] || ''} onChange={(event) => updateCell(index, column.name, event.target.value)} />}</td>)}{!field.options.fixedRows && <td><button className="clinical-secondary-button clinical-remove-row" type="button" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></td>}</tr>)}</tbody></table></div>{field.options.addLabel && <button type="button" className="clinical-add-operation" onClick={addRow}><span aria-hidden="true">+</span>{field.options.addLabel}</button>}</div>;
  }

  if (field.type === 'checkboxes') {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset className="clinical-field clinical-choice-field"><legend>{field.label}</legend><div className="clinical-card-choice-grid">{field.options.map((option) => <label className={`clinical-card-choice ${selected.includes(option.value) ? 'selected' : ''}`} key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))} /><span className="clinical-card-choice-check" aria-hidden="true">{selected.includes(option.value) ? '✓' : ''}</span><strong>{option.label}</strong></label>)}</div></fieldset>;
  }

  if (field.type === 'radio') {
    return <fieldset className="clinical-field clinical-choice-field"><legend>{field.label}</legend><div className="clinical-segment-control">{field.options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} className={value === option.value ? 'selected' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></fieldset>;
  }

  const common = { id, className: 'clinical-control', value: value ?? '', onChange: (event) => onChange(event.target.value) };
  return <div className="clinical-field"><label htmlFor={id}>{field.label}</label>
    {field.type === 'textarea'
      ? <textarea {...common} rows="3" />
      : field.type === 'select'
        ? <select {...common}><option value="">Select</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input {...common} type={field.type} step={field.type === 'number' ? 'any' : undefined} />}
  </div>;
};

const MedicalRecordForm = ({ recordType, resident }) => {
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
  const [activeSection, setActiveSection] = useState('medical-demographics');
  const [collapsed, setCollapsed] = useState(() => Object.fromEntries(config.sections.map((section, index) => [section.title, index > 0])));

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

  useEffect(() => {
    setForm(defaultForm);
    setEditingId(null);
    setCollapsed(Object.fromEntries(config.sections.map((section, index) => [section.title, index > 0])));
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

  useEffect(() => {
    const sectionIds = ['medical-demographics', ...config.sections.map((section) => `medical-section-${section.title}`)];
    const sections = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);
    if (typeof IntersectionObserver === 'undefined' || !sections.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: '-15% 0px -70% 0px', threshold: [0, 0.25, 0.5] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [config, loading]);

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const reset = () => {
    setForm(defaultForm);
    setEditingId(null);
    if (requestedRecordId) {
      const next = new URLSearchParams(searchParams);
      next.delete('recordId');
      setSearchParams(next, { replace: true });
    }
    setError('');
    setMessage('');
    setCollapsed(Object.fromEntries(config.sections.map((section, index) => [section.title, index > 0])));
  };

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
      setEditingId(null);
      if (requestedRecordId) {
        const next = new URLSearchParams(searchParams);
        next.delete('recordId');
        setSearchParams(next, { replace: true });
      }
      setMessage(result.offline
        ? 'Record saved on this device. It will synchronize when the connection is restored.'
        : editingId ? 'Record updated successfully.' : 'Record saved successfully.');
      setCollapsed(Object.fromEntries(config.sections.map((section, index) => [section.title, index > 0])));
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
    setForm({ ...defaultForm, ...saved, ...liveDemographics });
    setEditingId(record.id);
    setError('');
    setMessage('');
    setCollapsed(Object.fromEntries(config.sections.map((section, index) => [section.title, index > 0])));
  }, [defaultForm, resident, config]);

  useEffect(() => {
    if (!requestedRecordId || loading) return;
    const requestedRecord = records.find((item) => String(item.id) === requestedRecordId);
    if (requestedRecord) loadRecord(requestedRecord);
    else if (!error) setError(`The requested ${recordNoun} record was not found.`);
  }, [error, loadRecord, loading, records, requestedRecordId, recordNoun]);

  const removeRecord = async () => {
    if (!editingId || !window.confirm('Delete this saved record? This cannot be undone.')) return;
    setSaving(true);
    setError('');
    try {
      await deleteResidentMedicalRecord(resident.resident_id, recordType, editingId);
      reset();
      setMessage('Record deleted.');
      await refresh();
    } catch (deleteError) {
      setError(deleteError.response?.data?.message || 'Unable to delete record.');
    } finally {
      setSaving(false);
    }
  };

  const profileFields = config.demographics.filter((item) => item.type === 'resident');
  const editableDemographics = config.demographics.filter((item) => item.type !== 'resident');
  const countFields = (fields) => fields.filter((field) => {
    const value = form[field.name];
    return Array.isArray(value) ? value.length > 0 : String(value ?? '').trim().length > 0;
  }).length;
  const sectionList = [
    { id: 'medical-demographics', title: 'Patient Demographics', count: countFields(config.demographics) },
    ...config.sections.map((section) => ({ id: `medical-section-${section.title}`, title: section.title, count: countFields(section.fields) }))
  ];
  const focusSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const expandAll = (isCollapsed) => setCollapsed(Object.fromEntries(config.sections.map((section) => [section.title, isCollapsed])));
  const assessmentSnippet = (record) => {
    const data = record.record_data || {};
    return data.assessment || data.history_of_present_illness || data.birth_and_immunization_history || data.remarks || 'Saved record';
  };
  const displayProfileValue = (field) => {
    const value = form[field.name];
    if (!value) return '';
    if (field.options === 'birthdate') return formatDateOnly(value);
    if (field.options === 'age') return `${value} years`;
    return value;
  };

  if (loading) return <div className="clinical-loading" aria-busy="true" aria-label={`Loading ${config.title.toLowerCase()} records`}><span /><span /><span /></div>;

  return <div className="clinical-record-workspace medical-record-workspace">
    {error && <div className="clinical-error-banner" role="alert"><span aria-hidden="true">!</span>{error}<button type="button" onClick={refresh}>Try again</button></div>}
    {message && <div className="clinical-success-banner" role="status">{message}</div>}

    <div className="clinical-patient-banner">
      <div className="clinical-patient-avatar">{resident.profile_photo ? <img src={getProfilePhotoUrl(resident.profile_photo)} alt="" /> : <span>{`${resident.first_name?.charAt(0) || ''}${resident.last_name?.charAt(0) || ''}`.toUpperCase()}</span>}</div>
      <div className="clinical-patient-identification"><strong>{formatResidentName(resident)}</strong><span>{getResidentAge(resident.birthdate) === null ? 'Age unknown' : `${getResidentAge(resident.birthdate)} years`} · {String(resident.sex || 'Sex not recorded').replace(/^./, (letter) => letter.toUpperCase())}</span></div>
      {resident.category_flags && <span className="clinical-patient-chip">{Array.isArray(resident.category_flags) ? resident.category_flags.join(', ') : resident.category_flags}</span>}
    </div>

    <div className="clinical-visit-history">
      <div className="clinical-history-heading">
        <div><h2>Visit history</h2><p>{editingId ? `Editing ${recordNoun} record dated ${formatDateLabel(form.visit_date) || 'Unknown date'}` : `Review saved ${recordNoun} records or start a new one.`}</p></div>
        <button type="button" className="clinical-secondary-button" onClick={reset} disabled={saving || !editingId}>New record</button>
      </div>
      {records.length ? <div className="clinical-visit-list">{records.map((record) => {
        const recordDate = formatDateLabel(record.record_data?.visit_date || record.created_at) || 'Date not recorded';
        const active = Number(record.id) === Number(editingId);
        return <article className={`clinical-visit-item ${active ? 'active' : ''}`} key={record.id}>
          <div className="clinical-visit-date"><strong>{recordDate}</strong><span>{record.record_data?.visit_time || config.title}</span></div>
          <p>{assessmentSnippet(record)}</p>
          <small>{record.recorded_by_name ? `Recorded by ${record.recorded_by_name}` : `Record #${record.id}`}</small>
          <div className="clinical-visit-actions"><button type="button" onClick={() => loadRecord(record)}>{active ? 'Editing' : 'Edit'}</button></div>
        </article>;
      })}</div> : <div className="clinical-history-empty"><strong>No {recordNoun} records yet</strong><span>Fill in the form below to create the first one.</span></div>}
    </div>

    <div className="clinical-workspace-layout">
      <aside className="clinical-section-sidebar">
        <nav className="clinical-section-nav" aria-label={`${config.title} sections`}>
          {sectionList.map((section) => <button type="button" key={section.id} className={activeSection === section.id ? 'active' : ''} onClick={() => { setActiveSection(section.id); focusSection(section.id); }}>
            <span className="medical-section-nav-icon" aria-hidden="true">{section.id === 'medical-demographics' ? 'P' : section.title.slice(0, 1)}</span><span>{section.title}</span><small>{section.count ? <span aria-label={`${section.count} fields filled`}>✓</span> : <i />}</small>
          </button>)}
        </nav>
        <div className="clinical-expand-controls"><button type="button" onClick={() => expandAll(false)}>Expand all</button><button type="button" onClick={() => expandAll(true)}>Collapse all</button></div>
      </aside>

      <form className="clinical-form-content" onSubmit={save}>
        <section id="medical-demographics" className="clinical-card">
          <div className="clinical-card-heading"><span className="medical-card-icon" aria-hidden="true">P</span><div><h2>Patient Demographics</h2><p>Profile details are read-only; record-specific information can be completed below.</p></div></div>
          <div className="clinical-demographics-summary">{profileFields.map((field) => <div className="clinical-demographic-item" key={field.name}><span>{field.label}</span><strong>{displayProfileValue(field) || 'Not provided'}</strong></div>)}</div>
          <div className="clinical-form-grid clinical-editable-demographics">{editableDemographics.map((field) => <React.Fragment key={field.name}><MedicalField field={field} value={form[field.name]} onChange={(value) => setField(field.name, value)} /></React.Fragment>)}</div>
        </section>
        {config.sections.map((section, index) => {
          const sectionId = `medical-section-${section.title}`;
          const isCollapsed = collapsed[section.title];
          return <section id={sectionId} className={`clinical-card clinical-accordion ${isCollapsed ? 'collapsed' : ''}`} key={section.title}>
            <button type="button" className="clinical-accordion-heading" aria-expanded={!isCollapsed} onClick={() => setCollapsed((current) => ({ ...current, [section.title]: !current[section.title] }))}>
              <span className="clinical-card-icon medical-card-icon" aria-hidden="true">{index + 1}</span><span className="clinical-accordion-title"><strong>{section.title}</strong><small>Complete the relevant details for this record.</small></span><span className="clinical-filled-count">{countFields(section.fields)} filled</span><span className={`clinical-chevron ${isCollapsed ? '' : 'open'}`} aria-hidden="true">⌄</span>
            </button>
            {!isCollapsed && <div className="clinical-accordion-content"><div className="clinical-form-grid">{section.fields.map((item) => <MedicalField key={item.name} field={item} value={form[item.name]} onChange={(value) => setField(item.name, value)} />)}</div></div>}
          </section>;
        })}
        <div className="clinical-action-bar">
          <div className="clinical-action-status">{editingId ? `Editing record #${editingId}` : 'New record'}</div>
          <div className="clinical-action-buttons">
            {editingId && <button type="button" className="clinical-danger-button" onClick={removeRecord} disabled={saving}>Delete record</button>}
            <button type="button" className="clinical-secondary-button" onClick={reset} disabled={saving}>Discard</button>
            <button type="submit" className="clinical-primary-button" disabled={saving}>{saving && <span className="clinical-spinner" aria-hidden="true" />}{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save record'}</button>
          </div>
        </div>
      </form>
    </div>
  </div>;
};

export default MedicalRecordForm;
