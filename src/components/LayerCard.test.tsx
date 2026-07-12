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

type TestLayerMode = NonNullable<LayerModes['balance']>;

const balanceLayer: TestLayerMode = {
  id: 'reflection-man-layer',
  name: 'Reflection Man',
  brand: 'Amouage',
  family_key: 'floral-musk',
  notes: ['Neroli', 'Sandalwood', 'Musk'],
  accords: ['Musk', 'Woods'],
  top_notes: ['Neroli'],
  middle_notes: ['Jasmine'],
  base_notes: ['Sandalwood', 'Musk'],
  interactionType: 'balance',
  reason: 'It softens the anchor with clean musk and a woody bridge.',
  why_it_works: 'Musk and woods connect the anchor to the layer without making the pair too sweet.',
  projection: null,
  anchor_sprays: 2,
  layer_sprays: 1,
};

function renderExpandedLayerCard(overrides: Partial<TestLayerMode> = {}) {
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
  it('renders compressed ratio, placement maps, air text, and feedback menu', () => {
    renderExpandedLayerCard();
    const text = document.body.textContent ?? '';

    expect(text).toContain('Layered');
    expect(text).toContain('Ratio');
    expect(document.querySelector('[data-layer-ratio-visual]')?.getAttribute('aria-label')).toContain('1 Dark Pleasure : 2 Reflection Man');
    expect(document.querySelector('[data-layer-ratio-item="anchor"]')?.textContent).toContain('Dark Pleasure');
    expect(document.querySelector('[data-layer-ratio-item="anchor"]')?.textContent).toContain('x1');
    expect(document.querySelector('[data-layer-ratio-item="layer"]')?.textContent).toContain('Reflection Man');
    expect(document.querySelector('[data-layer-ratio-item="layer"]')?.textContent).toContain('x2');
    expect(text).toContain('Placement');
    expect(text).toContain('What happens in the air');
    expect(text).toContain('Dark Pleasure gives the blend its dark, textured body');
    expect(text).toContain('Reflection Man smooths the blend');
    expect(text).toContain('In the air');
    expect(text).not.toContain('Effect');
    expect(text).not.toContain('Why this ratio');
    expect(text).not.toContain('Spray guidance');
    expect(text).not.toContain('Anchor:');
    expect(text).not.toContain('Layer:');
    expect(text).not.toContain('Dark Pleasure - 1 spray chest / close to body');
    expect(text).not.toContain('Reflection Man - 2 light sprays back neck and upper shirt');

    const placementMaps = document.querySelectorAll('[data-spray-placement-map]');
    expect(placementMaps).toHaveLength(2);
    expect(document.querySelector('[data-spray-placement-role="Anchor"] [data-location="CHEST"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-spray-placement-role="Layer"] [data-location="BACK_NECK"]')).toHaveLength(2);
    expect(document.querySelector('[data-layer-feedback-button]')?.getAttribute('aria-label')).toBe('More options for this pairing');
  });

  it('opens and closes the pairing feedback popover without persistence', () => {
    renderExpandedLayerCard({
      spray_guidance: 'Use the anchor close to the chest and keep the layer as a light neck accent.',
    });
    const button = document.querySelector('[data-layer-feedback-button]') as HTMLButtonElement;

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(document.querySelector('[data-layer-feedback-menu]')).not.toBeNull();
    expect(document.body.textContent).toContain('Too strong');
    expect(document.body.textContent).toContain('Too weak');
    expect(document.body.textContent).toContain('Doesn’t work');

    const tooWeak = document.querySelector('[data-layer-feedback-option="Too weak"]') as HTMLButtonElement;
    act(() => {
      tooWeak.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(document.querySelector('[data-layer-feedback-menu]')).toBeNull();
    expect(document.querySelector('[data-layer-feedback-ack]')?.textContent).toContain('Too weak noted for this pairing');

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[data-layer-feedback-menu]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-layer-feedback-menu]')).toBeNull();

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[data-layer-feedback-menu]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(document.querySelector('[data-layer-feedback-menu]')).toBeNull();
  });

  it('keeps the Dark Pleasure and California Winter 2018 ratio and map correction visible without redundant prose', () => {
    renderExpandedLayerCard({
      name: 'California Winter 2018',
      brand: 'Alexandria Fragrances',
      family_key: 'fresh-blue',
      notes: ['Citrus', 'Clean Air', 'Musk'],
      accords: ['Fresh', 'Airy Musk'],
      projection: 8,
      reason: 'It brightens the dark anchor with cold air.',
      why_it_works: 'California Winter 2018 adds air around the dark base.',
      anchor_sprays: 1,
      layer_sprays: 2,
      ratio_hint: 'Companion-led',
    });
    const text = document.body.textContent ?? '';

    expect(text).toContain('Ratio');
    expect(document.querySelector('[data-layer-ratio-visual]')?.getAttribute('aria-label')).toContain('2 Dark Pleasure : 1 California Winter 2018');
    expect(document.querySelector('[data-layer-ratio-item="anchor"]')?.textContent).toContain('x2');
    expect(document.querySelector('[data-layer-ratio-item="layer"]')?.textContent).toContain('x1');
    expect(text).toContain('California Winter 2018 adds lift and air');
    expect(text).not.toContain('Why this ratio');
    expect(text).not.toContain('one spray keeps that lift controlled');
    expect(text).not.toContain('Dark Pleasure - 2 sprays chest / close to body');
    expect(text).not.toContain('California Winter 2018 - 1 spray back neck, upper shirt, or outer layer');
    expect(document.querySelectorAll('[data-spray-placement-role="Anchor"] [data-location="CHEST"]')).toHaveLength(2);
    expect(document.querySelector('[data-spray-placement-role="Layer"] [data-location="BACK_NECK"]')).not.toBeNull();
  });
});
