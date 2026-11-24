import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Briefcase,
  CalendarDays,
  Camera,
  ChevronDown,
  House,
  IdCard,
  Loader2,
  LockKeyhole,
  MapPin,
  Phone,
  Save,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import {
  createResident,
  deleteResidentPhoto,
  getResident,
  getResidentBarangays,
  getResidentCitiesMunicipalities,
  getResidentProvinces,
  getResidentRegions,
  getResidentSitios,
  updateResident,
  uploadResidentPhoto
} from '../../services/api/residentService';
import { AuthContext } from '../../context/AuthContext';
import { enqueueOperation, updateOperationStatus } from '../../services/offline/offlineQueueService';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { toDateInputValue } from '../../utils/dateUtils';
import { getProfilePhotoUrl, validateProfilePhoto } from '../../utils/profilePhoto';
import { healthCheck, isOffline } from '../../services/offline/networkService';

const CIVIL_STATUSES = ['Single', 'Married', 'Widowed', 'Separated', 'Annulled'];
const initialForm = {
  first_name: '', middle_name: '', last_name: '', suffix: '', birthdate: '', sex: '',
  civil_status: '', occupation: '', household_no: '', address: '', sitio: '', contact_no: '',
  region_code: '', province_code: '', city_municipality_code: '', barangay_code: '',
  philhealth_id_no: '', resident_status: 'Active', pwd: false, is_4ps: false, pregnant: false, lactating: false
};

const today = () => {
  const date = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('639') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('09') && digits.length === 11) return digits;
  return digits;
};

const formatPhoneInput = (value) => {
  const normalized = normalizePhone(value);
  if (!normalized) return '';
  if (!normalized.startsWith('09')) return value;
  const digits = normalized.slice(0, 11);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
};

const snapshotForm = (form) => JSON.stringify(form);

function buildResidentSyncPayload(form, residentId, address) {
  return {
    ...(residentId ? { resident_id: Number(residentId) } : {}),
    first_name: String(form.first_name || '').trim(),
    middle_name: String(form.middle_name || '').trim() || null,
    last_name: String(form.last_name || '').trim(),
    suffix: String(form.suffix || '').trim() || null,
    household_no: form.household_no || null,
    address: address || null,
    region_code: form.region_code || null,
    province_code: form.province_code || null,
    city_municipality_code: form.city_municipality_code || null,
    barangay_code: form.barangay_code || null,
    contact_no: normalizePhone(form.contact_no) || null,
    philhealth_id_no: form.philhealth_id_no || null,
    is_4ps: form.is_4ps ? 1 : 0,
    category_flags: form.pwd ? ['PWD'] : [],
    sitio: form.sitio || null,
    birthdate: form.birthdate,
    sex: form.sex,
    civil_status: form.civil_status || null,
    occupation: String(form.occupation || '').trim() || null,
    resident_status: form.resident_status,
    pregnant: form.pregnant ? 1 : 0,
    lactating: form.lactating ? 1 : 0
  };
}

function normalizeResident(resident) {
  const flags = Array.isArray(resident.category_flags)
    ? resident.category_flags
    : typeof resident.category_flags === 'string' ? resident.category_flags.split(',').map((item) => item.trim()) : [];
  return {
    ...initialForm,
    ...resident,
    birthdate: toDateInputValue(resident.birthdate),
    region_code: resident.region_code || '',
    province_code: resident.province_code || '',
    city_municipality_code: resident.city_municipality_code || '',
    barangay_code: resident.barangay_code || '',
    contact_no: formatPhoneInput(resident.contact_no || ''),
    pwd: flags.includes('PWD'),
    is_4ps: Boolean(resident.is_4ps),
    pregnant: Boolean(resident.pregnant),
    lactating: Boolean(resident.lactating),
    sex: String(resident.sex || '').toLowerCase(),
    civil_status: CIVIL_STATUSES.includes(resident.civil_status) ? resident.civil_status : '',
    resident_status: resident.resident_status || 'Active'
  };
}

const RequiredMark = () => <span className="resident-required-mark" aria-hidden="true"> *</span>;

