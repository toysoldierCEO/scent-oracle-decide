type ResolverCompletenessDetail = {
  vesper_intelligence?: unknown;
  vesper_metadata?: unknown;
  vesper_community_evidence?: unknown;
} | null | undefined;

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
    && hasOwnField(detail, 'vesper_community_evidence');
}
