import { motion } from "framer-motion";

export type LayerMood = 'balance' | 'bold' | 'smooth' | 'wild';
export const LAYER_MOODS: LayerMood[] = ['balance', 'bold', 'smooth', 'wild'];

export type InteractionType = 'amplify' | 'balance' | 'contrast';

export interface LayerModeEntry {
  id: string;
  name: string;
  brand: string | null;
  family_key: string;
  notes: string[] | null;
  accords: string[] | null;
  interactionType: InteractionType;
}

export type LayerModes = Record<LayerMood, LayerModeEntry | null>;

interface ModeSelectorProps {
  layerModes: LayerModes;
  selectedMood: LayerMood;
  onSelectMood: (mood: LayerMood) => void;
  familyColors: Record<string, string>;
}

/**
 * ModeSelector — a pure selector row.
 * It does NOT own card color, family token text, or fragrance name.
 * It ONLY changes which layer fragrance is active via onSelectMood.
 */
const ModeSelector = ({ layerModes, selectedMood, onSelectMood, familyColors }: ModeSelectorProps) => {
  return (
    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
      {LAYER_MOODS.map((mood) => {
        const mEntry = layerModes[mood];
        if (!mEntry) return null;
        const mColor = familyColors[mEntry.family_key] ?? '#888';
        return (
          <button
            key={mood}
            onClick={() => onSelectMood(mood)}
            className={`text-[9px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-full transition-all duration-200 ${
              selectedMood === mood
                ? "text-white"
                : "text-white/40 hover:text-white/70"
            }`}
            style={selectedMood === mood ? {
              background: `${mColor}33`,
              boxShadow: `inset 0 0 0 1px ${mColor}66`,
            } : undefined}
          >
            {mood}
          </button>
        );
      })}
    </div>
  );
};

export default ModeSelector;
