import React from 'react';

const TrendChart = ({ items = [], mode = 'nutrition' }) => {
  const keys = mode === 'bmi' ? ['bmi_for_age_zscore'] : mode === 'adult-bmi' ? ['bmi', 'weight_kg'] : ['wfa_zscore', 'hfa_zscore', 'wflh_zscore'];
  const data = items.filter((item) => keys.some((key) => Number.isFinite(Number(item[key])))).slice().reverse().slice(-12);
  if (!data.length) return <div className="nutrition-trend-card"><h3>Measurement trend</h3><p>{mode === 'adult-bmi' ? 'First measurement for this resident.' : mode === 'bmi' ? 'First measurement for this resident.' : 'First measurement for this child.'}</p></div>;
  const width = 520, height = 180, padX = 18, padY = 16;
  const x = (index) => padX + (data.length === 1 ? width / 2 : index * (width - padX * 2) / (data.length - 1));
  const y = (value) => padY + (4 - Math.max(-4, Math.min(4, Number(value)))) * (height - padY * 2) / 8;
  const adultY = (key, value) => key === 'weight_kg'
    ? padY + (150 - Math.max(0, Math.min(150, Number(value)))) * (height - padY * 2) / 150
    : padY + (40 - Math.max(12, Math.min(40, Number(value)))) * (height - padY * 2) / 28;
  const series = mode === 'bmi'
    ? [['bmi_for_age_zscore', 'BMI-for-age', 'var(--nutrition-chart-waz)']]
    : mode === 'adult-bmi'
      ? [['bmi', 'BMI', 'var(--nutrition-chart-waz)'], ['weight_kg', 'Weight kg', 'var(--nutrition-chart-haz)']]
      : [['wfa_zscore', 'WAZ', 'var(--nutrition-chart-waz)'], ['hfa_zscore', 'HAZ', 'var(--nutrition-chart-haz)'], ['wflh_zscore', 'WHZ', 'var(--nutrition-chart-whz)']];
  return <div className="nutrition-trend-card"><h3>Growth trend</h3><div className="nutrition-trend-legend">{series.map(([, label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={mode === 'adult-bmi' ? 'Adult BMI and weight trend with BMI category bands at 18.5, 25, and 30.' : 'Z-score trend chart with reference bands.'}>
      {mode === 'adult-bmi'
        ? [18.5, 25, 30].map((band) => <line key={band} x1={padX} x2={width - padX} y1={adultY('bmi', band)} y2={adultY('bmi', band)} className={`nutrition-trend-band${band === 25 ? ' zero' : ''}`} />)
        : (mode === 'bmi' ? [-3, -2, -1, 0, 1, 2, 3] : [-3, -2, 0, 2, 3]).map((band) => <line key={band} x1={padX} x2={width - padX} y1={y(band)} y2={y(band)} className={`nutrition-trend-band${band === 0 ? ' zero' : ''}`} />)}
      {series.map(([key, label, color]) => <g key={key}><polyline points={data.map((item, index) => `${x(index)},${mode === 'adult-bmi' ? adultY(key, item[key]) : y(item[key])}`).join(' ')} fill="none" stroke={color} strokeWidth="2.5" />{data.map((item, index) => Number.isFinite(Number(item[key])) ? <circle key={`${key}-${index}`} cx={x(index)} cy={mode === 'adult-bmi' ? adultY(key, item[key]) : y(item[key])} r="3.5" fill={color} /> : null)}</g>)}
    </svg>
  </div>;
};

export default TrendChart;
