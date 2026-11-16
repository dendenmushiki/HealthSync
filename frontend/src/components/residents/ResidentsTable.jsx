import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';

const formatPhone = (value) => {
  if (!value) return '';
  const text = String(value).trim();
  const digits = text.replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (/^639\d{9}$/.test(digits)) return `+63 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return text;
};

const isEnabled = (value) => value === true || value === 1 || value === '1' || value === 'true';
const getClassifications = (resident) => {
  const labels = [];
  if (isEnabled(resident.senior_citizen)) labels.push('Senior');
  if (resident.category_flags?.includes('PWD')) labels.push('PWD');
  if (isEnabled(resident.is_4ps)) labels.push('4Ps');
  if (isEnabled(resident.pregnant)) labels.push('Pregnant');
  if (isEnabled(resident.lactating)) labels.push('Lactating');
  return labels;
};

const StatusBadge = ({ status }) => {
  const value = status || 'Unknown';
  const className = value.toLowerCase().replace(/[^a-z]+/g, '-');
  return <span className={`residents-status-badge residents-status-${className}`}><i aria-hidden="true" />{value}</span>;
};

const ClassificationChips = ({ resident }) => {
  const labels = getClassifications(resident);
  if (!labels.length) return <span className="residents-empty-value" aria-label="No classification">-</span>;
  return <span className="residents-classifications">{labels.slice(0, 2).map((label) => <span className={`residents-class-chip residents-class-${label.toLowerCase().replace(/\s+/g, '-')}`} key={label}>{label}</span>)}{labels.length > 2 && <span className="residents-class-chip residents-class-more" title={labels.slice(2).join(', ')} aria-label={`And ${labels.length - 2} more: ${labels.slice(2).join(', ')}`}>+{labels.length - 2}</span>}</span>;
};

const ResidentAvatar = ({ resident, name }) => <span className="residents-avatar" aria-hidden="true">
  <span>{`${resident.first_name?.charAt(0) || name.charAt(0) || '?'}${resident.last_name?.charAt(0) || ''}`.toUpperCase()}</span>
  {resident.profile_photo && <img src={getProfilePhotoUrl(resident.profile_photo)} alt="" onError={(event) => event.currentTarget.remove()} />}
</span>;

const ResidentActions = ({ resident, name, onDelete, menuOpen, setMenuOpen }) => <div className="residents-row-actions" onClick={(event) => event.stopPropagation()}>
  <Link to={`/residents/${resident.resident_id}`} className="residents-icon-button" aria-label={`View ${name}`} title="View resident"><span aria-hidden="true">◉</span></Link>
  <Link to={`/residents/${resident.resident_id}/edit`} className="residents-icon-button" aria-label={`Edit ${name}`} title="Edit resident"><span aria-hidden="true">✎</span></Link>
  <div className="residents-row-menu-wrap">
    <button type="button" className="residents-icon-button residents-menu-trigger" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(menuOpen ? null : resident.resident_id)}><span aria-hidden="true">⋯</span></button>
    {menuOpen && <div className="residents-row-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setMenuOpen(null); onDelete(resident); }}>Delete resident</button></div>}
  </div>
</div>;

const ResidentsTable = ({ items, onDelete, sort = 'name-asc', onSort = () => {} }) => {
  const navigate = useNavigate();
  const [openMenuId, setOpenMenuId] = useState(null);
  useEffect(() => {
    if (openMenuId === null) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpenMenuId(null); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [openMenuId]);

  const sortHeader = (key, label) => {
    const selected = sort.startsWith(`${key}-`);
    const direction = selected ? sort.slice(key.length + 1) : '';
    const next = key === 'name'
      ? selected && direction === 'asc' ? 'name-desc' : 'name-asc'
      : selected && direction === 'desc' ? 'age-asc' : 'age-desc';
    return <th scope="col" aria-sort={selected ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className="residents-sort-header" onClick={() => onSort(next)}>{label}<span aria-hidden="true">{selected ? direction === 'asc' ? '↑' : '↓' : '↕'}</span></button></th>;
  };
  const openResident = (resident) => navigate(`/residents/${resident.resident_id}`);
  const onRowKeyDown = (event, resident) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openResident(resident);
    }
  };

  if (!items?.length) return null;
  return <div className="residents-results-list">
    <div className="residents-table-wrap">
      <table className="residents-table">
        <thead><tr>{sortHeader('name', 'Name')}{sortHeader('age', 'Age')}<th scope="col">Sex</th><th scope="col" className="residents-hide-tablet">Sitio</th><th scope="col">Contact No.</th><th scope="col">Status</th><th scope="col" className="residents-hide-tablet">Classification</th><th scope="col"><span className="residents-visually-hidden">Actions</span></th></tr></thead>
        <tbody>{items.map((resident) => {
          const name = formatResidentName(resident) || 'Unknown resident';
          const age = resident.age ?? calculateAge(resident.birthdate);
          const phone = formatPhone(resident.contact_no);
          return <tr key={resident.resident_id} tabIndex={0} aria-label={`View details for ${name}`} onClick={(event) => { if (!event.target.closest('a, button')) openResident(resident); }} onKeyDown={(event) => onRowKeyDown(event, resident)}>
            <td><div className="residents-name-cell"><ResidentAvatar resident={resident} name={name} /><div><Link className="residents-name-link" to={`/residents/${resident.resident_id}`} onClick={(event) => event.stopPropagation()}>{name}</Link><span className="residents-household">{resident.household_no ? `Household ${resident.household_no}` : <span aria-label="Not provided">-</span>}</span></div></div></td>
            <td className="residents-age-cell">{age ?? <span aria-label="Not provided">-</span>}</td>
            <td>{resident.sex ? `${resident.sex.charAt(0).toUpperCase()}${resident.sex.slice(1)}` : <span aria-label="Not provided">-</span>}</td>
            <td className="residents-hide-tablet">{resident.sitio || <span aria-label="Not provided">-</span>}</td>
            <td>{phone || <span aria-label="Not provided">-</span>}</td>
            <td><StatusBadge status={resident.resident_status} /></td>
            <td className="residents-hide-tablet"><ClassificationChips resident={resident} /></td>
            <td><ResidentActions resident={resident} name={name} onDelete={onDelete} menuOpen={openMenuId === resident.resident_id} setMenuOpen={setOpenMenuId} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="residents-mobile-cards">{items.map((resident) => {
      const name = formatResidentName(resident) || 'Unknown resident';
      const age = resident.age ?? calculateAge(resident.birthdate);
      return <article className="residents-mobile-card" key={`mobile-${resident.resident_id}`} onClick={(event) => { if (!event.target.closest('a, button')) openResident(resident); }}>
        <div className="residents-mobile-card-main"><ResidentAvatar resident={resident} name={name} /><div><Link className="residents-name-link" to={`/residents/${resident.resident_id}`}>{name}</Link><span>{resident.household_no ? `Household ${resident.household_no}` : 'Household not provided'}</span></div><StatusBadge status={resident.resident_status} /></div>
        <div className="residents-mobile-meta"><span>{age === null ? 'Age not provided' : `${age} years`}</span><span>{resident.sex ? `${resident.sex.charAt(0).toUpperCase()}${resident.sex.slice(1)}` : 'Sex not provided'}</span><span>{formatPhone(resident.contact_no) || 'Contact not provided'}</span></div>
        <div className="residents-mobile-card-footer"><ClassificationChips resident={resident} /><ResidentActions resident={resident} name={name} onDelete={onDelete} menuOpen={openMenuId === resident.resident_id} setMenuOpen={setOpenMenuId} /></div>
      </article>;
    })}</div>
  </div>;
};

export default ResidentsTable;
