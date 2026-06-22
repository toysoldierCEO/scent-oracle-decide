import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/OdaraScreen.tsx', 'utf8');

describe('Odara fragrance detail token styles', () => {
  it('does not render scent tokens with outer glow shadows', () => {
    expect(source).not.toContain('boxShadow: `0 0 14px ${tone.glow}`');
    expect(source).not.toContain('boxShadow: `0 0 12px ${tone.glow}`');
    expect(source).not.toContain('boxShadow: `0 0 12px ${familyChipTone.glow}`');
    expect(source).not.toContain('boxShadow: `0 0 14px ${familyChipTone.glow}`');
    expect(source).not.toContain('0 0 12px ${visibleHeroFamilyColor}20');
    expect(source).toContain("boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'");
  });

  it('keeps semantic token colors while flattening the visual treatment', () => {
    expect(source).toContain('color: tone.color');
    expect(source).toContain('border: `1px solid ${tone.border}`');
    expect(source).toContain('background: tone.background');
    expect(source).toContain('color: familyChipTone.color');
    expect(source).toContain('background: familyChipTone.background');
  });
});
