import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createResidentMedicalRecord,
  deleteResidentMedicalRecord,
  listResidentMedicalRecords,
  updateResidentMedicalRecord
} from '../../services/api/residentMedicalRecordService';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { formatDateLabel, formatDateOnly, getLocalDateInputValue, getLocalTimeInputValue, toDateInputValue } from '../../utils/dateUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import { medicalRecordForms } from './medicalRecordFormConfig';

const config = medicalRecordForms.clinical;
const HISTORY_SECTIONS = config.sections.slice(1);
const YES_NO_FIELDS = new Set([
  'pmh_allergy', 'pmh_history_of_illness', 'fmh_allergy', 'fmh_history_of_illness',
  'smoking', 'alcohol', 'illicit_drugs', 'sexually_active', 'menopause', 'pre_eclampsia'
]);
const CONDITIONAL_FIELDS = {
  pmh_allergy: ['pmh_allergy_specify'],
  pmh_history_of_illness: ['pmh_history_of_illness_specify', 'pmh_cancer_organ'],
  fmh_allergy: ['fmh_allergy_specify'],
  fmh_history_of_illness: ['fmh_history_of_illness_specify', 'fmh_cancer_organ'],
  smoking: ['smoking_packs_per_year'],
  alcohol: ['alcohol_bottles_per_day'],
  sexually_active: ['sexually_active_details']
};
const FIELD_RANGES = {
  heart_rate: [20, 250],
  respiratory_rate: [5, 80],
  height_cm: [20, 250],
  weight_kg: [0.3, 400],
  temperature: [25, 45],
  menstrual_pads_per_day: [0, 100],
  gravida: [0, 50],
  parity: [0, 50],
  full_term: [0, 50],
  premature: [0, 50],
  abortion: [0, 50],
  living_children: [0, 50]
};
const VITAL_LABELS = {
  blood_pressure: { label: 'Blood pressure', unit: 'mmHg', placeholder: '120/80' },
  heart_rate: { label: 'Heart rate', unit: 'bpm', placeholder: 'e.g. 72' },
  respiratory_rate: { label: 'Respiratory rate', unit: 'breaths/min', placeholder: 'e.g. 16' },
  height_cm: { label: 'Height', unit: 'cm', placeholder: 'e.g. 165' },
  weight_kg: { label: 'Weight', unit: 'kg', placeholder: 'e.g. 62' },
  temperature: { label: 'Temperature', unit: '°C', placeholder: 'e.g. 36.8' }
};

const snapshot = (value) => JSON.stringify(value);
const isFilled = (value) => Array.isArray(value)
  ? value.some((item) => Object.values(item || {}).some((cell) => String(cell || '').trim()))
  : String(value ?? '').trim().length > 0;
