import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, './OdaraScreen.tsx'), 'utf8');

describe('OdaraScreen collection sort controls', () => {
  it('uses the shared collection sorter for the visible wardrobe list', () => {
    expect(source).toContain('sortCollectionItems(cards');
    expect(source).toContain("wardrobeSortKey ?? 'name'");
    expect(source).toContain('statusRank: getWardrobeStatusRank(card.primary_status)');
    expect(source).toContain('addedAt: card.sort_newest_at');
    expect(source).toContain('lastWornAt: card.last_worn_at');
    expect(source).toContain('rating: card.rating');
    expect(source).toContain('favorite: card.favorite');
  });

  it('offers real sort types only when backing data exists', () => {
    expect(source).toContain("{ value: 'name', defaultDirection: 'asc' }");
    expect(source).toContain("{ value: 'brand', defaultDirection: 'asc' }");
    expect(source).toContain("{ value: 'newest', defaultDirection: 'desc' }");
    expect(source).toContain("{ value: 'status', defaultDirection: 'asc' }");
    expect(source).toContain("{ value: 'last_worn', defaultDirection: 'desc' }");
    expect(source).toContain("{ value: 'rating', defaultDirection: 'desc' }");
    expect(source).toContain("{ value: 'favorite', defaultDirection: 'desc' }");
    expect(source).toContain("if (option.value === 'last_worn') return wardrobeHasLastWornData;");
    expect(source).toContain("if (option.value === 'rating') return wardrobeHasRatingData;");
    expect(source).toContain("if (option.value === 'favorite') return wardrobeHasFavoriteData;");
  });

  it('has a separate mobile-safe reverse button instead of overloading active sort selection', () => {
    expect(source).toContain('aria-label="Reverse collection sort order"');
    expect(source).toContain('toggleCollectionSortDirection(current)');
    expect(source).toContain('event.preventDefault();');
    expect(source).toContain('event.stopPropagation();');
    expect(source).toContain('Reset to Name A-Z');
  });

  it('keeps mobile filter/sort dropdowns above the outside-close overlay', () => {
    expect(source).toContain('overflow-visible px-0.5 pb-0.5');
    expect(source).toContain("wardrobeMenu === 'filter' ? 'z-[90]' : 'z-[1]'");
    expect(source).toContain("wardrobeMenu === 'sort' ? 'z-[90]' : 'z-[1]'");
    expect(source).toContain('className="fixed inset-0 z-[60] cursor-default"');
  });
});
