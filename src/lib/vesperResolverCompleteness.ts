type ResolverCompletenessDetail = {
  vesper_intelligence?: unknown;
  vesper_metadata?: unknown;
  vesper_community_evidence?: unknown;
  vesper_resolver_cache_version?: unknown;
} | null | undefined;

export const ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION = 'community-evidence-v2';

function hasOwnField(detail: NonNullable<ResolverCompletenessDetail>, field: keyof NonNullable<ResolverCompletenessDetail>) {
  return Object.prototype.hasOwnProperty.call(detail, field);
}

export function isVesperResolverDetailCompleteForCache(
  detail: ResolverCompletenessDetail,
  resolverDisabled: boolean,
) {
  return resolverDisabled || !!detail
    && hasOwnField(detail, 'vesper_intelligence')
    && hasOwnField(detail, 'vesper_metadata')
    && hasOwnField(detail, 'vesper_community_evidence')
    && detail.vesper_resolver_cache_version === ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION;
}
