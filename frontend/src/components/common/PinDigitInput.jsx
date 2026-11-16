import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import './PinDigitInput.css';

const EMPTY_DIGITS = () => ['', '', '', '', '', ''];

const PinDigitInput = forwardRef(function PinDigitInput({
  disabled = false,
  invalid = false,
  describedBy,
  showStrengthHint = false,
  autoFocus = true,
  onComplete,
  onChange,
}, ref) {
  const [digits, setDigits] = useState(EMPTY_DIGITS);
  const [visible, setVisible] = useState(false);
  const inputs = useRef([]);
  const digitsRef = useRef(digits);
  const completeRef = useRef(onComplete);
  const autoSubmitTimer = useRef(null);
  const hideTimer = useRef(null);
  const pin = digits.join('');
  const predictablePin = /^(\d)\1{5}$|^(012345|123456|654321)$/.test(pin);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  const updateDigits = useCallback((next) => {
    digitsRef.current = next;
    setDigits(next);
    onChange?.(next.join(''));
    window.clearTimeout(autoSubmitTimer.current);
    if (next.every(Boolean) && !disabled) {
      autoSubmitTimer.current = window.setTimeout(() => {
        completeRef.current?.(next.join(''));
      }, 120);
    }
  }, [disabled, onChange]);

  const clear = useCallback((focus = false) => {
    digitsRef.current.fill('');
    const empty = EMPTY_DIGITS();
    digitsRef.current = empty;
    setDigits(empty);
    onChange?.('');
    window.clearTimeout(autoSubmitTimer.current);
    if (focus) window.requestAnimationFrame(() => inputs.current[0]?.focus());
  }, [onChange]);

  useImperativeHandle(ref, () => ({
    clear,
    focusFirst: () => inputs.current[0]?.focus(),
    getValue: () => digitsRef.current.join(''),
  }), [clear]);

  useEffect(() => {
    const mountedInputs = inputs.current;
    if (autoFocus) inputs.current[0]?.focus();
    return () => {
      window.clearTimeout(autoSubmitTimer.current);
      window.clearTimeout(hideTimer.current);
      digitsRef.current.fill('');
      mountedInputs.forEach((input) => {
        if (input) input.value = '';
      });
    };
  }, [autoFocus]);

  useEffect(() => {
    if (!visible) return undefined;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(hideTimer.current);
  }, [visible]);

  const pasteDigits = (event, index) => {
    const pasted = event.clipboardData?.getData('text') || '';
    const numeric = pasted.replace(/\D/g, '').slice(0, 6);
    if (!numeric) return;
    event.preventDefault();
    const next = EMPTY_DIGITS();
    if (numeric.length === 6) {
      numeric.split('').forEach((digit, digitIndex) => { next[digitIndex] = digit; });
    } else {
      digitsRef.current.forEach((digit, digitIndex) => { next[digitIndex] = digit; });
      numeric.split('').forEach((digit, digitIndex) => {
        const target = Math.min(index + digitIndex, 5);
        next[target] = digit;
      });
    }
    updateDigits(next);
    inputs.current[Math.min(index + numeric.length, 5)]?.focus();
  };

  const handleChange = (event, index) => {
    const digit = event.target.value.replace(/\D/g, '').slice(-1);
    const next = [...digitsRef.current];
    next[index] = digit;
    updateDigits(next);
    if (digit && index < 5) inputs.current[index + 1]?.focus();
  };

  const handleKeyDown = (event, index) => {
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      inputs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < 5) {
      event.preventDefault();
      inputs.current[index + 1]?.focus();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      const next = [...digitsRef.current];
      if (next[index]) {
        next[index] = '';
        updateDigits(next);
      } else if (index > 0) {
        next[index - 1] = '';
        updateDigits(next);
        inputs.current[index - 1]?.focus();
      }
    }
  };

  return (
    <div className={`hs-pin-entry ${invalid ? 'has-error' : ''}`}>
      <div className="hs-pin-digits">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(node) => { inputs.current[index] = node; }}
            className={`hs-pin-digit ${digit ? 'is-filled' : ''}`}
            type={visible ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]"
            maxLength={1}
            value={digit}
            disabled={disabled}
            aria-label={`PIN digit ${index + 1} of 6`}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => handleChange(event, index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onPaste={(event) => pasteDigits(event, index)}
          />
        ))}
      </div>
      <button
        className="hs-pin-visibility"
        type="button"
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        aria-label={visible ? 'Hide PIN digits' : 'Show PIN digits'}
        aria-pressed={visible}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
      {showStrengthHint && (
        <p className="hs-pin-strength" aria-live="polite">
          PIN strength: {!pin ? 'Enter six digits for a basic pattern check.'
            : predictablePin ? 'Weak — avoid repeated or sequential digits.'
              : 'Avoid sharing your PIN; choose a pattern that is hard to guess.'}
        </p>
      )}
    </div>
  );
});

export default PinDigitInput;
