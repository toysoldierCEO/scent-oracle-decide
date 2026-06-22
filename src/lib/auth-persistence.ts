export type VesperAuthPersistenceMode = 'local' | 'session';

export const VESPER_AUTH_PERSISTENCE_MODE_KEY = 'vesper_auth_persistence_mode';

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

function safeGetItem(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(storage: Storage | null, key: string, value: string) {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore storage failures */
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

export function primeVesperAuthPersistence(rememberMe: boolean, storageKey: string) {
  const mode: VesperAuthPersistenceMode = rememberMe ? 'local' : 'session';
  writeVesperAuthPersistenceMode(mode);
}

export const vesperAuthStorage = {
  getItem(key: string): string | null {
    const mode = readVesperAuthPersistenceMode();
    const preferredValue = safeGetItem(getPreferredStorage(mode), key);
    if (preferredValue !== null) return preferredValue;
    return safeGetItem(getFallbackStorage(mode), key);
  },
  setItem(key: string, value: string) {
    const mode = readVesperAuthPersistenceMode();
    safeSetItem(getPreferredStorage(mode), key, value);
    safeRemoveItem(getFallbackStorage(mode), key);
  },
  removeItem(key: string) {
    safeRemoveItem(getLocalStorage(), key);
    safeRemoveItem(getSessionStorage(), key);
  },
};
