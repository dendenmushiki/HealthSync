const DEFAULT_MESSAGE = "We couldn't complete that request. Please try again.";
const NETWORK_MESSAGE = "Can't reach the server right now.";
const INVALID_CREDENTIALS = /invalid credentials|incorrect (?:username|password)/i;

export function getFriendlyError(error) {
  const status = Number(error?.response?.status);
  const code = String(error?.code || '').toUpperCase();
  const technicalMessage = String(error?.message || error || '');
  const responseMessage = error?.response?.data?.message;

  if (status === 401 && typeof responseMessage === 'string' && INVALID_CREDENTIALS.test(responseMessage)) {
    return 'Please check your username or email and password.';
  }

  if (typeof error === 'string') {
    if (INVALID_CREDENTIALS.test(error)) {
      return 'Please check your username or email and password.';
    }
    if (/timeout|timed out|network error|failed to fetch/i.test(error)) return NETWORK_MESSAGE;
    if (/\b(?:401|403)\b/.test(error)) return 'Your session expired. Please sign in again.';
    if (/\b5\d{2}\b/.test(error)) return 'Something went wrong on our side. Try again in a moment.';
    if (/\b\d+ms\b|\bstatus code\b|(?:Axios)?Error:|^\s*at\s+/i.test(error)) return DEFAULT_MESSAGE;
    return error;
  }

  if (status === 401 || status === 403) {
    return 'Your session expired. Please sign in again.';
  }
  if (status >= 500) {
    return 'Something went wrong on our side. Try again in a moment.';
  }
  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return getFriendlyError(responseMessage.trim());
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return "You're offline. Showing data saved on this device.";
  }
  if (
    code === 'ECONNABORTED'
    || code === 'ETIMEDOUT'
    || /timeout|timed out|network error|failed to fetch/i.test(technicalMessage)
    || (!error?.response && Boolean(error?.isAxiosError || error?.request))
  ) {
    return NETWORK_MESSAGE;
  }

  return DEFAULT_MESSAGE;
}

export function getTechnicalErrorDetails(error) {
  if (!error) return '';
  const message = String(
    typeof error === 'string'
      ? error
      : error?.message || error?.response?.data?.message || ''
  ).trim();
  const status = Number(error?.response?.status);
  const details = [];
  if (message) details.push(message);
  if (Number.isFinite(status) && status > 0) details.push(`HTTP ${status}`);
  return details.join(' · ');
}
