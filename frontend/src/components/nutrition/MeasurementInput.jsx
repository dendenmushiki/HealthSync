import React from 'react';

const MeasurementInput = ({ id, label, name, value, onChange, onBlur, unit, error, min, max, step = '0.1', ...rest }) => (
  <div className={`nutrition-field${error ? ' nutrition-field--error' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <div className="nutrition-unit-input">
      <input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : rest['aria-describedby']}
        {...rest}
      />
      <span aria-hidden="true">{unit}</span>
    </div>
    {error && <div id={`${id}-error`} className="nutrition-field-error"><span aria-hidden="true">!</span>{error}</div>}
  </div>
);

export default MeasurementInput;
