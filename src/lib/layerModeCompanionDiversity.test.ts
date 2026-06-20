import { describe, expect, it } from 'vitest';

import { collectSameCardModeCompanionExclusionIds } from './layerModeCompanionDiversity';

const modeOrder = ['balance', 'bold', 'smooth', 'wild'] as const;
type TestMood = (typeof modeOrder)[number];

function key(slotPrefix: string, fragranceId: string, mood: TestMood) {
  return `${slotPrefix}|${fragranceId}|${mood}`;
}

describe('layerModeCompanionDiversity', () => {
  it('excludes loaded Balance companion when fetching Bold for the same card', () => {
    const stacks = new Map([
      [key('2026-06-20|rain', 'anchor-1', 'balance'), [{ layer_fragrance_id: 'into-the-woods' }]],
    ]);

    expect(collectSameCardModeCompanionExclusionIds({
      slotPrefix: '2026-06-20|rain',
      fragranceId: 'anchor-1',
      targetMood: 'bold',
      moodOrder: modeOrder,
      buildMoodLaneKey: key,
      readMoodLaneStack: (laneKey) => stacks.get(laneKey) ?? [],
    })).toEqual(['into-the-woods']);
  });

  it('excludes loaded Bold companion when fetching Balance or Smooth for the same card', () => {
    const stacks = new Map([
      [key('2026-06-20|rain', 'anchor-1', 'bold'), [{ layer_fragrance_id: 'dark-pleasure' }]],
    ]);

    const params = {
      slotPrefix: '2026-06-20|rain',
      fragranceId: 'anchor-1',
      moodOrder: modeOrder,
      buildMoodLaneKey: key,
      readMoodLaneStack: (laneKey: string) => stacks.get(laneKey) ?? [],
    };

    expect(collectSameCardModeCompanionExclusionIds({
      ...params,
      targetMood: 'balance',
    })).toEqual(['dark-pleasure']);

    expect(collectSameCardModeCompanionExclusionIds({
      ...params,
      targetMood: 'smooth',
    })).toEqual(['dark-pleasure']);
  });

  it('keeps queued or promoted card exclusions scoped to that anchor instead of the hero card', () => {
    const stacks = new Map([
      [key('2026-06-20|rain', 'hero-anchor', 'balance'), [{ layer_fragrance_id: 'hero-balance' }]],
      [key('2026-06-20|rain', 'promoted-anchor', 'balance'), [{ layer_fragrance_id: 'promoted-balance' }]],
    ]);

    expect(collectSameCardModeCompanionExclusionIds({
      slotPrefix: '2026-06-20|rain',
      fragranceId: 'promoted-anchor',
      targetMood: 'bold',
      moodOrder: modeOrder,
      buildMoodLaneKey: key,
      readMoodLaneStack: (laneKey) => stacks.get(laneKey) ?? [],
    })).toEqual(['promoted-balance']);
  });

  it('does not include the target lane companion unless explicitly provided for lane-depth retries', () => {
    const stacks = new Map([
      [key('2026-06-20|rain', 'anchor-1', 'balance'), [{ layer_fragrance_id: 'balance-current' }]],
      [key('2026-06-20|rain', 'anchor-1', 'bold'), [{ layer_fragrance_id: 'bold-current' }]],
    ]);

    expect(collectSameCardModeCompanionExclusionIds({
      slotPrefix: '2026-06-20|rain',
      fragranceId: 'anchor-1',
      targetMood: 'bold',
      moodOrder: modeOrder,
      buildMoodLaneKey: key,
      readMoodLaneStack: (laneKey) => stacks.get(laneKey) ?? [],
      extraExcludeIds: ['retry-target-lane-current'],
    })).toEqual(['retry-target-lane-current', 'balance-current']);
  });

  it('keeps guest and Wild behavior opt-in by only returning ids for lanes the caller reads', () => {
    expect(collectSameCardModeCompanionExclusionIds({
      slotPrefix: '2026-06-20|rain',
      fragranceId: 'anchor-1',
      targetMood: 'wild',
      moodOrder: modeOrder,
      buildMoodLaneKey: key,
      readMoodLaneStack: () => [],
    })).toEqual([]);
  });
});
