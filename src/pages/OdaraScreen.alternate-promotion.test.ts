import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, './OdaraScreen.tsx'), 'utf8');

describe('OdaraScreen alternate promotion', () => {
  it('promotes the tapped alternate object into the visible Today card', () => {
    expect(source).toContain('const handlePromoteAlternate = useCallback((alt: OracleAlternate) => {');
    expect(source).toContain('fragrance_id: alt.fragrance_id');
    expect(source).toContain('name: alt.name');
    expect(source).toContain('brand: alt.brand ??');
    expect(source).toContain('setVisibleCard(promoted)');
    expect(source).toContain('setPromotedAltId(alt.fragrance_id)');
  });

  it('keeps promoted alternates out of oracle re-ranking', () => {
    const handlerStart = source.indexOf('const handlePromoteAlternate = useCallback((alt: OracleAlternate) => {');
    const handlerEnd = source.indexOf('// ─────────────────────────────────────────────────────────────────────────', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(source).toContain("source: 'locked' | 'manual' | 'carryover-main' | 'carryover-layer' | 'oracle' | 'alternate'");
    expect(handler).toContain("setSignedInResolvedDayDecisionSource('alternate')");
    expect(handler).not.toContain("setSignedInResolvedDayDecisionSource('oracle')");
    expect(source).toContain("if (signedInResolvedDayDecisionSource !== 'oracle') return;");
  });

  it('does not route alternate taps through skip, accept, or add flows', () => {
    const handlerStart = source.indexOf('const handlePromoteAlternate = useCallback((alt: OracleAlternate) => {');
    const handlerEnd = source.indexOf('// ─────────────────────────────────────────────────────────────────────────', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).not.toContain('skip_oracle_selection_v1');
    expect(handler).not.toContain('accept');
    expect(handler).not.toContain('missing');
    expect(handler).not.toContain('Add');
  });

  it('stops alternate chip clicks from bubbling into parent card actions', () => {
    expect(source).toContain('data-alternate-chip');
    expect(source).toContain('e.stopPropagation();');
    expect(source).toContain('cardController.actions.promoteAlternate(item.alternate)');
  });
});
