export const ODARA_SHARED_PREVIEW_ORIGIN = 'https://id-preview--20427402-64b7-4dc9-80aa-727b1e4a3e69.lovable.app';
const LOVABLE_PROJECT_ID = '20427402-64b7-4dc9-80aa-727b1e4a3e69';

export type OdaraAuthRedirectResolution = {
  isExternalPreviewRequired: boolean;
  redirectOrigin: string;
};

function parseOrigin(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function isLocalOrigin(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isLovableProjectRuntime(hostname: string) {
  return hostname.endsWith('.lovableproject.com');
}

function isLovableSharedPreview(hostname: string) {
  return hostname === new URL(ODARA_SHARED_PREVIEW_ORIGIN).hostname
    || new RegExp(`^id-preview-[a-z0-9-]+--${LOVABLE_PROJECT_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.lovable\\.app$`).test(hostname);
}

export function resolveOdaraAuthRedirectOrigin(currentOrigin: string): OdaraAuthRedirectResolution {
  const parsed = parseOrigin(currentOrigin);
  if (!parsed) {
    return {
      isExternalPreviewRequired: true,
      redirectOrigin: ODARA_SHARED_PREVIEW_ORIGIN,
    };
  }

  const { hostname, origin } = parsed;
  if (isLocalOrigin(hostname) || isLovableProjectRuntime(hostname) || isLovableSharedPreview(hostname)) {
    return {
      isExternalPreviewRequired: false,
      redirectOrigin: origin,
    };
  }

  return {
    isExternalPreviewRequired: true,
    redirectOrigin: ODARA_SHARED_PREVIEW_ORIGIN,
  };
}
