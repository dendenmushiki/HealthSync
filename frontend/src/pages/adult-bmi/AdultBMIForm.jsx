import React, { useMemo, useState } from 'react';
import ResidentAutocomplete from '../../components/residents/ResidentAutocomplete';
import { createAdultBMI } from '../../services/api/adultBMIService';
import { calculateAge } from '../../utils/residentUtils';
import { getLocalDateInputValue } from '../../utils/dateUtils';

const AdultBMIForm = ({ onSaved }) => {
  const [selectedResident, setSelectedResident] = useState(null);
  const [form, setForm] = useState({ resident_id: '', record_date: getLocalDateInputValue(), height_cm: '', weight_kg: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const ageYears = useMemo(() => calculateAge(selectedResident?.birthdate, form.record_date ? new Date(`${form.record_date}T00:00:00`) : new Date()), [selectedResident, form.record_date]);

  const liveBmi = useMemo(() => {
    const height = Number(form.height_cm);
    const weight = Number(form.weight_kg);
    if (!height || !weight || height <= 0 || weight <= 0) return null;
    return Math.round((weight / ((height / 100) ** 2)) * 100) / 100;
  }, [form.height_cm, form.weight_kg]);

  const liveCategory = useMemo(() => {
    if (liveBmi === null) return null;
    if (liveBmi < 18.5) return 'Underweight';
    if (liveBmi < 25) return 'Normal';
    if (liveBmi < 30) return 'Overweight';
    return 'Obese';
  }, [liveBmi]);

  const handleChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.resident_id) {
      setError('Please select a resident.');
      return;
    }

    if (ageYears === null || ageYears < 20) {
      setError('Adult BMI is valid only for residents aged 20 or above.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        resident_id: Number(form.resident_id),
        date_recorded: form.record_date,
        height_cm: Number(form.height_cm),
        weight_kg: Number(form.weight_kg),
      };

      const response = await createAdultBMI(payload);
      if (response && response.success) {
        setResult(response.data);
        setSelectedResident(null);
        setForm({ resident_id: '', record_date: getLocalDateInputValue(), height_cm: '', weight_kg: '' });
        if (onSaved) onSaved();
      } else {
        setError(response?.message || 'Unable to save adult BMI record.');
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to save adult BMI record.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="healthsync-form-shell">
      <div className="healthsync-form-card">
        <div className="healthsync-form-header">
          <h3>Adult BMI Measurement</h3>
          <p>Adult nutritional status assessment</p>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit} className="healthsync-form">
          <section className="healthsync-form-section">
            <div className="healthsync-form-section-title">MEASUREMENT DETAILS</div>

            <div className="form-row three-col-row nutrition-details-row">
              <div className="form-group">
                <label className="form-label">Resident</label>
                <ResidentAutocomplete
                  value={form.resident_id}
                  selectedResident={selectedResident}
                  minAge={20}
                  onSelect={(resident) => { setSelectedResident(resident); setForm((prev) => ({ ...prev, resident_id: resident?.resident_id || '' })); }}
                  placeholder="Search name or household number"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Date recorded</label>
                <input type="date" name="record_date" className="form-control healthsync-form-input" value={form.record_date} onChange={handleChange} />
              </div>

              <div className="form-group">
                <label className="form-label">Age</label>
                <input className="form-control healthsync-form-input" value={ageYears ?? ''} readOnly />
              </div>
            </div>

            <div className="form-row two-col-row">
              <div className="form-group">
                <label className="form-label">Height (cm)</label>
                <input type="number" name="height_cm" step="0.1" placeholder="e.g. 170.0" inputMode="decimal" className="form-control healthsync-form-input" value={form.height_cm} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label">Weight (kg)</label>
                <input type="number" name="weight_kg" step="0.1" placeholder="e.g. 65.0" inputMode="decimal" className="form-control healthsync-form-input" value={form.weight_kg} onChange={handleChange} required />
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
              <strong>Live result:</strong> BMI {liveBmi} · Nutritional status: {liveCategory}
            </div>
          )}

          <div className="healthsync-form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Calculating...' : 'Save record'}</button>
          </div>
        </form>

        {result && (
          <div className="mt-4 border rounded p-3 bg-light">
            <h6 className="mb-3">BMI result</h6>
            <div className="row g-3">
              <div className="col-md-2"><div className="small text-muted">Age</div><div className="fs-5">{result.age_years ?? '-'}</div></div>
              <div className="col-md-2"><div className="small text-muted">Height</div><div className="fs-5">{result.height_cm ?? '-'} cm</div></div>
              <div className="col-md-2"><div className="small text-muted">Weight</div><div className="fs-5">{result.weight_kg ?? '-'} kg</div></div>
              <div className="col-md-2"><div className="small text-muted">BMI</div><div className="fs-5">{result.bmi ?? '-'}</div></div>
              <div className="col-md-4"><div className="small text-muted">Category</div><div className="fs-5">{result.bmi_category ?? '-'}</div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdultBMIForm;
