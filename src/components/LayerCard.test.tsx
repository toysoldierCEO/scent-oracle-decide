import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LayerCard from './LayerCard';
import type { LayerModes } from './ModeSelector';

let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  document.body.innerHTML = '';
});

const balanceLayer = {
  id: 'reflection-man-layer',
  name: 'Reflection Man',
  brand: 'Amouage',
  family_key: 'floral-musk',
  notes: ['Neroli', 'Sandalwood', 'Musk'],
  accords: ['Musk', 'Woods'],
  top_notes: ['Neroli'],
  middle_notes: ['Jasmine'],
  base_notes: ['Sandalwood', 'Musk'],
  interactionType: 'balance' as const,
  reason: 'It softens the anchor with clean musk and a woody bridge.',
  why_it_works: 'Musk and woods connect the anchor to the layer without making the pair too sweet.',
  projection: null,
  anchor_sprays: 2,
  layer_sprays: 1,
};

function renderExpandedLayerCard(overrides: Partial<typeof balanceLayer> = {}) {
  const layer = { ...balanceLayer, ...overrides };
  const layerModes: LayerModes = {
    balance: layer,
    bold: null,
    smooth: null,
    wild: null,
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <LayerCard
        mainName="Dark Pleasure"
        mainBrand="The House"
        mainNotes={['Rose', 'Coffee', 'Patchouli', 'Incense']}
        mainTopNotes={['Rose']}
        mainMiddleNotes={['Coffee']}
        mainBaseNotes={['Patchouli', 'Incense']}
        mainFamily="dark-leather"
        mainProjection={null}
        layerModes={layerModes}
        visibleLayerMode={layer}
        selectedMood="balance"
        onSelectMood={vi.fn()}
        selectedRatio="1:1"
        onSelectRatio={vi.fn()}
        isExpanded
        onToggleExpand={vi.fn()}
      />,
    );
  });

  return container;
}

describe('LayerCard expanded guidance', () => {
  it('renders why, effect, spray guidance, and placement text for expanded layered mode', () => {
    renderExpandedLayerCard();
    const text = document.body.textContent ?? '';

    expect(text).toContain('Why it works');
    expect(text).toContain('Musk and woods connect the anchor');
    expect(text).toContain('Effect');
    expect(text).toContain('softens the anchor with clean musk');
    expect(text).toContain('Spray guidance');
    expect(text).toContain('Start with 2 anchor sprays, then add 1 layer spray.');
    expect(text).toContain('Placement');
    expect(text).toContain('Anchor:');
    expect(text).toContain('Layer:');
  });

  it('uses explicit spray guidance when the layer payload provides it', () => {
    renderExpandedLayerCard({
      spray_guidance: 'Use the anchor close to the chest and keep the layer as a light neck accent.',
    });
    const text = document.body.textContent ?? '';

    expect(text).toContain('Spray guidance');
    expect(text).toContain('keep the layer as a light neck accent');
  });
});
