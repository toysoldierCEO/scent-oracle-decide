import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LayerCard from './LayerCard';
import type { LayerModes } from './ModeSelector';
import type { LayerFeedbackDisplayInput } from '@/lib/layerFeedbackMemory';

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

function renderExpandedLayerCard(
  overrides: Partial<TestLayerMode> = {},
  propOverrides: Partial<ComponentProps<typeof LayerCard>> = {},
) {
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
        mainFragranceId="dark-pleasure-id"
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
        feedbackContext={{
          context: 'evening',
          temperature: 74,
          wearDate: '2026-07-13',
        }}
        {...propOverrides}
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
    expect(document.querySelector('[data-spray-placement-role="Anchor"] [data-spray-placement-icon="body"]')).not.toBeNull();
    expect(document.querySelector('[data-spray-placement-role="Layer"] [data-location="BACK_NECK"]')).not.toBeNull();
    expect(document.querySelector('[data-spray-placement-role="Layer"] [data-location="SHIRT"]')).not.toBeNull();
    expect(document.querySelector('[data-spray-placement-role="Layer"] [data-spray-placement-icon="shirt"]')).not.toBeNull();
    expect(document.querySelector('[data-layer-feedback-button]')?.getAttribute('aria-label')).toBe('More options for this pairing');
  });

  it('opens, closes, and acknowledges the pairing feedback popover when no persistence callback is supplied', async () => {
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
    await act(async () => {
      tooWeak.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(document.querySelector('[data-layer-feedback-menu]')).toBeNull();
    expect(document.querySelector('[data-layer-feedback-ack]')?.textContent).toContain('Too weak noted');

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
    expect(document.querySelector('[data-spray-placement-role="Layer"] [data-location="BACK_NECK"]')).toBeNull();
    expect(document.querySelector('[data-spray-placement-role="Layer"] [data-location="SHIRT"]')).not.toBeNull();
    expect(document.querySelector('[data-spray-placement-role="Layer"] [data-spray-placement-icon="shirt"]')).not.toBeNull();
  });

  it('submits factual pairing feedback once and prevents duplicate rapid taps', async () => {
    let resolveSubmit: (() => void) | null = null;
    const onLayerFeedback = vi.fn(() => new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    }));

    renderExpandedLayerCard({}, { onLayerFeedback });
    const button = document.querySelector('[data-layer-feedback-button]') as HTMLButtonElement;

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    const tooStrong = document.querySelector('[data-layer-feedback-option="Too strong"]') as HTMLButtonElement;
    await act(async () => {
      tooStrong.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      tooStrong.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onLayerFeedback).toHaveBeenCalledTimes(1);
    const payload = onLayerFeedback.mock.calls[0][0] as LayerFeedbackDisplayInput;
    expect(payload).toMatchObject({
      feedbackType: 'too_strong',
      anchorFragranceId: 'dark-pleasure-id',
      companionFragranceId: 'reflection-man-layer',
      layerMode: 'balance',
      leadRole: 'Lead',
      context: 'evening',
      temperature: 74,
      wearDate: '2026-07-13',
    });
    expect(payload.ratioLabel).toContain('Dark Pleasure');
    expect(payload.ratioLabel).toContain('Reflection Man');
    expect(payload.presentation).toMatchObject({
      anchorName: 'Dark Pleasure',
      companionName: 'Reflection Man',
      selectedMood: 'balance',
    });
    expect(document.body.textContent).toContain('Saving…');

    await act(async () => {
      resolveSubmit?.();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-layer-feedback-menu]')).toBeNull();
    expect(document.querySelector('[data-layer-feedback-ack]')?.textContent).toContain('Too strong noted');
  });

  it('keeps the current recommendation visible and retryable when feedback persistence fails', async () => {
    const onLayerFeedback = vi.fn().mockRejectedValue(new Error('network'));

    renderExpandedLayerCard({}, { onLayerFeedback });
    const button = document.querySelector('[data-layer-feedback-button]') as HTMLButtonElement;

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    const doesntWork = document.querySelector('[data-layer-feedback-option="Doesn’t work"]') as HTMLButtonElement;
    await act(async () => {
      doesntWork.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onLayerFeedback).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-layer-feedback-menu]')).not.toBeNull();
    expect(document.querySelector('[data-layer-feedback-error]')?.textContent).toContain('Couldn’t save. Try again.');
    expect(document.querySelector('[data-layer-feedback-ack]')).toBeNull();
    expect(document.body.textContent).toContain('Reflection Man');
  });

  it('renders a visible exhausted-pool recovery state when no replacement layer is ready', () => {
    const onRetryMood = vi.fn();
    renderExpandedLayerCard({}, {
      visibleLayerMode: null,
      layerModes: {
        balance: null,
        bold: null,
        smooth: null,
        wild: null,
      },
      modeErrors: {
        balance: 'No other layer is ready right now.',
        bold: null,
        smooth: null,
        wild: null,
      },
      onRetryMood,
    });

    expect(document.body.textContent).toContain('No other layer is ready right now.');
    expect(document.querySelector('[data-layer-feedback-button]')).toBeNull();
    const retryButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Try again') as HTMLButtonElement | undefined;
    expect(retryButton).toBeTruthy();

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onRetryMood).toHaveBeenCalledWith('balance');
  });
});
