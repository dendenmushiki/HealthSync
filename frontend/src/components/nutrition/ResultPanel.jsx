import React from 'react';
import ClassificationBadge from './ClassificationBadge';
import ZScoreGauge from './ZScoreGauge';

const indicators = [
  ['wfa_zscore', 'wfa_status', 'Weight-for-age', 'Underweight status'],
  ['hfa_zscore', 'hfa_status', 'Length/height-for-age', 'Stunting status'],
  ['wflh_zscore', 'wflh_status', 'Weight-for-length/height', 'Wasting status'],
];

const severityRank = (status) => {
  const value = String(status || '').toLowerCase();
  if (value.includes('severe') || value.includes('obese') || value.includes('tall')) return 3;
  if (value.includes('moderate') || value.includes('wasted') || value.includes('stunted') || value.includes('underweight') || value.includes('overweight')) return 2;
  return value === 'normal' ? 0 : 1;
};

const ResultPanel = ({ result, calculating, emptyTitle = 'Enter weight and length to see results', mode = 'nutrition', heightCm, resident, ageYears }) => {
  if (calculating) return <div className="nutrition-assessment-card nutrition-assessment-skeleton" aria-live="polite"><div /><div /><div /><span>Calculating assessment...</span></div>;
  if (!result) return <div className="nutrition-assessment-card nutrition-assessment-empty"><div className="nutrition-empty-icon" aria-hidden="true">↗</div><h3>{mode === 'bmi' ? 'BMI result' : 'Assessment'}</h3><p>{emptyTitle}</p></div>;
  if (mode === 'bmi') {
    const category = result.bmi_for_age_category || 'Unavailable';
    const zscore = Number(result.bmi_for_age_zscore);
    const severe = /severe/i.test(category) || /obesity/i.test(category);
    const interpretation = category === 'Normal' ? 'BMI is within the normal range for age and sex.' : `BMI indicates ${category.toLowerCase()} for age and sex.`;
    return <aside className="nutrition-assessment-card nutrition-bmi-result" aria-live="polite">
      <div className="nutrition-bmi-hero"><span>BMI</span><strong>{Number(result.bmi).toFixed(2)}</strong><small>kg/m²</small></div>
      <div className="nutrition-bmi-classification"><ClassificationBadge status={category} severe={severe} /><span><strong>{Number.isFinite(zscore) ? zscore.toFixed(2) : '—'}</strong> SD</span></div>
      <ZScoreGauge value={zscore} label={`BMI-for-age: ${category}`} />
      <p className="nutrition-bmi-interpretation">{interpretation}</p>
      <small className="nutrition-reference-caption">WHO 2007 BMI-for-age LMS standard</small>
      <p className="nutrition-screening-note">Screening aid, not a diagnosis.</p>
    </aside>;
  }
  if (mode === 'adult-bmi') {
    const category = result.bmi_category || 'Unavailable';
    const bmi = Number(result.bmi);
    const marker = Math.max(12, Math.min(40, bmi));
    const markerLeft = `${((marker - 12) / (40 - 12)) * 100}%`;
    const height = Number(heightCm);
    const minKg = height > 0 ? 18.5 * (height / 100) ** 2 : null;
    const maxKg = height > 0 ? 24.9 * (height / 100) ** 2 : null;
    const delta = Number(result.weight_kg) - maxKg;
    const weightMessage = height > 0 ? (delta > 0 ? `${delta.toFixed(1)} kg above the upper healthy-weight limit` : Number(result.weight_kg) < minKg ? `${(minKg - Number(result.weight_kg)).toFixed(1)} kg below the lower healthy-weight limit` : 'Within the healthy weight range') : '';
    const interpretation = category === 'Normal' ? 'BMI is within the normal range for adults.' : `BMI indicates ${category.toLowerCase()} status.`;
    const notes = [];
    if (resident?.pregnant) notes.push('Pregnant resident: standard adult BMI interpretation may not apply; follow existing clinical guidance.');
    if (resident?.lactating) notes.push('Lactating resident: consider clinical context when interpreting BMI.');
    if (Number(ageYears) >= 60) notes.push('Resident is 60+: interpretation in older adults may differ.');
    if (Number(ageYears) >= 19 && Number(ageYears) <= 21) notes.push('Resident is near the adolescent/adult boundary (5–19 years vs 20+ years).');
    return <aside className="nutrition-assessment-card nutrition-adult-bmi-result" aria-live="polite">
      <div className="nutrition-bmi-hero"><span>BMI</span><strong>{Number.isFinite(bmi) ? bmi.toFixed(2) : '—'}</strong><small>kg/m²</small></div>
      <div className="nutrition-bmi-classification"><ClassificationBadge status={category} severe={category === 'Obese' || category === 'Underweight'} /></div>
      <div className="nutrition-adult-scale" aria-label={`BMI ${bmi.toFixed(2)}, classification ${category}. Cutoffs: underweight below 18.5, normal 18.5 to 24.9, overweight 25 to 29.9, obese 30 and above.`} role="img">
        <div className="nutrition-adult-scale-track"><span className="scale-underweight" /><span className="scale-normal" /><span className="scale-overweight" /><span className="scale-obese" /><i style={{ left: markerLeft }} /></div>
        <div className="nutrition-adult-scale-labels"><span>Underweight<br />&lt;18.5</span><span>Normal<br />18.5–24.9</span><span>Overweight<br />25–29.9</span><span>Obese<br />≥30</span></div>
      </div>
      {minKg && maxKg && <div className="nutrition-healthy-weight"><strong>Healthy weight range for {height.toFixed(1)} cm</strong><span>{minKg.toFixed(1)}–{maxKg.toFixed(1)} kg</span><small>{weightMessage}</small></div>}
      <p className="nutrition-bmi-interpretation">{interpretation}</p>
      {notes.map((note) => <p className="nutrition-context-note" key={note}><span aria-hidden="true">ⓘ</span>{note}</p>)}
      <small className="nutrition-reference-caption">WHO adult BMI standard</small>
      <p className="nutrition-screening-note">Screening aid, not a diagnosis.</p>
    </aside>;
  }
  const worst = indicators.reduce((current, indicator) => severityRank(result[indicator[1]]) > severityRank(result[current[1]]) ? indicator : current, indicators[0]);
  const missingIndicator = indicators.some(([scoreKey, statusKey]) => (
    result[scoreKey] === null || result[scoreKey] === undefined || result[scoreKey] === '' ||
    result[statusKey] === null || result[statusKey] === undefined || result[statusKey] === ''
  ));
  const needsFollowUp = missingIndicator || severityRank(result[worst[1]]) > 0;
  return (
    <aside className="nutrition-assessment-card" aria-live="polite">
      <div className="nutrition-overall">
        <div><span>Overall assessment</span><strong className={needsFollowUp ? 'warning' : 'success'}>{missingIndicator ? 'Unavailable' : needsFollowUp ? 'Needs follow-up' : 'Normal'}</strong></div>
        <ClassificationBadge status={missingIndicator ? 'Unavailable' : needsFollowUp ? 'Needs follow-up' : 'Normal'} severe={needsFollowUp} />
      </div>
      <div className="nutrition-indicator-list">
        {indicators.map(([scoreKey, statusKey, label, shortLabel]) => {
          const value = result[scoreKey];
          const score = value === null || value === undefined || value === '' ? Number.NaN : Number(value);
          const worstIndicator = worst[0] === scoreKey;
          return <div className={`nutrition-indicator${worstIndicator ? ' nutrition-indicator--worst' : ''}`} key={scoreKey}>
            <div className="nutrition-indicator-heading"><div><span>{shortLabel}</span><strong>{label}</strong></div><ClassificationBadge status={result[statusKey]} severe={worstIndicator} /></div>
            <div className="nutrition-zscore"><strong>{Number.isFinite(score) ? `${score.toFixed(2)} SD` : 'Unavailable'}</strong></div>
            <ZScoreGauge value={score} label={label} />
          </div>;
        })}
      </div>
      <p className="nutrition-screening-note">Screening aid, not a diagnosis.</p>
    </aside>
  );
};

export default ResultPanel;
