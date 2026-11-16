import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PinDigitInput from './PinDigitInput';

afterEach(() => {
  jest.useRealTimers();
});

test('accepts a pasted six-digit PIN with leading zeroes and submits it once', () => {
  jest.useFakeTimers();
  const onComplete = jest.fn();
  render(<PinDigitInput onComplete={onComplete} />);
  const digits = Array.from({ length: 6 }, (_, index) => screen.getByLabelText(`PIN digit ${index + 1} of 6`));

  fireEvent.paste(digits[0], {
    clipboardData: { getData: () => '001234' },
  });

  expect(digits.map((input) => input.value).join('')).toBe('001234');
  expect(digits.every((input) => input.type === 'password')).toBe(true);

  act(() => {
    jest.advanceTimersByTime(120);
  });
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith('001234');
});

test('backspace moves to and clears the preceding digit', () => {
  render(<PinDigitInput />);
  const first = screen.getByLabelText('PIN digit 1 of 6');
  const second = screen.getByLabelText('PIN digit 2 of 6');
  fireEvent.change(first, { target: { value: '4' } });
  fireEvent.change(second, { target: { value: '8' } });

  fireEvent.keyDown(second, { key: 'Backspace' });
  fireEvent.keyDown(second, { key: 'Backspace' });

  expect(first.value).toBe('');
  expect(second.value).toBe('');
});
