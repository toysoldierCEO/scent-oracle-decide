export const LAYERING_UNLOCK_COUNT = 7;

export type LayeringEligibilityInput = {
  fragrance_id?: string | null;
  id?: string | null;
  name?: string | null;
  brand?: string | null;
  family_key?: string | null;
  family?: string | null;
  family_label?: string | null;
  familyLabel?: string | null;
  notes?: string[] | null;
  accords?: string[] | null;
  top_notes?: string[] | null;
  topNotes?: string[] | null;
  heart_notes?: string[] | null;
  middle_notes?: string[] | null;
  middleNotes?: string[] | null;
  base_notes?: string[] | null;
  baseNotes?: string[] | null;
  collection_status?: string | null;
  collectionStatus?: string | null;
  primary_status?: string | null;
  primaryStatus?: string | null;
  owned?: boolean | null;
  is_in_collection?: boolean | null;
  recommendable?: boolean | null;
  wishlist?: boolean | null;
  wishlistOnly?: boolean | null;
  retired?: boolean | null;
  disliked?: boolean | null;
  preference_state?: string | null;
  preferenceState?: string | null;
  negative_state?: number | null;
  negativeState?: number | null;
  unresolved?: boolean | null;
  provisional?: boolean | null;
  vesperizing?: boolean | null;
  request_status?: string | null;
  canonical_fragrance_id?: string | null;
  item?: {
    family_key?: string | null;
    family_label?: string | null;
    notes?: string[] | null;
    accords?: string[] | null;
    top_notes?: string[] | null;
    heart_notes?: string[] | null;
    base_notes?: string[] | null;
  } | null;
};

export type LayeringEligibilityResult = {
  eligibleCount: number;
  isLayeringUnlocked: boolean;
  remainingToUnlock: number;
};

function normalizeWearModeValue(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function hasAnyText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasAnyListValue(value: unknown) {
  return Array.isArray(value) && value.some(hasAnyText);
}

export function hasUsableLayeringProfile(item: LayeringEligibilityInput | null | undefined) {
  if (!item) return false;
  return hasAnyText(item.family_key)
    || hasAnyText(item.family)
    || hasAnyText(item.family_label)
    || hasAnyText(item.familyLabel)
    || hasAnyListValue(item.notes)
    || hasAnyListValue(item.accords)
    || hasAnyListValue(item.top_notes)
    || hasAnyListValue(item.topNotes)
    || hasAnyListValue(item.heart_notes)
    || hasAnyListValue(item.middle_notes)
    || hasAnyListValue(item.middleNotes)
    || hasAnyListValue(item.base_notes)
    || hasAnyListValue(item.baseNotes)
    || hasAnyText(item.item?.family_key)
    || hasAnyText(item.item?.family_label)
    || hasAnyListValue(item.item?.notes)
    || hasAnyListValue(item.item?.accords)
    || hasAnyListValue(item.item?.top_notes)
    || hasAnyListValue(item.item?.heart_notes)
    || hasAnyListValue(item.item?.base_notes);
}

export function isLayerEligibleCollectionItem(item: LayeringEligibilityInput | null | undefined) {
  if (!item) return false;
  const id = item.fragrance_id ?? item.id ?? '';
  if (!hasAnyText(id)) return false;
  if (!hasAnyText(item.name)) return false;

  const status = normalizeWearModeValue(
    item.primary_status ?? item.primaryStatus ?? item.collection_status ?? item.collectionStatus,
  );
  const preference = normalizeWearModeValue(item.preference_state ?? item.preferenceState);
  const requestStatus = normalizeWearModeValue(item.request_status);
  const ownedByStatus = status === 'owned'
    || status === 'collection'
    || status === 'signature'
    || status === 'today pick'
    || status === 'queue';
  const explicitOwned = item.owned === true || item.is_in_collection === true || item.recommendable === true;
  const noStatusProvided = status.length === 0;

  if (!(ownedByStatus || explicitOwned || noStatusProvided)) return false;
  if (status === 'wishlist' || item.wishlist === true || item.wishlistOnly === true) return false;
  if (status === 'retired' || item.retired === true) return false;
  if (status === 'disliked' || preference === 'disliked' || item.disliked === true || item.negative_state === 2 || item.negativeState === 2) return false;
  if (
    item.unresolved === true
    || item.provisional === true
    || item.vesperizing === true
    || (requestStatus.length > 0 && !item.canonical_fragrance_id)
  ) {
    return false;
  }

  return hasUsableLayeringProfile(item);
}

export function resolveLayeringEligibility(
  items: Array<LayeringEligibilityInput | null | undefined> | null | undefined,
): LayeringEligibilityResult {
  const eligibleCount = (items ?? []).filter(isLayerEligibleCollectionItem).length;
  return {
    eligibleCount,
    isLayeringUnlocked: eligibleCount >= LAYERING_UNLOCK_COUNT,
    remainingToUnlock: Math.max(0, LAYERING_UNLOCK_COUNT - eligibleCount),
  };
}

