import { describe, expect, it } from 'vitest';
import { createSupabaseHandler } from '@lovable.dev/mcp-js/stacks/supabase';

import mcpDefinition from './index';

const handler = createSupabaseHandler(mcpDefinition, { functionName: 'mcp' });

async function requestMcp(path: string, body?: unknown) {
  return handler(new Request(`https://example.test/functions/v1/mcp${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  }));
}

describe('MCP auth boundary', () => {
  it('declares OAuth auth instead of public unauthenticated access', () => {
    expect(mcpDefinition.auth?.type).toBe('oauth');
    expect(mcpDefinition.auth?.issuer).toBe('https://yysmhqxmnhfugwnojfag.supabase.co/auth/v1');
    expect(mcpDefinition.auth?.acceptedAudiences).toEqual(['authenticated']);
  });

  it('blocks unauthenticated tools/list', async () => {
    const response = await requestMcp('/.mcp/list-tools');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    await expect(response.text()).resolves.not.toMatch(/echo|get_fragrance_context|service_role/i);
  });

  it('blocks unauthenticated echo calls', async () => {
    const response = await requestMcp('/.mcp/invoke-tool/echo', { text: 'hello' });
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).not.toContain('hello');
    expect(text).not.toMatch(/service_role|jwt|token/i);
  });

  it('blocks unauthenticated get_fragrance_context calls', async () => {
    const response = await requestMcp('/.mcp/invoke-tool/get_fragrance_context', {
      weather: 'sunny',
      occasion: 'work',
      temperatureF: 80,
    });
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).not.toContain('Citrus');
    expect(text).not.toMatch(/service_role|jwt|token/i);
  });
});
