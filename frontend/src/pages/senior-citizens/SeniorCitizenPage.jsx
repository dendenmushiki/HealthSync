import React, { useEffect, useState } from 'react';
import { listSeniorCitizens, createSeniorCitizen } from '../../services/api/seniorCitizenService';
import ResidentAutocomplete from '../../components/residents/ResidentAutocomplete';
import ResidentIdentityLink from '../../components/residents/ResidentIdentityLink';
import { calculateAge } from '../../utils/residentUtils';
import { getLocalDateInputValue } from '../../utils/dateUtils';
import StatusBanner from '../../components/common/StatusBanner';

const SeniorCitizenPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    resident_id: '',
    date_registered: getLocalDateInputValue(),
    senior_citizen_id: '',
    contact_number: '',
    emergency_contact_name: '',
    emergency_contact_number: '',
    health_conditions: '',
  });
  const [selectedResident, setSelectedResident] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('registration');
  const [registrationStatus, setRegistrationStatus] = useState('idle');

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const resp = await listSeniorCitizens({ page: 1, limit: 10 });
      if (resp && resp.success) setItems(resp.data?.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  useEffect(() => {
    const residentId = selectedResident?.resident_id;
    if (!residentId) {
      setRegistrationStatus('idle');
      return undefined;
    }

    let active = true;
    setRegistrationStatus('checking');
    listSeniorCitizens({ resident_id: residentId, page: 1, limit: 1 })
      .then((resp) => {
        if (!resp?.success) throw new Error(resp?.message || 'Unable to verify senior citizen registration.');
        if (active) {
          const isRegistered = (resp.data?.items || []).some((item) => Number(item.resident_id) === Number(residentId));
          setRegistrationStatus(isRegistered ? 'registered' : 'available');
        }
      })
      .catch(() => {
        if (active) setRegistrationStatus('check-failed');
      });

    return () => {
      active = false;
    };
  }, [selectedResident?.resident_id]);

  const ageYears = calculateAge(selectedResident?.birthdate, form.date_registered ? new Date(`${form.date_registered}T00:00:00`) : new Date());
  const isEligible = typeof ageYears === 'number' ? ageYears >= 60 : false;

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.resident_id) {
      setError('Please select a resident.');
      return;
    }

    if (!isEligible) {
      setError('Senior citizen registration is only available for residents aged 60 years or older.');
      return;
    }

    if (registrationStatus !== 'available') {
      setError(registrationStatus === 'registered'
        ? 'This resident is already registered as a senior citizen.'
        : 'Please wait until the resident registration check is complete.');
      return;
    }

    setSaving(true);
    try {
      const resp = await createSeniorCitizen(form);
      if (resp && resp.success) {
        setForm({
          resident_id: '',
          date_registered: getLocalDateInputValue(),
          senior_citizen_id: '',
          contact_number: '',
          emergency_contact_name: '',
          emergency_contact_number: '',
          health_conditions: '',
        });
        fetchRecords();
      } else {
        setError(resp?.message || 'Unable to register senior citizen.');
      }
    } catch (err) {
      console.error('Unable to register senior citizen.', err);
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mt-2">
      <div className="healthsync-form-shell">
        <div className="senior-citizen-tabs" role="tablist" aria-label="Senior citizen sections">
          <button type="button" className={`senior-citizen-tab ${activeTab === 'registration' ? 'active' : ''}`} onClick={() => setActiveTab('registration')}>Registration Form</button>
          <button type="button" className={`senior-citizen-tab ${activeTab === 'list' ? 'active' : ''}`} onClick={() => setActiveTab('list')}>Senior Citizen List</button>
        </div>

        {activeTab === 'registration' && <div className="healthsync-form-card mb-4">
          {error && <StatusBanner error={error} compact />}

          <form onSubmit={handleSubmit} className="healthsync-form senior-registration-form">
            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">SENIOR CITIZEN DETAILS</div>

              <div className="form-row three-col-row">
                <div className="form-group">
                  <label className="form-label">Resident <span className="required-mark">*</span></label>
                  <ResidentAutocomplete
                    value={form.resident_id}
                    selectedResident={selectedResident}
                    minAge={60}
                    onSelect={(resident) => {
                      setSelectedResident(resident);
                      setRegistrationStatus(resident ? 'checking' : 'idle');
                      setError('');
                      setForm((prev) => ({ ...prev, resident_id: resident?.resident_id || '' }));
                    }}
                    placeholder="Search resident age 60+"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Date registered <span className="required-mark">*</span></label>
                  <input type="date" className="form-control healthsync-form-input" name="date_registered" value={form.date_registered} onChange={handleChange} required />
                </div>

                <div className="form-group">
                  <label className="form-label">Age detected</label>
                  <input className="form-control healthsync-form-input" value={ageYears ?? ''} readOnly />
                </div>
              </div>

              <div className="form-row two-col-row senior-detail-row">
                <div className="form-group">
                  <label className="form-label">Senior citizen ID <span className="required-mark">*</span></label>
                  <input className="form-control healthsync-form-input" name="senior_citizen_id" value={form.senior_citizen_id} onChange={handleChange} placeholder="e.g., SC-2026-0001" required />
                </div>
              </div>
            </section>

            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">CONTACT &amp; EMERGENCY INFORMATION</div>
              <div className="form-row two-col-row">
                <div className="form-group">
                  <label className="form-label">Contact number <span className="required-mark">*</span></label>
                  <input className="form-control healthsync-form-input" name="contact_number" value={form.contact_number} onChange={handleChange} placeholder="e.g., 0912 345 6789" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Emergency contact name</label>
                  <input className="form-control healthsync-form-input" name="emergency_contact_name" value={form.emergency_contact_name} onChange={handleChange} placeholder="e.g., Maria Santos" />
                </div>
              </div>
              <div className="form-row two-col-row">
                <div className="form-group">
                  <label className="form-label">Emergency contact number</label>
                  <input className="form-control healthsync-form-input" name="emergency_contact_number" value={form.emergency_contact_number} onChange={handleChange} placeholder="e.g., 0912 345 6789" />
                </div>
              </div>
            </section>

            <section className="healthsync-form-section">
              <div className="healthsync-form-section-title">MEDICAL INFORMATION</div>
              <div className="form-row single-checkbox-row">
                <div className="form-group">
                  <label className="form-label">Health conditions</label>
                  <textarea className="form-control healthsync-form-input" name="health_conditions" value={form.health_conditions} onChange={handleChange} rows="3" placeholder="e.g., Hypertension, Diabetes" style={{ minHeight: '110px', height: 'auto' }} />
                </div>
              </div>
            </section>

            {selectedResident && (
              <div className="alert alert-light border mb-0">
                Eligibility check: {isEligible ? 'Eligible (60+ years)' : 'Not eligible'} · Resident: {selectedResident.first_name} {selectedResident.last_name}
              </div>
            )}
            {registrationStatus === 'checking' && <div className="alert alert-info mb-0" role="status">Checking the senior citizen registry...</div>}
            {registrationStatus === 'registered' && <div className="alert alert-warning mb-0" role="alert">This resident is already in the senior citizen registry and cannot be registered again.</div>}
            {registrationStatus === 'check-failed' && <div className="alert alert-danger mb-0" role="alert">Unable to check this resident against the senior citizen registry. Please select the resident again to retry.</div>}

            <div className="healthsync-form-actions">
              <button type="submit" className="btn btn-primary senior-register-button" disabled={!isEligible || saving || registrationStatus !== 'available'}>{saving ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> Registering...</> : 'Register Senior Citizen'}</button>
            </div>
          </form>
        </div>}

        {activeTab === 'list' && <div className="healthsync-form-card">
          <div className="healthsync-form-header">
            <h3>Senior citizen list</h3>
            <p>Current registered records</p>
          </div>

          {loading ? <div className="text-muted">Loading...</div> : items.length === 0 ? (
            <div className="senior-empty-state">
              <div className="senior-empty-icon" aria-hidden="true">&#128100;</div>
              <h4>No senior citizens registered yet</h4>
              <p>Fill out the form above to add your first senior citizen record.</p>
              <button type="button" className="btn btn-primary" onClick={() => setActiveTab('registration')}>Add your first senior citizen</button>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0 senior-citizen-table">
                <thead>
                  <tr>
                    <th>Resident</th>
                    <th>Senior ID</th>
                    <th>Age</th>
                    <th>Contact</th>
                    <th>Emergency</th>
                    <th>Health conditions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.senior_id}>
                      <td><div className="resident-table-person"><ResidentIdentityLink resident={item} className="text-decoration-none fw-semibold resident-name-link" /></div></td>
                      <td>{item.senior_citizen_id || '-'}</td>
                      <td>{calculateAge(item.birthdate) ?? '-'}</td>
                      <td>{item.contact_number || '-'}</td>
                      <td>{item.emergency_contact_name || '-'}<br />{item.emergency_contact_number || ''}</td>
                      <td>{item.health_conditions || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>}
      </div>
    </div>
  );
};

export default SeniorCitizenPage;
