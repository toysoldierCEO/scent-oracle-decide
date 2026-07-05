import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/get-vesper-intelligence/index.ts', 'utf8');

describe('get-vesper-intelligence CORS policy', () => {
  it('allows build-specific Lovable preview origins for the Odara project', () => {
    expect(source).toContain('function isAllowedLovablePreviewOrigin');
    expect(source).toContain('LOVABLE_PROJECT_ID = "20427402-64b7-4dc9-80aa-727b1e4a3e69"');
    expect(source).toContain('id-preview-[a-z0-9-]+--');
    expect(source).toContain('isAllowedLovablePreviewOrigin(origin)');
  });

  it('keeps the production Lovable project origin explicitly covered', () => {
    expect(source).toContain('https://20427402-64b7-4dc9-80aa-727b1e4a3e69.lovableproject.com');
    expect(source).toContain('https://scent-oracle-decide.lovable.app');
    expect(source).toContain('https://vesperize.lovable.app');
  });
});
