export type CollectionSortKey =
  | 'name'
  | 'brand'
  | 'newest'
  | 'status'
  | 'last_worn'
  | 'rating'
  | 'favorite';

export type CollectionSortDirection = 'asc' | 'desc';

export type CollectionSortableItem = {
  id: string;
  name: string | null | undefined;
  brand?: string | null | undefined;
  status?: string | null | undefined;
  statusRank?: number | null | undefined;
  addedAt?: number | null | undefined;
  lastWornAt?: number | null | undefined;
  rating?: number | null | undefined;
  favorite?: boolean | null | undefined;
};

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function normalizeText(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareNullableText(
  left: string | null | undefined,
  right: string | null | undefined,
  direction: CollectionSortDirection,
) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const delta = collator.compare(a, b);
  return direction === 'asc' ? delta : -delta;
}

function compareNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: CollectionSortDirection,
) {
  const a = normalizeNumber(left);
  const b = normalizeNumber(right);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const delta = a - b;
  return direction === 'asc' ? delta : -delta;
}

function compareFavorite(
  left: boolean | null | undefined,
  right: boolean | null | undefined,
  direction: CollectionSortDirection,
) {
  const a = left === true ? 1 : 0;
  const b = right === true ? 1 : 0;
  const delta = a - b;
  return direction === 'asc' ? delta : -delta;
}

function compareStableFallback(left: CollectionSortableItem, right: CollectionSortableItem) {
  return compareNullableText(left.name, right.name, 'asc')
    || compareNullableText(left.brand, right.brand, 'asc')
    || collator.compare(left.id, right.id);
}

export function compareCollectionSortItems(
  left: CollectionSortableItem,
  right: CollectionSortableItem,
  sortKey: CollectionSortKey,
  direction: CollectionSortDirection,
) {
  let primary = 0;

  if (sortKey === 'name') {
    primary = compareNullableText(left.name, right.name, direction);
  } else if (sortKey === 'brand') {
    primary = compareNullableText(left.brand, right.brand, direction);
  } else if (sortKey === 'newest') {
    primary = compareNullableNumber(left.addedAt, right.addedAt, direction);
  } else if (sortKey === 'last_worn') {
    primary = compareNullableNumber(left.lastWornAt, right.lastWornAt, direction);
  } else if (sortKey === 'rating') {
    primary = compareNullableNumber(left.rating, right.rating, direction);
  } else if (sortKey === 'favorite') {
    primary = compareFavorite(left.favorite, right.favorite, direction);
  } else if (sortKey === 'status') {
    primary = compareNullableNumber(left.statusRank, right.statusRank, direction)
      || compareNullableText(left.status, right.status, direction);
  }

  return primary || compareStableFallback(left, right);
}

export function sortCollectionItems<T>(
  items: T[],
  sortKey: CollectionSortKey,
  direction: CollectionSortDirection,
  toSortable: (item: T) => CollectionSortableItem,
) {
  return [...items].sort((left, right) => (
    compareCollectionSortItems(toSortable(left), toSortable(right), sortKey, direction)
  ));
}

export function toggleCollectionSortDirection(direction: CollectionSortDirection): CollectionSortDirection {
  return direction === 'asc' ? 'desc' : 'asc';
}

export function getCollectionSortLabel(
  sortKey: CollectionSortKey | null | undefined,
  direction: CollectionSortDirection,
) {
  if (sortKey === 'name') return direction === 'asc' ? 'Name A-Z' : 'Name Z-A';
  if (sortKey === 'brand') return direction === 'asc' ? 'Brand A-Z' : 'Brand Z-A';
  if (sortKey === 'newest') return direction === 'desc' ? 'Newest to Oldest' : 'Oldest to Newest';
  if (sortKey === 'status') return direction === 'asc' ? 'Status Order' : 'Status Reverse';
  if (sortKey === 'last_worn') return direction === 'desc' ? 'Last Worn' : 'Least Recently Worn';
  if (sortKey === 'rating') return direction === 'desc' ? 'Rating High-Low' : 'Rating Low-High';
  if (sortKey === 'favorite') return direction === 'desc' ? 'Favorites First' : 'Favorites Last';
  return null;
}
