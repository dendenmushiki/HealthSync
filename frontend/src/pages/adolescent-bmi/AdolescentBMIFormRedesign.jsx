import React, { useEffect, useMemo, useRef, useState } from 'react';
import ResidentPicker from '../../components/nutrition/ResidentPicker';
import ResidentSummaryCard from '../../components/nutrition/ResidentSummaryCard';
import MeasurementInput from '../../components/nutrition/MeasurementInput';
import ResultPanel from '../../components/nutrition/ResultPanel';
import PreviousMeasurements from '../../components/nutrition/PreviousMeasurements';
import TrendChart from '../../components/nutrition/TrendChart';
import ConfirmModal from '../../components/common/ConfirmModal';
import { createAdolescentBMI, previewAdolescentBMI, getPreviousAdolescentBMI } from '../../services/api/adolescentBMIService';
import { getLocalDateInputValue, formatDateLabel } from '../../utils/dateUtils';

export const getAdolescentAgeInMonths = (birthdate, dateRecorded) => {
  const matchBirth = /^\d{4}-\d{2}-\d{2}$/.exec(String(birthdate || '').slice(0, 10));
  const matchDate = /^\d{4}-\d{2}-\d{2}$/.exec(String(dateRecorded || ''));
  if (!matchBirth || !matchDate) return null;
  const [by, bm, bd] = String(birthdate).slice(0, 10).split('-').map(Number);
  const [ry, rm, rd] = String(dateRecorded).split('-').map(Number);
  const birth = new Date(Date.UTC(by, bm - 1, bd));
  const record = new Date(Date.UTC(ry, rm - 1, rd));
  if (birth.getUTCFullYear() !== by || birth.getUTCMonth() !== bm - 1 || birth.getUTCDate() !== bd) return null;
  if (record.getUTCFullYear() !== ry || record.getUTCMonth() !== rm - 1 || record.getUTCDate() !== rd) return null;
  if (record < birth) return null;
  let months = (ry - by) * 12 + rm - bm;
  if (rd < bd) months -= 1;
  return months;
};

const initialForm = () => ({ resident_id: '', record_date: getLocalDateInputValue(), height_cm: '', weight_kg: '' });
const normalizeServerErrors = (fieldErrors) => Object.fromEntries(Object.entries(fieldErrors || {}).map(([key, value]) => {
  const field = key === 'weight' ? 'weight_kg' : key === 'height' ? 'height_cm' : key;
  return [field, Array.isArray(value) ? value.join(' ') : value];
}));
const FormIcon = ({ children }) => <span className="nutrition-card-icon" aria-hidden="true">{children}</span>;

