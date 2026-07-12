export const SPRAY_PLACEMENT_KEYS = [
  'CHEST',
  'UPPER_CHEST',
  'NECK',
  'BACK_NECK',
  'LEFT_WRIST',
  'RIGHT_WRIST',
  'WRISTS',
  'INNER_ELBOW',
  'SHIRT',
  'UPPER_SHIRT',
  'OUTER_LAYER',
  'HAIR',
  'BACK_OF_HEAD',
] as const;

export type SprayPlacementLocation = typeof SPRAY_PLACEMENT_KEYS[number];
export type SprayPlacementSide = 'front' | 'back';

export type SprayPlacementCoordinate = {
  side: SprayPlacementSide;
  x: number;
  y: number;
  label: string;
};

export const SPRAY_PLACEMENT_COORDINATES: Record<SprayPlacementLocation, SprayPlacementCoordinate> = {
  CHEST: { side: 'front', x: 0.5, y: 0.43, label: 'chest' },
  UPPER_CHEST: { side: 'front', x: 0.5, y: 0.36, label: 'collarbone' },
  NECK: { side: 'front', x: 0.5, y: 0.25, label: 'neck' },
  BACK_NECK: { side: 'back', x: 0.5, y: 0.25, label: 'back neck' },
  LEFT_WRIST: { side: 'front', x: 0.27, y: 0.72, label: 'left wrist' },
  RIGHT_WRIST: { side: 'front', x: 0.73, y: 0.72, label: 'right wrist' },
  WRISTS: { side: 'front', x: 0.5, y: 0.72, label: 'wrists' },
  INNER_ELBOW: { side: 'front', x: 0.32, y: 0.53, label: 'inner elbow' },
  SHIRT: { side: 'front', x: 0.5, y: 0.43, label: 'shirt' },
  UPPER_SHIRT: { side: 'front', x: 0.5, y: 0.36, label: 'shirt' },
  OUTER_LAYER: { side: 'front', x: 0.5, y: 0.47, label: 'shirt' },
  HAIR: { side: 'back', x: 0.5, y: 0.16, label: 'hair' },
  BACK_OF_HEAD: { side: 'back', x: 0.5, y: 0.18, label: 'back of head' },
};

export function getSprayPlacementCoordinate(location: SprayPlacementLocation) {
  return SPRAY_PLACEMENT_COORDINATES[location];
}
