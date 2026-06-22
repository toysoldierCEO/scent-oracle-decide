import { describe, expect, it } from 'vitest';

import {
  ODARA_SHARED_PREVIEW_ORIGIN,
  resolveOdaraAuthRedirectOrigin,
} from './auth-redirect';

describe('auth redirect origin resolution', () => {
  it('keeps real Lovable project runtimes on their current origin', () => {
    expect(resolveOdaraAuthRedirectOrigin('https://20427402-64b7-4dc9-80aa-727b1e4a3e69.lovableproject.com')).toEqual({
      isExternalPreviewRequired: false,
      redirectOrigin: 'https://20427402-64b7-4dc9-80aa-727b1e4a3e69.lovableproject.com',
    });
  });

  it('keeps the shared preview origin when already running there', () => {
    expect(resolveOdaraAuthRedirectOrigin(ODARA_SHARED_PREVIEW_ORIGIN)).toEqual({
      isExternalPreviewRequired: false,
      redirectOrigin: ODARA_SHARED_PREVIEW_ORIGIN,
    });
  });

  it('keeps local development on the local origin', () => {
    expect(resolveOdaraAuthRedirectOrigin('http://127.0.0.1:8080')).toEqual({
      isExternalPreviewRequired: false,
      redirectOrigin: 'http://127.0.0.1:8080',
    });
  });

  it('falls back to the shared preview for unknown editor origins', () => {
    expect(resolveOdaraAuthRedirectOrigin('https://example.invalid')).toEqual({
      isExternalPreviewRequired: true,
      redirectOrigin: ODARA_SHARED_PREVIEW_ORIGIN,
    });
  });
});
