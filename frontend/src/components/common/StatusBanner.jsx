import React, { useState } from 'react';
import { getFriendlyError, getTechnicalErrorDetails } from '../../utils/apiErrorMessages';
import './StatusBanner.css';

function StatusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5 2.8 20h18.4L12 3.5Z" />
      <path d="M12 9v5m0 3h.01" />
    </svg>
  );
}

export default function StatusBanner({
  error,
  message,
  savedAt,
  offline = false,
  retry,
  retrying = false,
  compact = false,
  technicalDetails = '',
  id,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const details = [getTechnicalErrorDetails(error), technicalDetails].filter(Boolean).join(' · ');
  const savedTime = savedAt
    ? new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'your last update';
  const displayMessage = message || (offline
    ? `Showing saved data from ${savedTime}. We couldn't reach the server. Your work is safe on this device.`
    : getFriendlyError(error));

  return (
    <section
      className={`hs-status-banner${compact ? ' hs-status-banner--compact' : ''}`}
      id={id}
      role="status"
      aria-live="polite"
    >
      <StatusIcon />
      <div className="hs-status-banner-copy">
        <p>{displayMessage}</p>
        {details && (
          <div className="hs-status-banner-details">
            <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
              {detailsOpen ? 'Hide details' : 'Details'}
            </button>
            {detailsOpen && <p>{details}</p>}
          </div>
        )}
      </div>
      {retry && (
        <button className="hs-status-banner-retry" type="button" onClick={retry} disabled={retrying}>
          {retrying && <span className="hs-status-banner-spinner" aria-hidden="true" />}
          {retrying ? 'Trying again' : 'Try again'}
        </button>
      )}
    </section>
  );
}
