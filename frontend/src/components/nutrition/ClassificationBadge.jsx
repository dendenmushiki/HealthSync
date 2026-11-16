import React from 'react';

const ClassificationBadge = ({ status, severe = false }) => {
  const normalized = String(status || '').toLowerCase();
  const severity = normalized.includes('severe') || normalized.includes('sam') || normalized.includes('obese') || normalized.includes('underweight') || normalized.includes('wasted') || normalized.includes('stunted') ? 'danger' : normalized === 'normal' ? 'normal' : 'warning';
  return (
    <span className={`nutrition-classification nutrition-classification--${severity}${severe ? ' nutrition-classification--worst' : ''}`}>
      <span aria-hidden="true">{severity === 'normal' ? '✓' : severity === 'danger' ? '!' : '⚠'}</span>
      {status || 'Unavailable'}
    </span>
  );
};

export default ClassificationBadge;
