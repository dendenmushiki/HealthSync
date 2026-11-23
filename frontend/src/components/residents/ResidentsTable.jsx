import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, SquarePen } from 'lucide-react';
import { calculateAge, formatResidentName } from '../../utils/residentUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const ResidentAvatar = ({ resident, name }) => (
  <span className="residents-avatar" aria-hidden="true">
    <span>{`${resident.first_name?.charAt(0) || name.charAt(0) || ''}${resident.last_name?.charAt(0) || ''}`.toUpperCase()}</span>
    {resident.profile_photo && <img src={getProfilePhotoUrl(resident.profile_photo)} alt="" onError={(event) => event.currentTarget.remove()} />}
  </span>
);

const StatusBadge = ({ status }) => {
  const value = status || 'Not assessed';
  const className = value.toLowerCase().replace(/[^a-z]+/g, '-');
  return <span className={`residents-nutrition residents-nutrition-${className}`}>{value}</span>;
};

const ResidentActions = ({ resident, name, onSelect }) => (
  <div className="residents-row-actions" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="residents-icon-button" aria-label={`View ${name}`} title="View resident" onClick={() => onSelect(resident)}>
      <Eye size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <Link to={`/residents/${resident.resident_id}/edit`} className="residents-icon-button" aria-label={`Edit ${name}`} title="Edit resident">
      <SquarePen size={16} strokeWidth={1.8} aria-hidden="true" />
    </Link>
  </div>
);

const ResidentsTable = ({ items, sort = 'id-asc', onSort = () => {}, onSelect = () => {}, selectedId = null }) => {
  const sortHeader = (key, label) => {
    const selected = sort.startsWith(`${key}-`);
    const direction = selected ? sort.slice(key.length + 1) : '';
    const next = selected && direction === 'asc' ? `${key}-desc` : `${key}-asc`;
    const SortIcon = selected ? direction === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown;
    return (
      <th scope="col" aria-sort={selected ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="residents-sort-header" onClick={() => onSort(next)}>
          {label}<SortIcon size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </th>
    );
  };

  const openResident = (resident) => onSelect(resident);
  const onRowKeyDown = (event, resident) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openResident(resident);
    }
  };

  return (
    <div className="residents-results-list">
      <div className="residents-table-wrap">
        <table className="residents-table">
          <thead><tr>
            {sortHeader('id', 'ID')}
            {sortHeader('name', 'Full Name')}
            {sortHeader('age', 'Age')}
            <th scope="col">Gender</th>
            <th scope="col">Sitio</th>
            <th scope="col">Nutritional Status</th>
            <th scope="col">Last Updated</th>
            <th scope="col"><span className="residents-visually-hidden">Actions</span></th>
          </tr></thead>
          <tbody>{items.map((resident) => {
            const name = formatResidentName(resident) || 'Resident';
            const age = resident.age ?? calculateAge(resident.birthdate);
            const selected = String(selectedId) === String(resident.resident_id);
            const updated = resident.last_updated || resident.created_at;
            const gender = resident.sex ? `${resident.sex.charAt(0).toUpperCase()}${resident.sex.slice(1)}` : '—';
            return (
              <tr key={resident.resident_id} className={selected ? 'selected' : ''} tabIndex={0}
                aria-label={`Preview details for ${name}`} aria-selected={selected}
                onClick={(event) => { if (!event.target.closest('a, button')) openResident(resident); }}
                onKeyDown={(event) => onRowKeyDown(event, resident)}>
                <td className="residents-id-cell">{resident.resident_id}</td>
                <td><div className="residents-name-cell">
                  <ResidentAvatar resident={resident} name={name} />
                  <button type="button" className="residents-name-link residents-name-button"
                    onClick={(event) => { event.stopPropagation(); openResident(resident); }}>{name}</button>
                </div></td>
                <td className="residents-age-cell">{age ?? '—'}</td>
                <td><span className={`residents-gender residents-gender-${String(resident.sex || '').toLowerCase()}`}>{gender}</span></td>
                <td>{resident.sitio || '—'}</td>
                <td><StatusBadge status={resident.nutrition_status} /></td>
                <td>{formatDate(updated)}</td>
                <td><ResidentActions resident={resident} name={name} onSelect={onSelect} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
};

export default ResidentsTable;
