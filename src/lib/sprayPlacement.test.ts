import { describe, expect, it } from 'vitest';

import { buildPlacementGuide, formatPlacementSummary, parseSprayPlacementText } from './sprayPlacement';

describe('spray placement parser', () => {
  it('parses explicit chest spray counts', () => {
    expect(parseSprayPlacementText('2 sprays chest')).toEqual([
      expect.objectContaining({ location: 'CHEST', count: 2, optional: false }),
    ]);
  });

  it('parses explicit back neck spray counts', () => {
    expect(parseSprayPlacementText('1 spray back neck')).toEqual([
      expect.objectContaining({ location: 'BACK_NECK', count: 1, optional: false }),
    ]);
  });

  it('parses optional wrist without inventing extra locations', () => {
    expect(parseSprayPlacementText('optional wrist')).toEqual([
      expect.objectContaining({ location: 'WRISTS', count: 1, optional: true }),
    ]);
  });

  it('parses current ratio placement rows with fragrance prefixes', () => {
    const placements = parseSprayPlacementText('Dark Pleasure - 2 sprays chest / close to body');

    expect(placements).toEqual([
      expect.objectContaining({ location: 'CHEST', count: 2, optional: false }),
    ]);
  });

  it('parses shirt alternatives as the clothing shirt surface', () => {
    const placements = parseSprayPlacementText('California Winter 2018 - 1 spray back neck, upper shirt, or outer layer');

    expect(placements).toEqual([
      expect.objectContaining({ location: 'SHIRT', count: 1, optional: false }),
    ]);
  });

  it('splits skin and shirt when a two-spray instruction names both surfaces', () => {
    const placements = parseSprayPlacementText('Reflection Man - 2 light sprays back neck and upper shirt');

    expect(placements).toEqual([
      expect.objectContaining({ location: 'BACK_NECK', count: 1, optional: false }),
      expect.objectContaining({ location: 'SHIRT', count: 1, optional: false }),
    ]);
  });

  it('keeps vague text as text-only instead of inventing placements', () => {
    expect(parseSprayPlacementText('close to body')).toEqual([]);
  });

  it('supports the shared placement guide shape', () => {
    const guide = buildPlacementGuide({
      fragrance: 'Tomcat',
      role: 'Anchor',
      familyKey: 'dark-leather',
      colorToken: '#5A3A2E',
      placementText: '1 spray chest • optional wrist',
    });

    expect(guide).toMatchObject({
      fragrance: 'Tomcat',
      role: 'Anchor',
      familyKey: 'dark-leather',
      colorToken: '#5A3A2E',
    });
    expect(formatPlacementSummary(guide.placements)).toBe('1 spray on chest, 1 spray on wrists optional');
  });
});
