import { recordOdaraAuthTrace } from './auth-debug-trace';

export type VesperAuthPersistenceMode = 'local' | 'session';

export const VESPER_AUTH_PERSISTENCE_MODE_KEY = 'vesper_auth_persistence_mode';
type VesperAuthStorageBackend = 'local' | 'session';

type SafeStorageReadResult = {
  available: boolean;
  error: boolean;
  value: string | null;
};

function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function safeGetItemResult(storage: Storage | null, key: string): SafeStorageReadResult {
  if (!storage) return { available: false, error: false, value: null };
  try {
    return { available: true, error: false, value: storage.getItem(key) };
  } catch {
    return { available: true, error: true, value: null };
  }
}

function safeGetItem(storage: Storage | null, key: string): string | null {
  return safeGetItemResult(storage, key).value;
}

function safeSetItem(storage: Storage | null, key: string, value: string) {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return safeGetItem(storage, key) === value;
  } catch {
    return false;
  }
}

function safeRemoveItem(storage: Storage | null, key: string) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore storage failures */
  }
}

export function readVesperAuthPersistenceMode(): VesperAuthPersistenceMode {
  const stored = safeGetItem(getLocalStorage(), VESPER_AUTH_PERSISTENCE_MODE_KEY);
  return stored === 'session' ? 'session' : 'local';
}

function writeVesperAuthPersistenceMode(mode: VesperAuthPersistenceMode) {
  safeSetItem(getLocalStorage(), VESPER_AUTH_PERSISTENCE_MODE_KEY, mode);
}

function getPreferredStorage(mode: VesperAuthPersistenceMode): Storage | null {
  return mode === 'session' ? getSessionStorage() : getLocalStorage();
}

function getFallbackStorage(mode: VesperAuthPersistenceMode): Storage | null {
  return mode === 'session' ? getLocalStorage() : getSessionStorage();
}

function getPreferredStorageBackend(mode: VesperAuthPersistenceMode): VesperAuthStorageBackend {
  return mode === 'session' ? 'session' : 'local';
}

function getFallbackStorageBackend(mode: VesperAuthPersistenceMode): VesperAuthStorageBackend {
  return mode === 'session' ? 'local' : 'session';
}

export function primeVesperAuthPersistence(rememberMe: boolean, storageKey: string) {
  const mode: VesperAuthPersistenceMode = rememberMe ? 'local' : 'session';
  writeVesperAuthPersistenceMode(mode);
  recordOdaraAuthTrace({
    decision: 'primed',
    reason: rememberMe ? 'remember_me_local' : 'session_only_login',
    source: 'storage',
    storageKeyName: storageKey,
  });
}

export const vesperAuthStorage = {
  getItem(key: string): string | null {
    const mode = readVesperAuthPersistenceMode();
    const preferredBackend = getPreferredStorageBackend(mode);
    const fallbackBackend = getFallbackStorageBackend(mode);
    const preferredRead = safeGetItemResult(getPreferredStorage(mode), key);
    if (preferredRead.value !== null) {
      recordOdaraAuthTrace({
        decision: 'get_preferred',
        reason: 'supabase_storage_get_item_preferred_hit',
        source: 'storage',
        storageBackendUsed: preferredBackend,
        storageKeyName: key,
        storageOperation: 'getItem',
        storageOutcome: 'preferred_hit',
      });
      return preferredRead.value;
    }

    const fallbackRead = safeGetItemResult(getFallbackStorage(mode), key);
    if (fallbackRead.value !== null) {
      recordOdaraAuthTrace({
        decision: 'get_fallback',
        reason: preferredRead.error
          ? 'supabase_storage_get_item_fallback_after_preferred_error'
          : 'supabase_storage_get_item_fallback_hit',
        source: 'storage',
        storageBackendUsed: fallbackBackend,
        storageKeyName: key,
        storageOperation: 'getItem',
        storageOutcome: preferredRead.error ? 'fallback_hit_after_preferred_error' : 'fallback_hit',
      });
      return fallbackRead.value;
    }

    recordOdaraAuthTrace({
      decision: 'get_miss',
      reason: preferredRead.error || fallbackRead.error
        ? 'supabase_storage_get_item_miss_after_storage_error'
        : 'supabase_storage_get_item_miss',
      source: 'storage',
      storageBackendUsed: preferredRead.error ? preferredBackend : fallbackRead.error ? fallbackBackend : 'none',
      storageKeyName: key,
      storageOperation: 'getItem',
      storageOutcome: preferredRead.error || fallbackRead.error ? 'miss_after_error' : 'miss',
    });
    return null;
  },
  setItem(key: string, value: string) {
    const mode = readVesperAuthPersistenceMode();
    const preferredBackend = getPreferredStorageBackend(mode);
    const fallbackBackend = getFallbackStorageBackend(mode);
    const preferredStorage = getPreferredStorage(mode);
    const fallbackStorage = getFallbackStorage(mode);
    const preferredWriteSucceeded = safeSetItem(preferredStorage, key, value);
    if (preferredWriteSucceeded) {
      safeRemoveItem(fallbackStorage, key);
      recordOdaraAuthTrace({
        decision: 'set',
        reason: 'supabase_storage_set_item',
        source: 'storage',
        storageBackendUsed: preferredBackend,
        storageKeyName: key,
        storageOperation: 'setItem',
        storageOutcome: 'preferred_set',
      });
      return;
    }

    const fallbackWriteSucceeded = safeSetItem(fallbackStorage, key, value);
    recordOdaraAuthTrace({
      decision: fallbackWriteSucceeded ? 'set_fallback' : 'set_failed',
      reason: fallbackWriteSucceeded
        ? 'supabase_storage_set_item_fallback_after_preferred_write_failed'
        : 'supabase_storage_set_item_failed',
      source: 'storage',
      storageBackendUsed: fallbackWriteSucceeded ? fallbackBackend : 'none',
      storageKeyName: key,
      storageOperation: 'setItem',
      storageOutcome: fallbackWriteSucceeded ? 'fallback_set' : 'set_failed',
    });
  },
  removeItem(key: string) {
    safeRemoveItem(getLocalStorage(), key);
    safeRemoveItem(getSessionStorage(), key);
    recordOdaraAuthTrace({
      decision: 'removed',
      reason: 'supabase_storage_remove_item',
      source: 'storage',
      storageBackendUsed: 'both',
      storageKeyName: key,
      storageOperation: 'removeItem',
      storageOutcome: 'removed_both',
    });
  },
};
