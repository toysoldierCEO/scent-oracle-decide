import { describe, expect, it } from 'vitest';

import { SPRAY_PLACEMENT_COORDINATES, SPRAY_PLACEMENT_KEYS } from './sprayPlacementCoordinates';

describe('spray placement coordinates', () => {
  it('defines every supported placement key', () => {
    expect(Object.keys(SPRAY_PLACEMENT_COORDINATES).sort()).toEqual([...SPRAY_PLACEMENT_KEYS].sort());
  });

  it('keeps all body-map coordinates normalized', () => {
    for (const key of SPRAY_PLACEMENT_KEYS) {
      const coordinate = SPRAY_PLACEMENT_COORDINATES[key];
      expect(['front', 'back']).toContain(coordinate.side);
      expect(coordinate.x).toBeGreaterThanOrEqual(0);
      expect(coordinate.x).toBeLessThanOrEqual(1);
      expect(coordinate.y).toBeGreaterThanOrEqual(0);
      expect(coordinate.y).toBeLessThanOrEqual(1);
      expect(coordinate.label.length).toBeGreaterThan(0);
    }
  });
});
