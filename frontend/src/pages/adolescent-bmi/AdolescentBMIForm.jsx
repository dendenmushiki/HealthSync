import React, { useEffect, useMemo, useState } from 'react';
import ResidentAutocomplete from '../../components/residents/ResidentAutocomplete';
import { createAdolescentBMI, previewAdolescentBMI } from '../../services/api/adolescentBMIService';
import { normalizeResidentId } from '../../utils/residentUtils';

const getLocalDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const getDateParts = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { year, month, day, text: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
};

const getAgeInMonths = (birthdate, asOf) => {
  const birth = getDateParts(birthdate);
  const recordDate = getDateParts(asOf);
  if (!birth || !recordDate || recordDate.text < birth.text) return null;
  let months = (recordDate.year - birth.year) * 12 + recordDate.month - birth.month;
  if (recordDate.day < birth.day) months -= 1;
  return months;
};

const AdolescentBMIForm = ({ onSaved }) => {
  const [selectedResident, setSelectedResident] = useState(null);
  const [form, setForm] = useState({ resident_id: '', record_date: getLocalDate(), height_cm: '', weight_kg: '' });
  const [result, setResult] = useState(null);
  const [resultKey, setResultKey] = useState('');
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const ageInMonths = useMemo(() => getAgeInMonths(selectedResident?.birthdate, form.record_date), [selectedResident, form.record_date]);
  const calculationKey = [
    form.resident_id,
    selectedResident?.birthdate || '',
    selectedResident?.sex || '',
    form.record_date,
    form.height_cm,
    form.weight_kg
  ].join('|');
  const currentResult = resultKey === calculationKey ? result : null;
  const liveBmi = useMemo(() => {
    const height = Number(form.height_cm);
    const weight = Number(form.weight_kg);
    if (!height || !weight || height <= 0 || weight <= 0) return null;
    return Math.round((weight / ((height / 100) ** 2)) * 100) / 100;
  }, [form.height_cm, form.weight_kg]);

  useEffect(() => {
    const height = Number(form.height_cm);
    const weight = Number(form.weight_kg);
    if (!form.resident_id || !form.record_date || !form.height_cm || !form.weight_kg) {
      setResult(null);
      setResultKey('');
      setPreviewError('');
      setPreviewLoading(false);
      return undefined;
    }

    setResult(null);
    setResultKey('');
    if (!selectedResident?.birthdate) {
      setPreviewError('The selected resident must have a valid birthdate.');
      setPreviewLoading(false);
      return undefined;
    }
    if (!selectedResident?.sex) {
      setPreviewError('The selected resident must have sex recorded as male or female.');
      setPreviewLoading(false);
      return undefined;
    }
    if (ageInMonths === null) {
      setPreviewError('The record date must be a valid date on or after the resident’s birthdate.');
      setPreviewLoading(false);
      return undefined;
    }
    if (ageInMonths < 61 || ageInMonths > 228) {
      setPreviewError('WHO 2007 BMI-for-age references support ages 61–228 months.');
      setPreviewLoading(false);
      return undefined;
    }
    if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(weight) || weight <= 0) {
      setPreviewError('Enter a positive height and weight to calculate BMI-for-age.');
      setPreviewLoading(false);
      return undefined;
    }

    setPreviewError('');
    setPreviewLoading(true);
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await previewAdolescentBMI({ resident_id: normalizeResidentId(form.resident_id), record_date: form.record_date, height_cm: height, weight_kg: weight });
        if (active && response?.success && response.data?.bmi_for_age_category && Number.isFinite(response.data.bmi_for_age_zscore)) {
          setResult(response.data);
          setResultKey(calculationKey);
        } else if (active) {
          setResult(null);
          setResultKey('');
          setPreviewError('Unable to calculate nutritional status. Please verify the resident information and measurements.');
        }
      } catch (previewError) {
        if (active) {
          setResult(null);
          setResultKey('');
          setPreviewError(previewError?.response?.data?.message || 'Unable to calculate nutritional status. Please check the measurements and resident information.');
        }
      } finally {
        if (active) setPreviewLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ageInMonths, calculationKey, form.height_cm, form.record_date, form.resident_id, form.weight_kg, selectedResident]);

  const handleChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.resident_id) {
      setError('Please select a resident.');
      return;
    }

    if (ageInMonths === null || ageInMonths < 61 || ageInMonths > 228) {
      setError('WHO 2007 BMI-for-age references support ages 61–228 months.');
      return;
    }
    if (!selectedResident?.birthdate || !selectedResident?.sex) {
      setError('The selected resident must have a valid birthdate and sex recorded as male or female.');
      return;
    }
    if (!currentResult?.bmi_for_age_category) {
      setError('Wait for a valid nutritional classification before saving this assessment.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        resident_id: normalizeResidentId(form.resident_id),
        record_date: form.record_date,
        height_cm: Number(form.height_cm),
        weight_kg: Number(form.weight_kg),
      };

      const response = await createAdolescentBMI(payload);
      if (response && response.success) {
        setResult(response.data);
        setSelectedResident(null);
        setForm({ resident_id: '', record_date: getLocalDate(), height_cm: '', weight_kg: '' });
        if (onSaved) onSaved();
      } else {
        setError(response?.message || 'Unable to save BMI record.');
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to save BMI record.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="healthsync-form-shell">
      <div className="healthsync-form-card">
        <div className="healthsync-form-header">
          <h3>BMI Assessment</h3>
          <p>Adolescent nutritional evaluation</p>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit} className="healthsync-form">
          <section className="healthsync-form-section">
            <div className="healthsync-form-section-title">ASSESSMENT DETAILS</div>

            <div className="form-row three-col-row nutrition-details-row">
              <div className="form-group">
                <label className="form-label" htmlFor="adolescent-resident-search">Resident</label>
                <ResidentAutocomplete
                  inputId="adolescent-resident-search"
                  value={form.resident_id}
                  selectedResident={selectedResident}
                  minAgeMonths={61}
                  maxAgeMonths={228}
                  onSelect={(resident) => { setSelectedResident(resident); setForm((prev) => ({ ...prev, resident_id: resident?.resident_id || '' })); }}
                  placeholder="Search name or household number"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="adolescent-record-date">Record date</label>
                <input id="adolescent-record-date" type="date" name="record_date" className="form-control healthsync-form-input" value={form.record_date} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="adolescent-age-months">Age in months</label>
                <input id="adolescent-age-months" className="form-control healthsync-form-input" value={ageInMonths ?? ''} readOnly />
              </div>
            </div>

            <div className="form-row two-col-row">
              <div className="form-group">
                <label className="form-label" htmlFor="adolescent-height">Height (cm)</label>
                <input id="adolescent-height" type="number" name="height_cm" step="0.1" placeholder="e.g. 154.4" inputMode="decimal" className="form-control healthsync-form-input" value={form.height_cm} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="adolescent-weight">Weight (kg)</label>
                <input id="adolescent-weight" type="number" name="weight_kg" step="0.1" placeholder="e.g. 34.7" inputMode="decimal" className="form-control healthsync-form-input" value={form.weight_kg} onChange={handleChange} required />
              </div>
            </div>
          </section>

          {selectedResident && (
            <div className="alert alert-light border mb-0">
              Selected resident: {selectedResident.first_name} {selectedResident.last_name} · DOB: {selectedResident.birthdate || '-'} · Sex: {selectedResident.sex || '-'}
            </div>
          )}

          {liveBmi !== null && (
            <div className="alert alert-success border mb-0">
              <strong>Live result:</strong> BMI {liveBmi} · Nutritional status: {previewLoading ? 'Calculating…' : currentResult?.bmi_for_age_category || 'Not calculated'}
              {currentResult && <span> · Z-score: {currentResult.bmi_for_age_zscore}</span>}
            </div>
          )}
          {previewError && <div className="alert alert-danger mb-0" role="alert">{previewError}</div>}

          <div className="healthsync-form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading || previewLoading || !currentResult?.bmi_for_age_category}>{loading ? 'Saving...' : 'Save record'}</button>
          </div>
        </form>

        {currentResult && (
          <div className="mt-4 border rounded p-3 bg-light">
            <h6 className="mb-3">BMI result</h6>
            <div className="row g-3">
              <div className="col-md-2"><div className="small text-muted">Age</div><div className="fs-5">{currentResult.age_years ?? '-'}</div></div>
              <div className="col-md-2"><div className="small text-muted">Age months</div><div className="fs-5">{currentResult.age_months ?? '-'}</div></div>
              <div className="col-md-2"><div className="small text-muted">Height</div><div className="fs-5">{currentResult.height_cm ?? '-'} cm</div></div>
              <div className="col-md-2"><div className="small text-muted">Weight</div><div className="fs-5">{currentResult.weight_kg ?? '-'} kg</div></div>
              <div className="col-md-2"><div className="small text-muted">BMI</div><div className="fs-5">{currentResult.bmi ?? '-'}</div></div>
              <div className="col-md-2"><div className="small text-muted">Z-score</div><div className="fs-5">{currentResult.bmi_for_age_zscore ?? '-'}</div></div>
              <div className="col-md-12"><div className="small text-muted">Classification</div><div className="fs-5">{currentResult.bmi_for_age_category ?? '-'}</div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdolescentBMIForm;
