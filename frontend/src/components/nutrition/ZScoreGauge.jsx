import React from 'react';

const ZScoreGauge = ({ value, label }) => {
  const numeric = Number(value);
  const valid = Number.isFinite(numeric);
  const clamped = valid ? Math.max(-4, Math.min(4, numeric)) : 0;
  const position = ((clamped + 4) / 8) * 100;
  return (
    <div className="nutrition-gauge" role="img" aria-label={`${label}: ${valid ? `${numeric.toFixed(2)} standard deviations` : 'unavailable'}`}>
      <div className="nutrition-gauge-track">
        <span className="nutrition-gauge-zone nutrition-gauge-zone--danger" />
        <span className="nutrition-gauge-zone nutrition-gauge-zone--warning-left" />
        <span className="nutrition-gauge-zone nutrition-gauge-zone--normal" />
        <span className="nutrition-gauge-zone nutrition-gauge-zone--warning-right" />
        <span className="nutrition-gauge-zone nutrition-gauge-zone--high" />
      </div>
      <span className="nutrition-gauge-marker" style={{ left: `${position}%` }} aria-hidden="true" />
      <div className="nutrition-gauge-scale" aria-hidden="true"><span>-4</span><span>-3</span><span>-2</span><span>0</span><span>+2</span><span>+3</span><span>+4</span></div>
    </div>
  );
};

export default ZScoreGauge;
