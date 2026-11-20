import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { getResident } from '../../services/api/residentService';
import { listHealthRecords, createHealthRecord, deleteHealthRecord, updateHealthRecord } from '../../services/api/healthRecordService';
import ConfirmModal from '../../components/common/ConfirmModal';
import { formatDateLabel, getLocalDateInputValue } from '../../utils/dateUtils';
import StatusBanner from '../../components/common/StatusBanner';

const initialForm = {
  record_date: getLocalDateInputValue(),
  record_type: 'Clinical',
  chief_complaint: '',
  history_of_present_illness: '',
  past_medical_history: '',
  allergies: '',
  family_medical_history: '',
  personal_social_history: '',
  blood_pressure: '',
  heart_rate: '',
  respiratory_rate: '',
  temperature: '',
  weight_kg: '',
  height_cm: '',
  findings: '',
  assessment: '',
  plan: '',
  maintenance_medications: '',
  past_surgical_history: '',
  immunization_history: '',
  family_planning_history: '',
  menstrual_history: '',
  pregnancy_history: '',
  remarks: '',
};

const ClinicalRecordsPage = () => {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRecordId = searchParams.get('recordId');
  const [resident, setResident] = useState(null);
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!id) return;
        const residentResponse = await getResident(id);
        if (residentResponse?.success) setResident(residentResponse.data);

        const recordsResponse = await listHealthRecords({ resident_id: id, page: 1, limit: 20 });
        if (recordsResponse?.success) {
          const items = recordsResponse.data?.items || [];
          setRecords(items);
          if (requestedRecordId) {
            const requested = items.find((record) => String(record.health_record_id) === requestedRecordId);
            if (requested) {
              setEditingId(requested.health_record_id);
              setForm(Object.fromEntries(Object.keys(initialForm).map((field) => [field, requested[field] ?? ''])));
            } else {
              setError('The requested clinical record was not found.');
            }
          }
        }
      } catch (err) {
        console.error('Unable to load resident clinical records.', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, requestedRecordId]);

  const residentDisplayName = useMemo(() => {
    if (!resident) return 'Resident';
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
        weight_kg: form.weight_kg === '' ? null : Number(form.weight_kg),
        height_cm: form.height_cm === '' ? null : Number(form.height_cm),
        temperature: form.temperature === '' ? null : Number(form.temperature),
      };

      const response = editingId
        ? await updateHealthRecord(editingId, payload)
        : await createHealthRecord(payload);
      if (response?.success) {
        setSuccessMessage(response.offline || response.queued
          ? 'Record saved on this device. It will synchronize when the connection is restored.'
          : editingId ? 'Clinical record updated successfully.' : 'Clinical record saved successfully.');
        setForm(initialForm);
        setEditingId(null);
        if (searchParams.has('recordId')) {
          const next = new URLSearchParams(searchParams);
          next.delete('recordId');
          setSearchParams(next, { replace: true });
        }
        const refreshed = await listHealthRecords({ resident_id: id, page: 1, limit: 20 });
        if (refreshed?.success) setRecords(refreshed.data?.items || []);
      } else {
        setError(response?.message || 'Unable to save clinical record.');
      }
    } catch (err) {
      console.error('Unable to save clinical record.', err);
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteHealthRecord(recordToDelete.health_record_id);
      setRecords((current) => current.filter((record) => record.health_record_id !== recordToDelete.health_record_id));
      setRecordToDelete(null);
    } catch (err) {
      console.error('Unable to delete clinical record.', err);
      setError(err);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="container mt-4">Loading resident clinical records...</div>;

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div>
          <h3 className="mb-1">Clinical Records</h3>
          <p className="text-muted mb-0">Resident: {residentDisplayName}</p>
        </div>
        <Link to={`/residents/${id}`} className="page-action-button page-action-back"><span aria-hidden="true">&#8592;</span> Back to resident</Link>
      </div>

      {error && <StatusBanner error={error} compact />}
      {successMessage && <div className="alert alert-info" role="status">{successMessage}</div>}

      <div className="healthsync-form-shell">
        <div className="healthsync-form-card">
          <div className="healthsync-form-header">
            <h3>{editingId ? 'Edit clinical encounter' : 'Clinical encounter'}</h3>
            <p>Capture the resident visit, vital signs, assessment, and follow-up plan.</p>
          </div>

          <form onSubmit={handleSubmit} className="healthsync-form">
            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">RESIDENT INFORMATION</div>
              <div className="form-row two-col-row">
                <div className="form-group">
                  <label className="form-label">Resident</label>
                  <input className="form-control healthsync-form-input" value={residentDisplayName} readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Date / Time</label>
                  <input type="date" name="record_date" className="form-control healthsync-form-input" value={form.record_date} onChange={handleChange} required />
                </div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group">
                  <label className="form-label">Record type</label>
                  <input name="record_type" className="form-control healthsync-form-input" value={form.record_type} onChange={handleChange} />
                </div>
                <div className="form-group">
                  <label className="form-label">Chief complaint</label>
                  <input name="chief_complaint" className="form-control healthsync-form-input" value={form.chief_complaint} onChange={handleChange} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">History of present illness</label>
                <textarea name="history_of_present_illness" className="form-control healthsync-form-input" rows="3" value={form.history_of_present_illness} onChange={handleChange} />
              </div>
            </section>

            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">VITAL SIGNS</div>
              <div className="form-row four-col-row">
                <div className="form-group"><label className="form-label">Blood pressure</label><input name="blood_pressure" className="form-control healthsync-form-input" value={form.blood_pressure} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Heart rate</label><input name="heart_rate" className="form-control healthsync-form-input" value={form.heart_rate} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Respiratory rate</label><input name="respiratory_rate" className="form-control healthsync-form-input" value={form.respiratory_rate} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Temperature</label><input type="number" step="0.1" name="temperature" className="form-control healthsync-form-input" value={form.temperature} onChange={handleChange} /></div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Weight (kg)</label><input type="number" step="0.1" name="weight_kg" className="form-control healthsync-form-input" value={form.weight_kg} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Height (cm)</label><input type="number" step="0.1" name="height_cm" className="form-control healthsync-form-input" value={form.height_cm} onChange={handleChange} /></div>
              </div>
            </section>

            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">MEDICAL HISTORY & CLINICAL NOTES</div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Past medical history</label><textarea rows="3" name="past_medical_history" className="form-control healthsync-form-input" value={form.past_medical_history} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Allergies</label><textarea rows="3" name="allergies" className="form-control healthsync-form-input" value={form.allergies} onChange={handleChange} /></div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Family medical history</label><textarea rows="3" name="family_medical_history" className="form-control healthsync-form-input" value={form.family_medical_history} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Personal/social history</label><textarea rows="3" name="personal_social_history" className="form-control healthsync-form-input" value={form.personal_social_history} onChange={handleChange} /></div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Maintenance medications</label><textarea rows="3" name="maintenance_medications" className="form-control healthsync-form-input" value={form.maintenance_medications} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Past surgical history</label><textarea rows="3" name="past_surgical_history" className="form-control healthsync-form-input" value={form.past_surgical_history} onChange={handleChange} /></div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Immunization history</label><textarea rows="3" name="immunization_history" className="form-control healthsync-form-input" value={form.immunization_history} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Family planning / reproductive notes</label><textarea rows="3" name="family_planning_history" className="form-control healthsync-form-input" value={form.family_planning_history} onChange={handleChange} /></div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Menstrual history</label><textarea rows="3" name="menstrual_history" className="form-control healthsync-form-input" value={form.menstrual_history} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Pregnancy history</label><textarea rows="3" name="pregnancy_history" className="form-control healthsync-form-input" value={form.pregnancy_history} onChange={handleChange} /></div>
              </div>
            </section>

            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">ASSESSMENT</div>
              <div className="form-row two-col-row">
                <div className="form-group"><label className="form-label">Findings</label><textarea rows="3" name="findings" className="form-control healthsync-form-input" value={form.findings} onChange={handleChange} /></div>
                <div className="form-group"><label className="form-label">Assessment</label><textarea rows="3" name="assessment" className="form-control healthsync-form-input" value={form.assessment} onChange={handleChange} /></div>
              </div>
              <div className="form-group"><label className="form-label">Plan</label><textarea rows="3" name="plan" className="form-control healthsync-form-input" value={form.plan} onChange={handleChange} /></div>
              <div className="form-group mt-3"><label className="form-label">Remarks</label><textarea rows="3" name="remarks" className="form-control healthsync-form-input" value={form.remarks} onChange={handleChange} /></div>
            </section>

            <div className="healthsync-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update Clinical Record' : 'Save Clinical Record'}</button>
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
          <h5 className="card-title">Recent clinical encounters</h5>
          {records.length === 0 ? <p className="text-muted mb-0">No clinical records yet.</p> : (
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Chief complaint</th>
                    <th>Assessment</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.health_record_id}>
                      <td>{formatDateLabel(record.record_date) || 'Date not recorded'}</td>
                      <td>{record.record_type || 'Clinical'}</td>
                      <td>{record.chief_complaint || record.history_of_present_illness || '-'}</td>
                      <td>{record.assessment || '-'}</td>
                      <td><button type="button" className="btn btn-sm btn-outline-primary" onClick={() => {
                        setEditingId(record.health_record_id);
                        setForm(Object.fromEntries(Object.keys(initialForm).map((field) => [field, record[field] ?? ''])));
                        const next = new URLSearchParams(searchParams);
                        next.set('recordId', String(record.health_record_id));
                        setSearchParams(next, { replace: true });
                      }}>Edit</button> <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setRecordToDelete(record)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <ConfirmModal open={Boolean(recordToDelete)} title="Delete clinical record?" message="This permanently removes this record and records the action in the admin audit log." busy={deleting} onCancel={() => setRecordToDelete(null)} onConfirm={handleDelete} />
    </div>
  );
};

export default ClinicalRecordsPage;
