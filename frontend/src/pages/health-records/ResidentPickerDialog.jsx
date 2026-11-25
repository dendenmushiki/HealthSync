import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  House,
  Loader2,
  Search,
  UserPlus,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { getResidents } from '../../services/api/residentService';
import { calculateAge } from '../../utils/residentUtils';
import { getProfilePhotoUrl } from '../../utils/profilePhoto';
import { getFriendlyError } from '../../utils/apiErrorMessages';

const PAGE_SIZE = 10;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function getTotalPages(data) {
  const reported = Number(data.pagination?.totalPages);
  if (data.pagination?.totalPages !== null && data.pagination?.totalPages !== undefined && Number.isFinite(reported)) return reported;
  const resultTotal = Number(data.total);
  return Math.ceil((Number.isFinite(resultTotal) ? resultTotal : 0) / (Number(data.pageSize) || PAGE_SIZE));
}

function getResidentName(resident) {
  const firstName = String(resident.first_name || '').trim();
  const middleName = String(resident.middle_name || '').trim();
  const middleInitial = middleName ? `${middleName.charAt(0)}.` : '';
  const suffix = String(resident.suffix || '').trim();
  const givenNames = [firstName, middleInitial, suffix].filter(Boolean).join(' ');
  return [String(resident.last_name || '').trim(), givenNames].filter(Boolean).join(', ') || 'Name not provided';
}

