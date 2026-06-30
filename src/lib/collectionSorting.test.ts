import { describe, expect, it } from 'vitest';

import {
  getCollectionSortLabel,
  sortCollectionItems,
  toggleCollectionSortDirection,
  type CollectionSortDirection,
  type CollectionSortKey,
  type CollectionSortableItem,
} from './collectionSorting';

const fixtures: CollectionSortableItem[] = [
  {
    id: 'sienna',
    name: 'Sienna Brume',
    brand: 'Mihan Aromatics',
    status: 'owned',
    statusRank: 0,
    addedAt: 300,
    lastWornAt: 50,
    rating: 1,
    favorite: false,
  },
  {
    id: 'oud',
    name: 'Miraculous Oud',
    brand: 'Alexandria Fragrances',
    status: 'owned',
    statusRank: 0,
    addedAt: 200,
    lastWornAt: 100,
    rating: 2,
    favorite: true,
  },
  {
    id: 'not-for-sale',
    name: 'Not For Sale',
    brand: 'Alexandria Fragrances',
    status: 'wishlist',
    statusRank: 1,
    addedAt: 400,
    lastWornAt: null,
    rating: null,
    favorite: false,
  },
  {
    id: 'brandless',
    name: 'A Quiet Thing',
    brand: null,
    status: 'liked',
    statusRank: 3,
    addedAt: 100,
    lastWornAt: 25,
    rating: null,
    favorite: false,
  },
];

const sortIds = (
  sortKey: CollectionSortKey,
  direction: CollectionSortDirection,
  items = fixtures,
) => sortCollectionItems(items, sortKey, direction, (item) => item).map((item) => item.id);

describe('collectionSorting', () => {
  it('sorts by name in both directions with a stable fallback', () => {
    expect(sortIds('name', 'asc')).toEqual(['brandless', 'oud', 'not-for-sale', 'sienna']);
    expect(sortIds('name', 'desc')).toEqual(['sienna', 'not-for-sale', 'oud', 'brandless']);
  });

  it('sorts by brand and keeps unknown brands last', () => {
    expect(sortIds('brand', 'asc')).toEqual(['oud', 'not-for-sale', 'sienna', 'brandless']);
    expect(sortIds('brand', 'desc')).toEqual(['sienna', 'oud', 'not-for-sale', 'brandless']);
  });

  it('sorts by recently added newest/oldest', () => {
    expect(sortIds('newest', 'desc')).toEqual(['not-for-sale', 'sienna', 'oud', 'brandless']);
    expect(sortIds('newest', 'asc')).toEqual(['brandless', 'oud', 'sienna', 'not-for-sale']);
  });

  it('sorts by stable status order instead of random status strings', () => {
    expect(sortIds('status', 'asc')).toEqual(['oud', 'sienna', 'not-for-sale', 'brandless']);
    expect(sortIds('status', 'desc')).toEqual(['brandless', 'not-for-sale', 'oud', 'sienna']);
  });

  it('sorts last worn with unworn/null values last in either direction', () => {
    expect(sortIds('last_worn', 'desc')).toEqual(['oud', 'sienna', 'brandless', 'not-for-sale']);
    expect(sortIds('last_worn', 'asc')).toEqual(['brandless', 'sienna', 'oud', 'not-for-sale']);
  });

  it('sorts rating and favorite only when callers provide real fields', () => {
    expect(sortIds('rating', 'desc')).toEqual(['oud', 'sienna', 'brandless', 'not-for-sale']);
    expect(sortIds('rating', 'asc')).toEqual(['sienna', 'oud', 'brandless', 'not-for-sale']);
    expect(sortIds('favorite', 'desc')).toEqual(['oud', 'brandless', 'not-for-sale', 'sienna']);
    expect(sortIds('favorite', 'asc')).toEqual(['brandless', 'not-for-sale', 'sienna', 'oud']);
  });

  it('preserves selected sort when callers filter/search first', () => {
    const alexandria = fixtures.filter((item) => item.brand === 'Alexandria Fragrances');
    expect(sortIds('name', 'desc', alexandria)).toEqual(['not-for-sale', 'oud']);
    expect(sortIds('brand', 'asc', alexandria)).toEqual(['oud', 'not-for-sale']);
  });

  it('exposes clear labels and an explicit reverse toggle', () => {
    expect(getCollectionSortLabel('name', 'asc')).toBe('Name A-Z');
    expect(getCollectionSortLabel('brand', 'desc')).toBe('Brand Z-A');
    expect(getCollectionSortLabel('newest', 'desc')).toBe('Newest to Oldest');
    expect(toggleCollectionSortDirection('asc')).toBe('desc');
    expect(toggleCollectionSortDirection('desc')).toBe('asc');
  });
});
