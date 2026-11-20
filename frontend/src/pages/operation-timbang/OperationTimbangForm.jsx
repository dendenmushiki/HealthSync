import React, { useEffect, useMemo, useState } from 'react';
import ResidentAutocomplete from '../../components/residents/ResidentAutocomplete';
import { calculateOperationTimbang, createOperationTimbang } from '../../services/api/operationTimbangService';
import { formatResidentName, normalizeResidentId } from '../../utils/residentUtils';
import OperationTimbangFormRedesign from './OperationTimbangFormRedesign';
import StatusBanner from '../../components/common/StatusBanner';

const getLocalDateString = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const parseCalendarDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(String(value || ''));
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { date, value: `${yearText}-${monthText}-${dayText}` };
};

export const getAgeInMonths = (birthdate, dateRecorded, today = getLocalDateString()) => {
  const birth = parseCalendarDate(birthdate);
  const recorded = parseCalendarDate(dateRecorded);
  const current = parseCalendarDate(today);
  if (!birth || !recorded || !current || birth.value > current.value || recorded.value > current.value) return null;
  const birthParts = [birth.date.getUTCFullYear(), birth.date.getUTCMonth() + 1, birth.date.getUTCDate()];
  const recordParts = [recorded.date.getUTCFullYear(), recorded.date.getUTCMonth() + 1, recorded.date.getUTCDate()];
  const birthDay = birth.date.getTime();
  const recordDay = recorded.date.getTime();
  if (recordDay < birthDay) return null;
  let months = ((recordParts[0] - birthParts[0]) * 12) + recordParts[1] - birthParts[1];
  if (recordParts[2] < birthParts[2]) months -= 1;
  return months;
};

const createInitialForm = () => ({
  resident_id: '',
  date_recorded: getLocalDateString(),
  weight_kg: '',
  measurement_cm: '',
  measurement_type: '',
});

const ResultIndicator = ({ title, score, status }) => {
  const hasScore = Number.isFinite(Number(score)) && score !== null && score !== '';
  return (
    <div className="col-md-4">
      <div className="border rounded p-3 h-100 bg-white">
        <div className="small text-muted">{title}</div>
        <div className="fs-5 fw-semibold">{hasScore ? status || 'Unavailable' : 'Unavailable'}</div>
        <div className="small text-muted">Z-score: {hasScore ? `${Number(score).toFixed(2)} SD` : 'Unavailable'}</div>
      </div>
    </div>
  );
};