function HighlightedText({ value, query }) {
  const text = String(value || '');
  const terms = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (!text || terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig');
  const matches = new Set(terms.map((term) => term.toLowerCase()));
  return <>{text.split(pattern).map((part, index) => (
    matches.has(part.toLowerCase())
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
  ))}</>;
}

function ResidentAvatar({ resident }) {
  const initials = `${resident.first_name?.charAt(0) || ''}${resident.last_name?.charAt(0) || ''}`.toUpperCase();
  return <span className="resident-picker-avatar" aria-hidden="true">
    {resident.profile_photo && <img src={getProfilePhotoUrl(resident.profile_photo)} alt="" onError={(event) => event.currentTarget.remove()} />}
    {initials || <UserRound size={18} strokeWidth={1.8} />}
  </span>;
}

function PickerHeader({ typeInfo, onClose }) {
  const TypeIcon = typeInfo.icon;
  return <header className="resident-picker-header">
    <span className="resident-picker-drag-handle" aria-hidden="true" />
    <span className="resident-picker-type-icon"><TypeIcon size={19} strokeWidth={1.8} aria-hidden="true" /></span>
    <div className="resident-picker-heading">
      <span className="resident-picker-eyebrow">NEW {typeInfo.fullLabel.toUpperCase()}</span>
      <h2 id="resident-picker-title">Choose a resident</h2>
      <p id="resident-picker-description">
        {typeInfo.key === 'maternal' ? 'Select a female resident for this record.' : 'Select who this record is for.'}
      </p>
    </div>
    <button type="button" className="resident-picker-close" aria-label="Close" onClick={onClose}>
      <X size={18} strokeWidth={1.9} aria-hidden="true" />
    </button>
  </header>;
}

function PickerSearch({
  inputRef,
  query,
  onChange,
  onClear,
  loading,
  total,
  activeDescendant,
}) {
  const resultCount = query.trim()
    ? `Showing ${total.toLocaleString()} ${total === 1 ? 'result' : 'results'} for "${query.trim()}"`
    : `${total.toLocaleString()} ${total === 1 ? 'resident' : 'residents'}`;
  return <div className="resident-picker-search-area">
    <div className="resident-picker-search">
      <Search size={18} strokeWidth={1.8} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        aria-label="Search residents by name, ID, or household"
        aria-controls="resident-picker-options"
        aria-activedescendant={activeDescendant || undefined}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search by name, ID, or household"
      />
      {query && <button type="button" className="resident-picker-clear" aria-label="Clear search" onClick={onClear}>
        <X size={16} strokeWidth={1.9} aria-hidden="true" />
      </button>}
      {loading && <Loader2 className="resident-picker-spinner" size={17} strokeWidth={2} aria-label="Searching residents" />}
    </div>
    <p className="resident-picker-result-count" aria-live="polite">{resultCount}</p>
  </div>;
}

function PickerSkeleton({ count = 6 }) {
  return <div className="resident-picker-skeleton-list" role="status" aria-label="Loading residents">
    {Array.from({ length: count }, (_, index) => <div className="resident-picker-skeleton-row" key={index} aria-hidden="true">
      <span className="resident-picker-skeleton-avatar" />
      <span className="resident-picker-skeleton-copy"><i /><i /></span>
      <span className="resident-picker-skeleton-chip" />
      <span className="resident-picker-skeleton-arrow" />
    </div>)}
  </div>;
}

function PickerEmptyState({ searching, femaleOnly, onClear }) {
  const residentLabel = femaleOnly ? 'female resident' : 'resident';
  return <div className="resident-picker-empty">
    <span className="resident-picker-empty-icon">
      {searching ? <Search size={22} strokeWidth={1.8} aria-hidden="true" /> : <Users size={22} strokeWidth={1.8} aria-hidden="true" />}
    </span>
    <h3>{searching ? `No ${residentLabel}s found` : `No ${residentLabel}s registered yet`}</h3>
    <p>{searching ? 'Try a different name or clear the search.' : `Register a ${residentLabel} before creating this record.`}</p>
    {searching
      ? <button type="button" className="resident-picker-ghost-button" onClick={onClear}>Clear search</button>
      : <Link className="resident-picker-register-primary" to="/residents/new"><UserPlus size={17} strokeWidth={1.8} aria-hidden="true" />Register resident</Link>}
  </div>;
}

function ResidentOption({ resident, index, active, query, disabled, selecting, onActivate, onSelect, optionRef }) {
  const name = getResidentName(resident);
  const rawAge = resident.age ?? calculateAge(resident.birthdate);
  const age = rawAge === null || rawAge === undefined ? '' : `${rawAge} yrs`;
  const gender = String(resident.sex || '').trim();
  const displayGender = gender ? `${gender.charAt(0).toUpperCase()}${gender.slice(1).toLowerCase()}` : '';
  const sitio = String(resident.sitio || '').trim();
  const demographics = [age, displayGender, sitio].filter(Boolean);
  const household = String(resident.household_no || '').trim();
  return <li className="resident-picker-option-item">
    <button
      ref={optionRef}
      id={`resident-picker-option-${index}`}
      type="button"
      role="option"
      aria-selected={active}
      aria-label={`Choose ${name}`}
      title={name}
      tabIndex={-1}
      className={`resident-picker-option ${active ? 'is-active' : ''} ${selecting ? 'is-selecting' : ''}`}
      disabled={disabled}
      onMouseEnter={() => onActivate(index)}
      onClick={() => onSelect(resident)}
    >
      <ResidentAvatar resident={resident} />
      <span className="resident-picker-option-details">
        <strong><HighlightedText value={name} query={query} /></strong>
        {demographics.length > 0 && <span className="resident-picker-demographics">{demographics.join(' · ')}</span>}
        {household && <span className="resident-picker-household"><House size={13} strokeWidth={1.8} aria-hidden="true" />{household}</span>}
      </span>
      {resident.resident_id !== null && resident.resident_id !== undefined &&
        <span className="resident-picker-id" title={`Resident ID ${resident.resident_id}`}>ID {resident.resident_id}</span>}
      {selecting
        ? <Loader2 className="resident-picker-row-spinner" size={17} strokeWidth={2} aria-label="Opening record" />
        : <ChevronRight className="resident-picker-chevron" size={17} strokeWidth={1.9} aria-hidden="true" />}
    </button>
  </li>;
}

function PickerFooter({ onClose }) {
  return <footer className="resident-picker-footer">
    <div className="resident-picker-footer-links">
      <span className="resident-picker-keyboard-hint">↑↓ to navigate · Enter to select · Esc to close</span>
      <Link to="/residents/new" className="resident-picker-register-link" onClick={onClose}>
        <UserPlus size={16} strokeWidth={1.8} aria-hidden="true" />Register new resident
      </Link>
    </div>
    <button type="button" className="resident-picker-cancel" onClick={onClose}>Cancel</button>
  </footer>;
}

function ResidentPickerDialog({ typeInfo, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [residents, setResidents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectingId, setSelectingId] = useState(null);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const listRef = useRef(null);
  const optionRefs = useRef([]);
  const requestRef = useRef(null);
  const selectionTimerRef = useRef(null);
  const femaleOnly = typeInfo.key === 'maternal';
  const searchValue = query.trim();
  const hasMore = page < totalPages;
  const activeDescendant = activeIndex >= 0 ? `resident-picker-option-${activeIndex}` : '';

  useEffect(() => {
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      requestRef.current?.abort();
      window.clearTimeout(selectionTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setResidents([]);
    setTotal(0);
    setPage(1);
    setTotalPages(0);
    setActiveIndex(-1);
    optionRefs.current = [];
    if (listRef.current) listRef.current.scrollTop = 0;

    const timer = window.setTimeout(async () => {
      try {
        const response = await getResidents({
          search: searchValue,
          page: 1,
          pageSize: PAGE_SIZE,
          sort: 'name',
          order: 'asc',
          ...(femaleOnly ? { sex: 'female' } : {}),
        }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response?.success || !Array.isArray(response.data?.items)) {
          throw new Error(response?.message || 'Unable to load residents.');
        }
        const data = response.data;
        const eligibleResidents = femaleOnly
          ? data.items.filter((resident) => String(resident.sex || '').trim().toLowerCase() === 'female')
          : data.items;
        setResidents(eligibleResidents);
        setTotal(Number(data.total) || 0);
        setPage(Number(data.page) || 1);
        setTotalPages(getTotalPages(data));
        setActiveIndex(eligibleResidents.length ? 0 : -1);
      } catch (loadError) {
        if (controller.signal.aborted || loadError?.name === 'CanceledError' || loadError?.code === 'ERR_CANCELED') return;
        setError(loadError);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, searchValue ? 300 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (requestRef.current === controller) requestRef.current = null;
    };
  }, [femaleOnly, retry, searchValue]);

  useEffect(() => {
    if (activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMore || selectingId) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setLoadingMore(true);
    setError(null);
    const nextPage = page + 1;
    try {
      const response = await getResidents({
        search: searchValue,
        page: nextPage,
        pageSize: PAGE_SIZE,
        sort: 'name',
        order: 'asc',
        ...(femaleOnly ? { sex: 'female' } : {}),
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!response?.success || !Array.isArray(response.data?.items)) {
        throw new Error(response?.message || 'Unable to load more residents.');
      }
      const data = response.data;
      const eligibleResidents = femaleOnly
        ? data.items.filter((resident) => String(resident.sex || '').trim().toLowerCase() === 'female')
        : data.items;
      setResidents((current) => [...current, ...eligibleResidents]);
      if (eligibleResidents.length) setActiveIndex((current) => current < 0 ? 0 : current);
      setTotal(Number(data.total) || 0);
      setPage(Number(data.page) || nextPage);
      setTotalPages(getTotalPages(data));
    } catch (loadError) {
      if (controller.signal.aborted || loadError?.name === 'CanceledError' || loadError?.code === 'ERR_CANCELED') return;
      setError(loadError);
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [femaleOnly, hasMore, loading, loadingMore, page, searchValue, selectingId]);

  const chooseResident = (resident) => {
    if (selectingId) return;
    setSelectingId(String(resident.resident_id));
    selectionTimerRef.current = window.setTimeout(() => onSelect(resident), 120);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(dialogRef.current?.querySelectorAll('input:not(:disabled), button:not(:disabled), a[href]') || [])
        .filter((element) => element.tabIndex >= 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!residents.length || selectingId) return;
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + direction + residents.length) % residents.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!residents.length || selectingId) return;
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : residents.length - 1);
      return;
    }
    if (event.key === 'Enter' && event.target === inputRef.current && activeIndex >= 0 && !selectingId) {
      event.preventDefault();
      chooseResident(residents[activeIndex]);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey &&
        event.target !== inputRef.current && !selectingId) {
      event.preventDefault();
      inputRef.current?.focus();
      setQuery((current) => `${current}${event.key}`);
    }
  };

  const retryLoadMore = error && residents.length > 0;
  const loadError = error && residents.length === 0;
  const listIsScrollable = residents.length > 4 || hasMore || loading;
  const shouldShowEmpty = !loading && !error && residents.length === 0;

  return <div className="health-record-picker-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section
      ref={dialogRef}
      className="health-record-picker resident-picker-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resident-picker-title"
      aria-describedby="resident-picker-description"
      onKeyDown={handleKeyDown}
    >
      <PickerHeader typeInfo={typeInfo} onClose={onClose} />
      <PickerSearch
        inputRef={inputRef}
        query={query}
        onChange={setQuery}
        onClear={() => { setQuery(''); inputRef.current?.focus(); }}
        loading={loading}
        total={total}
        activeDescendant={activeDescendant}
      />
      <div className={`resident-picker-list-shell ${listIsScrollable ? 'is-scrollable' : ''}`}>
        <div ref={listRef} className="resident-picker-list-scroll" aria-busy={loading || loadingMore}>
          {loading
            ? <PickerSkeleton />
            : loadError
              ? <div className="resident-picker-error-state" role="alert">
                <span className="resident-picker-empty-icon is-error"><AlertCircle size={21} strokeWidth={1.8} aria-hidden="true" /></span>
                <h3>Couldn't load residents</h3>
                <p>{getFriendlyError(error)}</p>
                <button type="button" className="resident-picker-ghost-button" onClick={() => setRetry((current) => current + 1)}>Retry</button>
              </div>
              : shouldShowEmpty
                ? <PickerEmptyState searching={Boolean(searchValue)} femaleOnly={femaleOnly} onClear={() => { setQuery(''); inputRef.current?.focus(); }} />
                : <div className="resident-picker-results">
                  <ul id="resident-picker-options" className="resident-picker-list" role="listbox" aria-label="Residents">
                    {residents.map((resident, index) => <ResidentOption
                      key={resident.resident_id}
                      resident={resident}
                      index={index}
                      active={index === activeIndex}
                      query={searchValue}
                      disabled={Boolean(selectingId)}
                      selecting={String(resident.resident_id) === selectingId}
                      onActivate={setActiveIndex}
                      onSelect={chooseResident}
                      optionRef={(node) => { optionRefs.current[index] = node; }}
                    />)}
                  </ul>
                  {retryLoadMore && <div className="resident-picker-more-error" role="alert">
                    <span>{getFriendlyError(error)}</span>
                    <button type="button" disabled={Boolean(selectingId)} onClick={loadMore}>Retry</button>
                  </div>}
                  {loadingMore && <PickerSkeleton count={1} />}
                  {!loadingMore && hasMore && !retryLoadMore && <div className="resident-picker-load-more">
                    <button type="button" disabled={Boolean(selectingId)} onClick={loadMore}>Load more residents</button>
                  </div>}
                </div>}
        </div>
      </div>
      <PickerFooter onClose={onClose} />
    </section>
  </div>;
}

export default ResidentPickerDialog;
