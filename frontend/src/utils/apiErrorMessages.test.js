import { getFriendlyError, getTechnicalErrorDetails } from './apiErrorMessages';

const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');

afterEach(() => {
  if (originalOnLine) Object.defineProperty(window.navigator, 'onLine', originalOnLine);
});

test.each([
  [{ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' }, "Can't reach the server right now."],
  [{ message: 'Network Error' }, "Can't reach the server right now."],
  [{ response: { status: 401 } }, 'Your session expired. Please sign in again.'],
  [{ response: { status: 403 } }, 'Your session expired. Please sign in again.'],
  [{ response: { status: 503 } }, 'Something went wrong on our side. Try again in a moment.'],
])('maps %p to a plain-language message', (error, expected) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  expect(getFriendlyError(error)).toBe(expected);
});

test('maps unavailable network state to the offline message', () => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
  expect(getFriendlyError({ message: 'request failed' })).toBe("You're offline. Showing data saved on this device.");
});

test('maps technical strings and retains actionable server validation messages', () => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  expect(getFriendlyError('Request failed with status code 500')).toBe('Something went wrong on our side. Try again in a moment.');
  expect(getFriendlyError({ response: { status: 400, data: { message: 'Resident sex is required.' } } })).toBe('Resident sex is required.');
});

test('keeps technical details separate from the friendly message', () => {
  const error = { code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded', response: { status: 504 } };
  expect(getFriendlyError(error)).toBe('Something went wrong on our side. Try again in a moment.');
  expect(getTechnicalErrorDetails(error)).toBe('timeout of 10000ms exceeded · HTTP 504');
});
