import React from 'react';
import { formatDateLabel } from '../../utils/dateUtils';
import ClassificationBadge from './ClassificationBadge';

const PreviousMeasurements = ({ items = [], loading = false, mode = 'nutrition' }) => {
  if (loading) return <div className="nutrition-history-card"><h3>Previous measurements</h3><div className="nutrition-history-loading">Loading history...</div></div>;
  return (
    <div className="nutrition-history-card">
      <h3>Previous measurements</h3>
      {items.length === 0 ? <p className="nutrition-history-empty">First measurement for this {mode === 'adult-bmi' ? 'resident' : 'child'}.</p> : (
        <>
          <div className="nutrition-history-list">
            {items.slice(0, mode === 'adult-bmi' ? 5 : 3).map((item) => <div className="nutrition-history-row" key={item.timbang_id || item.record_id || item.bmi_id}>
              <div><strong>{formatDateLabel(item.date_recorded || item.record_date)}</strong><span>{mode === 'bmi' || mode === 'adult-bmi' ? `${Number(item.weight_kg).toFixed(1)} kg · ${Number(item.height_cm).toFixed(1)} cm · BMI ${Number(item.bmi).toFixed(2)}` : `${Number(item.weight_kg).toFixed(1)} kg · ${Number(item.measurement_cm).toFixed(1)} cm`}</span></div>
              <ClassificationBadge status={mode === 'bmi' ? item.bmi_for_age_category : mode === 'adult-bmi' ? item.bmi_category : (item.wflh_status || item.wfa_status || 'Normal')} />
            </div>)}
          </div>
          {items.length > 1 && (() => {
            const latest = items[0]; const previous = items[1];
            const delta = mode === 'bmi' ? Number(latest.bmi) - Number(previous.bmi) : Number(latest.weight_kg) - Number(previous.weight_kg);
            const latestDate = latest.date_recorded || latest.record_date;
            const previousDate = previous.date_recorded || previous.record_date;
            const dateDelta = Math.max(1, Math.round((new Date(latestDate) - new Date(previousDate)) / 2678400000));
            return <div className={`nutrition-history-delta${delta <= 0 ? ' warning' : ''}`}><strong>{delta >= 0 ? '+' : ''}{delta.toFixed(mode === 'bmi' ? 2 : 1)}{mode === 'bmi' ? '' : ' kg'}</strong><span>in {dateDelta} month{dateDelta === 1 ? '' : 's'}</span>{mode === 'bmi' ? <small>{delta < 0 ? 'BMI decreased since the last visit.' : delta === 0 ? 'BMI is unchanged since the last visit.' : 'BMI increased since the last visit.'}</small> : delta <= 0 && <small>Weight dropped or did not increase.</small>}</div>;
          })()}
        </>
      )}
    </div>
  );
};

export default PreviousMeasurements;