const isYes = (value) => String(value || '').toLowerCase() === 'yes';
const formatContactNumber = (value) => {
  const text = String(value || '').trim();
  const digits = text.replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (/^639\d{9}$/.test(digits)) return `+63 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return text;
};

function createDefaultForm(resident) {
  const form = {};
  config.demographics.forEach((field) => {
    if (field.type === 'resident') {
      if (field.options === 'full_name') form[field.name] = formatResidentName(resident);
      else if (field.options === 'age') form[field.name] = calculateAge(resident.birthdate) ?? '';
      else if (field.options === 'birthdate') form[field.name] = toDateInputValue(resident.birthdate);
      else form[field.name] = resident[field.options] ?? '';
    } else {
      form[field.name] = field.type === 'checkboxes' ? [] : '';
    }
  });
  config.sections.forEach((section) => section.fields.forEach((field) => {
    form[field.name] = field.type === 'table' ? [] : field.type === 'checkboxes' ? [] : '';
  }));
  form.visit_date = getLocalDateInputValue();
  form.visit_time = getLocalTimeInputValue();
  return form;
}

function validDate(value) {
  const parsed = toDateInputValue(value);
  return Boolean(parsed && parsed === value);
}

function validateField(name, form) {
  const value = String(form[name] ?? '').trim();
  if (name === 'client_type' && !['New', 'Follow-up', 'Referral'].includes(value)) return 'Select a client type.';
  if (name === 'visit_date' && (!validDate(value) || value > getLocalDateInputValue())) return 'Enter a valid visit date that is not in the future.';
  if (name === 'visit_time' && value && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return 'Enter a valid visit time.';
  if (name === 'lmp' && value && (!validDate(value) || value > getLocalDateInputValue())) return 'Enter a valid date that is not in the future.';
  if (name === 'blood_pressure' && value) {
    if (!/^\d{2,3}\s*\/\s*\d{2,3}$/.test(value)) return 'Use systolic/diastolic format, for example 120/80.';
    const [systolic, diastolic] = value.split('/').map(Number);
    if (systolic < 50 || systolic > 300 || diastolic < 30 || diastolic > 200) return 'Enter a plausible blood pressure value.';
  }
  if (FIELD_RANGES[name] && value) {
    const [minimum, maximum] = FIELD_RANGES[name];
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) return `Enter a value between ${minimum} and ${maximum}.`;
  }
  return '';
}

const Icon = ({ name }) => {
  const paths = {
    clinical: 'M12 3v18 M3 12h18',
    person: 'M20 21a8 8 0 0 0-16 0 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    history: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 2',
    social: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M23 11h-6',
    family: 'M3 10.5 12 3l9 7.5 M5 9v12h14V9 M9 21v-7h6v7',
    female: 'M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10 M12 14v7 M9 18h6',
    alert: 'M12 3 2.8 20h18.4L12 3z M12 9v5 M12 17h.01',
    check: 'm5 12 4 4L19 6',
    copy: 'M8 8V4h12v12h-4 M4 8h12v12H4z',
    plus: 'M12 5v14 M5 12h14',
    trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 14h10l1-14 M9 7V4h6v3'
  };
  return <svg className="clinical-form-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.clinical} /></svg>;
};

const Field = ({ id, label, error, hint, required, className = '', children }) => (
  <div className={`clinical-field ${className} ${error ? 'has-error' : ''}`}>
    <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
    {children}
    {hint && <small className="clinical-field-hint" id={`${id}-hint`}>{hint}</small>}
    {error && <span className="clinical-field-error" id={`${id}-error`} role="alert"><Icon name="alert" />{error}</span>}
  </div>
);

const clinicalRecordFields = config.sections[0].fields;
const TextArea = ({ id, value, onChange, onBlur, invalid, describedBy, disabled, placeholder }) => (
  <textarea id={id} className="clinical-control clinical-textarea" value={value || ''} onChange={(event) => {
    event.target.style.height = 'auto';
    event.target.style.height = `${event.target.scrollHeight}px`;
    onChange(event.target.value);
  }} onBlur={onBlur} aria-invalid={invalid || undefined} aria-describedby={describedBy} disabled={disabled} placeholder={placeholder} rows={3} />
);

const ClinicalRecordForm = ({ resident }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRecordId = searchParams.get('recordId');
  const defaultForm = useMemo(() => createDefaultForm(resident), [resident]);
  const draftKey = `healthsync:clinical-draft:${resident.resident_id}`;
  const [form, setForm] = useState(defaultForm);
  const [records, setRecords] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [viewingRecord, setViewingRecord] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [message, setMessage] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [availableDraft, setAvailableDraft] = useState(null);
  const [collapsed, setCollapsed] = useState(() => Object.fromEntries(HISTORY_SECTIONS.map((section) => [section.title, true])));
  const [activeSection, setActiveSection] = useState('clinical-notes');
  const [pendingAction, setPendingAction] = useState(null);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState('');
  const baselineRef = useRef(snapshot(defaultForm));
  const baselineFormRef = useRef(defaultForm);
  const draftCheckedRef = useRef('');
  const modalStayRef = useRef(null);

  const age = useMemo(() => calculateAge(resident.birthdate), [resident.birthdate]);
  const isFemaleAdult = String(resident.sex || '').toLowerCase() === 'female' && age !== null && age >= 18;
  const dirty = !viewingRecord && snapshot(form) !== baselineRef.current;
  const bmi = useMemo(() => {
    const height = Number(form.height_cm);
    const weight = Number(form.weight_kg);
    if (!height || !weight || height <= 0 || weight <= 0) return null;
    return weight / ((height / 100) ** 2);
  }, [form.height_cm, form.weight_kg]);
  const bmiCategory = bmi === null ? null : bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';

  const showToast = useCallback((text) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  const refreshRecords = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listResidentMedicalRecords(resident.resident_id, 'clinical');
      if (!response?.success) throw new Error(response?.message || 'Unable to load clinical records.');
      setRecords(response.data || []);
      setError('');
    } catch (loadError) {
      setError(loadError.response?.data?.message || loadError.message || 'Unable to load clinical records.');
    } finally {
      setLoading(false);
    }
  }, [resident.resident_id]);

  useEffect(() => {
    setForm(defaultForm);
    baselineRef.current = snapshot(defaultForm);
    baselineFormRef.current = defaultForm;
    setEditingId(null);
    setViewingRecord(false);
    setFieldErrors({});
    setTouched({});
  }, [defaultForm]);

  useEffect(() => { refreshRecords(); }, [refreshRecords]);

  useEffect(() => {
    if (draftCheckedRef.current === draftKey) return;
    draftCheckedRef.current = draftKey;
    try {
      const stored = window.localStorage.getItem(draftKey);
      if (!stored) return;
      const draft = JSON.parse(stored);
      if (!draft?.form || Date.now() - draft.savedAt > 24 * 60 * 60 * 1000) {
        window.localStorage.removeItem(draftKey);
        return;
      }
      setAvailableDraft(draft);
    } catch (draftError) {
      setError(`Unable to check the saved draft: ${draftError.message}`);
    }
  }, [draftKey]);

  useEffect(() => {
    if (!dirty) return undefined;
    const timer = window.setTimeout(() => {
      setDraftStatus('Saving draft…');
      try {
        window.localStorage.setItem(draftKey, JSON.stringify({ form, editingId, savedAt: Date.now() }));
        setDraftStatus('Draft saved');
      } catch (draftError) {
        setDraftStatus('Draft could not be saved');
        setError(`Unable to save the local draft: ${draftError.message}`);
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [dirty, draftKey, editingId, form]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const requestLeave = useCallback((action) => {
    if (!dirty) {
      action();
      return;
    }
    setPendingAction(() => action);
    setShowLeaveModal(true);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handleNavigationClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest('a[href]');
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash === window.location.hash) return;
      event.preventDefault();
      requestLeave(() => { window.location.assign(`${destination.pathname}${destination.search}${destination.hash}`); });
    };
    document.addEventListener('click', handleNavigationClick, true);
    return () => document.removeEventListener('click', handleNavigationClick, true);
  }, [dirty, requestLeave]);

  useEffect(() => {
    if (!showLeaveModal) return undefined;
    modalStayRef.current?.focus();
    const handleModalKeys = (event) => {
      if (event.key === 'Escape') {
        setShowLeaveModal(false);
        setPendingAction(null);
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const buttons = document.querySelectorAll('.clinical-confirm-modal button');
        const index = Array.from(buttons).indexOf(document.activeElement);
        buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
    };
    document.addEventListener('keydown', handleModalKeys);
    return () => document.removeEventListener('keydown', handleModalKeys);
  }, [showLeaveModal]);

  useEffect(() => {
    const ids = ['clinical-notes', 'patient-demographics', ...HISTORY_SECTIONS.map((section) => section.title)];
    const sections = ids.map((id) => document.getElementById(`clinical-section-${id}`)).filter(Boolean);
    if (typeof IntersectionObserver === 'undefined' || !sections.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id.replace('clinical-section-', ''));
    }, { rootMargin: '-15% 0px -70% 0px', threshold: [0, 0.25, 0.5] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [isFemaleAdult]);

  const setField = (name, value) => {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (value === 'No' && CONDITIONAL_FIELDS[name]) {
        CONDITIONAL_FIELDS[name].forEach((dependent) => { next[dependent] = ''; });
      }
      return next;
    });
    setFieldErrors((current) => {
      const next = { ...current, [name]: undefined };
      if (name === 'past_surgical_history') {
        Object.keys(next).filter((key) => key.startsWith('past_surgical_history.')).forEach((key) => { delete next[key]; });
      }
      return next;
    });
    setError('');
  };

  const onBlur = (name) => {
    setTouched((current) => ({ ...current, [name]: true }));
    setFieldErrors((current) => ({ ...current, [name]: validateField(name, form) || undefined }));
  };

  const loadRecord = useCallback((record, viewOnly) => {
    const saved = record.record_data || {};
    const liveDemographics = Object.fromEntries(config.demographics
      .filter((field) => field.type === 'resident')
      .map((field) => [field.name, defaultForm[field.name]]));
    const nextForm = { ...defaultForm, ...saved, ...liveDemographics };
    setForm(nextForm);
    baselineRef.current = snapshot(nextForm);
    baselineFormRef.current = nextForm;
    setEditingId(record.id);
    setViewingRecord(viewOnly);
    setFieldErrors({});
    setTouched({});
    setAvailableDraft(null);
    setMessage('');
    setError('');
    setCollapsed(Object.fromEntries(HISTORY_SECTIONS.map((section) => [section.title, !viewOnly])));
  }, [defaultForm]);

  useEffect(() => {
    if (!requestedRecordId || loading) return;
    const requestedRecord = records.find((item) => String(item.id) === requestedRecordId);
    if (requestedRecord) loadRecord(requestedRecord, false);
    else if (!error) setError('The requested clinical record was not found.');
  }, [error, loadRecord, loading, records, requestedRecordId]);

  const resetToNew = () => {
    const reset = () => {
      setForm(defaultForm);
      baselineRef.current = snapshot(defaultForm);
      baselineFormRef.current = defaultForm;
      setEditingId(null);
      setViewingRecord(false);
      if (searchParams.has('recordId')) {
        const next = new URLSearchParams(searchParams);
        next.delete('recordId');
        setSearchParams(next, { replace: true });
      }
      setFieldErrors({});
      setTouched({});
      setMessage('');
      setError('');
      setCollapsed(Object.fromEntries(HISTORY_SECTIONS.map((section) => [section.title, true])));
    };
    requestLeave(reset);
  };

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(draftKey);
      setDraftStatus('');
    } catch (draftError) {
      setDraftStatus('Draft could not be cleared');
      setError(`Unable to clear the local draft: ${draftError.message}`);
    }
  };

  const restoreDraft = () => {
    if (!availableDraft) return;
    setForm({ ...defaultForm, ...availableDraft.form });
    setEditingId(availableDraft.editingId || null);
    setViewingRecord(false);
    baselineRef.current = snapshot(defaultForm);
    baselineFormRef.current = defaultForm;
    setAvailableDraft(null);
    setDraftStatus('Draft restored');
  };

  const discardDraft = () => {
    setAvailableDraft(null);
    clearDraft();
  };

  const validate = () => {
    const errors = {};
    [...config.demographics.filter((field) => field.name === 'client_type'), ...clinicalRecordFields]
      .forEach((field) => {
        const errorMessage = validateField(field.name, form);
        if (errorMessage) errors[field.name] = errorMessage;
      });
    Object.entries(FIELD_RANGES).forEach(([name]) => {
      if (form[name] !== '' && form[name] !== undefined) {
        const errorMessage = validateField(name, form);
        if (errorMessage) errors[name] = errorMessage;
      }
    });
    if (form.lmp) {
      const errorMessage = validateField('lmp', form);
      if (errorMessage) errors.lmp = errorMessage;
    }
    (form.past_surgical_history || []).forEach((operation, index) => {
      if (operation.date && (!validDate(operation.date) || operation.date > getLocalDateInputValue())) {
        errors[`past_surgical_history.${index}.date`] = 'Enter a valid operation date that is not in the future.';
      }
    });
    return errors;
  };

  const save = async (event) => {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    setTouched(Object.fromEntries(Object.keys(errors).map((name) => [name, true])));
    if (Object.keys(errors).length) {
      const firstInvalid = Object.keys(errors)[0];
      const fieldName = firstInvalid.split('.')[0];
      const section = HISTORY_SECTIONS.find((item) => item.fields.some((field) => field.name === fieldName));
      if (section) setCollapsed((current) => ({ ...current, [section.title]: false }));
      showToast('Please correct the highlighted fields.');
      window.setTimeout(() => {
        const input = firstInvalid.startsWith('past_surgical_history.')
          ? document.getElementById(`clinical-past_surgical_history-${firstInvalid.split('.')[1]}-date`)
          : document.getElementById(`clinical-${firstInvalid}`);
        input?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        input?.focus();
      }, 100);
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = editingId
        ? await updateResidentMedicalRecord(resident.resident_id, 'clinical', editingId, form)
        : await createResidentMedicalRecord(resident.resident_id, 'clinical', form);
      if (!response?.success) throw new Error(response?.message || 'Unable to save clinical record.');
      clearDraft();
      setForm(defaultForm);
      baselineRef.current = snapshot(defaultForm);
      baselineFormRef.current = defaultForm;
      setEditingId(null);
      setViewingRecord(false);
      if (searchParams.has('recordId')) {
        const next = new URLSearchParams(searchParams);
        next.delete('recordId');
        setSearchParams(next, { replace: true });
      }
      setFieldErrors({});
      setTouched({});
      if (response.offline) {
        setMessage('Record saved on this device. It will synchronize when the connection is restored.');
        showToast('Clinical record saved on this device and waiting to synchronize.');
      } else {
        const message = editingId ? 'Clinical record updated successfully.' : 'Clinical record saved successfully.';
        setMessage(message);
        showToast(message);
        await refreshRecords();
      }
    } catch (saveError) {
      const serverErrors = saveError.response?.data?.errors;
      if (serverErrors && typeof serverErrors === 'object') {
        setFieldErrors(serverErrors);
        setTouched((current) => ({ ...current, ...Object.fromEntries(Object.keys(serverErrors).map((name) => [name, true])) }));
        const firstInvalid = Object.keys(serverErrors)[0];
        const fieldName = firstInvalid.split('.')[0];
        const section = HISTORY_SECTIONS.find((item) => item.fields.some((field) => field.name === fieldName));
        if (section) setCollapsed((current) => ({ ...current, [section.title]: false }));
        showToast(saveError.response?.data?.message || 'Please review the highlighted fields.');
      } else {
        const errorMessage = saveError.response?.data?.message || saveError.message || 'Unable to save clinical record.';
        setError(errorMessage);
        showToast('Failed to save clinical record.');
      }
    } finally {
      setSaving(false);
    }
  };

  const removeRecord = async () => {
    if (!editingId) return;
    const remove = async () => {
      setSaving(true);
      setError('');
      try {
        const response = await deleteResidentMedicalRecord(resident.resident_id, 'clinical', editingId);
        if (!response?.success) throw new Error(response?.message || 'Unable to delete record.');
        showToast(response.offline ? 'Record deletion saved offline.' : 'Clinical record deleted.');
        setForm(defaultForm);
        baselineRef.current = snapshot(defaultForm);
        baselineFormRef.current = defaultForm;
        setEditingId(null);
        setViewingRecord(false);
        if (!response.offline) await refreshRecords();
      } catch (deleteError) {
        setError(deleteError.response?.data?.message || deleteError.message || 'Unable to delete record.');
      } finally {
        setSaving(false);
      }
    };
    requestLeave(remove);
  };

  const discardChanges = () => requestLeave(() => {
    setForm(baselineFormRef.current);
    baselineRef.current = snapshot(baselineFormRef.current);
    setViewingRecord(false);
    setFieldErrors({});
    setTouched({});
    setMessage('');
    setError('');
    clearDraft();
  });

  const focusSection = (section) => document.getElementById(`clinical-section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const errorFor = (name) => touched[name] ? fieldErrors[name] || '' : '';
  const countSection = (section) => section.fields.filter((field) => isFilled(form[field.name])).length;
  const copyValue = async (name, value) => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(name);
      window.setTimeout(() => setCopied(''), 1800);
    } catch (copyError) {
      setError(`Unable to copy ${name}: ${copyError.message}`);
    }
  };
  const setAllCollapsed = (next) => setCollapsed(Object.fromEntries(HISTORY_SECTIONS.map((section) => [section.title, next])));

  const renderControl = (field, { history = false } = {}) => {
    const value = form[field.name] ?? '';
    const id = `clinical-${field.name}`;
    const errorMessage = errorFor(field.name);
    const description = errorMessage ? `${id}-error` : undefined;
    if (field.type === 'table') {
      const rows = Array.isArray(value) ? value : [];
      const updateRow = (index, key, nextValue) => setField(field.name, rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: nextValue } : row));
      const addRow = () => setField(field.name, [...rows, { operation: '', date: '' }]);
      return <fieldset className="clinical-field clinical-operations-field">
        <legend>{field.label}</legend>
        <div className="clinical-operations-list">
          <div className="clinical-operation-labels"><span>Operation</span><span>Date</span></div>
          {rows.length ? rows.map((row, index) => {
            const dateErrorKey = `${field.name}.${index}.date`;
            const dateError = errorFor(dateErrorKey);
            return <React.Fragment key={`operation-${index}`}><div className="clinical-operation-row">
          <label className="clinical-visually-hidden" htmlFor={`${id}-${index}-name`}>Operation {index + 1}</label>
          <input id={`${id}-${index}-name`} className="clinical-control" value={row.operation || ''} onChange={(event) => updateRow(index, 'operation', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && index === rows.length - 1) { event.preventDefault(); addRow(); } }} disabled={saving || viewingRecord} placeholder="Operation or procedure" />
          <label className="clinical-visually-hidden" htmlFor={`${id}-${index}-date`}>Operation date {index + 1}</label>
          <input id={`${id}-${index}-date`} className="clinical-control" type="date" max={getLocalDateInputValue()} value={toDateInputValue(row.date)} onChange={(event) => updateRow(index, 'date', event.target.value)} onBlur={() => { setTouched((current) => ({ ...current, [dateErrorKey]: true })); setFieldErrors((current) => ({ ...current, [dateErrorKey]: row.date && (!validDate(row.date) || row.date > getLocalDateInputValue()) ? 'Enter a valid operation date that is not in the future.' : undefined })); }} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? `${id}-${index}-date-error` : undefined} disabled={saving || viewingRecord} />
          {!viewingRecord && <button className="clinical-icon-button danger" type="button" aria-label={`Remove operation ${index + 1}`} onClick={() => setField(field.name, rows.filter((_, rowIndex) => rowIndex !== index))}><Icon name="trash" /></button>}
          </div>{dateError && <span className="clinical-field-error clinical-operation-error" id={`${id}-${index}-date-error`} role="alert">{dateError}</span>}</React.Fragment>;
          }) : <div className="clinical-empty-operations">No operations recorded.</div>}
          {!viewingRecord && <button type="button" className="clinical-add-operation" onClick={addRow}><Icon name="plus" />Add operation</button>}
        </div>
      </fieldset>;
    }
    if (YES_NO_FIELDS.has(field.name)) {
      if (value && !['yes', 'no'].includes(String(value).toLowerCase())) {
        return <Field id={id} label={field.label}>
          <input id={id} className="clinical-control" value={value} onChange={(event) => setField(field.name, event.target.value)} disabled={saving || viewingRecord} />
          {!viewingRecord && <div className="clinical-segment-control clinical-legacy-choice" role="group" aria-label={`${field.label} answer`}><button type="button" onClick={() => setField(field.name, 'Yes')}>Yes</button><button type="button" onClick={() => setField(field.name, 'No')}>No</button></div>}
        </Field>;
      }
      return <fieldset className="clinical-field clinical-choice-field">
        <legend>{field.label}</legend>
        <div className="clinical-segment-control" role="group" aria-label={field.label}>
          {['Yes', 'No'].map((option) => <button key={option} type="button" aria-pressed={String(value).toLowerCase() === option.toLowerCase()} className={String(value).toLowerCase() === option.toLowerCase() ? 'selected' : ''} onClick={() => setField(field.name, option)} disabled={saving || viewingRecord}>{option}</button>)}
        </div>
      </fieldset>;
    }
    if (field.type === 'textarea') {
      return <Field id={id} label={field.label} error={errorMessage}>
        <TextArea id={id} value={value} onChange={(next) => setField(field.name, next)} onBlur={() => onBlur(field.name)} invalid={Boolean(errorMessage)} describedBy={description} disabled={saving || viewingRecord} placeholder={`Enter ${field.label.toLowerCase()}...`} />
      </Field>;
    }
    const options = field.type === 'select' ? field.options : null;
    const isSelect = Boolean(options);
    const isNumeric = field.type === 'number';
    const unit = VITAL_LABELS[field.name]?.unit;
    const showConditional = history && (
      (field.name === 'pmh_allergy_specify' && isYes(form.pmh_allergy)) ||
      (field.name === 'pmh_history_of_illness_specify' && isYes(form.pmh_history_of_illness)) ||
      (field.name === 'pmh_cancer_organ' && isYes(form.pmh_history_of_illness)) ||
      (field.name === 'fmh_allergy_specify' && isYes(form.fmh_allergy)) ||
      (field.name === 'fmh_history_of_illness_specify' && isYes(form.fmh_history_of_illness)) ||
      (field.name === 'fmh_cancer_organ' && isYes(form.fmh_history_of_illness)) ||
      (field.name === 'smoking_packs_per_year' && isYes(form.smoking)) ||
      (field.name === 'alcohol_bottles_per_day' && isYes(form.alcohol)) ||
      (field.name === 'sexually_active_details' && isYes(form.sexually_active))
    );
    if (history && CONDITIONAL_FIELDS && Object.values(CONDITIONAL_FIELDS).flat().includes(field.name) && !showConditional) return null;
    const warning = field.name === 'temperature' && value && (Number(value) > 37.5 || Number(value) < 35)
      ? 'Check value: outside the usual adult range.'
      : field.name === 'heart_rate' && value && (Number(value) < 60 || Number(value) > 100)
        ? 'Check value: outside the usual adult resting range.'
        : field.name === 'respiratory_rate' && value && (Number(value) < 12 || Number(value) > 20)
          ? 'Check value: outside the usual adult resting range.'
          : '';
    return <Field id={id} label={field.label} required={field.name === 'client_type'} error={errorMessage} hint={warning}>
      {unit
        ? <div className="clinical-unit-control"><input id={id} className="clinical-control" type={field.name === 'blood_pressure' ? 'text' : 'number'} inputMode={field.name === 'blood_pressure' ? undefined : 'decimal'} min={FIELD_RANGES[field.name]?.[0]} max={FIELD_RANGES[field.name]?.[1]} step={field.name === 'temperature' ? '.1' : 'any'} value={value} onChange={(event) => setField(field.name, event.target.value)} onBlur={() => onBlur(field.name)} placeholder={VITAL_LABELS[field.name]?.placeholder} aria-invalid={Boolean(errorMessage)} aria-describedby={description} disabled={saving || viewingRecord} /><span>{unit}</span></div>
        : isSelect
          ? <select id={id} className="clinical-control" value={value} onChange={(event) => setField(field.name, event.target.value)} onBlur={() => onBlur(field.name)} aria-invalid={Boolean(errorMessage)} aria-describedby={description} disabled={saving || viewingRecord}><option value="">Select</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : <input id={id} className="clinical-control" type={field.type === 'date' ? 'date' : isNumeric ? 'number' : 'text'} min={isNumeric ? FIELD_RANGES[field.name]?.[0] ?? 0 : undefined} max={field.type === 'date' ? getLocalDateInputValue() : isNumeric ? FIELD_RANGES[field.name]?.[1] : undefined} step={isNumeric ? 'any' : undefined} value={field.type === 'date' ? toDateInputValue(value) : value} onChange={(event) => setField(field.name, event.target.value)} onBlur={() => onBlur(field.name)} aria-invalid={Boolean(errorMessage)} aria-describedby={description} disabled={saving || viewingRecord} />}
    </Field>;
  };

  const readonlyDemographics = config.demographics.filter((field) => field.type === 'resident');
  const editableDemographics = config.demographics.filter((field) => field.type !== 'resident');
  const sectionList = [
    { id: 'clinical-notes', title: 'Clinical Notes', icon: 'clinical', count: clinicalRecordFields.filter((field) => isFilled(form[field.name])).length },
    { id: 'patient-demographics', title: 'Patient Demographics', icon: 'person', count: editableDemographics.filter((field) => isFilled(form[field.name])).length },
    ...HISTORY_SECTIONS.filter((section) => section.title !== 'Female-Specific Histories' || isFemaleAdult).map((section) => ({
      id: section.title, title: section.title, icon: section.title === 'Personal Social History' ? 'social' : section.title.includes('Immunization') ? 'family' : section.title.includes('Female') ? 'female' : 'history', count: countSection(section)
    }))
  ];

  if (loading) return <div className="clinical-loading" aria-busy="true" aria-label="Loading clinical records"><span /><span /><span /></div>;

  return <div className="clinical-record-workspace">
    {error && <div className="clinical-error-banner" role="alert"><Icon name="alert" />{error}<button type="button" onClick={refreshRecords}>Try again</button></div>}
    {message && <div className="clinical-success-banner" role="status">{message}</div>}
    {availableDraft && <div className="clinical-draft-prompt" role="status"><div><strong>Draft available</strong><span>Saved {new Date(availableDraft.savedAt).toLocaleString()} on this device.</span></div><button type="button" onClick={restoreDraft}>Restore draft</button><button type="button" className="clinical-text-button" onClick={discardDraft}>Discard draft</button></div>}

    <div className="clinical-patient-banner">
      <div className="clinical-patient-avatar">{resident.profile_photo ? <img src={getProfilePhotoUrl(resident.profile_photo)} alt="" /> : <span>{`${resident.first_name?.charAt(0) || ''}${resident.last_name?.charAt(0) || ''}`.toUpperCase()}</span>}</div>
      <div className="clinical-patient-identification"><strong>{formatResidentName(resident)}</strong><span>{age === null ? 'Age unknown' : `${age} years`} · {String(resident.sex || 'Sex not recorded').replace(/^./, (letter) => letter.toUpperCase())}</span></div>
      {resident.category_flags && <span className="clinical-patient-chip">{Array.isArray(resident.category_flags) ? resident.category_flags.join(', ') : resident.category_flags}</span>}
      {resident.pregnant && <span className="clinical-patient-chip">Pregnant</span>}
      {resident.lactating && <span className="clinical-patient-chip">Lactating</span>}
    </div>

    <div className="clinical-visit-history">
      <div className="clinical-history-heading">
        <div><h2>Visit history</h2><p>{editingId ? `${viewingRecord ? 'Viewing' : 'Editing'} record dated ${formatDateLabel(form.visit_date) || 'Unknown date'}` : 'Review past clinical encounters or start a new one.'}</p></div>
        <button type="button" className="clinical-secondary-button" onClick={resetToNew} disabled={saving || (!dirty && !editingId)}>New record</button>
      </div>
      {records.length ? <div className="clinical-visit-list">{records.map((record) => {
        const recordDate = formatDateLabel(record.record_data?.visit_date || record.created_at) || 'Date not recorded';
        const assessment = record.record_data?.assessment || record.record_data?.history_of_present_illness || 'No assessment entered.';
        const active = Number(record.id) === Number(editingId);
        return <article className={`clinical-visit-item ${active ? 'active' : ''}`} key={record.id}>
          <div className="clinical-visit-date"><strong>{recordDate}</strong><span>{record.record_data?.visit_time || 'Time not recorded'}</span></div>
          <p>{assessment}</p>
          <small>Recorded by {record.recorded_by_name || 'Health worker'}</small>
          <div className="clinical-visit-actions"><button type="button" onClick={() => loadRecord(record, true)}>View</button><button type="button" onClick={() => loadRecord(record, false)}>Edit</button></div>
        </article>;
      })}</div> : <div className="clinical-history-empty"><strong>No clinical records yet</strong><span>Fill in the form below to create the first one.</span></div>}
    </div>

    <div className="clinical-workspace-layout">
      <aside className="clinical-section-sidebar">
        <div className="clinical-section-nav" role="navigation" aria-label="Clinical form sections">
          {sectionList.map((section) => <button type="button" key={section.id} className={activeSection === section.id ? 'active' : ''} onClick={() => focusSection(section.id)}>
            <Icon name={section.icon} /><span>{section.title}</span><small>{section.count ? <Icon name="check" /> : <i />}</small>
          </button>)}
        </div>
        <div className="clinical-expand-controls"><button type="button" onClick={() => setAllCollapsed(false)}>Expand all</button><button type="button" onClick={() => setAllCollapsed(true)}>Collapse all</button></div>
      </aside>

      <form className="clinical-form-content" onSubmit={save} noValidate>
        <section id="clinical-section-clinical-notes" className="clinical-card">
          <div className="clinical-card-heading"><span><Icon name="clinical" /></span><div><h2>Clinical Notes</h2><p>Capture the visit, observations, assessment, and plan.</p></div></div>
          <div className="clinical-form-grid clinical-visit-meta">
            {clinicalRecordFields.filter((field) => ['visit_date', 'visit_time'].includes(field.name)).map((field) => <Field key={field.name} id={`clinical-${field.name}`} label={field.label} error={errorFor(field.name)}>
              <div className="clinical-date-action"><input id={`clinical-${field.name}`} className="clinical-control" type={field.type} max={field.name === 'visit_date' ? getLocalDateInputValue() : undefined} value={form[field.name] || ''} onChange={(event) => setField(field.name, event.target.value)} onBlur={() => onBlur(field.name)} aria-invalid={Boolean(errorFor(field.name))} aria-describedby={errorFor(field.name) ? `clinical-${field.name}-error` : undefined} disabled={saving || viewingRecord} /><button type="button" className="clinical-text-button" onClick={() => setField(field.name, field.name === 'visit_date' ? getLocalDateInputValue() : getLocalTimeInputValue())} disabled={saving || viewingRecord}>Now</button></div>
            </Field>)}
          </div>
          <div className="clinical-soap-fields">
            {clinicalRecordFields.filter((field) => field.name === 'history_of_present_illness').map((field) => <div className="clinical-soap-field" key={field.name}><span className="clinical-soap-letter">S</span>{renderControl(field)}</div>)}
            <div className="clinical-vitals-block"><div className="clinical-vitals-heading"><h3>Objective · Vitals</h3>{bmi !== null && <span className={`clinical-bmi-badge clinical-bmi-${bmiCategory.toLowerCase()}`}>BMI {bmi.toFixed(1)}{age !== null && age < 18 ? ' · age-specific assessment needed' : ` · ${bmiCategory}`}</span>}</div>
              <div className="clinical-vitals-grid">{clinicalRecordFields.filter((field) => Object.prototype.hasOwnProperty.call(VITAL_LABELS, field.name)).map((field) => {
                const warning = field.name === 'blood_pressure' && form.blood_pressure && (() => {
                  const parts = form.blood_pressure.split('/').map(Number);
                  return parts.length === 2 && (parts[0] >= 140 || parts[1] >= 90 || parts[0] < 90 || parts[1] < 60);
                })();
                return <div className="clinical-vital-field" key={field.name}>{renderControl(field)}{warning && <span className="clinical-check-value"><Icon name="alert" />Check value</span>}</div>;
              })}</div>
            </div>
            <div className="clinical-soap-field"><span className="clinical-soap-letter">O</span>{renderControl(clinicalRecordFields.find((field) => field.name === 'findings'))}</div>
            {clinicalRecordFields.filter((field) => ['assessment', 'plan'].includes(field.name)).map((field) => <div className="clinical-soap-field" key={field.name}><span className="clinical-soap-letter">{field.name === 'assessment' ? 'A' : 'P'}</span>{renderControl(field)}</div>)}
          </div>
        </section>

        <section id="clinical-section-patient-demographics" className="clinical-card">
          <div className="clinical-card-heading"><span><Icon name="person" /></span><div><h2>Patient Demographics</h2><p>Profile details are read-only; record-specific details can be updated below.</p></div></div>
          <div className="clinical-demographics-summary">
            {readonlyDemographics.map((field) => {
              const value = form[field.name];
              const display = field.name === 'birthdate' ? formatDateOnly(value) : field.name === 'age' ? (value ? `${value} years` : '') : field.name === 'contact_number' ? formatContactNumber(value) : value;
              const canCopy = ['philhealth_number', 'family_serial_number', 'contact_number'].includes(field.name) && value;
              return <div className="clinical-demographic-item" key={field.name}><span>{field.label}</span><strong className={canCopy ? 'clinical-monospace' : ''}>{display || 'Not provided'}</strong>{canCopy && <button type="button" className="clinical-copy-button" aria-label={`Copy ${field.label}`} onClick={() => copyValue(field.label, value)}>{copied === field.label ? 'Copied' : <Icon name="copy" />}</button>}</div>;
            })}
          </div>
          <a className="clinical-edit-profile-link" href={`/residents/${resident.resident_id}/edit`}>Edit in resident profile</a>
          <div className="clinical-form-grid clinical-editable-demographics">{editableDemographics.map((field) => <React.Fragment key={field.name}>{renderControl(field)}</React.Fragment>)}</div>
        </section>

        {HISTORY_SECTIONS.filter((section) => section.title !== 'Female-Specific Histories' || isFemaleAdult).map((section) => {
          const isCollapsed = collapsed[section.title];
          const sectionId = section.title;
          const icon = section.title === 'Personal Social History' ? 'social' : section.title.includes('Immunization') ? 'family' : section.title.includes('Female') ? 'female' : 'history';
          return <section id={`clinical-section-${sectionId}`} className={`clinical-card clinical-accordion ${isCollapsed ? 'collapsed' : ''}`} key={section.title}>
            <button type="button" className="clinical-accordion-heading" aria-expanded={!isCollapsed} onClick={() => setCollapsed((current) => ({ ...current, [section.title]: !current[section.title] }))}>
              <span className="clinical-card-icon"><Icon name={icon} /></span><span className="clinical-accordion-title"><strong>{section.title}</strong><small>{section.title === 'PMH' ? 'Past medical conditions, allergies, and medications.' : section.title === 'Past Surgical History' ? 'Document prior procedures.' : 'Additional health and personal history.'}</small></span><span className="clinical-filled-count">{countSection(section)} filled</span><span className={`clinical-chevron ${isCollapsed ? '' : 'open'}`} aria-hidden="true">⌄</span>
            </button>
            {!isCollapsed && <div className="clinical-accordion-content">
              <div className={`clinical-form-grid ${section.title === 'Past Surgical History' ? 'clinical-table-grid' : ''}`}>
                {section.fields.map((field) => <React.Fragment key={field.name}>{renderControl(field, { history: true })}</React.Fragment>)}
              </div>
            </div>}
          </section>;
        })}

        {viewingRecord && <div className="clinical-viewing-banner"><span>Viewing a saved record</span><button type="button" className="clinical-primary-button" onClick={() => { baselineRef.current = snapshot(form); setViewingRecord(false); }}>Edit this record</button></div>}
        <div className="clinical-action-bar">
          <div className="clinical-action-status">{dirty ? <><span className="clinical-unsaved-dot" />Unsaved changes</> : <span>{draftStatus}</span>}</div>
          <div className="clinical-action-buttons">
            {editingId && !viewingRecord && <button type="button" className="clinical-secondary-button" onClick={removeRecord} disabled={saving}>Delete record</button>}
            <button type="button" className="clinical-secondary-button" onClick={discardChanges} disabled={saving || viewingRecord}>Discard</button>
            <button type="submit" className="clinical-primary-button" disabled={saving || !dirty || viewingRecord}>{saving && <span className="clinical-spinner" aria-hidden="true" />}{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save record'}</button>
          </div>
        </div>
      </form>
    </div>

    {toast && <div className="clinical-toast" role="status" aria-live="polite">{toast}</div>}
    {showLeaveModal && <div className="clinical-modal-backdrop" role="presentation"><section className="clinical-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="clinical-leave-title" aria-describedby="clinical-leave-description">
      <h2 id="clinical-leave-title">Discard unsaved changes?</h2><p id="clinical-leave-description">This clinical record has unsaved changes. Leave without saving?</p>
      <div><button ref={modalStayRef} type="button" className="clinical-secondary-button" onClick={() => { setShowLeaveModal(false); setPendingAction(null); }}>Keep editing</button><button type="button" className="clinical-danger-button" onClick={() => { const action = pendingAction; setShowLeaveModal(false); setPendingAction(null); action?.(); }}>Discard changes</button></div>
    </section></div>}
  </div>;
};

export default ClinicalRecordForm;
