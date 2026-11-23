import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Cake,
  CheckCircle2,
  ClipboardList,
  ChevronRight,
  FileText,
  HeartPulse,
  MapPin,
  Scale,
  UserRound,
  VenusAndMars,
  X,
} from 'lucide-react';
import './ResidentProfilePanel.css';
import { getResidentSummary } from '../../services/api/residentService';
import { calculateAdultBMIOffline, calculateAdolescentBMIOffline } from '../../services/nutrition/offlineNutritionCalculator';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';

const PROFILE_TABS = [
  ['health', 'Health Overview'],
  ['nutrition', 'Nutrition History'],
  ['timbang', 'Operation Timbang'],
];
const EMPTY_RESIDENT = {};
const STATUS_TONES = {
  normal: 'normal',
  overweight: 'overweight',
  'overweight-obesity': 'obese',
  obese: 'obese',
  underweight: 'underweight',
  'moderately-underweight': 'underweight',
  thin: 'underweight',
  thinness: 'underweight',
  'moderately-wasted-mam': 'underweight',
  'moderately-stunted': 'underweight',
  'severely-underweight': 'severely-underweight',
  'severely-wasted-sam': 'severely-underweight',
  wasted: 'severely-underweight',
  'severely-stunted': 'severely-underweight',
};

const formatDate = (value) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatMetric = (value, digits = 1, minimumFractionDigits = 0) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString([], { minimumFractionDigits, maximumFractionDigits: digits })
    : null;
};

