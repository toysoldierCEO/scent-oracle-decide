/**
 * Display-only note normalization.
 * Collapses near-duplicate variants into a single clean parent note.
 * Does NOT modify database data.
 */

const COLLAPSE_MAP: [RegExp, string][] = [
  [/\b(\w+\s+)?cedar\b/i, 'cedar'],
  [/\b(\w+\s+)?bergamot\b/i, 'bergamot'],
  [/\b(\w+\s+)?vanilla\b/i, 'vanilla'],
  [/\b(\w+\s+)?rose\b/i, 'rose'],
  [/\b(\w+\s+)?amber\b/i, 'amber'],
];

function collapseNote(note: string): string {
  const trimmed = note.trim().toLowerCase();
  for (const [pattern, parent] of COLLAPSE_MAP) {
    if (pattern.test(trimmed)) return parent;
  }
  return trimmed;
}

/**
 * Normalize and deduplicate notes for display.
 * @param notes - raw notes array
 * @param max - max notes to return (default 3)
 */
export function normalizeNotes(notes: string[], max = 3): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const note of notes) {
    const collapsed = collapseNote(note);
    if (!seen.has(collapsed)) {
      seen.add(collapsed);
      result.push(collapsed);
    }
    if (result.length >= max) break;
  }
  return result;
}
