/**
 * @deprecated DO NOT USE — Guest mode now renders strictly from the backend
 * payload returned by get_guest_oracle_home_v1 (today_pick, layer, alternates,
 * layer_modes, layer_mode_order, ui_default_mode, hero_tokens, layer_tokens,
 * accord_tokens). This file is retained only to avoid breaking historical
 * imports during cleanup; nothing in the guest render path consumes it
 * anymore. Do NOT reintroduce frontend curation of guest content.
 */

export type GuestStyleKey =
  | 'bright'
  | 'clean'
  | 'woods'
  | 'sweet'
  | 'amber'
  | 'smoke'
  | 'leather';

export interface GuestScent {
  name: string;
  brand: string;
}

export interface GuestStyleEntry {
  hero: GuestScent;
  alternates: GuestScent[];           // exactly 3
  defaultLayer: GuestScent;
  modes: {
    balance: GuestScent;
    bold: GuestScent;
    smooth: GuestScent;
    wild: GuestScent;
  };
}

export const GUEST_CONTENT: Record<GuestStyleKey, GuestStyleEntry> = {
  bright: {
    hero: { name: 'Acqua di Parma Colonia', brand: 'Acqua di Parma' },
    alternates: [
      { name: "Eau d'Hadrien", brand: 'Goutal' },
      { name: 'Eau Sauvage', brand: 'Dior' },
      { name: 'Arancia di Capri', brand: 'Acqua di Parma' },
    ],
    defaultLayer: { name: 'Dior Homme Cologne', brand: 'Dior' },
    modes: {
      balance: { name: 'Dior Homme Cologne', brand: 'Dior' },
      bold:    { name: 'Eau Sauvage', brand: 'Dior' },
      smooth:  { name: 'Arancia di Capri', brand: 'Acqua di Parma' },
      wild:    { name: "Eau d'Hadrien", brand: 'Goutal' },
    },
  },
  clean: {
    hero: { name: "Prada L'Homme", brand: 'Prada' },
    alternates: [
      { name: 'Blanche', brand: 'Byredo' },
      { name: "Infusion d'Iris Cèdre", brand: 'Prada' },
      { name: 'Lazy Sunday Morning', brand: 'Maison Margiela' },
    ],
    defaultLayer: { name: "Prada L'Homme L'Eau", brand: 'Prada' },
    modes: {
      balance: { name: "Prada L'Homme L'Eau", brand: 'Prada' },
      bold:    { name: 'Blanche', brand: 'Byredo' },
      smooth:  { name: "Infusion d'Iris Cèdre", brand: 'Prada' },
      wild:    { name: 'Lazy Sunday Morning', brand: 'Maison Margiela' },
    },
  },
  woods: {
    hero: { name: "Terre d'Hermès", brand: 'Hermès' },
    alternates: [
      { name: 'Sycomore', brand: 'Chanel' },
      { name: 'Tam Dao Eau de Parfum', brand: 'Diptyque' },
      { name: 'Encre Noire', brand: 'Lalique' },
    ],
    defaultLayer: { name: "Terre d'Hermès Eau Intense Vetiver", brand: 'Hermès' },
    modes: {
      balance: { name: "Terre d'Hermès Eau Intense Vetiver", brand: 'Hermès' },
      bold:    { name: 'Encre Noire', brand: 'Lalique' },
      smooth:  { name: 'Tam Dao Eau de Parfum', brand: 'Diptyque' },
      wild:    { name: 'Sycomore', brand: 'Chanel' },
    },
  },
  sweet: {
    hero: { name: 'Angel', brand: 'Mugler' },
    alternates: [
      { name: 'Prada Candy', brand: 'Prada' },
      { name: "Love, Don't Be Shy", brand: 'Kilian' },
      { name: 'La Vie Est Belle', brand: 'Lancôme' },
    ],
    defaultLayer: { name: "Prada Candy L'Eau", brand: 'Prada' },
    modes: {
      balance: { name: "Prada Candy L'Eau", brand: 'Prada' },
      bold:    { name: 'Prada Candy', brand: 'Prada' },
      smooth:  { name: "Love, Don't Be Shy", brand: 'Kilian' },
      wild:    { name: 'La Vie Est Belle', brand: 'Lancôme' },
    },
  },
  amber: {
    hero: { name: 'Grand Soir', brand: 'Maison Francis Kurkdjian' },
    alternates: [
      { name: 'Ambre Sultan', brand: 'Serge Lutens' },
      { name: 'Cèdre Encens', brand: 'Atelier Cologne' },
      { name: 'Ambra Aurea', brand: 'Profumum Roma' },
    ],
    defaultLayer: { name: 'Ambre Nuit', brand: 'Christian Dior' },
    modes: {
      balance: { name: 'Ambre Nuit', brand: 'Christian Dior' },
      bold:    { name: 'Ambre Sultan', brand: 'Serge Lutens' },
      smooth:  { name: 'Cèdre Encens', brand: 'Atelier Cologne' },
      wild:    { name: 'Ambra Aurea', brand: 'Profumum Roma' },
    },
  },
  smoke: {
    hero: { name: 'By the Fireplace', brand: 'Maison Margiela' },
    alternates: [
      { name: 'Tobacco Vanille', brand: 'Tom Ford' },
      { name: 'Cèdre Encens', brand: 'Atelier Cologne' },
      { name: 'Ébène Fumé', brand: 'Tom Ford' },
    ],
    defaultLayer: { name: 'Jazz Club', brand: 'Maison Margiela' },
    modes: {
      balance: { name: 'Jazz Club', brand: 'Maison Margiela' },
      bold:    { name: 'Tobacco Vanille', brand: 'Tom Ford' },
      smooth:  { name: 'Cèdre Encens', brand: 'Atelier Cologne' },
      wild:    { name: 'Ébène Fumé', brand: 'Tom Ford' },
    },
  },
  leather: {
    hero: { name: 'Ombré Leather', brand: 'Tom Ford' },
    alternates: [
      { name: 'Tuscan Leather', brand: 'Tom Ford' },
      { name: 'Irish Leather', brand: 'Memo Paris' },
      { name: 'Cuir de Russie Eau de Parfum', brand: 'Chanel' },
    ],
    defaultLayer: { name: 'Ombré Leather Parfum', brand: 'Tom Ford' },
    modes: {
      balance: { name: 'Ombré Leather Parfum', brand: 'Tom Ford' },
      bold:    { name: 'Tuscan Leather', brand: 'Tom Ford' },
      smooth:  { name: 'Irish Leather', brand: 'Memo Paris' },
      wild:    { name: 'Cuir de Russie Eau de Parfum', brand: 'Chanel' },
    },
  },
};

export function getGuestStyleEntry(styleKey: string | null | undefined): GuestStyleEntry | null {
  if (!styleKey) return null;
  const k = styleKey.toLowerCase() as GuestStyleKey;
  return GUEST_CONTENT[k] ?? null;
}

export const GUEST_LAYER_MOODS = ['balance', 'bold', 'smooth', 'wild'] as const;
export type GuestLayerMood = typeof GUEST_LAYER_MOODS[number];

/**
 * Short, premium "why it works" copy per mood. Used only inside the
 * expanded guest layer view — never on the collapsed face.
 */
export const GUEST_MODE_REASON: Record<GuestLayerMood, string> = {
  balance: 'Holds the world steady. The layer reinforces the hero without competing.',
  bold:    'Pushes the world louder. The layer amplifies presence and projection.',
  smooth:  'Softens the edges. The layer rounds the hero into something quieter.',
  wild:    'Bends the world sideways. The layer adds an unexpected accent.',
};