const OperationTimbangForm = ({ onSaved }) => {
  const [form, setForm] = useState(createInitialForm);
  const [selectedResident, setSelectedResident] = useState(null);
  const [preview, setPreview] = useState(null);
  const [savedResult, setSavedResult] = useState(null);
  const [error, setError] = useState('');
  const [calculationError, setCalculationError] = useState('');
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);

  const ageInMonths = useMemo(
    () => getAgeInMonths(selectedResident?.birthdate, form.date_recorded),
    [form.date_recorded, selectedResident]
  );

  useEffect(() => {
    const complete = selectedResident
      && form.resident_id
      && form.date_recorded
      && form.weight_kg !== ''
      && form.measurement_cm !== ''
      && form.measurement_type;
    if (!complete) {
      setPreview(null);
      setCalculationError('');
      setCalculating(false);
      return undefined;
    }

    if (ageInMonths === null) {
      setPreview(null);
      setCalculationError('Enter a valid birthdate and measurement date. The measurement date must be on or after birth and not in the future.');
      setCalculating(false);
      return undefined;
    }

    let active = true;
    setPreview(null);
    setCalculationError('');
    setCalculating(true);
    const timer = setTimeout(async () => {
      try {
        const response = await calculateOperationTimbang({
          resident_id: normalizeResidentId(form.resident_id),
          date_recorded: form.date_recorded,
          weight_kg: Number(form.weight_kg),
          measurement_cm: Number(form.measurement_cm),
          measurement_type: form.measurement_type,
        });
        if (active && response?.success) setPreview(response.data);
        else if (active)         setCalculationError(response?.message || 'Unable to calculate nutritional status. Please check the measurements and required child information.');
      } catch (calculationFailure) {
        if (active) {
          console.error('Unable to calculate Operation Timbang status.', calculationFailure);
          setCalculationError(calculationFailure);
        }
      } finally {
        if (active) setCalculating(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ageInMonths, form.date_recorded, form.measurement_cm, form.measurement_type, form.resident_id, form.weight_kg, selectedResident]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setPreview(null);
    setSavedResult(null);
    setCalculationError('');
    setError('');
  };

  const handleResidentSelect = (resident) => {
    setSelectedResident(resident);
    setForm((previous) => ({ ...previous, resident_id: resident?.resident_id || '' }));
    setPreview(null);
    setSavedResult(null);
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!preview) {
      setError(calculationError || 'Enter valid measurements and wait for the nutritional assessment before saving.');
      return;
    }

    setSaving(true);
    try {
      const response = await createOperationTimbang({
        resident_id: normalizeResidentId(form.resident_id),
        date_recorded: form.date_recorded,
        weight_kg: Number(form.weight_kg),
        measurement_cm: Number(form.measurement_cm),
        measurement_type: form.measurement_type,
      });
      if (!response?.success) {
        setError(response?.message || 'Unable to save Operation Timbang record.');
        return;
      }
      setSavedResult(response.data);
      setPreview(null);
      setForm(createInitialForm());
      setSelectedResident(null);
      if (onSaved) onSaved();
    } catch (saveFailure) {
      console.error('Unable to save Operation Timbang record.', saveFailure);
      setError(saveFailure);
    } finally {
      setSaving(false);
    }
  };

  const displayedResult = preview || savedResult;

  return (
    <div className="healthsync-form-shell">
      <div className="healthsync-form-card">
        <div className="healthsync-form-header">
          <h3>Create Measurement</h3>
          <p>Operation Timbang child measurement</p>
        </div>

        {error && <StatusBanner error={error} compact />}
        {calculationError && (typeof calculationError === 'string'
          ? <div className="alert alert-warning" role="status">{calculationError}</div>
          : <StatusBanner error={calculationError} compact />)}

        <form onSubmit={handleSubmit} className="healthsync-form">
          <section className="healthsync-form-section">
            <div className="healthsync-form-section-title">MEASUREMENT ENTRY</div>

            <div className="form-row three-col-row nutrition-details-row">
              <div className="form-group">
                <label className="form-label" htmlFor="operation-timbang-resident">Resident</label>
                <ResidentAutocomplete
                  inputId="operation-timbang-resident"
                  value={form.resident_id}
                  selectedResident={selectedResident}
                  minAgeMonths={0}
                  maxAgeMonths={59}
                  onSelect={handleResidentSelect}
                  placeholder="Search name or household number"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="operation-timbang-date">Date recorded</label>
                <input id="operation-timbang-date" type="date" name="date_recorded" className="form-control healthsync-form-input" value={form.date_recorded} max={getLocalDateString()} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="operation-timbang-age">Age at measurement (months)</label>
                <input id="operation-timbang-age" className="form-control healthsync-form-input" value={ageInMonths ?? ''} readOnly />
              </div>
            </div>

            <div className="form-row three-col-row">
              <div className="form-group">
                <label className="form-label" htmlFor="operation-timbang-weight">Weight (kg)</label>
                <input id="operation-timbang-weight" type="number" step="0.01" min="0" name="weight_kg" placeholder="e.g. 12.5" inputMode="decimal" className="form-control healthsync-form-input" value={form.weight_kg} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="operation-timbang-measurement">Height / length (cm)</label>
                <input id="operation-timbang-measurement" type="number" step="0.1" min="0" name="measurement_cm" placeholder="e.g. 86.5" inputMode="decimal" className="form-control healthsync-form-input" value={form.measurement_cm} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="operation-timbang-type">Measurement type</label>
                <select id="operation-timbang-type" name="measurement_type" className="form-select healthsync-form-input" value={form.measurement_type} onChange={handleChange} required>
                  <option value="" disabled>Select measurement type</option>
                  <option value="length">Recumbent length</option>
                  <option value="height">Standing height</option>
                </select>
              </div>
            </div>
          </section>

          {selectedResident && (
            <div className="alert alert-light border mb-0">
              <strong>Selected child:</strong> {formatResidentName(selectedResident)} · Age: {ageInMonths ?? '-'} months · Sex: {selectedResident.sex || 'Not recorded'}
            </div>
          )}

          {calculating && <div className="text-muted" role="status">Calculating WHO growth indicators...</div>}

          <div className="healthsync-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || calculating || !preview}>
              {saving ? 'Saving...' : 'Save record'}
            </button>
          </div>
        </form>

        {displayedResult && (
          <div className="mt-4 border rounded p-3 bg-light" aria-live="polite">
            <h6 className="mb-3">{preview ? 'Nutritional assessment preview' : 'Saved assessment results'}</h6>
            <div className="row g-3 mb-3">
              <div className="col-md-4"><div className="small text-muted">Weight</div><div>{displayedResult.weight_kg} kg</div></div>
              <div className="col-md-4"><div className="small text-muted">Measured height/length</div><div>{displayedResult.measurement_cm} cm ({displayedResult.measurement_type})</div></div>
              <div className="col-md-4"><div className="small text-muted">Age at measurement</div><div>{displayedResult.age_in_months} months</div></div>
            </div>
            <div className="row g-3">
              <ResultIndicator title="Weight-for-age (WAZ)" score={displayedResult.wfa_zscore} status={displayedResult.wfa_status} />
              <ResultIndicator title="Length/height-for-age (HAZ)" score={displayedResult.hfa_zscore} status={displayedResult.hfa_status} />
              <ResultIndicator title="Weight-for-length/height (WHZ)" score={displayedResult.wflh_zscore} status={displayedResult.wflh_status} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OperationTimbangFormRedesign;
