import { resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

let runtime;
afterEach(async () => {
  await runtime?.dispose();
  runtime = undefined;
});

async function lookup(upstream) {
  const calls = [];
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        'tests/fixtures/upstream-worker.js',
        'worker/src/http.js',
        'worker/src/providers.js',
        'shared/barcode.js',
        'shared/service-errors.js',
      ].map((path) => ({ type: 'ESModule', path: resolve(path) })),
      modulesRoot: resolve('.'),
      compatibilityDate: '2026-10-01',
      host: '127.0.0.1',
      port: 0,
      outboundService: async (request) => {
        calls.push({ url: request.url, authorization: request.headers.get('Authorization') });
        return upstream();
      },
    }),
  );
  const response = await runtime.dispatchFetch('http://worker.test/lookup-barcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode: '7393834487707' }),
  });
  return { response, calls };
}

describe('barcode provider transport in Workers runtime', () => {
  test('returns the recognized movie through the real provider adapter', async () => {
    const { response, calls } = await lookup(() =>
      Response.json({
        found: true,
        title: 'The Wicked (Blu-ray)',
        description: 'A film on Blu-ray.',
        images: ['https://images.test/cover.jpg'],
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      found: true,
      title: 'The Wicked',
      description: 'A film on Blu-ray.',
      format: 'Blu-ray',
      images: ['https://images.test/cover.jpg'],
      source: 'json',
    });
    expect(calls).toEqual([
      {
        url: 'https://provider.test/lookup?barcode=7393834487707',
        authorization: 'Bearer test-only-provider',
      },
    ]);
  });

  test('rejects a provider redirect without forwarding credentials or private error text', async () => {
    const { response, calls } = await lookup(
      () =>
        new Response('private-provider-message', {
          status: 302,
          headers: { Location: 'https://another-provider.test/collect' },
        }),
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe('PROVIDER_FAILURE');
    expect(JSON.stringify(body)).not.toContain('private-provider-message');
    expect(calls.map(({ url }) => url)).toEqual([
      'https://provider.test/lookup?barcode=7393834487707',
    ]);
  });
});