const AdolescentBMIFormRedesign = ({ onSaved, onSwitchToAdult }) => {
  const [form, setForm] = useState(initialForm);
  const [resident, setResident] = useState(null);
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [duplicate, setDuplicate] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pickerRef = useRef(null);
  const ageMonths = useMemo(() => getAdolescentAgeInMonths(resident?.birthdate, form.record_date), [resident, form.record_date]);
  const ageYears = ageMonths === null ? null : Math.floor(ageMonths / 12);
  const ageRemaining = ageMonths === null ? null : ageMonths % 12;

  useEffect(() => {
    if (!resident || resident.resident_id !== Number(form.resident_id)) { setHistory([]); return undefined; }
    let active = true;
    setHistoryLoading(true);
    getPreviousAdolescentBMI(resident.resident_id, 12).then((response) => {
      if (active && response?.success) setHistory(response.data || []);
    }).catch(() => { if (active) setHistory([]); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [resident, form.resident_id]);

  const complete = resident && ageMonths !== null && ageMonths >= 61 && ageMonths <= 228 && form.record_date && form.height_cm !== '' && form.weight_kg !== '';
  const outsideGroup = resident && ageMonths !== null && (ageMonths < 61 || ageMonths > 228);

  useEffect(() => {
    if (!complete) { setPreview(null); setCalculating(false); return undefined; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setCalculating(true);
      try {
        const response = await previewAdolescentBMI({ resident_id: Number(form.resident_id), record_date: form.record_date, height_cm: Number(form.height_cm), weight_kg: Number(form.weight_kg) });
        if (active && response?.success) setPreview(response.data);
        if (active) setErrors((current) => ({ ...current, height_cm: undefined, weight_kg: undefined }));
      } catch (error) {
        if (active) {
          const fieldErrors = error.response?.data?.errors;
          setPreview(null);
          setErrors(fieldErrors ? normalizeServerErrors(fieldErrors) : { weight_kg: error.response?.data?.message || 'Unable to calculate BMI.' });
        }
      } finally { if (active) setCalculating(false); }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [complete, form]);

  const dirty = Boolean(resident || form.height_cm || form.weight_kg);
  useEffect(() => {
    const handler = (event) => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const validate = () => {
    const next = {};
    if (!resident) next.resident_id = 'Select an adolescent resident.';
    if (!form.record_date) next.record_date = 'Select a record date.';
    else if (form.record_date > getLocalDateInputValue()) next.record_date = 'The record date cannot be in the future.';
    if (!form.height_cm || Number(form.height_cm) <= 0) next.height_cm = 'Enter a height greater than 0 cm.';
    else if (Number(form.height_cm) < 50 || Number(form.height_cm) > 230) next.height_cm = 'Check measurement: height must be between 50 and 230 cm.';
    if (!form.weight_kg || Number(form.weight_kg) <= 0) next.weight_kg = 'Enter a weight greater than 0 kg.';
    else if (Number(form.weight_kg) > 300) next.weight_kg = 'Check measurement: weight is unusually high.';
    if (ageMonths !== null && (ageMonths < 61 || ageMonths > 228)) next.resident_id = 'This resident is outside the adolescent BMI age range.';
    setErrors(next);
    return next;
  };

  const publishToast = (message, link = true) => {
    setToast({ message, link });
    window.dispatchEvent(new CustomEvent('healthsync:notification', { detail: { title: 'Adolescent BMI', description: message } }));
  };

  const performSave = async (addNext = false) => {
    setSaving(true);
    try {
      const response = await createAdolescentBMI({ resident_id: Number(form.resident_id), record_date: form.record_date, height_cm: Number(form.height_cm), weight_kg: Number(form.weight_kg) });
      if (!response?.success) throw new Error(response?.message || 'Unable to save BMI record.');
      const offline = response.offline || response.queued;
      const category = response.data?.bmi_for_age_category;
      publishToast(offline ? 'Saved offline, will sync' : `Measurement saved - Classification: ${category || 'Assessment complete'}`);
      if (offline) {
        if (addNext) { setForm({ ...initialForm(), record_date: form.record_date }); setResident(null); setPreview(null); }
        return;
      }
      setPreview(response.data);
      if (addNext) { setForm({ ...initialForm(), record_date: form.record_date }); setResident(null); setPreview(null); setHistory([]); window.setTimeout(() => pickerRef.current?.focus(), 0); }
      else { setForm(initialForm()); setResident(null); setPreview(null); setHistory([]); }
      if (onSaved) onSaved();
    } catch (error) {
      const fieldErrors = error.response?.data?.errors;
      if (fieldErrors) setErrors(normalizeServerErrors(fieldErrors));
      publishToast(error.response?.data?.message || error.message || 'Unable to save BMI record.');
    } finally { setSaving(false); }
  };

  const submit = async (addNext = false) => {
    const nextErrors = validate();
    const first = Object.keys(nextErrors)[0];
    if (first) {
      const id = first === 'resident_id' ? 'adolescent-resident' : `adolescent-${first}`;
      window.setTimeout(() => document.getElementById(id)?.focus(), 0);
      publishToast('Please correct the highlighted fields.');
      return;
    }
    const sameDay = history.find((item) => String(item.record_date).slice(0, 10) === form.record_date);
    if (sameDay) { setDuplicate(true); return; }
    await performSave(addNext);
  };

  const reset = () => { setForm(initialForm()); setResident(null); setPreview(null); setErrors({}); };
  const heightWarning = form.height_cm && (Number(form.height_cm) < 50 || Number(form.height_cm) > 230) ? 'Check measurement: height is outside the plausible range.' : '';
  const weightWarning = form.weight_kg && (Number(form.weight_kg) <= 0 || Number(form.weight_kg) > 300) ? 'Check measurement: weight needs verification.' : '';
  const extremeWarning = preview && Number.isFinite(Number(preview.bmi_for_age_zscore)) && (Number(preview.bmi_for_age_zscore) < -5 || Number(preview.bmi_for_age_zscore) > 5) ? 'Check measurement: BMI-for-age z-score is outside the plausible WHO range.' : '';
  const displayResult = preview;
  const switchAdult = outsideGroup && ageYears !== null && ageYears >= 20;

  return <>
    <div className="nutrition-operation-layout adolescent-bmi-layout">
      <div className="nutrition-operation-form">
        <section className="nutrition-form-card">
          <header><FormIcon>◉</FormIcon><div><h2>Adolescent</h2><p>Search for the adolescent being assessed</p></div></header>
          {!resident ? <ResidentPicker inputId="adolescent-resident" value={form.resident_id} selectedResident={null} minAgeMonths={61} maxAgeMonths={228} onBMILabel="Switch to Adult BMI" onBMI={() => onSwitchToAdult ? onSwitchToAdult() : window.location.assign('/nutrition?tab=bmi-computation&bmi=adult')} onSelect={(item) => { setResident(item); setForm((current) => ({ ...current, resident_id: item?.resident_id || '' })); }} /> : <ResidentSummaryCard resident={resident} ageMonths={ageMonths} onChange={() => { setResident(null); setForm((current) => ({ ...current, resident_id: '' })); window.setTimeout(() => pickerRef.current?.focus(), 0); }} />}
          {errors.resident_id && <div className="nutrition-field-error"><span>!</span>{errors.resident_id}</div>}
          {outsideGroup && <div className="nutrition-out-range">{switchAdult ? `This resident is ${ageYears} years old.` : `This resident is outside the adolescent age range.`} <button type="button" className="nutrition-link-button nutrition-bmi-link" onClick={switchAdult && onSwitchToAdult ? onSwitchToAdult : () => window.location.assign('/nutrition?tab=bmi-computation&bmi=adult')}>{switchAdult ? 'Switch to Adult BMI' : 'Use another nutrition section'}</button></div>}
        </section>
        <section className="nutrition-form-card">
          <header><FormIcon>⚖</FormIcon><div><h2>Measurements</h2><p>Enter the measurement details</p></div></header>
          <div className="nutrition-measurement-grid">
            <div className="nutrition-field"><label htmlFor="adolescent-record_date">Record date</label><input id="adolescent-record_date" name="record_date" type="date" max={getLocalDateInputValue()} value={form.record_date} aria-invalid={errors.record_date ? 'true' : 'false'} aria-describedby={errors.record_date ? 'adolescent-record-date-error' : undefined} onChange={(event) => setForm((current) => ({ ...current, record_date: event.target.value }))} />{errors.record_date && <div id="adolescent-record-date-error" className="nutrition-field-error"><span>!</span>{errors.record_date}</div>}</div>
            <div className="nutrition-field"><label htmlFor="adolescent-age">Age</label><div className="nutrition-age-readonly"><input id="adolescent-age" value={ageMonths !== null ? `${ageYears} yr${ageYears === 1 ? '' : 's'} ${ageRemaining} mos (${ageMonths} months)` : ''} readOnly /><small>Calculated from birthdate</small></div></div>
            <MeasurementInput id="adolescent-height_cm" label="Height" name="height_cm" unit="cm" placeholder="e.g. 154.4" value={form.height_cm} min="50" max="230" step="0.1" error={errors.height_cm} onChange={(event) => { setForm((current) => ({ ...current, height_cm: event.target.value })); setPreview(null); }} />
            <MeasurementInput id="adolescent-weight_kg" label="Weight" name="weight_kg" unit="kg" placeholder="e.g. 34.7" value={form.weight_kg} min="0" max="300" step="0.1" error={errors.weight_kg} onChange={(event) => { setForm((current) => ({ ...current, weight_kg: event.target.value })); setPreview(null); }} />
          </div>
          {(heightWarning || weightWarning || extremeWarning) && <div className="nutrition-plausibility-warning"><span aria-hidden="true">⚠</span>{heightWarning || weightWarning || extremeWarning}</div>}
        </section>
      </div>
      <div className="nutrition-operation-side"><ResultPanel mode="bmi" result={displayResult} calculating={calculating} emptyTitle="Enter height and weight to see results" /><PreviousMeasurements mode="bmi" items={history} loading={historyLoading} /><TrendChart mode="bmi" items={history} /></div>
    </div>
    <div className="nutrition-mobile-summary"><button type="button" onClick={() => setDetailsOpen(true)}><strong>{displayResult ? `${displayResult.bmi_for_age_category || 'Assessment'} · BMI ${Number(displayResult.bmi).toFixed(2)}` : 'BMI result · Enter measurements'}</strong><span>Tap for details</span></button></div>
    {detailsOpen && <div className="nutrition-bottom-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsOpen(false); }}><div className="nutrition-bottom-sheet" role="dialog" aria-modal="true" aria-label="BMI result details"><button type="button" className="nutrition-sheet-close" onClick={() => setDetailsOpen(false)}>Close</button><ResultPanel mode="bmi" result={displayResult} calculating={calculating} emptyTitle="Enter height and weight to see results" /></div></div>}
    <div className="nutrition-action-bar"><div className="nutrition-today-counter"><strong>{history.length}</strong><span>previous visits</span></div><div className="nutrition-action-buttons"><button type="button" className="nutrition-button nutrition-button--secondary" onClick={reset}>Reset</button><button type="button" className="nutrition-button nutrition-button--outline" disabled={saving || calculating || !complete || Object.keys(errors).some((key) => errors[key])} onClick={() => submit(true)}>Save and add next</button><button type="button" className="nutrition-button nutrition-button--primary" disabled={saving || calculating || !complete || Object.keys(errors).some((key) => errors[key])} onClick={() => submit(false)}>{saving ? 'Saving…' : 'Save record'}</button></div></div>
    {toast && <div className="nutrition-toast" role="status"><span>{toast.message}</span>{toast.link && <button type="button" onClick={() => window.location.assign('/nutrition?tab=recent-records')}>View in recent records</button>}<button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button></div>}
    <ConfirmModal open={duplicate} title="Duplicate measurement" message={`Already measured on ${formatDateLabel(form.record_date)} - save anyway?`} confirmLabel="Save anyway" busy={saving} onCancel={() => setDuplicate(false)} onConfirm={async () => { setDuplicate(false); await performSave(false); }} />
  </>;
};

export default AdolescentBMIFormRedesign;