const getStatusTone = (status) => {
  const normalized = String(status || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized ? (STATUS_TONES[normalized] || 'other') : 'unassessed';
};

const getFullName = (resident) => (
  [resident?.first_name, resident?.middle_name, resident?.last_name, resident?.suffix]
    .filter(Boolean)
    .join(' ')
  || formatResidentName(resident)
  || 'Resident'
);

const ProfileLoadingSkeleton = ({ tab }) => (
  <div className="resident-profile-skeleton" aria-label="Loading profile" aria-busy="true">
    {tab === 'health' ? <>
      <div className="resident-profile-skeleton-status"><span /><i /><b /></div>
      <div className="resident-profile-skeleton-metrics"><span /><span /><span /></div>
    </> : <>
      <span /><span /><span />
    </>}
  </div>
);

const NutritionStatusBadge = ({ status }) => (
  <span className={`resident-history-status resident-history-status--${getStatusTone(status)}`}>
    {status || 'Not assessed'}
  </span>
);

const ResidentHistoryList = ({ tab, records }) => {
  if (!records.length) {
    const EmptyIcon = tab === 'nutrition' ? ClipboardList : Scale;
    return (
      <div className="resident-profile-empty-state">
        <EmptyIcon size={22} aria-hidden="true" />
        <p>{tab === 'nutrition' ? 'No nutrition history recorded' : 'No Operation Timbang entries recorded'}</p>
      </div>
    );
  }

  return (
    <div className="resident-history-list">
      {records.map((item) => (
        <article className="resident-history-item" key={item.id}>
          <div className="resident-history-item-heading">
            <time dateTime={item.date || undefined}>{formatDate(item.date)}</time>
            {item.nutritionStatus && <NutritionStatusBadge status={item.nutritionStatus} />}
          </div>
          <span>
            {tab === 'nutrition'
              ? `BMI ${formatMetric(item.bmi, 1, 1) || '—'}`
              : `${formatMetric(item.weightKg, 1, 1) || '—'} kg · ${formatMetric(item.heightCm, 1, 1) || '—'} cm`}
          </span>
        </article>
      ))}
    </div>
  );
};

function getLatestAssessment(resident, visits, snapshot) {
  const latest = visits.find((item) => [item.weightKg, item.heightCm, item.bmi, item.nutritionStatus]
    .some((value) => value !== null && value !== undefined && value !== '')) || null;
  if (!latest) {
    return {
      bmi: snapshot?.bmi,
      heightCm: snapshot?.heightCm,
      weightKg: snapshot?.weightKg,
      nutritionStatus: snapshot?.nutritionStatus,
      calculationUnavailable: false,
    };
  }

  const result = {
    bmi: latest.bmi,
    heightCm: latest.heightCm,
    weightKg: latest.weightKg,
    nutritionStatus: latest.nutritionStatus || snapshot?.nutritionStatus,
    calculationUnavailable: false,
  };
  if (result.bmi !== null && result.bmi !== undefined) return result;
  if (!(result.weightKg > 0) || !(result.heightCm > 0) || !resident?.birthdate || !latest.date) return result;

  const date = String(latest.date).slice(0, 10);
  const ageAtMeasurement = calculateAge(resident.birthdate, new Date(`${date}T00:00:00`));
  try {
    if (ageAtMeasurement >= 20) {
      const calculation = calculateAdultBMIOffline(resident, {
        date_recorded: date,
        weight_kg: result.weightKg,
        height_cm: result.heightCm,
      });
      return { ...result, bmi: calculation.bmi, nutritionStatus: result.nutritionStatus || calculation.bmi_category };
    }
    if (ageAtMeasurement >= 5) {
      const calculation = calculateAdolescentBMIOffline(resident, {
        record_date: date,
        weight_kg: result.weightKg,
        height_cm: result.heightCm,
      });
      return { ...result, bmi: calculation.bmi, nutritionStatus: result.nutritionStatus || calculation.bmi_for_age_category };
    }
  } catch (calculationError) {
    if (!(calculationError instanceof Error)) throw calculationError;
    return { ...result, calculationUnavailable: true, calculationMessage: calculationError.message };
  }
  return result;
}

const ResidentProfilePanel = ({ resident, onClose }) => {
  const dialogRef = useRef(null);
  const navigate = useNavigate();
  const cache = useRef(new Map());
  const activeResidentId = useRef(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('health');
  const tabButtonRefs = useRef({});
  const closeTimer = useRef(null);
  const [isClosing, setIsClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return;
    setIsClosing(true);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    closeTimer.current = window.setTimeout(onClose, reducedMotion ? 0 : 170);
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [requestClose]);

  const loadProfile = async (force = false) => {
    const id = resident?.resident_id;
    if (!id) return;
    if (!force && cache.current.has(String(id))) {
      setProfile(cache.current.get(String(id)));
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await getResidentSummary(id);
      if (response?.success !== true || !response.data?.resident) {
        throw new Error(response?.message || 'Unable to load resident profile.');
      }
      cache.current.set(String(id), response.data);
      if (activeResidentId.current === String(id)) setProfile(response.data);
    } catch (loadError) {
      if (activeResidentId.current === String(id)) setError(loadError.message || 'Unable to load resident profile.');
    } finally {
      if (activeResidentId.current === String(id)) setLoading(false);
    }
  };

  useEffect(() => {
    const id = resident?.resident_id ? String(resident.resident_id) : null;
    activeResidentId.current = id;
    setTab('health');
    setProfile(null);
    loadProfile();
    return () => {
      if (activeResidentId.current === id) activeResidentId.current = null;
    };
  // loadProfile is deliberately tied to resident selection only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident?.resident_id]);

  const activeProfile = profile?.resident && String(profile.resident.resident_id) === String(resident?.resident_id)
    ? profile
    : null;
  const details = activeProfile?.resident || resident || EMPTY_RESIDENT;
  const fullName = getFullName(details);
  const age = details?.age ?? calculateAge(details?.birthdate);
  const snapshot = activeProfile?.healthSnapshot;
  const visits = useMemo(() => Array.isArray(activeProfile?.visitHistory) ? activeProfile.visitHistory : [], [activeProfile]);
  const assessment = useMemo(
    () => getLatestAssessment(details, visits, snapshot),
    [details, snapshot, visits]
  );
  const history = visits.filter((item) => item.nutritionStatus);
  const timbangRecords = visits.filter((item) => item.recordType === 'operation_timbang');
  const status = assessment.nutritionStatus || null;
  const hasMeasurements = [assessment.bmi, assessment.heightCm, assessment.weightKg]
    .some((value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
  const statusTone = getStatusTone(status);
  const avatar = details?.profile_photo ? getProfilePhotoUrl(details.profile_photo) : null;
  const initials = `${details?.first_name?.charAt(0) || ''}${details?.last_name?.charAt(0) || ''}`.toUpperCase();
  const householdName = details?.household_name || (details?.household_no ? `Household ${details.household_no}` : 'Household not recorded');
  const gender = details?.sex ? `${details.sex.charAt(0).toUpperCase()}${details.sex.slice(1)}` : 'Not recorded';
  const sitio = String(details?.sitio ?? '').trim() || 'Not assigned';
  const selectedTabRecords = tab === 'nutrition' ? history : timbangRecords;
  const StatusIcon = statusTone === 'normal' ? CheckCircle2 : AlertCircle;

  const handleTabKeyDown = (event, currentIndex) => {
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % PROFILE_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + PROFILE_TABS.length) % PROFILE_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = PROFILE_TABS.length - 1;
    else return;

    event.preventDefault();
    const [nextTab] = PROFILE_TABS[nextIndex];
    setTab(nextTab);
    tabButtonRefs.current[nextTab]?.focus();
  };

  return (
    <div
      className={`resident-profile-modal-backdrop${isClosing ? ' is-closing' : ''}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <section ref={dialogRef} className="resident-profile-panel resident-profile-modal" role="dialog" aria-modal="true" aria-labelledby="resident-profile-dialog-title" tabIndex={-1}>
        <header className="resident-profile-heading">
          <div className="resident-profile-heading-brand">
            <span className="resident-profile-logo-tile">
              <img src="/images/healthsynclogo.png" alt="HealthSync logo" />
            </span>
            <strong id="resident-profile-dialog-title">Resident Profile</strong>
          </div>
          <button type="button" className="resident-profile-close" aria-label="Close" onClick={requestClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="resident-profile-body">
          {resident ? <>
            <section className="resident-profile-summary" aria-label="Resident identity">
              <div
                className="resident-profile-avatar"
                role="img"
                aria-label={avatar ? `${fullName} profile photo` : `${fullName} initials`}
              >
                <span aria-hidden="true">{initials}</span>
                {avatar && <img src={avatar} alt="" onError={(event) => event.currentTarget.remove()} />}
              </div>
              <div className="resident-profile-name">
                <div className="resident-profile-name-line">
                  <strong title={fullName}>{fullName}</strong>
                  <span className="resident-profile-id">ID {details?.resident_id ?? '—'}</span>
                </div>
                <small title={householdName}>{householdName}</small>
              </div>
            </section>

            <section className="resident-profile-facts" aria-label="Resident details">
              <div className="resident-profile-fact">
                <span className="resident-profile-fact-label"><Cake size={15} aria-hidden="true" />Age</span>
                <strong title={age === null || age === undefined || age === '' ? 'Not provided' : `${age} years`}>
                  {age === null || age === undefined || age === '' ? 'Not provided' : `${age} years`}
                </strong>
              </div>
              <div className="resident-profile-fact">
                <span className="resident-profile-fact-label"><VenusAndMars size={15} aria-hidden="true" />Gender</span>
                <strong title={gender}>{gender}</strong>
              </div>
              <div className="resident-profile-fact">
                <span className="resident-profile-fact-label"><MapPin size={15} aria-hidden="true" />Sitio</span>
                <strong title={sitio}>{sitio}</strong>
              </div>
            </section>

            <div className="resident-profile-tabs" role="tablist" aria-label="Resident health details">
              {PROFILE_TABS.map(([value, label], index) => (
                <button
                  key={value}
                  ref={(element) => { tabButtonRefs.current[value] = element; }}
                  type="button"
                  role="tab"
                  id={`profile-tab-${value}`}
                  aria-controls="resident-profile-content"
                  aria-selected={tab === value}
                  tabIndex={tab === value ? 0 : -1}
                  onClick={() => setTab(value)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div
              className="resident-profile-content"
              id="resident-profile-content"
              role="tabpanel"
              aria-labelledby={`profile-tab-${tab}`}
              tabIndex={0}
            >
              {loading ? <ProfileLoadingSkeleton tab={tab} /> : error ? (
                <div className="resident-profile-message" role="alert">
                  <p>{error}</p>
                  <button type="button" onClick={() => loadProfile(true)}>Retry</button>
                </div>
              ) : tab === 'health' ? (
                <div className="resident-health-overview">
                  <section className={`resident-health-card resident-health-card--${statusTone}`} aria-label="Nutritional status">
                    <span className="resident-health-heart"><HeartPulse size={20} strokeWidth={1.8} aria-hidden="true" /></span>
                    <div>
                      <small>Nutritional Status</small>
                      <strong>{status || 'Not assessed'}</strong>
                    </div>
                    <StatusIcon size={19} aria-label={statusTone === 'normal' ? 'Normal status' : 'Status notice'} />
                  </section>

                  <div className={`resident-profile-metrics${hasMeasurements ? '' : ' is-empty'}`} aria-label="Latest measurements">
                    <div className="resident-profile-metric">
                      <small>BMI</small>
                      <strong>{formatMetric(assessment.bmi, 1, 1) || '—'}</strong>
                      {status
                        ? <span className={`resident-profile-metric-category resident-profile-metric-category--${statusTone}`}>({status})</span>
                        : <span className="resident-profile-metric-category is-muted">Category not recorded</span>}
                    </div>
                    <div className="resident-profile-metric">
                      <small>Height</small>
                      <strong>{assessment.heightCm == null || assessment.heightCm === '' ? '—' : `${formatMetric(Number(assessment.heightCm) / 100, 2, 2) || '—'} m`}</strong>
                    </div>
                    <div className="resident-profile-metric">
                      <small>Weight</small>
                      <strong>{assessment.weightKg == null ? '—' : `${formatMetric(assessment.weightKg, 1, 1) || '—'} kg`}</strong>
                    </div>
                  </div>
                  {!hasMeasurements && <p className="resident-profile-empty">No measurement yet</p>}
                  {assessment.calculationUnavailable && (
                    <p className="resident-profile-calculation-note" role="status">
                      BMI unavailable: {assessment.calculationMessage}
                    </p>
                  )}
                </div>
              ) : (
                <ResidentHistoryList tab={tab} records={selectedTabRecords} />
              )}
            </div>
          </> : (
            <div className="resident-profile-empty-selection">
              <span><UserRound size={24} aria-hidden="true" /></span>
              <p>Select a resident to view their profile</p>
            </div>
          )}
        </div>

        <button
          type="button"
          className="resident-full-record-button"
          disabled={!resident}
          onClick={() => resident && navigate(`/residents/${resident.resident_id}`)}
        >
          <span className="resident-full-record-label">
            <FileText size={16} aria-hidden="true" />
            <span>View Full Record</span>
          </span>
          <ChevronRight className="resident-full-record-chevron" size={17} aria-hidden="true" />
        </button>
      </section>
    </div>
  );
};

export default ResidentProfilePanel;
