import { describe, expect, it } from 'vitest';

import {
  buildFragranceSearchBackendQueryVariants,
  matchesFragranceSearchQuery,
  normalizeFragranceSearchText,
  scoreFragranceSearchCandidate,
} from './fragranceSearchNormalization';

describe('fragranceSearchNormalization', () => {
  it('normalizes Mystere symbol and number variants to the same searchable form', () => {
    expect(normalizeFragranceSearchText('Mystere #29')).toBe('mystere 29');
    expect(normalizeFragranceSearchText('Mystere 29')).toBe('mystere 29');
    expect(normalizeFragranceSearchText('Mystere29')).toBe('mystere 29');
    expect(normalizeFragranceSearchText('mystere # 29')).toBe('mystere 29');
  });

  it('matches Mystere #29 from symbol, spaced, compact, and partial queries', () => {
    const values = ['Mystere #29', 'Alexandria Fragrances'];

    expect(matchesFragranceSearchQuery('Mystere #29', values)).toBe(true);
    expect(matchesFragranceSearchQuery('Mystere 29', values)).toBe(true);
    expect(matchesFragranceSearchQuery('Mystere29', values)).toBe(true);
    expect(matchesFragranceSearchQuery('mystere # 29', values)).toBe(true);
    expect(matchesFragranceSearchQuery('mystere', values)).toBe(true);
  });

  it('keeps meaningful numeric fragrance names searchable', () => {
    expect(matchesFragranceSearchQuery('9pm', ['9PM'])).toBe(true);
    expect(matchesFragranceSearchQuery('9 PM', ['9PM'])).toBe(true);
    expect(matchesFragranceSearchQuery('1981 x', ['1981 X'])).toBe(true);
    expect(matchesFragranceSearchQuery('1872', ['1872'])).toBe(true);
    expect(matchesFragranceSearchQuery('212 vip', ['212 VIP'])).toBe(true);
  });

  it('handles No. and hash number variants sanely', () => {
    const values = ['Chanel No. 5'];

    expect(matchesFragranceSearchQuery('No 5', values)).toBe(true);
    expect(matchesFragranceSearchQuery('No. 5', values)).toBe(true);
    expect(matchesFragranceSearchQuery('#5', values)).toBe(true);
  });

  it('does not overmatch unrelated numeric scent suffixes', () => {
    expect(matchesFragranceSearchQuery('Mystere 28', ['Mystere #29'])).toBe(false);
    expect(matchesFragranceSearchQuery('29', ['Mystere #129'])).toBe(false);
    expect(matchesFragranceSearchQuery('212 vip', ['VIP 2121'])).toBe(false);
  });

  it('scores normalized exact symbol matches above partial text matches', () => {
    const exact = scoreFragranceSearchCandidate('Mystere #29', {
      name: 'Mystere #29',
      brand: 'Alexandria Fragrances',
    });
    const partial = scoreFragranceSearchCandidate('Mystere #29', {
      name: 'Mystere Noir',
      brand: 'Alexandria Fragrances',
    });

    expect(exact).toBeGreaterThan(0);
    expect(partial).toBe(0);
    expect(exact).toBeGreaterThan(partial);
  });

  it('builds safe backend variants for symbol-number searches', () => {
    expect(buildFragranceSearchBackendQueryVariants('Mystere #29')).toEqual(['mystere 29', 'mystere']);
    expect(buildFragranceSearchBackendQueryVariants('9PM')).toEqual(['9 pm']);
  });
});
