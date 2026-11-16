import React, { useEffect, useMemo, useState } from 'react';
import { getResidents } from '../../services/api/residentService';
import { calculateAge } from '../../utils/residentUtils';

const formatResidentName = (resident = {}) => {
  const first = [resident.first_name, resident.middle_name].filter(Boolean).join(' ');
  const lastName = resident.last_name ? resident.last_name : '';
  const suffix = resident.suffix ? ` ${resident.suffix}` : '';
  return `${first ? `${first} ` : ''}${lastName}${suffix}`.trim();
};

const ResidentAutocomplete = ({
  value,
  selectedResident,
  onSelect,
  inputId,
  placeholder = 'Search resident by name...',
  minAge,
  maxAge,
  minAgeMonths,
  maxAgeMonths,
}) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const filters = useMemo(() => {
    const params = { page: 1, limit: 8 };
    const trimmed = query.trim();
    if (trimmed) params.search = trimmed;
    if (minAge !== undefined && minAge !== '') params.min_age = Number(minAge);
    if (maxAge !== undefined && maxAge !== '') params.max_age = Number(maxAge);
    if (minAgeMonths !== undefined && minAgeMonths !== '') params.min_age_months = Number(minAgeMonths);
    if (maxAgeMonths !== undefined && maxAgeMonths !== '') params.max_age_months = Number(maxAgeMonths);
    return params;
  }, [query, minAge, maxAge, minAgeMonths, maxAgeMonths]);

  useEffect(() => {
    if (selectedResident) {
      setQuery(formatResidentName(selectedResident));
    } else if (!value) {
      setQuery('');
    }
  }, [selectedResident, value]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2 || selectedResident) {
      setSuggestions([]);
      return undefined;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await getResidents(filters);
        if (active) setSuggestions(response?.success ? response.data?.items || [] : []);
      } catch (error) {
        if (active) setSuggestions([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [filters, query, selectedResident]);

  const chooseResident = (resident) => {
    setQuery(formatResidentName(resident));
    setSuggestions([]);
    setOpen(false);
    if (onSelect) onSelect(resident);
  };

  const handleChange = (event) => {
    setQuery(event.target.value);
    setOpen(true);
    if (selectedResident && onSelect) onSelect(null);
  };

  return (
    <div className="resident-autocomplete">
      <input
        id={inputId}
        type="text"
        className="form-control healthsync-form-input"
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && Boolean(query.trim()) && !selectedResident}
        aria-controls={`${inputId || 'resident-autocomplete'}-listbox`}
        aria-label="Search resident"
      />
      {open && query.trim().length >= 2 && !selectedResident && (
        <div id={`${inputId || 'resident-autocomplete'}-listbox`} className="resident-autocomplete-menu" role="listbox">
          {loading && <div className="resident-autocomplete-message">Searching residents...</div>}
          {!loading && suggestions.length === 0 && <div className="resident-autocomplete-message">No matching residents.</div>}
          {!loading && suggestions.map((resident) => {
            const age = calculateAge(resident.birthdate);
            return (
              <button type="button" role="option" aria-selected="false" className="resident-autocomplete-option" key={resident.resident_id} onMouseDown={() => chooseResident(resident)}>
                <div className="resident-autocomplete-avatar" aria-hidden="true">{(resident.first_name || 'R').charAt(0).toUpperCase()}</div>
                <div className="resident-autocomplete-copy">
                  <strong>{formatResidentName(resident)}</strong>
                  <small>{resident.sitio || 'No sitio'} • {age !== null ? `${age} yrs` : 'Age unknown'} • {resident.sex || 'Unknown sex'}</small>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ResidentAutocomplete;
