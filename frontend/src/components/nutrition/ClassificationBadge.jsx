import React from 'react';
import { AlertCircle, AlertOctagon, AlertTriangle, ArrowDownCircle, CheckCircle2, Circle } from 'lucide-react';

const ClassificationBadge = ({ status, severe = false }) => {
  const normalized = String(status || '').trim().toLowerCase();
  const tone = normalized === 'normal'
    ? 'normal'
    : normalized === 'overweight'
      ? 'overweight'
      : normalized === 'underweight'
        ? 'underweight'
        : /severely underweight|severely wasted|severely stunted|severe/.test(normalized)
          ? 'severe'
          : /stunted|wasted/.test(normalized)
            ? 'warning'
            : normalized === 'obese'
              ? 'obese'
              : 'neutral';
  const Icon = tone === 'normal' ? CheckCircle2 : tone === 'underweight' ? ArrowDownCircle : tone === 'severe' ? AlertTriangle : tone === 'obese' ? AlertOctagon : tone === 'neutral' ? Circle : AlertCircle;
  return (
    <span className={`nutrition-classification nutrition-classification--${tone}${severe ? ' nutrition-classification--worst' : ''}`}>
      <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
      {status || 'Unavailable'}
    </span>
  );
};

export default ClassificationBadge;
