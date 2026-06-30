import { describe, expect, it } from 'vitest';

import { summarizeSafeAuthError } from './auth-error-summary';

describe('auth error summary', () => {
  it('maps invalid credentials without leaking submitted secrets', () => {
    const summary = summarizeSafeAuthError({
      name: 'AuthApiError',
      status: 400,
      code: 'invalid_credentials',
      message: 'Invalid login credentials for user@example.test password=swordfish access_token=secret',
    });

    expect(summary).toMatchObject({
      category: 'invalid_credentials',
      errorClass: 'AuthApiError',
      status: 400,
      code: 'invalid_credentials',
    });
    expect(summary.displayMessage).toBe('Sign-in failed. Check your credentials or try again.');
    expect(JSON.stringify(summary)).not.toContain('user@example.test');
    expect(JSON.stringify(summary)).not.toContain('swordfish');
    expect(JSON.stringify(summary)).not.toContain('access_token');
  });

  it('maps email-not-confirmed errors safely', () => {
    expect(summarizeSafeAuthError({
      name: 'AuthApiError',
      status: 400,
      message: 'Email not confirmed',
    })).toMatchObject({
      category: 'email_not_confirmed',
      errorClass: 'AuthApiError',
      status: 400,
      code: null,
    });
  });

  it('maps rate limits safely', () => {
    expect(summarizeSafeAuthError({
      name: 'AuthApiError',
      status: 429,
      code: 'over_request_rate_limit',
      message: 'Too many requests',
    })).toMatchObject({
      category: 'rate_limited',
      code: 'over_request_rate_limit',
      status: 429,
    });
  });

  it('maps retryable fetch and CORS-style failures', () => {
    expect(summarizeSafeAuthError({
      name: 'AuthRetryableFetchError',
      message: 'Failed to fetch',
    })).toMatchObject({
      category: 'network_error',
      errorClass: 'AuthRetryableFetchError',
    });

    expect(summarizeSafeAuthError(new TypeError('CORS access-control blocked'))).toMatchObject({
      category: 'cors_or_fetch_failed',
      errorClass: 'TypeError',
    });
  });

  it('maps server and unknown errors without raw messages', () => {
    expect(summarizeSafeAuthError({
      name: 'AuthApiError',
      status: 503,
      message: 'service unavailable for user@example.test',
    })).toMatchObject({
      category: 'server_error',
      status: 503,
    });

    const unknown = summarizeSafeAuthError({
      name: 'Weird Auth Error!',
      message: 'something unexpected with refresh_token=secret',
    });
    expect(unknown.category).toBe('unknown_auth_error');
    expect(unknown.errorClass).toBe('WeirdAuthError');
    expect(JSON.stringify(unknown)).not.toContain('refresh_token');
  });
});
