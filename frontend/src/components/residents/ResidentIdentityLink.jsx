import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';

const ResidentIdentityLink = ({ resident, className = 'resident-name-link', to }) => {
  const tooltipId = useId();
  const name = formatResidentName(resident) || 'Unknown resident';
  const age = resident.age ?? calculateAge(resident.birthdate);
  const details = [
    age === null || age === undefined ? null : `${age} years old`,
    resident.sex ? `${String(resident.sex).charAt(0).toUpperCase()}${String(resident.sex).slice(1)}` : null,
    resident.sitio || resident.address,
    resident.contact_no || resident.contact_number,
    resident.philhealth_id_no || resident.philhealth_number,
    resident.resident_status
  ].filter(Boolean);

  return (
    <span className="resident-identity">
      <span className="resident-table-avatar" aria-hidden="true">
        <span className="resident-table-avatar-fallback">{String(resident.first_name || name).charAt(0).toUpperCase()}</span>
        {resident.profile_photo && <img src={getProfilePhotoUrl(resident.profile_photo)} alt="" onError={(event) => event.currentTarget.remove()} />}
      </span>
      {resident.resident_id ? (
        <Link to={to || `/residents/${resident.resident_id}`} className={className} aria-describedby={details.length ? tooltipId : undefined}>
          {name}
        </Link>
      ) : <span className={className}>{name}</span>}
      {details.length > 0 && <span id={tooltipId} className="resident-identity-tooltip" role="tooltip">
        <strong>{name}</strong>
        {details.map((detail) => <span key={detail}>{detail}</span>)}
      </span>}
    </span>
  );
};

export default ResidentIdentityLink;
