import { CompactSign, exportJWK, generateKeyPair } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth, defineMcp } from '@lovable.dev/mcp-js';
import { createSupabaseHandler } from '@lovable.dev/mcp-js/stacks/supabase';

import mcpDefinition from './index';
import echoTool from './tools/echo';

const handler = createSupabaseHandler(mcpDefinition, { functionName: 'mcp' });

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('allows authenticated OAuth bearer tool calls with a verified issuer token', async () => {
    const issuer = 'https://issuer.test/auth/v1';
    const jwksUri = `${issuer}/.well-known/jwks.json`;
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    const key = { ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' };
    const now = Math.floor(Date.now() / 1000);
    const claims = JSON.stringify({
      iss: issuer,
      aud: 'authenticated',
      sub: '00000000-0000-4000-8000-000000000001',
      client_id: 'test-mcp-client',
      scope: 'mcp:tools',
      iat: now,
      exp: now + 300,
    });
    const token = await new CompactSign(new Uint8Array(Buffer.from(claims)))
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
      .sign(privateKey);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === jwksUri) {
        return new Response(JSON.stringify({ keys: [key] }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const authedHandler = createSupabaseHandler(defineMcp({
      name: 'odara-mcp-test',
      title: 'Odara MCP Test',
      version: '0.1.0',
      instructions: 'Test-only MCP definition.',
      auth: auth.oauth.issuer({
        issuer,
        acceptedAudiences: 'authenticated',
        jwksUri,
      }),
      tools: [echoTool],
    }), { functionName: 'mcp' });

    const listResponse = await authedHandler(new Request('https://example.test/functions/v1/mcp/.mcp/list-tools', {
      headers: { authorization: `Bearer ${token}` },
    }));
    await expect(listResponse.text()).resolves.toContain('echo');
    expect(listResponse.status).toBe(200);

    const echoResponse = await authedHandler(new Request('https://example.test/functions/v1/mcp/.mcp/invoke-tool/echo', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'authenticated-ok' }),
    }));
    await expect(echoResponse.text()).resolves.toContain('authenticated-ok');
    expect(echoResponse.status).toBe(200);
  });
});
