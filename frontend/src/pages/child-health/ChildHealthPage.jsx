import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { getResident } from '../../services/api/residentService';
import { listChildHealthRecords, createChildHealthRecord, updateChildHealthRecord } from '../../services/api/childHealthService';
import { formatDateLabel, getLocalDateInputValue } from '../../utils/dateUtils';
import StatusBanner from '../../components/common/StatusBanner';
import { getFriendlyError } from '../../utils/apiErrorMessages';

const initialForm = {
  family_serial_number: '',
  nhts_number: '',
  philhealth_number: '',
  philhealth_category: '',
  religion: '',
  birthplace: '',
  birth_weight_kg: '',
  school_name: '',
  grade_level: '',
  parent_guardian_name: '',
  parent_guardian_relationship: '',
  record_date: getLocalDateInputValue(),
  history_of_present_illness: '',
  past_medical_history: '',
  hospitalization_history: '',
  medication_allergies: '',
  food_allergies: '',
  family_medical_history: '',
  birth_history: '',
  immunization_history: '',
  blood_pressure: '',
  heart_rate: '',
  respiratory_rate: '',
  temperature: '',
  weight_kg: '',
  height_cm: '',
  findings: '',
  assessment: '',
  plan: '',
  remarks: '',
};

const ChildHealthPage = () => {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRecordId = searchParams.get('recordId');
  const [resident, setResident] = useState(null);
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const residentResponse = await getResident(id);
        if (residentResponse?.success) setResident(residentResponse.data);

        const recordResponse = await listChildHealthRecords({ resident_id: id, page: 1, limit: 20 });
        if (recordResponse?.success) {
          const items = recordResponse.data?.items || [];
          setRecords(items);
          if (requestedRecordId) {
            const requested = items.find((record) => String(record.id) === requestedRecordId);
            if (requested) {
              setEditingId(requested.id);
              setForm(Object.fromEntries(Object.keys(initialForm).map((field) => [field, requested[field] ?? ''])));
            } else {
              setError('The requested child health record was not found.');
            }
          }
        }
      } catch (err) {
        console.error('Unable to load child health records.', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, requestedRecordId]);

  const residentDisplayName = useMemo(() => {
    if (!resident) return 'Child';
    return [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(' ');
  }, [resident]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');
    setSaving(true);

    try {
      const payload = {
        resident_id: Number(id),
        ...form,
        birth_weight_kg: form.birth_weight_kg === '' ? null : Number(form.birth_weight_kg),
        temperature: form.temperature === '' ? null : Number(form.temperature),
        weight_kg: form.weight_kg === '' ? null : Number(form.weight_kg),
        height_cm: form.height_cm === '' ? null : Number(form.height_cm),
      };

      const response = editingId
        ? await updateChildHealthRecord(editingId, payload)
        : await createChildHealthRecord(payload);
      if (response?.success) {
        setSuccessMessage(response.offline || response.queued
          ? 'Record saved on this device. It will synchronize when the connection is restored.'
          : editingId ? 'Child health record updated successfully.' : 'Child health record saved successfully.');
        setForm(initialForm);
        setEditingId(null);
        if (searchParams.has('recordId')) {
          const next = new URLSearchParams(searchParams);
          next.delete('recordId');
          setSearchParams(next, { replace: true });
        }
        const refreshed = await listChildHealthRecords({ resident_id: id, page: 1, limit: 20 });
        if (refreshed?.success) setRecords(refreshed.data?.items || []);
      } else {
        setError(getFriendlyError(response?.message || 'Unable to save child health record.'));
      }
    } catch (err) {
      console.error('Unable to save child health record.', err);
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="container mt-4">Loading child health records...</div>;

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div>
          <h3 className="mb-1">Child Health Record</h3>
          <p className="text-muted mb-0">Resident: {residentDisplayName}</p>
        </div>
        <Link to={`/residents/${id}`} className="page-action-button page-action-back"><span aria-hidden="true">&#8592;</span> Back to resident</Link>
      </div>

      {error && <StatusBanner error={error} compact />}
      {successMessage && <div className="alert alert-info" role="status">{successMessage}</div>}

      <div className="healthsync-form-shell">
        <div className="healthsync-form-card">
          <div className="healthsync-form-header">
            <h3>{editingId ? 'Edit child health record' : 'Child health information'}</h3>
            <p>Document child-specific profile details and general clinical history while keeping Operation Timbang separate.</p>
          </div>

          <form onSubmit={handleSubmit} className="healthsync-form">
            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">CHILD INFORMATION</div>
              <div className="form-row four-col-row">
                <div className="form-group"><label className="form-label">Family serial number</label><input name="family_serial_number" className="form-control healthsync-form-input" value={form.family_serial_number} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">NHTS #</label><input name="nhts_number" className="form-control healthsync-form-input" value={form.nhts_number} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">PhilHealth #</label><input name="philhealth_number" className="form-control healthsync-form-input" value={form.philhealth_number} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">PhilHealth category</label><input name="philhealth_category" className="form-control healthsync-form-input" value={form.philhealth_category} onChange={handleChange} /></div>
              </div>
              <div className="form-row four-col-row">
                <div className="form-group"><label className="form-label">Religion</label><input name="religion" className="form-control healthsync-form-input" value={form.religion} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Birthplace</label><input name="birthplace" className="form-control healthsync-form-input" value={form.birthplace} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Birth weight (kg)</label><input type="number" step="0.1" name="birth_weight_kg" className="form-control healthsync-form-input" value={form.birth_weight_kg} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Date of record</label><input type="date" name="record_date" className="form-control healthsync-form-input" value={form.record_date} onChange={handleChange} required /></div>
              </div>
              <div className="form-row three-col-row">
                <div className="form-group"><label className="form-label">School</label><input name="school_name" className="form-control healthsync-form-input" value={form.school_name} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Grade level</label><input name="grade_level" className="form-control healthsync-form-input" value={form.grade_level} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Sex</label><input className="form-control healthsync-form-input" value={resident?.sex || '-'} readOnly /></div>
              </div>
            </section>

            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">PARENT / GUARDIAN</div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Parent / guardian name</label><input name="parent_guardian_name" className="form-control healthsync-form-input" value={form.parent_guardian_name} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Relationship</label><input name="parent_guardian_relationship" className="form-control healthsync-form-input" value={form.parent_guardian_relationship} onChange={handleChange} /></div>
              </div>
            </section>

            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">CLINICAL ENCOUNTER</div>
              <div className="form-group"><label className="form-label">History of present illness</label><textarea rows="3" name="history_of_present_illness" className="form-control healthsync-form-input" value={form.history_of_present_illness} onChange={handleChange} /></div>
              <div className="form-row two-col-row mt-3">
                <div className="form-group"><label className="form-label">Past medical history</label><textarea rows="3" name="past_medical_history" className="form-control healthsync-form-input" value={form.past_medical_history} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Hospitalization history</label><textarea rows="3" name="hospitalization_history" className="form-control healthsync-form-input" value={form.hospitalization_history} onChange={handleChange} /></div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Medication allergies</label><textarea rows="3" name="medication_allergies" className="form-control healthsync-form-input" value={form.medication_allergies} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Food allergies</label><textarea rows="3" name="food_allergies" className="form-control healthsync-form-input" value={form.food_allergies} onChange={handleChange} /></div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Family medical history</label><textarea rows="3" name="family_medical_history" className="form-control healthsync-form-input" value={form.family_medical_history} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Birth / health history</label><textarea rows="3" name="birth_history" className="form-control healthsync-form-input" value={form.birth_history} onChange={handleChange} /></div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Immunization history</label><textarea rows="3" name="immunization_history" className="form-control healthsync-form-input" value={form.immunization_history} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Remarks</label><textarea rows="3" name="remarks" className="form-control healthsync-form-input" value={form.remarks} onChange={handleChange} /></div>
              </div>
            </section>

            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">VITAL SIGNS</div>
              <div className="form-row four-col-row">
                <div className="form-group"><label className="form-label">Blood pressure</label><input name="blood_pressure" className="form-control healthsync-form-input" value={form.blood_pressure} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Pulse / heart rate</label><input name="heart_rate" className="form-control healthsync-form-input" value={form.heart_rate} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Respiratory rate</label><input name="respiratory_rate" className="form-control healthsync-form-input" value={form.respiratory_rate} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Temperature</label><input type="number" step="0.1" name="temperature" className="form-control healthsync-form-input" value={form.temperature} onChange={handleChange} /></div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Weight (kg)</label><input type="number" step="0.1" name="weight_kg" className="form-control healthsync-form-input" value={form.weight_kg} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Height (cm)</label><input type="number" step="0.1" name="height_cm" className="form-control healthsync-form-input" value={form.height_cm} onChange={handleChange} /></div>
              </div>
            </section>

            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">FINDINGS</div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Findings</label><textarea rows="3" name="findings" className="form-control healthsync-form-input" value={form.findings} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Assessment</label><textarea rows="3" name="assessment" className="form-control healthsync-form-input" value={form.assessment} onChange={handleChange} /></div>
              </div>
              <div className="form-group"><label className="form-label">Plan</label><textarea rows="3" name="plan" className="form-control healthsync-form-input" value={form.plan} onChange={handleChange} /></div>
            </section>

            <div className="healthsync-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update Child Health Record' : 'Save Child Health Record'}</button>
              {editingId && <button type="button" className="btn btn-outline-secondary" disabled={saving} onClick={() => {
                setForm(initialForm);
                setEditingId(null);
                const next = new URLSearchParams(searchParams);
                next.delete('recordId');
                setSearchParams(next, { replace: true });
              }}>Cancel edit</button>}
            </div>
          </form>
        </div>
      </div>

      <div className="card shadow-sm border-0 mt-4">
        <div className="card-body">
          <h5 className="card-title">Child health history</h5>
          {records.length === 0 ? <p className="text-muted mb-0">No child health records yet.</p> : (
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>History</th>
                    <th>Assessment</th>
                    <th>Plan</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td>{formatDateLabel(record.record_date) || 'Date not recorded'}</td>
                      <td>{record.history_of_present_illness || '-'}</td>
                      <td>{record.assessment || '-'}</td>
                      <td>{record.plan || '-'}</td>
                      <td><button type="button" className="btn btn-sm btn-outline-primary" onClick={() => {
                        setEditingId(record.id);
                        setForm(Object.fromEntries(Object.keys(initialForm).map((field) => [field, record[field] ?? ''])));
                        const next = new URLSearchParams(searchParams);
                        next.set('recordId', String(record.id));
                        setSearchParams(next, { replace: true });
                      }}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChildHealthPage;
