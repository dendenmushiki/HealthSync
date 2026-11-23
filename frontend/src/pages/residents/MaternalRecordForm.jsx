import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Baby,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  HeartPulse,
  Loader2,
  Plus,
  Save,
  Stethoscope,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { calculateAge } from '../../utils/residentUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import {
  createResidentMedicalRecord,
  listResidentMedicalRecords,
  updateResidentMedicalRecord,
} from '../../services/api/residentMedicalRecordService';
import { medicalRecordForms } from './medicalRecordFormConfig';

const maternalFields = medicalRecordForms.maternal;
const profileFieldNames = [
  'family_serial_number',
  'age',
  'sex',
  'first_name',
  'middle_name',
  'last_name',
  'address',
  'birthdate',
  'civil_status',
  'philhealth_number',
  'occupation',
  'contact_number',
];
const copyableProfileFields = new Set(['family_serial_number', 'philhealth_number', 'contact_number']);
const profileLabels = [
  ['family_serial_number', 'Family serial number'],
  ['age', 'Age'],
  ['sex', 'Gender'],
  ['first_name', 'First name'],
  ['middle_name', 'Middle name'],
  ['last_name', 'Last name'],
  ['address', 'Address'],
  ['birthdate', 'Date of birth'],
  ['civil_status', 'Civil status'],
  ['philhealth_number', 'PhilHealth #'],
  ['occupation', 'Occupation'],
  ['contact_number', 'Contact #'],
];
const residentFieldNames = {
  family_serial_number: 'household_no',
  sex: 'sex',
  first_name: 'first_name',
  middle_name: 'middle_name',
  last_name: 'last_name',
  address: 'address',
  birthdate: 'birthdate',
  civil_status: 'civil_status',
  philhealth_number: 'philhealth_id_no',
  occupation: 'occupation',
  contact_number: 'contact_no',
};
const unitByField = {
  blood_pressure: 'mmHg',
  temperature: '°C',
  weight_kg: 'kg',
  pulse_rate: 'bpm',
  respiratory_rate: 'breaths/min',
  height_cm: 'cm',
  fht_cm: 'cm',
  fhb_bpm: 'bpm',
  muac_cm: 'cm',
};
const historyOptions = maternalFields.sections
  .find((section) => section.title === 'Medical and Past History')
  .fields.find((field) => field.name === 'pmh_history').options;

const getLocalDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const getLocalTime = () => {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const formatDate = (value) => {
  if (!value) return '';
  const dateText = String(value).slice(0, 10);
  const date = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};
const formatGender = (value) => {
  const text = String(value || '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';
};
const formatResidentName = (resident) => {
  const last = String(resident?.last_name || '').trim();
  const firstAndMiddle = [
    resident?.first_name,
    resident?.middle_name,
    resident?.suffix,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
  if (last && firstAndMiddle) return `${last}, ${firstAndMiddle}`;
  return last || firstAndMiddle;
};
const formatInitials = (resident) => {
  const initials = [resident?.first_name, resident?.last_name]
    .map((value) => String(value || '').trim().charAt(0))
    .filter(Boolean)
    .join('');
  return initials.toUpperCase() || '?';
};
const normalizeRecordData = (record) => {
  if (typeof record?.record_data === 'string') {
    try {
      return JSON.parse(record.record_data);
    } catch (error) {
      throw new Error('The saved maternal record contains invalid data.');
    }
  }
  return record?.record_data && typeof record.record_data === 'object'
    ? record.record_data
    : {};
};
const addDaysToDate = (value, days) => {
  if (!value) return '';
  const dateText = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) ||
      date.getUTCMonth() !== Number(match[2]) - 1 ||
      date.getUTCDate() !== Number(match[3])) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const suggestEdcFromLmp = (lmp) => addDaysToDate(lmp, 280);
const getGestationalAge = (lmp, visitDate) => {
  if (!lmp || !visitDate) return '';
  const start = new Date(`${String(lmp).slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${String(visitDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return '';
  const elapsedDays = Math.floor((end.getTime() - start.getTime()) / 86400000);
  return `${Math.floor(elapsedDays / 7)} weeks, ${elapsedDays % 7} days`;
};
function makeDefaultForm(resident) {
  const data = {};
  for (const field of maternalFields.demographics) {
    if (field.type === 'resident') {
      data[field.name] = field.options === 'age'
        ? calculateAge(resident?.birthdate) ?? ''
        : resident?.[field.options] ?? '';
    } else {
      data[field.name] = field.type === 'checkboxes' ? [] : '';
    }
  }
  for (const section of maternalFields.sections) {
    for (const field of section.fields) {
      if (field.name === 'visit_date') data[field.name] = getLocalDate();
      else if (!(field.name in data)) data[field.name] = field.type === 'checkboxes' ? [] : '';
    }
  }
  return data;
}

function SectionCard({ title, description, icon: Icon, action, className = '', children }) {
  return (
    <section className={`maternal-card ${className}`}>
      <header className="maternal-card-heading">
        <span className="maternal-card-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.85} /></span>
        <div className="maternal-card-title">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="maternal-card-action">{action}</div>}
      </header>
      <div className="maternal-card-content">{children}</div>
    </section>
  );
}

function SubgroupHeading({ icon: Icon, children }) {
  return (
    <div className="maternal-subgroup-heading">
      {Icon && <Icon size={16} strokeWidth={1.85} aria-hidden="true" />}
      <h3>{children}</h3>
    </div>
  );
}

function MaternalField({
  id,
  name,
  label,
  value,
  onChange,
  disabled,
  error,
  hint,
  type = 'text',
  options,
  suffix,
  icon: Icon,
  onNow,
  step,
  inputMode,
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const commonProps = {
    id,
    name,
    value: value ?? '',
    disabled,
    'aria-invalid': Boolean(error),
    'aria-describedby': describedBy,
    className: 'maternal-control',
    onChange,
  };
  return (
    <div className={`maternal-field ${error ? 'has-error' : ''} ${type === 'textarea' ? 'maternal-field-wide' : ''}`}>
      <div className="maternal-field-label-row">
        <label htmlFor={id}>{label}</label>
        {onNow && <button className="maternal-text-button" type="button" onClick={onNow} disabled={disabled}>Now</button>}
      </div>
      <div className={`maternal-control-wrap ${Icon ? 'has-leading-icon' : ''} ${suffix ? 'has-suffix' : ''} ${type === 'select' ? 'has-select-icon' : ''}`}>
        {Icon && <Icon className="maternal-control-icon" size={17} strokeWidth={1.8} aria-hidden="true" />}
        {type === 'textarea'
          ? <textarea {...commonProps} className="maternal-control maternal-textarea" />
          : type === 'select'
            ? <>
              <select {...commonProps}>
                <option value="">Select</option>
                {(options || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <ChevronDown className="maternal-select-icon" size={16} strokeWidth={1.8} aria-hidden="true" />
            </>
            : <input
              {...commonProps}
              type={type}
              step={step}
              inputMode={inputMode}
            />}
        {suffix && <span className="maternal-unit-suffix">{suffix}</span>}
      </div>
      {hint && <small className="maternal-field-hint" id={hintId}>{hint}</small>}
      {error && <span className="maternal-field-error" id={errorId} role="alert"><AlertCircle size={15} strokeWidth={1.9} aria-hidden="true" />{error}</span>}
    </div>
  );
}

function ReadOnlyField({ label, value, copyable, onCopy, copied }) {
  const missing = value === null || value === undefined || String(value).trim() === '';
  return (
    <div className={`maternal-readonly-item ${label === 'Address' ? 'maternal-address-item' : ''}`}>
      <span className="maternal-readonly-label">{label}</span>
      <div className="maternal-readonly-value-row">
        {missing
          ? <em className="maternal-not-provided">Not provided</em>
          : <strong>{value}</strong>}
        {!missing && copyable && (
          <span className="maternal-copy-wrap">
            <button type="button" className="maternal-copy-button" onClick={onCopy} aria-label={`Copy ${label}`} title={`Copy ${label}`}>
              <Copy size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {copied && <span className="maternal-copy-tooltip" role="status">Copied</span>}
          </span>
        )}
      </div>
    </div>
  );
}

const MaternalRecordForm = ({ resident }) => {
  const { id: routeResidentId } = useParams();
  const residentId = resident?.resident_id || routeResidentId;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRecordId = searchParams.get('recordId');
  const initialRequestedRecordId = useRef(requestedRecordId);
  const defaults = useMemo(() => makeDefaultForm(resident), [resident]);
  const [recordLoading, setRecordLoading] = useState(Boolean(requestedRecordId));
  const [recordError, setRecordError] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [viewingRecord, setViewingRecord] = useState(false);
  const [form, setForm] = useState(defaults);
  const [baseline, setBaseline] = useState(defaults);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [discardAction, setDiscardAction] = useState('');
  const [copiedField, setCopiedField] = useState('');
  const [copyError, setCopyError] = useState('');
  const [toast, setToast] = useState('');
  const edcManuallyEdited = useRef(false);
  const copyTimer = useRef(null);
  const toastTimer = useRef(null);
  const discardModalRef = useRef(null);
  const keepEditingRef = useRef(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const residentName = formatResidentName(resident);
  const residentAge = calculateAge(resident?.birthdate);
  const gender = formatGender(resident?.sex);
  const ageGender = [
    residentAge === null ? '' : `${residentAge} ${residentAge === 1 ? 'year' : 'years'}`,
    gender,
  ].filter(Boolean).join(' · ');
  const gestationalAge = getGestationalAge(form.lmp, form.visit_date);

  const updateQuery = useCallback((recordId) => {
    const next = new URLSearchParams(searchParams);
    if (recordId) next.set('recordId', String(recordId));
    else next.delete('recordId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const hydrateRecord = useCallback((record, mode = 'view') => {
    const savedData = normalizeRecordData(record);
    const nextForm = { ...defaults, ...savedData };
    for (const fieldName of profileFieldNames) nextForm[fieldName] = defaults[fieldName];
    if (!nextForm.edc && record?.edc) nextForm.edc = String(record.edc).slice(0, 10);
    edcManuallyEdited.current = Boolean(nextForm.edc);
    if (!nextForm.edc && nextForm.lmp) nextForm.edc = suggestEdcFromLmp(nextForm.lmp);
    setForm(nextForm);
    setBaseline(nextForm);
    setSelectedRecord(record);
    setViewingRecord(mode === 'view');
    setFieldErrors({});
    setSubmitError('');
    setRecordError('');
    setMessage('');
  }, [defaults]);

  const loadRecords = useCallback(async () => {
    const initialId = initialRequestedRecordId.current;
    if (initialId) {
      setRecordLoading(true);
      setRecordError('');
    }
    try {
      const response = await listResidentMedicalRecords(residentId, 'maternal');
      if (!response?.success || !Array.isArray(response.data)) {
        throw new Error(response?.message || 'Unable to load maternal records.');
      }
      if (initialId) {
        const record = response.data.find((item) => String(item.id) === String(initialId));
        if (record) hydrateRecord(record, 'view');
        else setRecordError('The requested maternal record could not be found.');
      }
    } catch (error) {
      if (initialId) setRecordError(error.response?.data?.message || error.message || 'Unable to load this maternal record.');
    } finally {
      setRecordLoading(false);
    }
  }, [hydrateRecord, residentId]);

  useEffect(() => {
    setForm(defaults);
    setBaseline(defaults);
  }, [defaults]);

  useEffect(() => {
    if (initialRequestedRecordId.current) loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (!discardAction) return undefined;
    const previousFocus = document.activeElement;
    keepEditingRef.current?.focus();
    const handleDialogKeyDown = (event) => {
      if (event.key === 'Escape') {
        setDiscardAction('');
        return;
      }
      if (event.key !== 'Tab') return;
      const buttons = discardModalRef.current?.querySelectorAll('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      window.removeEventListener('keydown', handleDialogKeyDown);
      previousFocus?.focus?.();
    };
  }, [discardAction]);

  const setField = (name, value) => {
    if (name === 'edc') edcManuallyEdited.current = true;
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === 'lmp' && !edcManuallyEdited.current) {
        next.edc = value ? suggestEdcFromLmp(value) : '';
      }
      return next;
    });
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[name];
      if (name === 'lmp' || name === 'edc') {
        delete next.lmp;
        delete next.edc;
      }
      return next;
    });
    setSubmitError('');
    setMessage('');
  };

  const showToast = (text) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  };

  const startNewRecord = () => {
    if (dirty) {
      setDiscardAction('new');
      return;
    }
    performStartNewRecord();
  };

  const performStartNewRecord = () => {
    initialRequestedRecordId.current = '';
    setForm(defaults);
    setBaseline(defaults);
    setSelectedRecord(null);
    setViewingRecord(false);
    setFieldErrors({});
    setRecordError('');
    setSubmitError('');
    setMessage('');
    edcManuallyEdited.current = false;
    updateQuery('');
  };

  const handleNow = (name) => {
    setField(name, name === 'visit_date' ? getLocalDate() : getLocalTime());
  };

  const copyValue = async (fieldName, value) => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopiedField(fieldName);
      setCopyError('');
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedField(''), 1500);
    } catch (error) {
      setCopyError(`Unable to copy ${fieldName.toLowerCase()}.`);
    }
  };

  const validate = () => {
    const errors = {};
    if (form.lmp && !addDaysToDate(form.lmp, 0)) {
      errors.lmp = 'Enter a valid LMP date.';
    }
    if (form.edc && !addDaysToDate(form.edc, 0)) errors.edc = 'Enter a valid EDC date.';
    if (!errors.lmp && !errors.edc && form.lmp && form.edc &&
        String(form.edc).slice(0, 10) < String(form.lmp).slice(0, 10)) {
      errors.edc = 'EDC cannot be before LMP.';
    }
    return errors;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (saving || viewingRecord) return;
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      const firstInvalid = Object.keys(errors)[0];
      window.requestAnimationFrame(() => {
        const invalidField = document.getElementById(`maternal-${firstInvalid}`);
        invalidField?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        invalidField?.focus();
      });
      return;
    }
    setSaving(true);
    setSubmitError('');
    setMessage('');
    try {
      const response = selectedRecord
        ? await updateResidentMedicalRecord(residentId, 'maternal', selectedRecord.id, form)
        : await createResidentMedicalRecord(residentId, 'maternal', form);
      if (!response?.success) throw new Error(response?.message || 'Unable to save the maternal record.');
      const offlineMessage = response.offline
        ? 'Record saved on this device. It will synchronize when the connection is restored.'
        : 'Maternal record saved.';
      setMessage(offlineMessage);
      showToast(offlineMessage);
      initialRequestedRecordId.current = '';
      setForm(defaults);
      setBaseline(defaults);
      setSelectedRecord(null);
      setViewingRecord(false);
      setFieldErrors({});
      edcManuallyEdited.current = false;
      updateQuery('');
    } catch (error) {
      const serverErrors = error.response?.data?.errors;
      if (serverErrors && typeof serverErrors === 'object') {
        setFieldErrors(serverErrors);
        const firstInvalid = Object.keys(serverErrors)[0];
        if (firstInvalid) {
          window.requestAnimationFrame(() => {
            const invalidField = document.getElementById(`maternal-${firstInvalid}`);
            invalidField?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            invalidField?.focus();
          });
        }
      }
      setSubmitError(error.response?.data?.message || error.message || 'Unable to save the maternal record.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (dirty) {
      setDiscardAction('back');
      return;
    }
    navigate(`/residents/${residentId}`);
  };

  const confirmDiscard = () => {
    const action = discardAction;
    setDiscardAction('');
    if (action === 'new') {
      performStartNewRecord();
      return;
    }
    navigate(`/residents/${residentId}`);
  };

  const renderField = (name, label, options = {}) => {
    const value = form[name] ?? '';
    const type = options.type || 'text';
    const isVisitDate = name === 'visit_date';
    const isVisitTime = name === 'visit_time';
    const suffix = options.suffix || unitByField[name];
    const helper = options.hint || (name === 'edc'
      ? 'Estimated date of confinement'
      : name === 'aog'
        ? gestationalAge ? `Gestational age from LMP: ${gestationalAge}` : ''
        : '');
    const icon = isVisitDate || name === 'lmp' || name === 'edc'
      ? CalendarDays
      : isVisitTime ? Clock3 : undefined;
    let inputMode = options.inputMode;
    if (type === 'number') inputMode = ['gravida', 'para', 'abortion'].includes(name) ? 'numeric' : 'decimal';
    if (name === 'blood_pressure') inputMode = 'decimal';
    return (
      <MaternalField
        key={name}
        id={`maternal-${name}`}
        name={name}
        label={label}
        value={value}
        onChange={(event) => setField(name, event.target.value)}
        disabled={saving || viewingRecord}
        error={fieldErrors[name]}
        hint={helper}
        type={type}
        options={options.options}
        suffix={suffix}
        icon={icon}
        onNow={isVisitDate || isVisitTime ? () => handleNow(name) : undefined}
        step={type === 'number' ? (['gravida', 'para', 'abortion'].includes(name) ? '1' : 'any') : undefined}
        inputMode={inputMode}
      />
    );
  };

  const renderHistoryChoices = (name, label) => {
    const selected = Array.isArray(form[name]) ? form[name] : String(form[name] || '').split(',').filter(Boolean);
    return (
      <fieldset className="maternal-field maternal-field-wide maternal-choice-field">
        <legend>{label}</legend>
        <div className="maternal-choice-chips">
          {historyOptions.map((option) => (
            <label className="maternal-history-option" key={option.value}>
              <input
                type="checkbox"
                name={name}
                value={option.value}
                checked={selected.includes(option.value)}
                disabled={saving || viewingRecord}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((item) => item !== option.value);
                  setField(name, next);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  };

  const readOnlyValue = (name) => {
    if (name === 'age') return residentAge === null ? '' : `${residentAge} years`;
    const sourceField = residentFieldNames[name];
    const value = sourceField ? resident?.[sourceField] : '';
    if (name === 'sex') return formatGender(value);
    if (name === 'birthdate') return formatDate(value);
    return value;
  };

  const getProfileCopyValue = (name) => {
    if (name === 'age') return String(residentAge ?? '');
    return resident?.[residentFieldNames[name]] ?? '';
  };

  return (
    <div id="maternal-form-page" className="maternal-form-page">
      <nav className="clinical-breadcrumb maternal-breadcrumb" aria-label="Breadcrumb">
        <Link to="/residents">Residents</Link><span aria-hidden="true">/</span>
        <Link to={`/residents/${residentId}`}>{residentName || 'Resident'}</Link><span aria-hidden="true">/</span>
        <span>Health Records</span><span aria-hidden="true">/</span>
        <span aria-current="page">Maternal Record</span>
      </nav>

      <header className="maternal-page-header">
        <div className="maternal-page-title">
          <span className="overview-eyebrow">HEALTH RECORDS</span>
          <h1>Maternal Record</h1>
          <p>Maternal visit details and medical/family history. Resident: {residentName || 'Not provided'}.</p>
        </div>
        <Link to={`/residents/${residentId}`} className="maternal-resident-button">
          <UserRound size={17} strokeWidth={1.8} aria-hidden="true" />
          Resident details
        </Link>
      </header>

      <form className="maternal-form" onSubmit={handleSave} noValidate>
        <section className="maternal-patient-card" aria-label="Resident summary">
          {resident?.profile_photo
            ? <img className="maternal-avatar" src={getProfilePhotoUrl(resident.profile_photo)} alt="" />
            : <span className="maternal-avatar maternal-avatar-initials" aria-hidden="true">{formatInitials(resident)}</span>}
          <div className="maternal-patient-identification">
            <strong>{residentName || <em className="maternal-not-provided">Not provided</em>}</strong>
            <span>{ageGender || 'Not provided'}</span>
          </div>
          {selectedRecord && <button className="maternal-primary-button maternal-new-record" type="button" onClick={startNewRecord}><Plus size={17} strokeWidth={2} aria-hidden="true" />New record</button>}
          <span className="maternal-resident-id">Resident ID · {resident?.resident_id || 'Not provided'}</span>
        </section>

        {recordError && <div className="maternal-form-error" role="alert">
          <span>{recordError}</span><button type="button" className="maternal-text-button" onClick={loadRecords}>Retry</button>
        </div>}
        {submitError && <div className="maternal-form-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{submitError}</div>}
        {message && <div className="maternal-form-success" role="status">{message}</div>}
        {copyError && <div className="maternal-form-error" role="status">{copyError}</div>}
        {toast && <div className="maternal-toast" role="status" aria-live="polite">{toast}</div>}
        {recordLoading
          ? <div className="maternal-form-skeleton" aria-label="Loading maternal record" aria-busy="true">
            <div className="maternal-skeleton-card" /><div className="maternal-skeleton-card" /><div className="maternal-skeleton-card" />
          </div>
          : <>
            <SectionCard title="Patient demographics" description="Profile details are read-only; record-specific information can be completed below." icon={UserRound}
              action={<Link className="maternal-edit-profile-link" to={`/residents/${residentId}/edit`}>Edit in resident profile <ExternalLink size={15} strokeWidth={1.8} aria-hidden="true" /></Link>}>
              <div className="maternal-readonly-grid">
                {profileLabels.map(([name, label]) => {
                  const value = readOnlyValue(name);
                  const rawCopy = getProfileCopyValue(name);
                  return <ReadOnlyField
                    key={name}
                    label={label}
                    value={value}
                    copyable={copyableProfileFields.has(name) && Boolean(rawCopy)}
                    onCopy={() => copyValue(label, rawCopy)}
                    copied={copiedField === label}
                  />;
                })}
              </div>
              <div className="maternal-subgroup-heading maternal-additional-heading"><h3>Additional information</h3></div>
              <div className="maternal-form-grid">
                {renderField('nhts_number', 'NHTS#')}
                {renderField('birthplace', 'Birthplace')}
                {renderField('religion', 'Religion')}
                {renderField('educational_attainment', 'Educational attainment')}
                {renderField('philhealth_category', 'PhilHealth category')}
                {renderField('spouse_name', 'Spouse name')}
                <fieldset className="maternal-field maternal-choice-field maternal-type-field">
                  <legend>Type</legend>
                  <div className="maternal-type-options">
                    {maternalFields.demographics.find((field) => field.name === 'philhealth_type').options.map((option) => {
                      const selected = Array.isArray(form.philhealth_type)
                        ? form.philhealth_type
                        : String(form.philhealth_type || '').split(',').filter(Boolean);
                      return <label className={`maternal-type-option ${selected.includes(option.value) ? 'is-selected' : ''}`} key={option.value}>
                        <input
                          type="checkbox"
                          name="philhealth_type"
                          value={option.value}
                          checked={selected.includes(option.value)}
                          disabled={saving || viewingRecord}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...selected, option.value]
                              : selected.filter((value) => value !== option.value);
                            setField('philhealth_type', next);
                          }}
                        />
                        <span>{option.label}</span>
                        {selected.includes(option.value) && <Check size={15} strokeWidth={2} aria-hidden="true" />}
                      </label>;
                    })}
                  </div>
                </fieldset>
              </div>
            </SectionCard>

            <SectionCard title="Visit details" description="Document the maternal visit, pregnancy, measurements, and prenatal assessment." icon={CalendarClock}>
              <SubgroupHeading>Visit information</SubgroupHeading>
              <div className="maternal-form-grid maternal-visit-meta">
                {renderField('visit_date', 'Date', { type: 'date' })}
                {renderField('visit_time', 'Time', { type: 'time' })}
              </div>

              <SubgroupHeading icon={Baby}>Obstetric information</SubgroupHeading>
              <div className="maternal-form-grid">
                {renderField('gravida', 'Gravida (G)', { type: 'number' })}
                {renderField('para', 'Parity (P)', { type: 'number' })}
                {renderField('abortion', 'Abortion (A)', { type: 'number' })}
                {renderField('lmp', 'Last menstrual period (LMP)', { type: 'date' })}
                {renderField('edc', 'EDC', { type: 'date' })}
                {renderField('aog', 'Age of gestation (AOG)', { type: 'text' })}
              </div>

              <SubgroupHeading icon={HeartPulse}>Vital signs</SubgroupHeading>
              <div className="maternal-form-grid">
                {renderField('blood_pressure', 'Blood pressure (BP)')}
                {renderField('temperature', 'Temperature', { type: 'number' })}
                {renderField('weight_kg', 'Weight', { type: 'number' })}
                {renderField('pulse_rate', 'Pulse rate (PR)', { type: 'number' })}
                {renderField('respiratory_rate', 'Respiratory rate (RR)', { type: 'number' })}
                {renderField('height_cm', 'Height', { type: 'number' })}
              </div>

              <SubgroupHeading icon={Stethoscope}>Prenatal assessment</SubgroupHeading>
              <div className="maternal-form-grid">
                {renderField('fht_cm', 'Fundal height (FHT)', { type: 'number' })}
                {renderField('fhb_bpm', 'Fetal heart beat (FHB)', { type: 'number' })}
                {renderField('presentation', 'Presentation (PRES)', {
                  type: 'select',
                  options: ['Cephalic', 'Breech', 'Transverse'].map((value) => ({ value, label: value })),
                })}
                {renderField('muac_cm', 'Mid-upper arm circumference (MUAC)', { type: 'number' })}
                {renderField('tt_status', 'Tetanus toxoid status (TT)', { type: 'textarea' })}
              </div>
            </SectionCard>

            <SectionCard title="Past medical history" description="Record the resident's medical conditions, medications, hospitalizations, and allergies." icon={HeartPulse}>
              <SubgroupHeading>Medical history</SubgroupHeading>
              <div className="maternal-form-grid">
                {renderHistoryChoices('pmh_history', 'Past medical history')}
                {renderField('maintenance_medications', 'Maintenance medications', { type: 'textarea' })}
                {renderField('hospitalization_history', 'History of hospitalization', { type: 'textarea' })}
                {renderField('medication_allergies', 'Medication allergies', { type: 'textarea' })}
                {renderField('food_allergies', 'Food allergies', { type: 'textarea' })}
              </div>
            </SectionCard>

            <SectionCard title="Family medical history" description="Record relevant family health history." icon={UsersRound}>
              <SubgroupHeading>Family history</SubgroupHeading>
              <div className="maternal-form-grid">
                {renderHistoryChoices('fmh_history', 'Family medical history')}
              </div>
            </SectionCard>
          </>}

        {viewingRecord && <div className="maternal-viewing-banner" role="status">
          <span>Viewing a saved maternal record</span>
          <button type="button" className="maternal-primary-button" onClick={() => setViewingRecord(false)}>Edit this record</button>
        </div>}

        <div className="maternal-action-bar">
          <div className={`maternal-action-status ${dirty ? 'is-dirty' : ''}`} role="status" aria-live="polite" aria-atomic="true">
            {dirty ? <><span className="maternal-unsaved-dot" />Unsaved changes</> : 'All changes saved'}
          </div>
          <div className="maternal-action-buttons">
            <button type="button" className="maternal-secondary-button" onClick={handleDiscard} disabled={saving}>
              <X size={17} strokeWidth={1.9} aria-hidden="true" />Discard
            </button>
            <button type="submit" className="maternal-primary-button" disabled={saving || viewingRecord || !dirty}>
              {saving ? <><Loader2 className="maternal-spinner" size={17} strokeWidth={2} aria-hidden="true" />Saving...</> : <><Save size={17} strokeWidth={1.9} aria-hidden="true" />{selectedRecord ? 'Save changes' : 'Save record'}</>}
            </button>
          </div>
        </div>
      </form>

      {discardAction && <div className="maternal-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDiscardAction(''); }}>
        <section ref={discardModalRef} className="maternal-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="maternal-discard-title" aria-describedby="maternal-discard-description">
          <span className="maternal-modal-icon" aria-hidden="true"><X size={19} strokeWidth={2} /></span>
          <h2 id="maternal-discard-title">Discard changes?</h2>
          <p id="maternal-discard-description">Your unsaved changes will be lost.</p>
          <div className="maternal-modal-actions">
            <button ref={keepEditingRef} type="button" className="maternal-secondary-button" onClick={() => setDiscardAction('')}>Keep editing</button>
            <button type="button" className="maternal-danger-button" onClick={confirmDiscard}>Discard</button>
          </div>
        </section>
      </div>}
    </div>
  );
};

export default MaternalRecordForm;