const Field = ({ id, label, required, error, hint, className = '', children }) => {
  const control = React.isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type)
    ? React.cloneElement(children, {
      'aria-invalid': error ? true : children.props['aria-invalid'],
      'aria-describedby': [...new Set([
        children.props['aria-describedby'],
        hint ? `${id}-hint` : '',
        error ? `${id}-error` : '',
      ].filter(Boolean))].join(' ') || undefined,
    })
    : children;

  return (
    <div className={`resident-form-field ${className} ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}{required && <RequiredMark />}</label>
      {control}
      {hint && <small className="resident-form-hint" id={`${id}-hint`}>{hint}</small>}
      {error && <span className="resident-field-error" id={`${id}-error`} role="alert"><AlertCircle size={16} strokeWidth={1.8} aria-hidden="true" />{error}</span>}
    </div>
  );
};

const PageHeader = ({ isEditing, displayName, age, photoUrl, initials }) => (
  <>
    <nav className="resident-form-breadcrumb" aria-label="Breadcrumb">
      <Link to="/residents">Residents</Link><span aria-hidden="true">/</span>
      {isEditing
        ? <><span>{displayName}</span><span aria-hidden="true">/</span><span aria-current="page">Edit</span></>
        : <span aria-current="page">Add resident</span>}
    </nav>
    <header className="resident-form-page-header">
      <div className="resident-form-header-title">
        <span className="resident-form-header-icon"><UserRound size={22} strokeWidth={1.8} aria-hidden="true" /></span>
        <div className="resident-form-header-copy">
          <span className="resident-form-header-eyebrow">{isEditing ? 'RESIDENT PROFILE' : 'NEW RESIDENT PROFILE'}</span>
          <h1>{isEditing ? 'Edit Resident' : 'Add Resident'}</h1>
          <p>{isEditing ? 'Update this resident’s profile and contact details.' : 'Create a complete resident profile for barangay health services.'}</p>
        </div>
      </div>
      {isEditing && <div className="resident-form-header-resident">
        {photoUrl ? <img src={photoUrl} alt="" /> : <span>{initials}</span>}
        <div><strong>{displayName}</strong><small>{age === null ? 'Age not provided' : `${age} years old`}</small></div>
      </div>}
    </header>
  </>
);

const FormSection = ({ id, icon: Icon, title, description, children }) => (
  <section id={id} className="resident-form-card">
    <div className="resident-form-card-heading">
      <span className="resident-form-section-icon"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></span>
      <div><h2>{title}</h2><p>{description}</p></div>
    </div>
    {children}
  </section>
);

const FormSectionNavigation = () => {
  const sections = [
    ['resident-section-personal', 'Personal Information'],
    ['resident-section-address', 'Address & Contact'],
  ];

  const navigateToSection = (id) => {
    const section = document.getElementById(id);
    if (!section) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <nav className="resident-form-section-navigation" aria-label="Form sections">
      {sections.map(([id, label], index) => (
        <button key={id} type="button" aria-controls={id} onClick={() => navigateToSection(id)}>
          <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{label}
        </button>
      ))}
    </nav>
  );
};

const GroupHeading = ({ children }) => <h3 className="resident-form-group-heading">{children}</h3>;

const PhotoUploader = ({ photoUrl, initials, photoInputRef, photoError, saving, onRemove, onChange }) => (
  <div className="resident-photo-uploader">
    <div className="resident-photo-avatar-wrap">
      <button type="button" className="resident-form-avatar-button" aria-label="Choose resident photo" onClick={() => photoInputRef.current?.click()} disabled={saving}>
        {photoUrl ? <img src={photoUrl} alt="" /> : <span className="resident-form-avatar-initials">{initials}</span>}
        <span className="resident-form-camera-badge"><Camera size={17} strokeWidth={1.8} aria-hidden="true" /></span>
      </button>
      <input ref={photoInputRef} id="resident-profile-photo" type="file" className="resident-photo-hidden-input"
        accept="image/jpeg,image/png,image/webp" onChange={onChange} disabled={saving} aria-label="Upload resident photo" />
    </div>
    <div className="resident-photo-uploader-copy">
      <strong>Resident photo</strong>
      <small>JPG, PNG, or WebP up to 5 MB</small>
      <div className="resident-photo-actions">
        <button type="button" className="resident-form-text-button resident-form-upload-button" onClick={() => photoInputRef.current?.click()} disabled={saving}>
          <Upload size={16} strokeWidth={1.8} aria-hidden="true" />Upload photo
        </button>
        {photoUrl && <button type="button" className="resident-form-text-button resident-form-remove-photo" onClick={onRemove} disabled={saving}>
          <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />Remove
        </button>}
      </div>
      {photoError && <span className="resident-field-error" role="alert"><AlertCircle size={16} strokeWidth={1.8} aria-hidden="true" />{photoError}</span>}
    </div>
  </div>
);

const FormActions = ({ dirty, saving, disabled, onDiscard }) => (
  <footer className="resident-form-actions">
    {dirty && <span className="resident-form-dirty-status"><span className="resident-unsaved-dot" />Unsaved changes</span>}
    <div className="resident-form-action-buttons">
      <button type="button" className="resident-form-secondary-button" onClick={onDiscard} disabled={saving}>
        <X size={17} strokeWidth={1.8} aria-hidden="true" />Discard
      </button>
      <button type="submit" className="resident-form-primary-button" disabled={disabled || saving}>
        {saving ? <Loader2 className="resident-form-loading-icon" size={17} strokeWidth={2} aria-hidden="true" /> : <Save size={17} strokeWidth={1.8} aria-hidden="true" />}
        {saving ? 'Saving...' : 'Save resident'}
      </button>
    </div>
  </footer>
);

const DiscardDialog = ({ stayButtonRef, onStay, onDiscard }) => (
  <div className="resident-form-modal-backdrop" role="presentation">
    <section className="resident-form-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="resident-unsaved-title" aria-describedby="resident-unsaved-description">
      <span className="resident-form-modal-icon"><AlertCircle size={18} strokeWidth={1.8} aria-hidden="true" /></span>
      <h2 id="resident-unsaved-title">Discard changes?</h2>
      <p id="resident-unsaved-description">Your entered information will be lost.</p>
      <div className="resident-form-modal-actions">
        <button ref={stayButtonRef} type="button" className="resident-form-secondary-button" onClick={onStay}>Keep editing</button>
        <button type="button" className="resident-form-danger-button" onClick={onDiscard}>Discard</button>
      </div>
    </section>
  </div>
);

const ResidentForm = ({ onBack }) => {
  const { id } = useParams();
  const { user } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(location.state?.photoUploadError ? 'Resident saved, but the photo could not be uploaded. Please select it again and save.' : '');
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [photoError, setPhotoError] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [removePhoto, setRemovePhoto] = useState(false);
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [citiesMunicipalities, setCitiesMunicipalities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [sitios, setSitios] = useState([]);
  const [sitioError, setSitioError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [successRedirect, setSuccessRedirect] = useState(null);
  const photoInputRef = useRef(null);
  const photoObjectUrlRef = useRef('');
  const baselineRef = useRef(snapshotForm(initialForm));
  const leaveActionRef = useRef(null);
  const stayButtonRef = useRef(null);
  const toastTimerRef = useRef(null);
  const redirectTimerRef = useRef(null);
  const submissionInProgressRef = useRef(false);

  const locationSelected = Boolean(form.region_code || form.province_code || form.city_municipality_code || form.barangay_code);
  const age = useMemo(() => calculateAge(form.birthdate), [form.birthdate]);
  const photoUrl = photoPreview || (!removePhoto ? getProfilePhotoUrl(form.profile_photo) : '');
  const dirty = !successRedirect && (snapshotForm(form) !== baselineRef.current || Boolean(photoFile) || removePhoto);

  const showToast = useCallback((message, isError = false) => {
    window.clearTimeout(toastTimerRef.current);
    setToast({ message, isError });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const requestLeave = useCallback((action) => {
    if (dirty) {
      leaveActionRef.current = action;
      setLeaveOpen(true);
    } else {
      action();
    }
  }, [dirty]);

  const leaveToResidents = useCallback(() => {
    if (onBack) onBack();
    else navigate('/residents');
  }, [navigate, onBack]);

  useEffect(() => {
    if (!id) {
      baselineRef.current = snapshotForm(initialForm);
      setLoading(false);
      return undefined;
    }
    let active = true;
    getResident(id)
      .then((response) => {
        if (active && response?.success) {
          const nextForm = normalizeResident(response.data);
          setForm(nextForm);
          baselineRef.current = snapshotForm(nextForm);
        } else if (active) {
          setError(response?.message || 'Unable to load resident.');
        }
      })
      .catch((loadError) => { if (active) setError(loadError.response?.data?.message || loadError.message || 'Unable to load resident.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    let active = true;
    getResidentRegions()
      .then((response) => { if (active) { setRegions(response.data || []); setLocationError(''); } })
      .catch((loadError) => { if (active) setLocationError(loadError.response?.data?.message || loadError.message || 'Unable to load regions.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getResidentSitios()
      .then((response) => {
        if (active && response?.success) setSitios(Array.isArray(response.data) ? response.data : []);
        else if (active) setSitioError(response?.message || 'Unable to load sitios.');
      })
      .catch((loadError) => {
        if (active) setSitioError(loadError.response?.data?.message || loadError.message || 'Unable to load sitios.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!form.region_code) { setProvinces([]); return undefined; }
    let active = true;
    getResidentProvinces(form.region_code)
      .then((response) => { if (active) { setProvinces(response.data || []); setLocationError(''); } })
      .catch((loadError) => { if (active) setLocationError(loadError.response?.data?.message || loadError.message || 'Unable to load provinces.'); });
    return () => { active = false; };
  }, [form.region_code]);

  useEffect(() => {
    if (!form.province_code) { setCitiesMunicipalities([]); return undefined; }
    let active = true;
    getResidentCitiesMunicipalities(form.province_code)
      .then((response) => { if (active) { setCitiesMunicipalities(response.data || []); setLocationError(''); } })
      .catch((loadError) => { if (active) setLocationError(loadError.response?.data?.message || loadError.message || 'Unable to load cities or municipalities.'); });
    return () => { active = false; };
  }, [form.province_code]);

  useEffect(() => {
    if (!form.city_municipality_code) { setBarangays([]); return undefined; }
    let active = true;
    getResidentBarangays(form.city_municipality_code)
      .then((response) => { if (active) { setBarangays(response.data || []); setLocationError(''); } })
      .catch((loadError) => { if (active) setLocationError(loadError.response?.data?.message || loadError.message || 'Unable to load barangays.'); });
    return () => { active = false; };
  }, [form.city_municipality_code]);

  useEffect(() => () => {
    if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
    window.clearTimeout(toastTimerRef.current);
    window.clearTimeout(redirectTimerRef.current);
  }, []);

  useEffect(() => {
    if (!successRedirect) return undefined;
    redirectTimerRef.current = window.setTimeout(() => navigate(successRedirect, { replace: true }), 900);
    return () => window.clearTimeout(redirectTimerRef.current);
  }, [navigate, successRedirect]);

  useEffect(() => {
    if (!leaveOpen) return undefined;
    stayButtonRef.current?.focus();
    const handleModalKeys = (event) => {
      if (event.key === 'Escape') {
        setLeaveOpen(false);
        leaveActionRef.current = null;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const buttons = document.querySelectorAll('.resident-form-confirm-modal button');
        const focusedIndex = Array.from(buttons).indexOf(document.activeElement);
        buttons[(focusedIndex + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
    };
    document.addEventListener('keydown', handleModalKeys);
    return () => document.removeEventListener('keydown', handleModalKeys);
  }, [leaveOpen]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => {
      const updated = { ...current, [name]: type === 'checkbox' ? checked : name === 'contact_no' ? formatPhoneInput(value) : value };
      if (name === 'sex' && value !== 'female') {
        updated.pregnant = false;
        updated.lactating = false;
      }
      return updated;
    });
    setFieldErrors((current) => ({ ...current, [name]: undefined }));
    setError('');
  };

  const handleBlur = (event) => {
    const { name } = event.target;
    setTouched((current) => ({ ...current, [name]: true }));
    setFieldErrors((current) => ({ ...current, [name]: validateField(name, form) || undefined }));
  };

  const handleLocationChange = (event) => {
    const { name, value } = event.target;
    const resets = {
      region_code: { province_code: '', city_municipality_code: '', barangay_code: '' },
      province_code: { city_municipality_code: '', barangay_code: '' },
      city_municipality_code: { barangay_code: '' },
      barangay_code: {}
    };
    setForm((current) => ({ ...current, [name]: value, ...resets[name], address: '' }));
    setLocationError('');
    setFieldErrors((current) => ({ ...current, location: undefined }));
  };

  const getSelectedAddress = () => {
    const selected = [
      barangays.find((item) => item.code === form.barangay_code),
      citiesMunicipalities.find((item) => item.code === form.city_municipality_code),
      provinces.find((item) => item.code === form.province_code),
      regions.find((item) => item.code === form.region_code)
    ];
    if (selected.some((item) => !item)) return form.address || '';
    return selected.map((item) => item.name).join(', ');
  };

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const photoValidationError = validateProfilePhoto(file);
    if (photoValidationError) {
      setPhotoError(photoValidationError);
      event.target.value = '';
      return;
    }
    setPhotoError('');
    if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
    photoObjectUrlRef.current = URL.createObjectURL(file);
    setPhotoFile(file);
    setPhotoPreview(photoObjectUrlRef.current);
    setRemovePhoto(false);
  };

  const handlePhotoRemove = () => {
    if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
    photoObjectUrlRef.current = '';
    setPhotoFile(null);
    setPhotoPreview('');
    setRemovePhoto(true);
    setPhotoError('');
    setForm((current) => ({ ...current, profile_photo: null }));
  };

  const validateField = (name, value = form) => {
    const text = String(value[name] || '').trim();
    if (['first_name', 'last_name'].includes(name)) {
      if (!text) return `${name === 'first_name' ? 'First' : 'Last'} name is required.`;
      if (text.length < 2) return 'Enter at least 2 characters.';
      if (text.length > 100) return 'Use 100 characters or fewer.';
    }
    if (name === 'middle_name' && text.length > 100) return 'Use 100 characters or fewer.';
    if (name === 'birthdate') {
      if (!text || text > today() || calculateAge(text) === null) return 'Enter a valid birthdate that is not in the future.';
    }
    if (name === 'sex' && !['male', 'female', 'others'].includes(text.toLowerCase())) return 'Select a gender.';
    if (name === 'civil_status' && !CIVIL_STATUSES.includes(text)) return 'Please select a civil status.';
    if (name === 'resident_status' && !text) return 'Select a resident status.';
    if (name === 'contact_no' && text && !/^09\d{9}$/.test(normalizePhone(text))) return 'Enter a valid Philippine mobile number, such as 0917 123 4567.';
    return '';
  };

  const validate = () => {
    const errors = {};
    ['first_name', 'last_name', 'birthdate', 'sex', 'civil_status', 'resident_status', 'contact_no', 'philhealth_id_no'].forEach((name) => {
      const message = validateField(name, form);
      if (message) errors[name] = message;
    });
    if (locationSelected && (!form.region_code || !form.province_code || !form.city_municipality_code || !form.barangay_code)) {
      errors.location = 'Choose a region, province, city or municipality, and barangay to complete the address.';
    }
    return errors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submissionInProgressRef.current) return;
    setError('');
    const errors = validate();
    setFieldErrors(errors);
    setTouched({ first_name: true, last_name: true, birthdate: true, sex: true, civil_status: true, resident_status: true, contact_no: true, philhealth_id_no: true });
    if (Object.keys(errors).length) {
      const firstInvalid = Object.keys(errors)[0];
      showToast('Please fix the highlighted fields before saving.', true);
      const target = firstInvalid === 'location' ? document.getElementById('region_code') : document.getElementById(firstInvalid);
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
      window.setTimeout(() => target?.focus(), 250);
      return;
    }

    submissionInProgressRef.current = true;
    setSaving(true);
    let savedResidentId = id;
    const selectedAddress = getSelectedAddress();
    try {
      const female = form.sex === 'female';
      const payload = {
        ...form,
        address: selectedAddress || null,
        first_name: String(form.first_name || '').trim(),
        middle_name: String(form.middle_name || '').trim(),
        last_name: String(form.last_name || '').trim(),
        suffix: String(form.suffix || '').trim(),
        occupation: String(form.occupation || '').trim(),
        contact_no: normalizePhone(form.contact_no) || null,
        philhealth_id_no: String(form.philhealth_id_no || '').trim() || null,
        household_no: String(form.household_no || '').trim() || null,
        category_flags: form.pwd ? ['PWD'] : [],
        is_4ps: Boolean(form.is_4ps),
        pregnant: female ? Boolean(form.pregnant) : false,
        lactating: female ? Boolean(form.lactating) : false
      };
      delete payload.profile_photo;

      if (navigator.onLine) await healthCheck();
      if (isOffline()) {
        const operation = id ? 'UPDATE' : 'CREATE';
        const queued = await enqueueOperation({
          operation,
          module: 'residents',
          table: 'residents',
          payload: buildResidentSyncPayload(form, id, selectedAddress),
          userId: user?.user_id,
          photo: photoFile,
          photoAction: removePhoto ? 'DELETE' : null,
          request: { method: id ? 'PUT' : 'POST', url: id ? `/residents/${id}` : '/residents', data: payload },
          localRecord: { ...payload, ...(id ? { resident_id: id, id } : {}) }
        });
        window.dispatchEvent(new CustomEvent('healthsync:queue-changed'));
        navigate('/sync-status', { state: { queuedOperationId: queued.offlineOperationId } });
        return;
      }

      const response = id ? await updateResident(id, payload) : await createResident(payload);
      if (!response?.success) throw new Error(response?.message || 'Unable to save resident.');
      if (response.offline || response.queued) {
        if ((photoFile || removePhoto) && response.offlineOperationId) {
          await updateOperationStatus(response.offlineOperationId, {
            photo: photoFile,
            photoAction: removePhoto ? 'DELETE' : null,
          }, String(user?.user_id));
        }
        navigate('/sync-status', {
          state: { queuedOperationId: response.offlineOperationId },
        });
        return;
      }
      savedResidentId = response.data.resident_id || id;
      if (photoFile) await uploadResidentPhoto(savedResidentId, photoFile);
      else if (removePhoto) await deleteResidentPhoto(savedResidentId);
      showToast(id ? 'Resident updated successfully.' : 'Resident saved successfully.');
      setSuccessRedirect(id ? `/residents/${id}` : `/residents/${savedResidentId}`);
    } catch (saveError) {
      const serverErrors = saveError.response?.data?.errors;
      if (serverErrors && typeof serverErrors === 'object') {
        setFieldErrors((current) => ({ ...current, ...serverErrors }));
        const firstInvalid = Object.keys(serverErrors)[0];
        const target = document.getElementById(firstInvalid === 'location' ? 'region_code' : firstInvalid);
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        target?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
        window.setTimeout(() => document.getElementById(firstInvalid)?.focus(), 250);
        showToast(saveError.response?.data?.message || 'Please review the highlighted fields.', true);
      } else {
        const message = saveError.response?.data?.message || saveError.message || 'Unable to save resident.';
        setError(message);
        showToast('Failed to save resident.', true);
        if (!id && savedResidentId) navigate(`/residents/${savedResidentId}/edit`, { state: { photoUploadError: true } });
      }
    } finally {
      submissionInProgressRef.current = false;
      setSaving(false);
    }
  };

  const removeFieldError = (name) => fieldErrors[name] && touched[name] ? fieldErrors[name] : '';
  useEffect(() => {
    if (!dirty) return undefined;
    const handlePageNavigation = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href]');
      if (!link || link.target || link.hasAttribute('download')) return;
      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === location.pathname && destination.search === location.search && destination.hash === location.hash)
      ) return;
      event.preventDefault();
      requestLeave(() => navigate(`${destination.pathname}${destination.search}${destination.hash}`));
    };
    document.addEventListener('click', handlePageNavigation, true);
    return () => document.removeEventListener('click', handlePageNavigation, true);
  }, [dirty, location.hash, location.pathname, location.search, navigate, requestLeave]);

  if (loading) return <main className="resident-form-page resident-form-loading" aria-busy="true" aria-label="Loading resident form"><div className="resident-form-skeleton resident-form-skeleton-header" /><div className="resident-form-skeleton resident-form-skeleton-section" /><div className="resident-form-skeleton resident-form-skeleton-section" /></main>;

  const displayName = form.first_name || form.last_name ? formatResidentName(form) : 'New resident';
  const initials = `${form.first_name?.charAt(0) || ''}${form.last_name?.charAt(0) || ''}`.toUpperCase() || 'R';

  return (
    <main className="resident-form-page">
      <PageHeader isEditing={Boolean(id)} displayName={displayName} age={age} photoUrl={photoUrl} initials={initials} />
      {(error || locationError || sitioError) && <div className="resident-form-error-banner" role="alert"><AlertCircle size={18} strokeWidth={1.8} aria-hidden="true" /><span>{error || locationError || sitioError}</span></div>}
      <FormSectionNavigation />

      <div className="resident-form-layout">
        <form id="resident-form" onSubmit={handleSubmit} className="resident-form-content" noValidate>
          <FormSection id="resident-section-personal" icon={UserRound} title="Personal Information"
            description="Identity and basic demographic information.">
            <PhotoUploader photoUrl={photoUrl} initials={initials} photoInputRef={photoInputRef}
              photoError={photoError} saving={saving} onRemove={handlePhotoRemove} onChange={handlePhotoChange} />

            <div className="resident-form-grid resident-name-grid">
              {[
                ['first_name', 'First name', true, 'e.g. Maria'],
                ['middle_name', 'Middle name', false, 'e.g. Teresa'],
                ['last_name', 'Last name', true, 'e.g. Santos'],
                ['suffix', 'Suffix', false, 'e.g. Jr.']
              ].map(([field, label, required, placeholder]) => <Field key={field} id={field} label={label} required={required} error={removeFieldError(field)}>
                <input id={field} className="resident-form-control" name={field} value={form[field]} onChange={handleChange} onBlur={handleBlur}
                  placeholder={placeholder} autoComplete={field === 'first_name' ? 'given-name' : field === 'middle_name' ? 'additional-name' : field === 'last_name' ? 'family-name' : 'honorific-suffix'}
                  required={required} disabled={saving} />
              </Field>)}
            </div>

            <div className="resident-form-grid resident-demographic-grid">
              <Field id="birthdate" label="Birthdate" required error={removeFieldError('birthdate')}>
                <div className="resident-form-control-wrap has-leading-icon">
                  <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
                  <input id="birthdate" type="date" max={today()} className="resident-form-control" name="birthdate"
                    value={form.birthdate || ''} onChange={handleChange} onBlur={handleBlur} required autoComplete="bday"
                    aria-invalid={Boolean(removeFieldError('birthdate'))}
                    aria-describedby={removeFieldError('birthdate') ? 'birthdate-error' : undefined} disabled={saving} />
                </div>
              </Field>
              <Field id="age" label="Age" hint="Calculated from birthdate">
                <div className="resident-form-control-wrap has-trailing-icon">
                  <input id="age" className="resident-form-control resident-form-readonly"
                    value={age === null ? '—' : `${age} years old`} readOnly aria-describedby="age-hint" />
                  <LockKeyhole size={16} strokeWidth={1.8} aria-hidden="true" />
                </div>
              </Field>
              <Field id="sex" label="Gender" required error={removeFieldError('sex')}>
                <div className="resident-form-control-wrap has-trailing-icon">
                  <select id="sex" className="resident-form-control resident-form-select" name="sex" value={form.sex}
                    onChange={handleChange} onBlur={handleBlur} required aria-invalid={Boolean(removeFieldError('sex'))}
                    aria-describedby={removeFieldError('sex') ? 'sex-error' : undefined} disabled={saving}>
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="others">Others</option>
                  </select>
                  <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
                </div>
              </Field>
              <Field id="civil_status" label="Civil status" required error={removeFieldError('civil_status')}>
                <div className="resident-form-control-wrap has-trailing-icon">
                  <select id="civil_status" className="resident-form-control resident-form-select" name="civil_status"
                    value={form.civil_status} onChange={handleChange} onBlur={handleBlur} required
                    aria-invalid={Boolean(removeFieldError('civil_status'))}
                    aria-describedby={removeFieldError('civil_status') ? 'civil_status-error' : undefined} disabled={saving}>
                    <option value="">Select civil status</option>
                    {CIVIL_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
                </div>
              </Field>
            </div>

            <div className="resident-form-grid resident-occupation-grid">
              <Field id="occupation" label="Occupation">
                <div className="resident-form-control-wrap has-leading-icon">
                  <Briefcase size={17} strokeWidth={1.8} aria-hidden="true" />
                  <input id="occupation" className="resident-form-control" name="occupation" value={form.occupation}
                    onChange={handleChange} placeholder="e.g. Farmer, Teacher, Retired" disabled={saving} />
                </div>
              </Field>
            </div>
          </FormSection>

          <FormSection id="resident-section-address" icon={MapPin} title="Address &amp; Contact"
            description="Household identifiers and current contact location.">
            <div className="resident-form-subgroup">
              <GroupHeading>Household</GroupHeading>
              <div className="resident-form-grid resident-contact-grid">
                <Field id="household_no" label="Household number" hint="Shared by members of the same household.">
                  <div className="resident-form-control-wrap has-leading-icon">
                    <House size={17} strokeWidth={1.8} aria-hidden="true" />
                    <input id="household_no" className="resident-form-control" name="household_no" value={form.household_no}
                      onChange={handleChange} placeholder="e.g. HH-001" aria-describedby="household_no-hint" disabled={saving} />
                  </div>
                </Field>
                <Field id="sitio" label="Sitio" error={sitioError}>
                  <div className="resident-form-control-wrap has-trailing-icon">
                    <select id="sitio" className="resident-form-control resident-form-select" name="sitio" value={form.sitio}
                      onChange={handleChange} aria-invalid={Boolean(sitioError)} aria-describedby={sitioError ? 'sitio-error' : undefined} disabled={saving}>
                      <option value="">Select sitio</option>
                      {sitios.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
                  </div>
                </Field>
              </div>
            </div>

            <div className="resident-form-subgroup">
              <GroupHeading>Contact</GroupHeading>
              <div className="resident-form-grid resident-contact-grid">
                <Field id="contact_no" label="Contact number" error={removeFieldError('contact_no')} hint="Philippine mobile number, for example 0917 123 4567.">
                  <div className="resident-form-control-wrap has-leading-icon">
                    <Phone size={17} strokeWidth={1.8} aria-hidden="true" />
                    <input id="contact_no" type="tel" className="resident-form-control" name="contact_no" value={form.contact_no}
                      onChange={handleChange} onBlur={handleBlur} inputMode="tel" autoComplete="tel-national"
                      placeholder="09XX XXX XXXX" aria-invalid={Boolean(removeFieldError('contact_no'))}
                      aria-describedby={removeFieldError('contact_no') ? 'contact_no-hint contact_no-error' : 'contact_no-hint'} disabled={saving} />
                  </div>
                </Field>
                <Field id="philhealth_id_no" label="PhilHealth ID" error={removeFieldError('philhealth_id_no')} hint="Enter the member ID as printed on the card.">
                  <div className="resident-form-control-wrap has-leading-icon">
                    <IdCard size={17} strokeWidth={1.8} aria-hidden="true" />
                    <input id="philhealth_id_no" className="resident-form-control" name="philhealth_id_no" value={form.philhealth_id_no}
                      onChange={handleChange} onBlur={handleBlur} placeholder="e.g. 12-345678901-2"
                      aria-invalid={Boolean(removeFieldError('philhealth_id_no'))}
                      aria-describedby={removeFieldError('philhealth_id_no') ? 'philhealth_id_no-hint philhealth_id_no-error' : 'philhealth_id_no-hint'} disabled={saving} />
                  </div>
                </Field>
              </div>
            </div>

            <div className="resident-form-subgroup">
              <GroupHeading>Location</GroupHeading>
              <fieldset className="resident-address-fieldset">
                <legend className="resident-visually-hidden">Location</legend>
                <div className="resident-form-grid resident-location-grid">
                  {[
                    ['region_code', 'Region', regions, 'Select region', false],
                    ['province_code', 'Province', provinces, 'Select province', !form.region_code],
                    ['city_municipality_code', 'City/Municipality', citiesMunicipalities, 'Select city or municipality', !form.province_code],
                    ['barangay_code', 'Barangay', barangays, 'Select barangay', !form.city_municipality_code]
                  ].map(([name, label, options, placeholder, isDisabled]) => <Field key={name} id={name} label={label} error={name === 'region_code' ? fieldErrors.location : ''}>
                    <div className="resident-form-control-wrap has-trailing-icon">
                      <select id={name} className="resident-form-control resident-form-select" name={name} value={form[name]}
                        onChange={handleLocationChange} disabled={saving || isDisabled}
                        aria-invalid={Boolean(name === 'region_code' && fieldErrors.location)}
                        aria-describedby={name === 'region_code' && fieldErrors.location ? 'region_code-error' : undefined}>
                        <option value="">{placeholder}</option>
                        {options.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                      </select>
                      <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
                    </div>
                  </Field>)}
                  <Field id="resident_status" label="Resident status" required error={removeFieldError('resident_status')}>
                    <div className="resident-form-control-wrap has-trailing-icon">
                      <select id="resident_status" className="resident-form-control resident-form-select" name="resident_status"
                        value={form.resident_status} onChange={handleChange} onBlur={handleBlur} required
                        aria-invalid={Boolean(removeFieldError('resident_status'))}
                        aria-describedby={removeFieldError('resident_status') ? 'resident_status-error' : undefined} disabled={saving}>
                        {['Active', 'Inactive', 'Transferred', 'Deceased'].map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                      <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
                    </div>
                  </Field>
                </div>
                {(getSelectedAddress() || form.address) && <div className="resident-address-preview">
                  <House size={17} strokeWidth={1.8} aria-hidden="true" />
                  <span><small>Selected address</small><strong>{getSelectedAddress() || form.address}</strong></span>
                </div>}
                {form.address && !locationSelected && <p className="resident-address-help">Choose a complete location above to replace the saved address.</p>}
              </fieldset>
            </div>
          </FormSection>

          <FormActions dirty={dirty} saving={saving}
            disabled={(Boolean(id) && !dirty) || Boolean(successRedirect)}
            onDiscard={() => requestLeave(leaveToResidents)} />
        </form>
      </div>

      {toast && <div className={`resident-form-toast ${toast.isError ? 'error' : 'success'}`} role={toast.isError ? 'alert' : 'status'} aria-live="polite">{toast.message}</div>}
      {leaveOpen && <DiscardDialog stayButtonRef={stayButtonRef} onStay={() => { setLeaveOpen(false); leaveActionRef.current = null; }} onDiscard={() => { const action = leaveActionRef.current; setLeaveOpen(false); leaveActionRef.current = null; action?.(); }} />}
    </main>
  );
};

export default ResidentForm;
