import React, { useEffect, useMemo, useRef, useState } from 'react';
import ResidentPicker from '../../components/nutrition/ResidentPicker';
import ResidentSummaryCard from '../../components/nutrition/ResidentSummaryCard';
import MeasurementInput from '../../components/nutrition/MeasurementInput';
import ResultPanel from '../../components/nutrition/ResultPanel';
import PreviousMeasurements from '../../components/nutrition/PreviousMeasurements';
import TrendChart from '../../components/nutrition/TrendChart';
import ConfirmModal from '../../components/common/ConfirmModal';
import { createAdultBMI, previewAdultBMI, getPreviousAdultBMI } from '../../services/api/adultBMIService';
import { getLocalDateInputValue, formatDateLabel } from '../../utils/dateUtils';

const initialForm = () => ({ resident_id: '', date_recorded: getLocalDateInputValue(), height_cm: '', weight_kg: '' });
const ageInMonths = (birthdate, asOf) => {
  const b = /^\d{4}-\d{2}-\d{2}$/.exec(String(birthdate || '').slice(0, 10));
  const d = /^\d{4}-\d{2}-\d{2}$/.exec(String(asOf || ''));
  if (!b || !d) return null;
  const [by, bm, bd] = birthdate.slice(0, 10).split('-').map(Number);
  const [ry, rm, rd] = asOf.split('-').map(Number);
  const birth = new Date(Date.UTC(by, bm - 1, bd));
  const record = new Date(Date.UTC(ry, rm - 1, rd));
  if (record < birth || birth.getUTCDate() !== bd) return null;
  let months = (ry - by) * 12 + rm - bm;
  if (rd < bd) months -= 1;
  return months;
};

