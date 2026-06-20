export type MissingScentDesiredStatus = 'owned' | 'wishlist' | 'tried' | 'liked';

export const DEFAULT_MISSING_SCENT_DESIRED_STATUS: MissingScentDesiredStatus = 'owned';

export const MISSING_SCENT_DESIRED_STATUS_OPTIONS: Array<{
  value: MissingScentDesiredStatus;
  label: string;
}> = [
  { value: 'owned', label: 'Collection' },
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'tried', label: 'Tried' },
  { value: 'liked', label: 'Liked' },
];

const VALID_MISSING_SCENT_DESIRED_STATUSES = new Set<MissingScentDesiredStatus>([
  'owned',
  'wishlist',
  'tried',
  'liked',
]);

function normalizeStatusKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeMissingScentDesiredStatus(value: unknown): MissingScentDesiredStatus {
  const status = normalizeStatusKey(value);
  return VALID_MISSING_SCENT_DESIRED_STATUSES.has(status as MissingScentDesiredStatus)
    ? status as MissingScentDesiredStatus
    : DEFAULT_MISSING_SCENT_DESIRED_STATUS;
}

export function getMissingScentDesiredStatusLabel(status: MissingScentDesiredStatus) {
  if (status === 'owned') return 'Collection';
  if (status === 'tried') return 'Tried';
  if (status === 'liked') return 'Liked';
  return 'Wishlist';
}

export function shouldAutoApplyWishlistForMatchedIntake(input: {
  desiredStatus: MissingScentDesiredStatus;
  isResolved: boolean;
  canonicalFragranceId?: string | null;
  alreadyOwned?: boolean;
  alreadyWishlisted?: boolean;
}) {
  return input.desiredStatus === 'wishlist'
    && input.isResolved
    && Boolean(input.canonicalFragranceId)
    && !input.alreadyOwned
    && !input.alreadyWishlisted;
}

export function shouldAutoApplyCollectionForMatchedIntake(input: {
  desiredStatus: MissingScentDesiredStatus;
  isResolved: boolean;
  canonicalFragranceId?: string | null;
  alreadyOwned?: boolean;
}) {
  return input.desiredStatus === 'owned'
    && input.isResolved
    && Boolean(input.canonicalFragranceId)
    && !input.alreadyOwned;
}
