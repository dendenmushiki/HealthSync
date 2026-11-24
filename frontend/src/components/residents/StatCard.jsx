import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

const StatCard = ({ icon: Icon, label, value, trend, suffix = '', animateOnMount = false }) => {
  const positive = trend?.changePercent > 0;
  const negative = trend?.changePercent < 0;
  const TrendIcon = positive ? ArrowUp : negative ? ArrowDown : ArrowUpDown;
  const initialValue = animateOnMount && Number.isFinite(Number(value)) ? 0 : value;
  const [displayValue, setDisplayValue] = useState(initialValue);
  const previousValueRef = useRef(initialValue);

  useEffect(() => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      setDisplayValue(value);
      previousValueRef.current = value;
      return undefined;
    }

    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = Number(value);
    const start = Number.isFinite(previousValueRef.current) ? Number(previousValueRef.current) : 0;
    previousValueRef.current = target;

    if (reduceMotion || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setDisplayValue(target);
      return undefined;
    }

    let frameId;
    const startedAt = window.performance?.now ? window.performance.now() : Date.now();
    const duration = 700;

    const animate = (timestamp) => {
      const elapsed = timestamp - startedAt;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - ((1 - progress) ** 3);
      setDisplayValue(start + ((target - start) * eased));
      if (progress < 1) frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    };
  }, [value, animateOnMount]);

  const formattedValue = value === null || value === undefined
    ? '—'
    : `${Number(displayValue).toLocaleString([], { maximumFractionDigits: 1 })}${suffix}`;

  return (
    <article className="resident-stat-card">
      <span className="resident-stat-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
      <div className="resident-stat-content">
        <strong aria-label={`${label}: ${formattedValue}`}>{formattedValue}</strong>
        <small>{label}</small>
        {trend && (
          <span
            className={`resident-stat-trend ${positive ? 'is-positive' : ''} ${negative ? 'is-negative' : ''}`}
          >
            <TrendIcon size={12} aria-hidden="true" />
            {Math.abs(trend.changePercent).toLocaleString([], { maximumFractionDigits: 1 })}% vs. last month
          </span>
        )}
      </div>
      <Icon className="resident-stat-watermark" size={64} strokeWidth={1.3} aria-hidden="true" />
    </article>
  );
};

export default StatCard;
