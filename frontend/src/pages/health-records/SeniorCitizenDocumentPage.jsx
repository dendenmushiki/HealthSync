import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { getSeniorCitizen } from '../../services/api/seniorCitizenService';
import { formatDateLabel } from '../../utils/dateUtils';
import { calculateAge } from '../../utils/residentUtils';
import StatusBanner from '../../components/common/StatusBanner';
import HealthRecordDocument, { HealthRecordDocumentField, HealthRecordDocumentSection } from './HealthRecordDocument';

const SeniorCitizenDocumentPage = () => {
  const { id } = useParams();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getSeniorCitizen(id).then((response) => {
      if (!response?.success || !response.data) throw new Error(response?.message || 'Unable to load senior citizen record.');
      if (active) setRecord(response.data);
    }).catch((loadError) => {
      if (active) {
        console.error('Unable to load senior citizen record.', loadError);
        setError(loadError.response?.data?.message || loadError.message || 'Unable to load senior citizen record.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  if (loading) return <main className="health-record-detail-page health-record-document-page" aria-busy="true"><p>Loading senior citizen record…</p></main>;
  if (!record) return <main className="health-record-detail-page health-record-document-page">
    <section className="health-record-state-card"><h1>Senior citizen record unavailable</h1><StatusBanner error={error || 'This registration could not be found.'} /><Link className="health-record-secondary-button" to="/senior-citizens">Back to Senior Registry</Link></section>
  </main>;

  const resident = { ...record, contact_no: record.contact_number || record.contact_no };
  const documentRecord = {
    ...record,
    id: record.senior_id,
    record_type: 'Senior Citizen Health Record',
    record_label: 'Senior Citizen Health Record',
    record_date: record.date_registered,
  };

  return <main className="health-record-detail-page health-record-document-page">
    <div className="health-record-document-toolbar">
      <div className="health-record-document-toolbar-meta">
        <h1>{[record.first_name, record.middle_name, record.last_name, record.suffix].filter(Boolean).join(' ') || 'Resident'}</h1>
        {(record.offline === true || record.sync_status === 'PENDING') &&
          <span className="healthsync-not-synced-badge">Not synced</span>}
        <span>Senior Citizen Health Record · {formatDateLabel(record.date_registered) || 'Date not recorded'} · Status: {record.status || '—'}</span>
      </div>
      <div className="health-record-document-toolbar-actions">
        <Link to="/senior-citizens"><ArrowLeft size={16} aria-hidden="true" />Back to Senior Registry</Link>
        <Link className="health-record-document-edit" to={`/senior-citizens/${record.senior_id}/edit`}>Edit Record</Link>
        <button type="button" onClick={() => window.print()}><Printer size={15} aria-hidden="true" />Print / Save PDF</button>
      </div>
    </div>
    <HealthRecordDocument
      type="senior"
      title="Senior Citizen Health Record"
      date={record.date_registered}
      record={documentRecord}
      resident={resident}
      data={record}
      hideUnconfiguredFields
    >
      <HealthRecordDocumentSection title="Senior Citizen Registration">
        <dl className="health-record-document-grid">
          <HealthRecordDocumentField label="Senior citizen ID" value={record.senior_citizen_id} />
          <HealthRecordDocumentField label="Date registered" value={record.date_registered} field={{ type: 'date' }} />
          <HealthRecordDocumentField label="Age at assessment" value={calculateAge(record.birthdate, record.date_registered ? new Date(`${String(record.date_registered).slice(0, 10)}T00:00:00`) : undefined)} />
          <HealthRecordDocumentField label="Contact number" value={record.contact_number || record.contact_no} />
          <HealthRecordDocumentField label="Emergency contact name" value={record.emergency_contact_name} />
          <HealthRecordDocumentField label="Emergency contact number" value={record.emergency_contact_number} />
          <HealthRecordDocumentField label="Health conditions" value={record.health_conditions} />
        </dl>
      </HealthRecordDocumentSection>
    </HealthRecordDocument>
  </main>;
};

export default SeniorCitizenDocumentPage;
