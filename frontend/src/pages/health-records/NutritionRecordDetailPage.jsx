import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatDateLabel } from '../../utils/dateUtils';
import { getNutritionRecord } from '../../services/api/nutritionRecordsService';
import HealthRecordDocument, { HealthRecordDocumentField, HealthRecordDocumentSection } from './HealthRecordDocument';

const TYPES = {
  operation: { label: 'Operation Timbang', fields: [
    ['weight_kg', 'Weight (kg)'], ['height_cm', 'Measurement (cm)'], ['measurement_type', 'Measurement type'],
    ['wfa_status', 'Weight-for-age status'], ['wfa_zscore', 'Weight-for-age z-score'],
    ['hfa_status', 'Height-for-age status'], ['hfa_zscore', 'Height-for-age z-score'],
    ['wflh_status', 'Weight-for-length / height status'], ['wflh_zscore', 'Weight-for-length / height z-score'],
    ['status', 'Assessment status']
  ] },
  adolescent: { label: 'Adolescent BMI', fields: [
    ['weight_kg', 'Weight (kg)'], ['height_cm', 'Height (cm)'], ['bmi', 'BMI (kg/m²)'],
    ['bmi_for_age_zscore', 'BMI-for-age z-score'], ['status', 'BMI-for-age category']
  ] },
  adult: { label: 'Adult BMI', fields: [
    ['weight_kg', 'Weight (kg)'], ['height_cm', 'Height (cm)'], ['bmi', 'BMI (kg/m²)'],
    ['status', 'BMI category']
  ] }
};

const NutritionRecordDetailPage = () => {
  const { type, id } = useParams();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const typeInfo = TYPES[type];

  useEffect(() => {
    let active = true;
    if (!typeInfo || !/^\d+$/.test(id || '')) {
      setLoading(false);
      setError('This health record could not be found.');
      return undefined;
    }
    setLoading(true);
    setError('');
    getNutritionRecord(type, id).then((response) => {
      if (!response?.success || !response.data) throw new Error(response?.message || 'Unable to load nutrition record.');
      if (active) setRecord(response.data);
    }).catch((loadError) => {
      if (active) {
        console.error('Unable to load nutrition record.', loadError);
        setError(loadError.response?.data?.message || loadError.message || 'Unable to load nutrition record.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, type, typeInfo]);

  if (loading) return <main className="health-record-detail-page health-record-document-page" aria-busy="true"><p>Loading health record…</p></main>;
  if (error || !record || !typeInfo) return <main className="health-record-detail-page health-record-document-page">
    <section className="health-record-state-card"><h1>Health record unavailable</h1><p>{error || 'This health record could not be found.'}</p><Link className="health-record-secondary-button" to="/nutrition">Back to Nutritional Monitoring</Link></section>
  </main>;

  const residentName = [record.first_name, record.middle_name, record.last_name, record.suffix].filter(Boolean).join(' ') || 'Resident';

  return <main className="health-record-detail-page health-record-document-page">
    <div className="health-record-document-toolbar">
      <div className="health-record-document-toolbar-meta">
        <h1>{residentName}</h1>
        <span>{typeInfo.label} · {formatDateLabel(record.record_date) || 'Date not recorded'} · Status: {record.status || '—'}</span>
      </div>
      <div className="health-record-document-toolbar-actions">
        <Link to="/nutrition"><ArrowLeft size={16} aria-hidden="true" />Back to Health Records</Link>
        <button type="button" onClick={() => window.print()}><Printer size={15} aria-hidden="true" />Print / Save PDF</button>
      </div>
    </div>
    <HealthRecordDocument
      type="nutrition"
      title={typeInfo.label}
      date={record.record_date}
      record={{ ...record, id: record.id, record_label: typeInfo.label }}
      resident={record}
      data={record}
      hideUnconfiguredFields
    >
      <HealthRecordDocumentSection title="Assessment Measurements">
        <dl className="health-record-document-grid">
          {typeInfo.fields.map(([field, label]) => <HealthRecordDocumentField key={field} label={label} value={record[field]} field={{ name: field }} />)}
        </dl>
      </HealthRecordDocumentSection>
      {record.history?.length > 1 && <HealthRecordDocumentSection title="Assessment History">
        <div className="health-record-document-table-wrap">
          <table className="health-record-document-table">
            <thead><tr><th>Date</th><th>Record type</th><th>Measurement</th><th>Result</th><th>Recorded by</th></tr></thead>
            <tbody>{record.history.map((item) => <tr key={`${item.record_type}-${item.id}`}>
              <td>{formatDateLabel(item.record_date) || '—'}</td>
              <td>{item.record_type}</td>
              <td>{item.weight_kg ?? '—'} kg / {item.height_cm ?? '—'} cm</td>
              <td>{item.status || '—'}</td>
              <td>{item.recorded_by_name || '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </HealthRecordDocumentSection>}
    </HealthRecordDocument>
  </main>;
};

export default NutritionRecordDetailPage;
