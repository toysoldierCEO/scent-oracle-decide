export type LayerMood = 'balance' | 'bold' | 'smooth' | 'wild';

/**
 * Fixed constant — the rail ALWAYS renders exactly these 4 chips in this order.
 * Never derive rendered chips from payload keys or loaded state.
 */
export const LAYER_MODE_ORDER = ['balance', 'bold', 'smooth', 'wild'] as const;
export const LAYER_MOODS: LayerMood[] = [...LAYER_MODE_ORDER];

export type InteractionType = 'amplify' | 'balance' | 'contrast';

export interface LayerModeEntry {
  id: string;
  name: string;
  brand: string | null;
  family_key: string;
  notes: string[] | null;
  accords: string[] | null;
  interactionType: InteractionType;
  reason: string;
  why_it_works: string;
  projection: number | null;
  ratio_hint?: string;
  application_style?: string;
  placement_hint?: string;
  spray_guidance?: string;
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
}: ModeSelectorProps) => {
  return (
    <div
      className="grid grid-cols-4 gap-1.5 w-full"
      onClick={(e) => e.stopPropagation()}
    >
      {LAYER_MODE_ORDER.map((mood) => {
        const mEntry = layerModes[mood];
        const isSelected = selectedMood === mood;
        const isLoading = loadingMood === mood;
        const hasData = !!mEntry;
        const isLocked = locked;

        // Color: use entry color if available, fallback for unloaded
        const mColor = hasData ? (familyColors[mEntry.family_key] ?? '#888') : '#888';

        return (
          <button
            key={mood}
            type="button"
            aria-disabled={isLocked || undefined}
            disabled={isLocked && !consumeLockedTap}
            data-mode-chip
            onClick={(e) => {
              e.stopPropagation();
              if (!isLocked) onSelectMood(mood);
            }}
            className={`text-[9px] uppercase tracking-[0.12em] py-1 rounded-full transition-all duration-200 text-center ${
              isLocked && !isSelected ? 'opacity-30 cursor-default' : ''
            } ${
              !hasData && !isSelected ? 'opacity-40 cursor-default' : ''
            } ${
              isSelected
                ? "text-white"
                : "text-white/40 hover:text-white/70"
            }`}
            style={{
              ...(isSelected ? {
                background: `${mColor}33`,
                boxShadow: `inset 0 0 0 1px ${mColor}66`,
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
  );
};

export default ModeSelector;
