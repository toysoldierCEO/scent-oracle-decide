export interface LayerModeCompanionEntry {
  layer_fragrance_id?: string | null;
}

export interface CollectSameCardModeCompanionExclusionIdsParams<Mood extends string> {
  slotPrefix: string;
  fragranceId: string;
  targetMood: Mood;
  moodOrder: readonly Mood[];
  buildMoodLaneKey: (slotPrefix: string, fragranceId: string, mood: Mood) => string;
  readMoodLaneStack: (moodKey: string) => readonly LayerModeCompanionEntry[];
  extraExcludeIds?: readonly string[];
}

export function collectSameCardModeCompanionExclusionIds<Mood extends string>({
  slotPrefix,
  fragranceId,
  targetMood,
  moodOrder,
  buildMoodLaneKey,
  readMoodLaneStack,
  extraExcludeIds = [],
}: CollectSameCardModeCompanionExclusionIdsParams<Mood>): string[] {
  const excludeIds = new Set<string>();

  for (const extraId of extraExcludeIds) {
    if (extraId) excludeIds.add(extraId);
  }

  for (const laneMood of moodOrder) {
    if (laneMood === targetMood) continue;

    const laneKey = buildMoodLaneKey(slotPrefix, fragranceId, laneMood);
    for (const entry of readMoodLaneStack(laneKey)) {
      const companionId = entry?.layer_fragrance_id?.trim();
      if (companionId) excludeIds.add(companionId);
    }
  }

  return Array.from(excludeIds);
}
