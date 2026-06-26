import { ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION } from './vesperResolverCompleteness';

export type VesperResolverSurfaceFields = {
  vesper_intelligence?: unknown;
  vesper_metadata?: unknown;
  vesper_metadata_applied?: unknown;
  vesper_community_evidence?: unknown;
  vesper_community_evidence_checked?: unknown;
  vesper_resolver_cache_version?: unknown;
};

export function hasCurrentVesperResolverSurfaceFields(
  fields: VesperResolverSurfaceFields | null | undefined,
) {
  return Boolean(
    fields
    && fields.vesper_community_evidence_checked === true
    && fields.vesper_resolver_cache_version === ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION,
  );
}

export function mergeVesperResolverSurfaceFields(
  current: VesperResolverSurfaceFields | null | undefined,
  incoming: VesperResolverSurfaceFields | null | undefined,
) {
  if (hasCurrentVesperResolverSurfaceFields(incoming)) {
    return {
      vesper_intelligence: incoming?.vesper_intelligence ?? null,
      vesper_metadata: incoming?.vesper_metadata ?? null,
      vesper_metadata_applied: incoming?.vesper_metadata_applied ?? null,
      vesper_community_evidence: incoming?.vesper_community_evidence ?? null,
      vesper_community_evidence_checked: true,
      vesper_resolver_cache_version: incoming?.vesper_resolver_cache_version ?? null,
    };
  }

  return {
    vesper_intelligence: current?.vesper_intelligence ?? incoming?.vesper_intelligence ?? null,
    vesper_metadata: current?.vesper_metadata ?? incoming?.vesper_metadata ?? null,
    vesper_metadata_applied: current?.vesper_metadata_applied ?? incoming?.vesper_metadata_applied ?? null,
    vesper_community_evidence: current?.vesper_community_evidence ?? incoming?.vesper_community_evidence ?? null,
    vesper_community_evidence_checked: current?.vesper_community_evidence_checked ?? incoming?.vesper_community_evidence_checked ?? null,
    vesper_resolver_cache_version: current?.vesper_resolver_cache_version ?? incoming?.vesper_resolver_cache_version ?? null,
  };
}
