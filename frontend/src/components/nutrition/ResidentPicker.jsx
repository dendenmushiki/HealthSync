import React, { useEffect, useRef, useState } from 'react';
import { getResidents } from '../../services/api/residentService';
import { calculateAgeInMonths } from '../../utils/residentUtils';

const nameFor = (resident) => [resident.first_name, resident.middle_name, resident.last_name, resident.suffix].filter(Boolean).join(' ').trim();

const ageLabel = (birthdate, asOf = new Date()) => {
  if (!birthdate) return 'Age unknown';
  const birth = new Date(`${String(birthdate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return 'Age unknown';
  let months = (asOf.getFullYear() - birth.getFullYear()) * 12 + asOf.getMonth() - birth.getMonth();
  if (asOf.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return 'Age unknown';
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  return years ? `${years} yr${years === 1 ? '' : 's'} ${remaining} mos` : `${remaining} mos`;
};

const ResidentPicker = ({ inputId, selectedResident, value, onSelect, outOfRange, onBMI, minAgeMonths = 0, maxAgeMonths = 59, onBMILabel = 'Use BMI computation', label = maxAgeMonths <= 59 ? 'Child' : 'Resident', placeholder = 'Search name or household number' }) => {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rangeMessage, setRangeMessage] = useState('');
  const inputRef = useRef(null);
  const searchEntity = maxAgeMonths <= 59 ? 'children' : 'residents';

  useEffect(() => {
    if (selectedResident) { setQuery(nameFor(selectedResident)); setOpen(false); }
    else if (!value) setQuery('');
  }, [selectedResident, value]);

  useEffect(() => {
    const term = query.trim();
    if (!term || term.length < 2 || selectedResident) { setItems([]); return undefined; }
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await getResidents({ search: term, min_age_months: minAgeMonths, max_age_months: maxAgeMonths, page: 1, limit: 8 });
        const eligible = response?.success ? response.data?.items || [] : [];
        if (eligible.length) {
          if (active) { setItems(eligible); setRangeMessage(''); }
        } else {
          const broadResponse = await getResidents({ search: term, page: 1, limit: 8 });
          const match = broadResponse?.success ? (broadResponse.data?.items || []).find((resident) => {
            const ageMonths = calculateAgeInMonths(resident.birthdate);
            return ageMonths !== null && (ageMonths < minAgeMonths || ageMonths > maxAgeMonths);
          }) : null;
          if (active) {
            setItems([]);
            if (match) {
              const ageMonths = calculateAgeInMonths(match.birthdate);
              const years = ageMonths === null ? null : Math.floor(ageMonths / 12);
              const isBmiRange = minAgeMonths >= 61 && maxAgeMonths >= 228;
              const switchToAdult = isBmiRange && ageMonths >= 229;
              const switchToAdolescent = isBmiRange && minAgeMonths >= 229 && ageMonths >= 61 && ageMonths <= 228;
              const guidance = switchToAdult ? 'Switch to Adult BMI'
                : switchToAdolescent ? 'Switch to Adolescent BMI'
                  : minAgeMonths > 0 ? 'This resident is outside this age group.' : 'Use BMI computation';
              setRangeMessage(`This resident is ${years === null ? 'age unknown' : `${years} years old`}. ${guidance}`);
            } else setRangeMessage('');
          }
        }
      } catch (error) { if (active) { setItems([]); setRangeMessage(''); } }
      finally { if (active) setLoading(false); }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, selectedResident, minAgeMonths, maxAgeMonths]);

  const choose = (resident) => { setQuery(nameFor(resident)); setItems([]); setOpen(false); onSelect(resident); };
  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((i) => Math.min(i + 1, items.length - 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (event.key === 'Enter' && open && activeIndex >= 0) { event.preventEventDefault?.(); event.preventDefault(); choose(items[activeIndex]); }
    if (event.key === 'Escape') setOpen(false);
  };

  return (
    <div className="nutrition-resident-picker">
      <label htmlFor={inputId}>{label}</label>
      <input
        ref={inputRef} id={inputId} role="combobox" aria-expanded={open} aria-controls={`${inputId}-listbox`} aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined}
        value={query} placeholder={placeholder}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); if (selectedResident) onSelect(null); }}
        onFocus={() => setOpen(true)} onKeyDown={handleKeyDown} autoComplete="off"
      />
      {!selectedResident && open && query.trim().length >= 2 && (
        <div id={`${inputId}-listbox`} className="nutrition-combobox-menu" role="listbox">
          {loading && <div className="nutrition-combobox-message">Searching {searchEntity}...</div>}
          {!loading && items.length === 0 && <div className="nutrition-combobox-message">No eligible {searchEntity} found.</div>}
          {!loading && items.map((resident, index) => (
            <button id={`${inputId}-option-${index}`} type="button" role="option" aria-selected={activeIndex === index}
              className={`nutrition-combobox-option${activeIndex === index ? ' active' : ''}`} key={resident.resident_id}
              onMouseDown={(event) => { event.preventDefault(); choose(resident); }}>
              <span className="nutrition-avatar" aria-hidden="true">{(resident.first_name || 'C').charAt(0).toUpperCase()}</span>
              <span><strong>{nameFor(resident)}</strong><small>{ageLabel(resident.birthdate)} · {resident.sex || 'Unknown sex'} · {resident.sitio || 'No sitio'}{resident.household_no ? ` · Household ${resident.household_no}` : ''}</small></span>
            </button>
          ))}
        </div>
      )}
      {(outOfRange || rangeMessage) && <div className="nutrition-field-warning" role="alert">{outOfRange || rangeMessage} <button type="button" className="nutrition-link-button nutrition-bmi-link" onClick={onBMI}>{onBMILabel}</button></div>}
    </div>
  );
};

export default ResidentPicker;