const AdultBMIFormRedesign = ({ onSaved, onSwitchToAdolescent }) => {
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

  const months = useMemo(() => ageInMonths(resident?.birthdate, form.date_recorded), [resident, form.date_recorded]);
  const ageYears = months === null ? null : Math.floor(months / 12);
  const outsideGroup = resident && months !== null && months < 240;

  useEffect(() => {
    if (!resident) { setHistory([]); return undefined; }
    let active = true;
    setHistoryLoading(true);
    getPreviousAdultBMI(resident.resident_id, 5).then((response) => {
      if (active && response?.success) setHistory(response.data || []);
    }).catch(() => { if (active) setHistory([]); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [resident]);

  const complete = resident && months !== null && months >= 240 && form.date_recorded && form.height_cm !== '' && form.weight_kg !== '';
  useEffect(() => {
    if (!complete) { setPreview(null); setCalculating(false); return undefined; }
    let active = true;
    setCalculating(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await previewAdultBMI({ resident_id: resident.resident_id, date_recorded: form.date_recorded, height_cm: Number(form.height_cm), weight_kg: Number(form.weight_kg) });
        if (active && response?.success) setPreview(response.data);
      } catch (error) {
        if (active) {
          const fieldErrors = error.response?.data?.errors || {};
          setPreview(null);
          setErrors((current) => ({ ...current, ...fieldErrors }));
        }
      } finally { if (active) setCalculating(false); }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [complete, resident, form]);

  const dirty = Boolean(resident || form.height_cm || form.weight_kg);
  useEffect(() => {
    const handler = (event) => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const validate = () => {
    const next = {};
    if (!resident) next.resident_id = 'Select an adult resident.';
    if (!form.date_recorded) next.date_recorded = 'Select a record date.';
    else if (form.date_recorded > getLocalDateInputValue()) next.date_recorded = 'The record date cannot be in the future.';
    if (!form.height_cm || Number(form.height_cm) <= 0) next.height_cm = 'Enter a height greater than 0 cm.';
    else if (Number(form.height_cm) < 50 || Number(form.height_cm) > 230) next.height_cm = 'Check measurement: height must be between 50 and 230 cm.';
    if (!form.weight_kg || Number(form.weight_kg) <= 0) next.weight_kg = 'Enter a weight greater than 0 kg.';
    else if (Number(form.weight_kg) > 300) next.weight_kg = 'Check measurement: weight is unusually high.';
    if (months !== null && months < 240) next.resident_id = 'This resident is outside the adult BMI age range.';
    setErrors(next);
    return next;
  };

  const publishToast = (message) => {
    setToast({ message });
    window.dispatchEvent(new CustomEvent('healthsync:notification', { detail: { title: 'Adult BMI', description: message } }));
  };

  const performSave = async (addNext) => {
    setSaving(true);
    try {
      const response = await createAdultBMI({ resident_id: Number(form.resident_id), date_recorded: form.date_recorded, height_cm: Number(form.height_cm), weight_kg: Number(form.weight_kg) });
      if (!response?.success) throw new Error(response?.message || 'Unable to save adult BMI record.');
      const offline = response.offline || response.queued;
      const category = response.data?.bmi_category;
      publishToast(offline ? 'Saved offline, will sync' : `Measurement saved - Classification: ${category || 'Assessment complete'}`);
      if (addNext) {
        setForm({ ...initialForm(), date_recorded: form.date_recorded }); setResident(null); setPreview(null); setHistory([]);
        window.setTimeout(() => pickerRef.current?.focus(), 0);
      } else {
        setForm(initialForm()); setResident(null); setPreview(null); setHistory([]);
      }
      if (onSaved) onSaved();
    } catch (error) {
      const fieldErrors = error.response?.data?.errors;
      if (fieldErrors) setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([key, value]) => [key === 'weight' ? 'weight_kg' : key === 'height' ? 'height_cm' : key, value])));
      publishToast(error.response?.data?.message || error.message || 'Unable to save adult BMI record.');
    } finally { setSaving(false); }
  };

  const submit = async (addNext = false) => {
    const nextErrors = validate();
    const first = Object.keys(nextErrors)[0];
    if (first) {
      const id = first === 'resident_id' ? 'adult-resident' : first === 'date_recorded' ? 'adult-date_recorded' : `adult-${first}`;
      window.setTimeout(() => document.getElementById(id)?.focus(), 0);
      publishToast('Please correct the highlighted fields.');
      return;
    }
    const sameDay = history.find((item) => String(item.date_recorded).slice(0, 10) === form.date_recorded);
    if (sameDay) { setDuplicate(true); return; }
    await performSave(addNext);
  };

  const reset = () => { setForm(initialForm()); setResident(null); setPreview(null); setErrors({}); };
  const bmi = preview?.bmi ? Number(preview.bmi) : null;
  const implausible = bmi !== null && (bmi < 12 || bmi > 60) ? 'Check measurement: BMI is outside the plausible range.' : '';
  const heightWarning = form.height_cm && (Number(form.height_cm) < 50 || Number(form.height_cm) > 230) ? 'Check measurement: height needs verification.' : '';
  const weightWarning = form.weight_kg && (Number(form.weight_kg) <= 0 || Number(form.weight_kg) > 300) ? 'Check measurement: weight needs verification.' : '';

  return <>
    <div className="nutrition-operation-layout adult-bmi-layout">
      <div className="nutrition-operation-form">
        <section className="nutrition-form-card">
          <header><span className="nutrition-card-icon" aria-hidden="true">◉</span><div><h2>Adult</h2><p>Search for the adult being assessed</p></div></header>
          {!resident ? <ResidentPicker inputId="adult-resident" label="Resident" value={form.resident_id} selectedResident={null} minAgeMonths={240} maxAgeMonths={1200} onBMILabel="Switch to Adolescent BMI" onBMI={() => onSwitchToAdolescent ? onSwitchToAdolescent() : window.location.assign('/nutrition?tab=bmi-computation&bmi=adolescent')} onSelect={(item) => { setResident(item); setForm((current) => ({ ...current, resident_id: item?.resident_id || '' })); }} /> : <ResidentSummaryCard resident={resident} ageMonths={months || 0} onChange={() => { setResident(null); setForm((current) => ({ ...current, resident_id: '' })); window.setTimeout(() => pickerRef.current?.focus(), 0); }} />}
          {errors.resident_id && <div className="nutrition-field-error"><span>!</span>{errors.resident_id}</div>}
          {outsideGroup && <div className="nutrition-out-range">This resident is {ageYears} years old. <button type="button" className="nutrition-link-button" onClick={() => onSwitchToAdolescent ? onSwitchToAdolescent() : window.location.assign('/nutrition?tab=bmi-computation&bmi=adolescent')}>Switch to Adolescent BMI</button></div>}
        </section>
        <section className="nutrition-form-card">
          <header><span className="nutrition-card-icon" aria-hidden="true">⚖</span><div><h2>Measurements</h2><p>Enter the measurement details</p></div></header>
          <div className="nutrition-measurement-grid">
            <div className="nutrition-field"><label htmlFor="adult-date_recorded">Date recorded</label><input id="adult-date_recorded" name="date_recorded" type="date" max={getLocalDateInputValue()} value={form.date_recorded} aria-invalid={errors.date_recorded ? 'true' : 'false'} onChange={(event) => setForm((current) => ({ ...current, date_recorded: event.target.value }))} />{errors.date_recorded && <div className="nutrition-field-error"><span>!</span>{errors.date_recorded}</div>}</div>
            <div className="nutrition-field"><label htmlFor="adult-age">Age</label><div className="nutrition-age-readonly"><input id="adult-age" value={months !== null ? `${ageYears} year${ageYears === 1 ? '' : 's'} (${months} months)` : ''} readOnly /><small>Calculated from birthdate</small></div></div>
            <MeasurementInput id="adult-height_cm" label="Height" name="height_cm" unit="cm" placeholder="e.g. 170.0" value={form.height_cm} min="50" max="230" step="0.1" error={errors.height_cm} onChange={(event) => { setForm((current) => ({ ...current, height_cm: event.target.value })); setPreview(null); }} />
            <MeasurementInput id="adult-weight_kg" label="Weight" name="weight_kg" unit="kg" placeholder="e.g. 65.0" value={form.weight_kg} min="0" max="300" step="0.1" error={errors.weight_kg} onChange={(event) => { setForm((current) => ({ ...current, weight_kg: event.target.value })); setPreview(null); }} />
          </div>
          {(heightWarning || weightWarning || implausible) && <div className="nutrition-plausibility-warning"><span aria-hidden="true">⚠</span>{heightWarning || weightWarning || implausible}</div>}
        </section>
      </div>
      <div className="nutrition-operation-side">
        <ResultPanel mode="adult-bmi" result={preview} calculating={calculating} emptyTitle="Enter height and weight to see results" heightCm={Number(form.height_cm)} resident={resident} ageYears={ageYears} />
        <PreviousMeasurements mode="adult-bmi" items={history} loading={historyLoading} />
        <TrendChart mode="adult-bmi" items={history} />
      </div>
    </div>
    <div className="nutrition-mobile-summary"><button type="button" onClick={() => setDetailsOpen(true)}><strong>{preview ? `${preview.bmi_category} · BMI ${Number(preview.bmi).toFixed(2)}` : 'BMI result · Enter measurements'}</strong><span>Tap for details</span></button></div>
    {detailsOpen && <div className="nutrition-bottom-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsOpen(false); }}><div className="nutrition-bottom-sheet" role="dialog" aria-modal="true" aria-label="Adult BMI result details"><button type="button" className="nutrition-sheet-close" onClick={() => setDetailsOpen(false)}>Close</button><ResultPanel mode="adult-bmi" result={preview} calculating={calculating} emptyTitle="Enter height and weight to see results" heightCm={Number(form.height_cm)} resident={resident} ageYears={ageYears} /></div></div>}
    <div className="nutrition-action-bar"><div className="nutrition-today-counter"><strong>{history.length}</strong><span>previous visits</span></div><div className="nutrition-action-buttons"><button type="button" className="nutrition-button nutrition-button--secondary" onClick={reset}>Reset</button><button type="button" className="nutrition-button nutrition-button--outline" disabled={saving || calculating || !complete || Object.keys(errors).some((key) => errors[key])} onClick={() => submit(true)}>Save and add next</button><button type="button" className="nutrition-button nutrition-button--primary" disabled={saving || calculating || !complete || Object.keys(errors).some((key) => errors[key])} onClick={() => submit(false)}>{saving ? 'Saving…' : 'Save record'}</button></div></div>
    {toast && <div className="nutrition-toast" role="status"><span>{toast.message}</span><button type="button" onClick={() => window.location.assign('/nutrition?tab=recent-records')}>View in recent records</button><button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button></div>}
    <ConfirmModal open={duplicate} title="Duplicate measurement" message={`Already measured on ${formatDateLabel(form.date_recorded)} - save anyway?`} confirmLabel="Save anyway" busy={saving} onCancel={() => setDuplicate(false)} onConfirm={async () => { setDuplicate(false); await performSave(false); }} />
  </>;
};

export default AdultBMIFormRedesign;
