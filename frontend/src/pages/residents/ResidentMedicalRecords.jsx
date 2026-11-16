import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getResident } from '../../services/api/residentService';
import PatientClinicalRecordForm from './PatientClinicalRecordForm';
import ChildRecordForm from './ChildRecordForm';
import MaternalRecordForm from './MaternalRecordForm';
import ImmunizationRecordForm from './ImmunizationRecordForm';

const tabs = [
  { key: 'clinical', label: 'Clinical Record', Form: PatientClinicalRecordForm },
  { key: 'child', label: 'Child Record', Form: ChildRecordForm },
  { key: 'maternal', label: 'Maternal Record', Form: MaternalRecordForm },
  { key: 'immunization', label: 'Immunization Record', Form: ImmunizationRecordForm }
];

const formatResidentName = (resident) => [resident?.first_name, resident?.middle_name, resident?.last_name, resident?.suffix].filter(Boolean).join(' ');
const formatBreadcrumbName = (resident) => {
  const lastName = resident?.last_name || '';
  const firstName = resident?.first_name || '';
  const middleInitial = resident?.middle_name ? ` ${resident.middle_name.charAt(0)}.` : '';
  return [lastName, `${firstName}${middleInitial}`].filter(Boolean).join(', ');
};
const formDescriptions = {
  clinical: 'Visit notes, vital signs, histories, assessment, and plan.',
  child: 'Child visit, medical history, and birth/immunization history.',
  maternal: 'Maternal visit details and medical/family history.',
  immunization: 'Immunization details and growth/vital measurements.'
};

const ResidentMedicalRecords = () => {
  const { id, recordType } = useParams();
  const [resident, setResident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    getResident(id).then((response) => {
      if (mounted && response?.success) setResident(response.data);
      else if (mounted) setError(response?.message || 'Resident not found.');
    }).catch((fetchError) => {
      if (mounted) setError(fetchError.response?.data?.message || fetchError.message || 'Unable to load resident.');
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [id]);

  if (loading) return <div className="container mt-4">Loading resident medical records...</div>;
  if (error || !resident) return <div className="container mt-4"><div className="alert alert-danger" role="alert">{error || 'Resident not found.'}</div><Link to="/residents">Back to residents</Link></div>;

  const selectedTab = tabs.find((tab) => tab.key === recordType);
  const ActiveForm = selectedTab?.Form;
  const isRecordPage = Boolean(selectedTab);
  const isMale = String(resident.sex || '').toLowerCase() === 'male';
  return <div className={`container mt-2 resident-medical-records-page ${isRecordPage ? 'clinical-record-page' : ''}`}>
    {isRecordPage ? <>
      <nav className="clinical-breadcrumb" aria-label="Breadcrumb">
        <Link to="/residents">Residents</Link><span aria-hidden="true">/</span>
        <Link to={`/residents/${id}`}>{formatBreadcrumbName(resident) || formatResidentName(resident)}</Link><span aria-hidden="true">/</span>
        <span>Medical Records</span><span aria-hidden="true">/</span><span aria-current="page">{selectedTab.label.replace(' Record', '')}</span>
      </nav>
      <header className="clinical-page-header">
        <div><span className="overview-eyebrow">RESIDENT MEDICAL FILE</span><h1>{selectedTab.label}</h1><p>{formDescriptions[selectedTab.key]} Resident: {formatResidentName(resident)}.</p></div>
        <Link to={`/residents/${id}`} className="resident-action-button resident-action-back">Resident details</Link>
      </header>
    </> : <header className="medical-records-header">
      <div><span className="overview-eyebrow">RESIDENT MEDICAL FILE</span><h1>{formatResidentName(resident)}</h1><p>{selectedTab ? selectedTab.label : 'Select a medical form to view or enter a record.'}</p></div>
      <div className="resident-detail-actions">
        <Link to={`/residents/${id}`} className="resident-action-button resident-action-back">Resident details</Link>
        <Link to="/residents" className="resident-action-button resident-action-back">Back to directory</Link>
      </div>
    </header>}
    {selectedTab
      ? <>
        <nav className="clinical-record-type-tabs" aria-label="Resident medical forms">
          {tabs.map((tab) => <Link
            key={tab.key}
            to={`/residents/${id}/medical-records/${tab.key}`}
            className={`${tab.key === recordType ? 'active' : ''} ${isMale && tab.key === 'maternal' ? 'not-applicable' : ''}`.trim()}
            aria-current={tab.key === recordType ? 'page' : undefined}
            aria-label={isMale && tab.key === 'maternal' ? 'Maternal Record (not applicable to this resident)' : undefined}
          >{tab.label.replace(' Record', '')}</Link>)}
        </nav>
        <section className="healthsync-form-card resident-medical-panel clinical-record-panel"><ActiveForm resident={resident} /></section>
      </>
      : recordType
        ? <div className="alert alert-warning" role="alert">Medical form not found. Choose one of the available forms below.</div>
        : null}
    {!selectedTab && <div className="resident-medical-link-grid">
      {tabs.map((tab) => <Link key={tab.key} to={`/residents/${id}/medical-records/${tab.key}`} className="resident-medical-link-card">
        <span><strong>{tab.label}</strong><small>{formDescriptions[tab.key]}</small></span><span className="resident-medical-link-arrow" aria-hidden="true">&#8594;</span>
      </Link>)}
    </div>}
  </div>;
};

export default ResidentMedicalRecords;
