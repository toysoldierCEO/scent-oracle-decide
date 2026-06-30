export type OdaraAuthErrorCategory =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'network_error'
  | 'cors_or_fetch_failed'
  | 'server_error'
  | 'unknown_auth_error';

export type OdaraSafeAuthErrorSummary = {
  category: OdaraAuthErrorCategory;
  errorClass: string;
  status: number | null;
  code: string | null;
  displayMessage: string;
};

const SAFE_AUTH_ERROR_CODES = new Set([
  'invalid_credentials',
  'email_not_confirmed',
  'email_not_verified',
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'otp_disabled',
  'signup_disabled',
  'weak_password',
]);

function readStringProperty(error: unknown, key: string): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumberProperty(error: unknown, key: string): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeClassName(value: unknown): string {
  const candidate = typeof value === 'string' ? value : '';
  const cleaned = candidate.replace(/[^A-Za-z0-9_$.-]/g, '').slice(0, 80);
  return cleaned || 'AuthError';
}

function sanitizeCode(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80);
  if (!normalized || !SAFE_AUTH_ERROR_CODES.has(normalized)) return null;
  return normalized;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error ?? '');
  const value = (error as Record<string, unknown>).message;
  return typeof value === 'string' ? value : '';
}

function resolveCategory(params: {
  code: string | null;
  message: string;
  name: string;
  status: number | null;
}): OdaraAuthErrorCategory {
  const { code, message, name, status } = params;
  const text = `${code ?? ''} ${message} ${name}`.toLowerCase();

  if (status === 429 || /rate limit|too many|over_request_rate_limit|over_email_send_rate_limit/.test(text)) {
    return 'rate_limited';
  }
  if (/email.*not.*confirmed|email_not_confirmed|email_not_verified|confirm your email/.test(text)) {
    return 'email_not_confirmed';
  }
  if (/invalid.*credential|invalid login|invalid_credentials|bad credentials/.test(text)) {
    return 'invalid_credentials';
  }
  if (/cors|cross-origin|access-control/.test(text)) {
    return 'cors_or_fetch_failed';
  }
  if (/failed to fetch|fetch failed|networkerror|network error|load failed|retryablefetch|aborterror|timeout/.test(text)) {
    return 'network_error';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'server_error';
  }
  return 'unknown_auth_error';
}

export function getSafeAuthErrorDisplayMessage(category: OdaraAuthErrorCategory): string {
  switch (category) {
    case 'invalid_credentials':
      return 'Sign-in failed. Check your credentials or try again.';
    case 'email_not_confirmed':
      return 'Sign-in failed: email not confirmed.';
    case 'rate_limited':
      return 'Too many sign-in attempts. Wait a bit, then try again.';
    case 'network_error':
    case 'cors_or_fetch_failed':
      return 'Sign-in failed: network/auth service error.';
    case 'server_error':
      return 'Sign-in failed: auth service error. Try again shortly.';
    case 'unknown_auth_error':
    default:
      return 'Sign-in failed. Try again.';
  }
}

export function summarizeSafeAuthError(error: unknown): OdaraSafeAuthErrorSummary {
  const errorClass = sanitizeClassName(
    readStringProperty(error, 'name')
      ?? readStringProperty(error, 'constructorName')
      ?? (error instanceof Error ? error.name : null)
      ?? (error && typeof error === 'object' ? (error as object).constructor?.name : null),
  );
  const status = readNumberProperty(error, 'status') ?? readNumberProperty(error, 'statusCode');
  const code = sanitizeCode(
    readStringProperty(error, 'code')
      ?? readStringProperty(error, 'error_code')
      ?? readStringProperty(error, 'errorCode'),
  );
  const category = resolveCategory({
    code,
    message: readMessage(error),
    name: errorClass,
    status,
  });

  return {
    category,
    code,
    errorClass,
    status,
    displayMessage: getSafeAuthErrorDisplayMessage(category),
  };
}
