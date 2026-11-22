import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UserRound } from 'lucide-react';
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
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    setResident(null);
    getResident(id).then((response) => {
      if (mounted && response?.success) setResident(response.data);
      else if (mounted) setError(response?.message || 'Resident not found.');
    }).catch((fetchError) => {
      if (mounted) setError(fetchError.response?.data?.message || fetchError.message || 'Unable to load resident.');
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [id, retryToken]);

  const selectedTab = tabs.find((tab) => tab.key === recordType);
  const ActiveForm = selectedTab?.Form;
  const isRecordPage = Boolean(selectedTab);
  const isClinicalRoute = recordType === 'clinical';
  const clinicalPageClasses = isClinicalRoute ? 'clinical-record-page clinical-form-page' : '';

  if (loading) return isClinicalRoute
    ? <main className={`resident-medical-records-page clinical-page-state-container ${clinicalPageClasses}`} aria-busy="true" aria-label="Loading clinical record">
      <div className="clinical-route-skeleton">
        <div className="clinical-skeleton-breadcrumb" />
        <div className="clinical-skeleton-page-title" />
        <div className="clinical-skeleton-card clinical-skeleton-patient" />
        <div className="clinical-skeleton-card clinical-skeleton-visit" />
        <div className="clinical-skeleton-card" />
      </div>
    </main>
    : <main className="resident-medical-records-page clinical-page-state-container" aria-busy="true">
      <div className="clinical-page-state"><span className="clinical-page-spinner" aria-hidden="true" /><p>Loading health records…</p></div>
    </main>;
  if (error || !resident) return isClinicalRoute
    ? <main className={`resident-medical-records-page clinical-page-state-container ${clinicalPageClasses}`}>
      <section className="clinical-page-error clinical-route-error" role="alert">
        <h1>Clinical record unavailable</h1><p>{error || 'Resident not found.'}</p>
        <div><button type="button" className="clinical-secondary-button" onClick={() => setRetryToken((current) => current + 1)}>Try again</button><Link to="/residents" className="clinical-text-link">Back to residents</Link></div>
      </section>
    </main>
    : <main className="resident-medical-records-page clinical-page-state-container">
      <section className="clinical-page-error" role="alert"><h1>Health records unavailable</h1><p>{error || 'Resident not found.'}</p><Link to="/residents" className="resident-action-button resident-action-back">Back to residents</Link></section>
    </main>;

  return <div className={`${isClinicalRoute ? '' : 'container mt-2'} resident-medical-records-page ${isRecordPage ? 'clinical-record-page' : ''} ${isClinicalRoute ? 'clinical-form-page' : ''}`}>
    {isRecordPage ? <>
      <nav className="clinical-breadcrumb" aria-label="Breadcrumb">
        <Link to="/residents">Residents</Link><span aria-hidden="true">/</span>
        <Link to={`/residents/${id}`}>{formatBreadcrumbName(resident) || formatResidentName(resident)}</Link><span aria-hidden="true">/</span>
        <span>Health Records</span><span aria-hidden="true">/</span><span aria-current="page">{selectedTab.label}</span>
      </nav>
      <header className="clinical-page-header">
        <div><span className="overview-eyebrow">HEALTH RECORDS</span><h1>{selectedTab.label}</h1><p>{isClinicalRoute ? 'Document visits, vital signs, and health history for this resident.' : `${formDescriptions[selectedTab.key]} Resident: ${formatResidentName(resident)}.`}</p></div>
        <Link to={`/residents/${id}`} className={`resident-action-button resident-action-back ${isClinicalRoute ? 'clinical-header-action' : ''}`}>{isClinicalRoute && <UserRound size={17} strokeWidth={1.8} aria-hidden="true" />}Resident details</Link>
      </header>
    </> : <header className="medical-records-header">
      <div><span className="overview-eyebrow">HEALTH RECORDS</span><h1>{formatResidentName(resident)}</h1><p>Select a health record type to view or create an entry.</p></div>
      <div className="resident-detail-actions">
        <Link to={`/residents/${id}`} className="resident-action-button resident-action-back">Resident details</Link>
        <Link to="/residents" className="resident-action-button resident-action-back">Back to directory</Link>
      </div>
    </header>}
    {selectedTab
      ? <>
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
