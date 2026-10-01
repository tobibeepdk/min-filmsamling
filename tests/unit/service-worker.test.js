import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

const scope = 'https://tobibeepdk.github.io/min-filmsamling/';
async function harness() {
  const listeners = {},
    cached = new Response('cached bundle'),
    match = vi.fn(async (_request, options) => (options?.ignoreVary ? cached : undefined));
  const caches = {
    open: vi.fn(async () => ({ match, addAll: vi.fn() })),
    match: vi.fn(async () => undefined),
  };
  const fetch = vi.fn(async () => {
    throw new TypeError('offline');
  });
  const source = (
    await readFile(new URL('../../public/service-worker.js', import.meta.url), 'utf8')
  )
    .replace('__VERSION__', 'test')
    .replace(
      '__ASSETS__',
      JSON.stringify(['/min-filmsamling/index.html', '/min-filmsamling/assets/app.js']),
    );
  vm.runInNewContext(source, {
    self: {
      registration: { scope },
      location: new URL(scope),
      addEventListener: (type, handler) => {
        listeners[type] = handler;
      },
    },
    caches,
    fetch,
    URL,
    Response,
    Set,
  });
  return { listeners, caches, match, fetch };
}
describe('service worker cachegrænser', () => {
  it('statisk modul med Vary:Origin kan genbruges efter netværket forsvinder', async () => {
    const h = await harness();
    let response;
    h.listeners.fetch({
      request: new Request(scope + 'assets/app.js', {
        headers: { Origin: 'https://tobibeepdk.github.io' },
      }),
      respondWith: (promise) => {
        response = promise;
      },
    });
    expect(await (await response).text()).toBe('cached bundle');
    expect(h.match).toHaveBeenCalledWith(expect.any(Request), { ignoreVary: true });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each([
    new Request('https://api.example.workers.dev/health'),
    new Request(scope + 'search-movie', { method: 'POST', body: '{}' }),
    new Request(scope + 'assets/app.js', { headers: { Authorization: 'Bearer test-session' } }),
    new Request(scope + 'assets/app.js?token=test'),
  ])('API, adgangsheaders og query-parametre cacher aldrig: %s', async (request) => {
    const h = await harness(),
      respondWith = vi.fn();
    h.listeners.fetch({ request, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(h.caches.open).not.toHaveBeenCalled();
  });
});
