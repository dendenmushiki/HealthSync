import React from 'react';
import { formatDateLabel } from '../../utils/dateUtils';

const ResidentSummaryCard = ({ resident, ageMonths, onChange }) => {
  const name = [resident.first_name, resident.middle_name, resident.last_name, resident.suffix].filter(Boolean).join(' ').trim();
  const years = Math.floor((ageMonths || 0) / 12);
  const months = (ageMonths || 0) % 12;
  const ageLabel = years ? `${years} yr${years === 1 ? '' : 's'} ${months} mos` : `${months} mos`;
  return (
    <div className="nutrition-resident-summary">
      <div className="nutrition-avatar" aria-hidden="true">{(resident.first_name || 'C').charAt(0).toUpperCase()}</div>
      <div className="nutrition-resident-copy">
        <strong>{name}</strong>
        <span>{formatDateLabel(resident.birthdate)} ({ageLabel})</span>
        <span>{resident.sex || 'Sex not recorded'} · {resident.sitio || 'No sitio recorded'}{!resident.sitio && <button type="button" className="nutrition-link-button" onClick={() => window.location.assign(`/residents/${resident.resident_id}/edit`)}>Add sitio</button>}</span>
        {resident.household_no && <span>Household {resident.household_no}</span>}
        {(resident.pregnant || resident.lactating || resident.category_flags) && <span className="nutrition-resident-flags"><>{resident.pregnant ? <b>Pregnant</b> : null}{resident.lactating ? <b>Lactating</b> : null}{Array.isArray(resident.category_flags) ? resident.category_flags.filter((flag) => ['Senior', 'PWD'].includes(flag)).map((flag) => <b key={flag}>{flag}</b>) : String(resident.category_flags || '').includes('PWD') ? <b>PWD</b> : null}</></span>}
      </div>
      <button type="button" className="nutrition-link-button" onClick={onChange}>Change</button>
    </div>
  );
};

export default ResidentSummaryCard;
