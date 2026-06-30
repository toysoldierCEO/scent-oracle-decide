export type LayerMood = 'balance' | 'bold' | 'smooth' | 'wild';

/**
 * Fixed constant — the rail ALWAYS renders exactly these 4 chips in this order.
 * Never derive rendered chips from payload keys or loaded state.
 */
export const LAYER_MODE_ORDER = ['balance', 'bold', 'smooth', 'wild'] as const;
export const LAYER_MOODS: LayerMood[] = [...LAYER_MODE_ORDER];

export type InteractionType = 'amplify' | 'balance' | 'contrast';

export interface SprayPattern {
  key: string;
  name: string;
  placement: string;
  anchor_placement_text?: string | null;
  layer_placement_text?: string | null;
  halo?: string | null;
  trail?: string | null;
  why_it_works: string;
  anchor_sprays?: number | null;
  layer_sprays?: number | null;
  spray_ratio?: string | null;
  is_layer_allowed?: boolean;
}

export interface LayerModeEntry {
  id: string;
  name: string;
  brand: string | null;
  family_key: string;
  image_url?: string | null;
  notes: string[] | null;
  accords: string[] | null;
  top_notes?: string[] | null;
  middle_notes?: string[] | null;
  base_notes?: string[] | null;
  interactionType: InteractionType;
  reason: string;
  why_it_works: string;
  layer_score?: number | null;
  projection: number | null;
  ratio_hint?: string;
  application_style?: string;
  placement_hint?: string;
  spray_guidance?: string;
  spray_pattern?: SprayPattern | null;
  spray_pattern_key?: string | null;
  spray_pattern_name?: string | null;
  halo?: string | null;
  trail?: string | null;
  anchor_sprays?: number | null;
  layer_sprays?: number | null;
  spray_map?: unknown;
  zone_spray_map?: unknown;
}

export type LayerModes = Record<LayerMood, LayerModeEntry | null>;

interface ModeSelectorProps {
  layerModes: LayerModes;
  selectedMood: LayerMood;
  onSelectMood: (mood: LayerMood) => void;
  familyColors: Record<string, string>;
  lockPulse?: boolean;
  locked?: boolean;
  loadingMood?: LayerMood | null;
  consumeLockedTap?: boolean;
  disabledMoodReasons?: Partial<Record<LayerMood, string>>;
}

/**
 * ModeSelector — a pure selector row.
 * HARD INVARIANT: always renders exactly 4 chips in fixed order.
 * Chips are never removed, filtered, or reordered.
 */
const ModeSelector = ({
  layerModes,
  selectedMood,
  onSelectMood,
  familyColors,
  lockPulse = false,
  locked = false,
  loadingMood = null,
  consumeLockedTap = false,
  disabledMoodReasons,
}: ModeSelectorProps) => {
  const selectedDisabledReason = disabledMoodReasons?.[selectedMood]?.trim() ?? null;
  const sharedEditableMoodReason = (['balance', 'bold', 'smooth'] as const)
    .map((mood) => disabledMoodReasons?.[mood]?.trim())
    .find(Boolean) ?? null;
  const disabledMoodNote = sharedEditableMoodReason || selectedDisabledReason;

  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-4 gap-1.5 w-full">
        {LAYER_MODE_ORDER.map((mood) => {
          const mEntry = layerModes[mood];
          const isSelected = selectedMood === mood;
          const isLoading = loadingMood === mood;
          const hasData = !!mEntry;
          const disabledReason = disabledMoodReasons?.[mood]?.trim() ?? null;
          const isLocked = locked || !!disabledReason;
          const isUnavailable = isLocked || !hasData;

          // Color: use entry color if available, fallback for unloaded
          const mColor = hasData ? (familyColors[mEntry.family_key] ?? '#888') : '#888';

          return (
            <button
              key={mood}
              type="button"
              aria-disabled={isLocked || undefined}
              disabled={isLocked && !consumeLockedTap}
              data-mode-chip
              title={disabledReason ?? undefined}
              onPointerDown={(e) => {
                if (!isLocked) return;
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!isLocked) onSelectMood(mood);
              }}
              className={`flex items-center justify-center text-[9px] uppercase tracking-[0.14em] h-6 px-3 rounded-full transition-all duration-200 text-center ${
                isUnavailable ? 'cursor-default' : ''
              } ${
                isSelected
                  ? (isLocked ? 'text-white/68 opacity-80' : 'text-white')
                  : (isLocked
                    ? 'text-white/30 opacity-55'
                    : !hasData
                      ? 'text-white/40 opacity-40'
                      : 'text-white/40 hover:text-white/70')
              }`}
              style={{
                ...(isSelected ? {
                  background: isLocked ? `${mColor}16` : `${mColor}33`,
                  boxShadow: `inset 0 0 0 1px ${isLocked ? `${mColor}33` : `${mColor}66`}`,
                  animation: lockPulse ? 'lockConfirmTint 300ms ease-out forwards' : undefined,
                } : undefined),
              }}
            >
              {isLoading ? (
                <span className="inline-block w-3 h-3 border border-white/40 border-t-white/80 rounded-full animate-spin" />
              ) : mood}
            </button>
          );
        })}
      </div>
      {disabledMoodNote && (
        <p className="px-1 text-left text-[10px] text-white/38">
          {disabledMoodNote}
        </p>
      )}
    </div>
  );
};

export default ModeSelector;
