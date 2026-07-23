import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const frameworkSource = readFileSync('src/lib/beliefThresholdFramework.ts', 'utf8');
const odaraScreenSource = readFileSync('src/pages/OdaraScreen.tsx', 'utf8');
const layerCardSource = readFileSync('src/components/LayerCard.tsx', 'utf8');
const todayScoringSource = readFileSync('src/lib/todaysPickScoring.ts', 'utf8');
const layerRatioSource = readFileSync('src/lib/layerRatioIntelligence.ts', 'utf8');
const dailyLayerMemorySource = readFileSync('src/lib/dailyLayerMemory.ts', 'utf8');
const feedbackMemorySource = readFileSync('src/lib/layerFeedbackMemory.ts', 'utf8');

describe('belief threshold framework source isolation', () => {
  it('is a read-only analysis module with no Supabase writes or RPC calls', () => {
    expect(frameworkSource).toContain('BELIEF_THRESHOLD_FRAMEWORK_VERSION');
    expect(frameworkSource).not.toContain('odaraSupabase');
    expect(frameworkSource).not.toContain('.rpc(');
    expect(frameworkSource).not.toContain('.insert(');
    expect(frameworkSource).not.toContain('.update(');
    expect(frameworkSource).not.toContain('.delete(');
    expect(frameworkSource).not.toContain('localStorage');
    expect(frameworkSource).not.toContain('sessionStorage');
  });

  it('does not import into Today, LayerCard, scoring, or recommendation plumbing', () => {
    for (const source of [
      odaraScreenSource,
      layerCardSource,
      todayScoringSource,
      layerRatioSource,
      dailyLayerMemorySource,
      feedbackMemorySource,
    ]) {
      expect(source).not.toContain('beliefThresholdFramework');
      expect(source).not.toContain('evaluateBeliefState');
      expect(source).not.toContain('BELIEF_THRESHOLD_FRAMEWORK_VERSION');
    }
  });

  it('keeps memory and belief vocabulary separate from user-facing identity labels', () => {
    expect(frameworkSource).toContain('Memory stores facts');
    expect(frameworkSource).not.toMatch(/personality/i);
    expect(frameworkSource).not.toMatch(/user type/i);
    expect(frameworkSource).not.toMatch(/smooth layerer/i);
    expect(frameworkSource).not.toMatch(/balanced layerer/i);
    expect(frameworkSource).not.toMatch(/bold layerer/i);
  });

  it('does not create migrations, tables, or recommendation side effects', () => {
    expect(frameworkSource).not.toContain('create table');
    expect(frameworkSource).not.toContain('alter table');
    expect(frameworkSource).not.toContain('get_signed_in_card_contract');
    expect(frameworkSource).not.toContain('accept_oracle_selection');
    expect(frameworkSource).not.toContain('skip_oracle_selection');
    expect(frameworkSource).not.toContain('submit_layer_recommendation_feedback_v1');
    expect(frameworkSource).not.toContain('submit_daily_layer_wear_memory_v1');
  });
});
