import { describe, expect, it } from 'vitest';

import {
  getCanonicalScentIntelDisplayLabel,
  resolveCanonicalScentIntelSlug,
} from './scentIntelChipTerms';

describe('scentIntelChipTerms', () => {
  it('keeps White Musk standalone across exact white/clean musk aliases', () => {
    const whiteMuskAliases = [
      'white musk',
      'white musks',
      'white musk accord',
      'white musk notes',
      'clean musk',
      'clean musks',
      'clean musk accord',
      'clean musk notes',
    ];

    for (const label of whiteMuskAliases) {
      expect(resolveCanonicalScentIntelSlug(label)).toBe('white-musk');
      expect(getCanonicalScentIntelDisplayLabel(label)).toBe('White Musk');
    }
  });

  it('keeps generic musk generic', () => {
    expect(resolveCanonicalScentIntelSlug('musk')).toBe('musk');
    expect(resolveCanonicalScentIntelSlug('musks')).toBe('musk');
  });
});
