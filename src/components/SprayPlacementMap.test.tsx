import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import SprayPlacementMap from './SprayPlacementMap';
import { buildPlacementGuide } from '@/lib/sprayPlacement';

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

function renderMap(placementText = '2 sprays chest') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const guide = buildPlacementGuide({
    fragrance: 'Tomcat',
    role: 'Anchor',
    familyKey: 'dark-leather',
    colorToken: '#5A3A2E',
    placementText,
  });

  root = createRoot(container);
  act(() => {
    root?.render(<SprayPlacementMap guide={guide} compact />);
  });

  return container;
}

describe('SprayPlacementMap', () => {
  it('renders one dot per spray with the fragrance family color', () => {
    renderMap('2 sprays chest');

    const map = document.querySelector('[data-spray-placement-map]');
    const dots = document.querySelectorAll('[data-spray-placement-dot][data-location="CHEST"]');

    expect(map?.getAttribute('aria-label')).toContain('Anchor Tomcat: 2 sprays on chest');
    expect(document.querySelector('[data-spray-placement-icon="body"]')).not.toBeNull();
    expect(document.querySelector('[data-spray-placement-icon="shirt"]')).toBeNull();
    expect(dots).toHaveLength(2);
    dots.forEach((dot) => {
      expect(dot.getAttribute('fill')).toBe('#5A3A2E');
    });
  });

  it('renders back neck as a skin body placement', () => {
    renderMap('1 spray back neck');

    expect(document.querySelector('[data-spray-placement-icon="body"]')).not.toBeNull();
    expect(document.querySelector('[data-spray-placement-icon="shirt"]')).toBeNull();
    expect(document.querySelector('[data-location="BACK_NECK"]')).not.toBeNull();
  });

  it('renders shirt placements on a shirt icon instead of the body icon', () => {
    renderMap('1 spray upper shirt');

    const shirtDot = document.querySelector('[data-spray-placement-dot][data-location="SHIRT"]');

    expect(document.querySelector('[data-spray-placement-icon="shirt"]')).not.toBeNull();
    expect(document.querySelector('[data-spray-placement-icon="body"]')).toBeNull();
    expect(shirtDot?.getAttribute('data-semantic-location')).toBe('UPPER_SHIRT');
    expect(shirtDot?.getAttribute('fill')).toBe('#5A3A2E');
    expect(document.querySelector('[data-spray-placement-map]')?.getAttribute('aria-label')).toContain('1 spray on shirt');
  });

  it('marks optional placements distinctly for accessibility and visual styling', () => {
    renderMap('optional wrist');

    const optionalDot = document.querySelector('[data-spray-placement-dot][data-optional="true"]');
    expect(optionalDot).not.toBeNull();
    expect(document.body.textContent).toContain('Tomcat');
  });
});
