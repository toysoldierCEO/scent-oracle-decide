import { ODARA_BUILD_INFO } from './build-info';

export const ODARA_DETAIL_COMMUNITY_EVIDENCE_TRACE_STORAGE_KEY = 'odara_detail_community_evidence_trace_v1';

const MAX_DETAIL_COMMUNITY_EVIDENCE_TRACE_ENTRIES = 80;

export type OdaraDetailCommunityEvidenceTraceEntry = {
  accordCount?: number;
  buildCommit?: string;
  cacheComplete?: boolean;
  cacheHit?: boolean;
  cacheVersion?: string | null;
  collectionPreviewChipCount?: number;
  collectionPreviewCommunityChipCount?: number;
  collectionPreviewFamilyChipCount?: number;
  communityEvidenceChecked?: boolean;
  communityEvidenceMappedCount?: number;
  communityRowsReturnedCount?: number;
  communitySignalsCount?: number;
  decision: string;
  detailOpen?: boolean;
  detailOpenedFromCollection?: boolean;
  detailFetchAttempted?: boolean;
  fragranceId?: string | null;
  fragranceName?: string | null;
  host?: string;
  mappedCount?: number;
  origin?: string;
  path?: string;
  renderedAccordCount?: number;
  renderedCommunitySignalCount?: number;
  renderedTrustLabelCount?: number;
  resolverCacheVersion?: string;
  resolverDisabled?: boolean;
  source: 'detail-cache' | 'detail-fetch' | 'detail-model' | 'detail-render';
  timestamp: string;
  trustLabelCount?: number;
};

declare global {
  interface Window {
    __ODARA_DETAIL_COMMUNITY_EVIDENCE_TRACE__?: OdaraDetailCommunityEvidenceTraceEntry[];
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function safeGetStorageItem(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorageItem(storage: Storage | null, key: string, value: string) {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

export function readPersistedOdaraDetailCommunityEvidenceTrace(): OdaraDetailCommunityEvidenceTraceEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = safeGetStorageItem(getLocalStorage(), ODARA_DETAIL_COMMUNITY_EVIDENCE_TRACE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_DETAIL_COMMUNITY_EVIDENCE_TRACE_ENTRIES) : [];
  } catch {
    return [];
  }
}

function persistDetailCommunityEvidenceTrace(trace: OdaraDetailCommunityEvidenceTraceEntry[]) {
  if (typeof window === 'undefined') return;
  safeSetStorageItem(
    getLocalStorage(),
    ODARA_DETAIL_COMMUNITY_EVIDENCE_TRACE_STORAGE_KEY,
    JSON.stringify(trace.slice(-MAX_DETAIL_COMMUNITY_EVIDENCE_TRACE_ENTRIES)),
  );
}

export function readSafeOdaraDetailCommunityEvidenceTrace(): OdaraDetailCommunityEvidenceTraceEntry[] {
  if (typeof window === 'undefined') return [];
  const trace = window.__ODARA_DETAIL_COMMUNITY_EVIDENCE_TRACE__;
  return Array.isArray(trace)
    ? trace.slice(-40)
    : readPersistedOdaraDetailCommunityEvidenceTrace().slice(-40);
}

export function recordOdaraDetailCommunityEvidenceTrace(
  entry: Omit<OdaraDetailCommunityEvidenceTraceEntry, 'buildCommit' | 'host' | 'origin' | 'path' | 'timestamp'>,
) {
  if (typeof window === 'undefined') return;
  const trace = window.__ODARA_DETAIL_COMMUNITY_EVIDENCE_TRACE__
    ?? readPersistedOdaraDetailCommunityEvidenceTrace();
  const nextEntry: OdaraDetailCommunityEvidenceTraceEntry = {
    buildCommit: ODARA_BUILD_INFO.commit,
    host: window.location.host,
    origin: window.location.origin,
    path: window.location.pathname,
    ...entry,
    timestamp: new Date().toISOString(),
  };
  trace.push(nextEntry);
  if (trace.length > MAX_DETAIL_COMMUNITY_EVIDENCE_TRACE_ENTRIES) {
    trace.splice(0, trace.length - MAX_DETAIL_COMMUNITY_EVIDENCE_TRACE_ENTRIES);
  }
  window.__ODARA_DETAIL_COMMUNITY_EVIDENCE_TRACE__ = trace;
  persistDetailCommunityEvidenceTrace(trace);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.odaraDetailCommunityTraceLength = String(trace.length);
    document.documentElement.dataset.odaraDetailCommunityLastDecision = nextEntry.decision;
    document.documentElement.dataset.odaraDetailCommunityLastSource = nextEntry.source;
    const traceNodeId = 'odara-detail-community-evidence-trace';
    const existing = document.getElementById(traceNodeId);
    const traceNode = existing ?? document.createElement('script');
    traceNode.id = traceNodeId;
    traceNode.setAttribute('type', 'application/json');
    traceNode.textContent = JSON.stringify(trace);
    if (!existing) document.head.appendChild(traceNode);
  }
}
