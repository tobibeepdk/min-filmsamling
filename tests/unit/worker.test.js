import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import worker, { RateLimiter } from '../../worker/src/index.js';
const origin = 'https://example.github.io';
const image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
const recognized = {
  recognized: true,
  title: 'Alien',
  originalTitle: 'Alien',
  year: 1979,
  confidence: 0.95,
  visibleText: ['Alien'],
  candidates: [{ title: 'Alien', year: 1979, confidence: 0.95 }],
};
function memoryStorage() {
  const data = new Map();
  let queue = Promise.resolve();
  let alarm = null;
  const storage = {
    async get(keys) {
      return Array.isArray(keys)
        ? new Map(
            keys.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))]),
          )
        : structuredClone(data.get(keys));
    },
    async put(key, value) {
      if (typeof key === 'string') data.set(key, structuredClone(value));
      else Object.entries(key).forEach(([name, entry]) => data.set(name, structuredClone(entry)));
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    },
    async list(options = {}) {
      return new Map(
        [...data]
          .filter(
            ([key]) =>
              key.startsWith(options.prefix || '') &&
              (!options.startAfter || key > options.startAfter),
          )
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, options.limit || Infinity),
      );
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(value) {
      alarm = value;
    },
    async deleteAlarm() {
      alarm = null;
    },
    transaction(callback) {
      const operation = queue.then(() => callback(storage));
      queue = operation.catch(() => {});
      return operation;
    },
  };
  return storage;
}
function environment(overrides = {}) {
  const env = {
    ALLOWED_ORIGIN: origin,
    APP_ACCESS_KEY: 'test-only-access',
    SESSION_SIGNING_KEY: 'test-only-signing-secret-with-enough-length',
    OPENAI_API_KEY: 'test-only-openai',
    OPENAI_MODEL: 'test-vision-model',
    DAILY_LIMIT: '100',
    RATE_LIMIT_PER_MINUTE: '20',
    IP_RATE_LIMIT_PER_MINUTE: '30',
    SESSION_DAILY_LIMIT: '100',
    IP_DAILY_LIMIT: '200',
    ...overrides,
  };
  const storage = memoryStorage();
  let limiter = new RateLimiter({ storage }, env);
  env.RATE_LIMITER = {
    idFromName: (name) => name,
    get: () => ({ fetch: (request) => limiter.fetch(request) }),
  };
  return {
    env,
    restart: () => {
      limiter = new RateLimiter({ storage }, env);
    },
  };
}
function request(path, body, token, headers = {}, method = 'POST') {
  return new Request(`https://worker.test${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function login(env, ip = '192.0.2.1') {
  const response = await worker.fetch(
    request('/session', { accessKey: 'test-only-access' }, null, { 'CF-Connecting-IP': ip }),
    env,
  );
  expect(response.status).toBe(200);
  return (await response.json()).token;
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
function mockVision() {
  const fetch = vi.fn(async () =>
    json({
      id: 'resp_test',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(recognized) }],
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Worker ingress and sessions', () => {
  test.each([undefined, 'https://attacker.test', `${origin}.attacker.test`, `${origin}/`])(
    'rejects non-exact Origin %s without CORS permission',
    async (other) => {
      const { env } = environment();
      const response = await worker.fetch(
        new Request('https://worker.test/health', { headers: other ? { Origin: other } : {} }),
        env,
      );
      expect(response.status).toBe(403);
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    },
  );
  test('preflight permits only the endpoint method and known headers, after origin validation', async () => {
    const { env } = environment();
    const valid = await worker.fetch(
      request(
        '/identify-cover',
        undefined,
        null,
        {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
        'OPTIONS',
      ),
      env,
    );
    expect(valid.status).toBe(204);
    expect(valid.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(valid.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    expect(
      (
        await worker.fetch(
          request(
            '/session',
            undefined,
            null,
            { 'Access-Control-Request-Method': 'DELETE' },
            'OPTIONS',
          ),
          env,
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await worker.fetch(
          request(
            '/session',
            undefined,
            null,
            {
              'Access-Control-Request-Method': 'POST',
              'Access-Control-Request-Headers': 'x-custom',
            },
            'OPTIONS',
          ),
          env,
        )
      ).status,
    ).toBe(400);
    const bad = await worker.fetch(
      request(
        '/session',
        undefined,
        null,
        { Origin: 'https://attacker.test', 'Access-Control-Request-Method': 'POST' },
        'OPTIONS',
      ),
      env,
    );
    expect(bad.status).toBe(403);
    expect(bad.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
  test('health and routes have narrow methods', async () => {
    const { env } = environment();
    const health = await worker.fetch(request('/health', undefined, null, {}, 'GET'), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect((await worker.fetch(request('/health', {}), env)).status).toBe(405);
    expect((await worker.fetch(request('/absent', {}), env)).status).toBe(404);
    expect(
      (await worker.fetch(request('/identify-cover', undefined, null, {}, 'GET'), env)).status,
    ).toBe(405);
  });
  test('issues short-lived signed session and rejects wrong access, missing auth, tampering, expiry', async () => {
    const { env } = environment();
    expect(
      (await worker.fetch(request('/session', { accessKey: 'test-only-access-extra' }), env))
        .status,
    ).toBe(401);
    const response = await worker.fetch(
      request('/session', { accessKey: 'test-only-access' }),
      env,
    );
    const { token, expiresAt } = await response.json();
    expect(response.status).toBe(200);
    expect(Date.parse(expiresAt)).toBe(Date.now() + 900_000);
    const segments = token.split('.');
    const payload = JSON.parse(atob(segments[0].replaceAll('-', '+').replaceAll('_', '/')));
    expect(payload.jti.length).toBeGreaterThan(20);
    payload.exp += 3600;
    const tampered =
      btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') +
      '.' +
      segments[1];
    expect((await worker.fetch(request('/search-movie', { title: 'Alien' }), env)).status).toBe(
      401,
    );
    expect(
      (await worker.fetch(request('/search-movie', { title: 'Alien' }, tampered), env)).status,
    ).toBe(401);
    vi.advanceTimersByTime(900_000);
    expect(
      (await worker.fetch(request('/search-movie', { title: 'Alien' }, token), env)).status,
    ).toBe(401);
  });
  test('limits access-key guessing by IP after a restart', async () => {
    const { env, restart } = environment({ LOGIN_RATE_LIMIT_PER_MINUTE: '2' });
    for (let i = 0; i < 2; i++) {
      expect((await worker.fetch(request('/session', { accessKey: 'wrong' }), env)).status).toBe(
        401,
      );
      restart();
    }
    const limited = await worker.fetch(request('/session', { accessKey: 'test-only-access' }), env);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
  test('fails closed when required environment configuration is missing', async () => {
    for (const field of [
      'APP_ACCESS_KEY',
      'SESSION_SIGNING_KEY',
      'OPENAI_MODEL',
      'OPENAI_API_KEY',
      'RATE_LIMITER',
    ]) {
      const { env } = environment();
      delete env[field];
      const response = await worker.fetch(
        request('/session', { accessKey: 'test-only-access' }),
        env,
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('test-only');
    }
  });
  test('rejects wrong MIME, malformed JSON and streamed bodies beyond cap', async () => {
    const { env } = environment();
    expect(
      (
        await worker.fetch(
          request('/session', { accessKey: 'test-only-access' }, null, {
            'Content-Type': 'text/plain',
          }),
          env,
        )
      ).status,
    ).toBe(415);
    const malformed = new Request('https://worker.test/session', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{bad',
    });
    expect((await worker.fetch(malformed, env)).status).toBe(400);
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(5000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamed = new Request('https://worker.test/session', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    });
    expect((await worker.fetch(streamed, env)).status).toBe(413);
    expect(cancelled).toBe(true);
  });
});
describe('Vision proxy', () => {
  test.each([
    [
      401,
      { error: { code: 'invalid_api_key', message: 'private-provider-detail' } },
      'PROVIDER_AUTH',
    ],
    [403, { error: { message: 'private-provider-detail' } }, 'PROVIDER_ACCESS'],
    [
      404,
      { error: { code: 'model_not_found', message: 'private-provider-detail' } },
      'PROVIDER_ACCESS',
    ],
    [
      429,
      { error: { code: 'insufficient_quota', message: 'private-provider-detail' } },
      'PROVIDER_QUOTA',
    ],
    [
      429,
      { error: { code: 'rate_limit_exceeded', message: 'private-provider-detail' } },
      'PROVIDER_RATE_LIMIT',
    ],
    [
      400,
      { error: { code: 'invalid_request', message: 'private-provider-detail' } },
      'PROVIDER_REQUEST',
    ],
  ])(
    'provider HTTP %s giver en allowlistet fejlkode uden providerindhold',
    async (status, body, code) => {
      const { env } = environment();
      const token = await login(env);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json(body, status)),
      );
      const response = await worker.fetch(request('/identify-cover', { image }, token), env);
      expect(response.status).toBe(status === 429 ? 429 : 502);
      const result = await response.json();
      expect(result.code).toBe(code);
      expect(JSON.stringify(result)).not.toContain('private-provider-detail');
      expect(JSON.stringify(result)).not.toContain('invalid_api_key');
      if (code === 'PROVIDER_QUOTA') expect(response.headers.has('Retry-After')).toBe(false);
    },
  );

  test('en afbrudt upstream-analyse skelnes fra forkert adgang og lækker ikke URL eller nøgle', async () => {
    const { env } = environment();
    const token = await login(env);
    let started;
    const upstreamStarted = new Promise((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            started();
            signal.addEventListener('abort', () =>
              reject(new DOMException('private-request', 'AbortError')),
            );
          }),
      ),
    );
    const pending = worker.fetch(request('/identify-cover', { image }, token), env);
    await upstreamStarted;
    await vi.advanceTimersByTimeAsync(25001);
    const response = await pending;
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  test.each([
    [
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] },
      'AI_INCOMPLETE',
    ],
    [
      {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private-refusal' }] }],
      },
      'AI_REFUSED',
    ],
    [
      {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'not-json' }] }],
      },
      'AI_INVALID_RESULT',
    ],
  ])('et AI-svar uden brugbare filmdata kan diagnosticeres sikkert', async (body, code) => {
    const { env } = environment();
    const token = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(body)),
    );
    const response = await worker.fetch(request('/identify-cover', { image }, token), env);
    expect(response.status).toBe(502);
    const result = await response.json();
    expect(result.code).toBe(code);
    expect(JSON.stringify(result)).not.toContain('private-refusal');
    expect(JSON.stringify(result)).not.toContain('not-json');
  });

  test('uses Responses image input, configured model, strict schema and store false', async () => {
    const { env } = environment();
    const token = await login(env);
    const upstream = mockVision();
    const response = await worker.fetch(request('/identify-cover', { image }, token), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(recognized);
    const [url, options] = upstream.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(payload.model).toBe('test-vision-model');
    expect(payload.store).toBe(false);
    expect(payload.input[0].content).toContainEqual({
      type: 'input_image',
      image_url: image,
      detail: 'high',
    });
    expect(payload.text.format.type).toBe('json_schema');
    expect(payload.text.format.strict).toBe(true);
    expect(payload.text.format.schema.properties.candidates.maxItems).toBe(5);
    expect(payload.text.format.schema.additionalProperties).toBe(false);
  });
  test.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,aGVsbG8=',
    'data:image/webp;base64,aGVsbG8=',
    'https://example.test/image.jpg',
    'data:image/jpeg;base64,%%%',
  ])('rejects unsupported or spoofed image %s before upstream', async (bad) => {
    const { env } = environment();
    const token = await login(env);
    const upstream = mockVision();
    expect(
      (await worker.fetch(request('/identify-cover', { image: bad }, token), env)).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  test('rejects decoded image beyond 1.5 MB without trusting Content-Length', async () => {
    const { env } = environment();
    const token = await login(env);
    const upstream = mockVision();
    const bytes = Buffer.alloc(1_500_001);
    bytes.set([255, 216, 255]);
    bytes.set([255, 217], bytes.length - 2);
    expect(
      (
        await worker.fetch(
          request(
            '/identify-cover',
            { image: `data:image/jpeg;base64,${bytes.toString('base64')}` },
            token,
          ),
          env,
        )
      ).status,
    ).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  test('accepts WebP signature and container length', async () => {
    const { env } = environment();
    const token = await login(env);
    mockVision();
    expect(
      (
        await worker.fetch(
          request(
            '/identify-cover',
            { image: 'data:image/webp;base64,UklGRhAAAABXRUJQVlA4IAQAAAAAAAAA' },
            token,
          ),
          env,
        )
      ).status,
    ).toBe(200);
  });
  test('rejects invalid model output and more than five candidates', async () => {
    const { env } = environment();
    const token = await login(env);
    for (const bad of [
      { ...recognized, confidence: 2 },
      { ...recognized, candidates: Array(6).fill(recognized.candidates[0]) },
      { ...recognized, injected: 'unexpected' },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          json({
            output: [
              { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(bad) }] },
            ],
          }),
        ),
      );
      const response = await worker.fetch(request('/identify-cover', { image }, token), env);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('unexpected');
    }
  });
  test('upstream throttling is safe 429 and errors disclose no provider content', async () => {
    const { env } = environment();
    const token = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ error: { message: 'private-provider-detail' } }, 429, { 'Retry-After': '90' }),
      ),
    );
    const limited = await worker.fetch(request('/identify-cover', { image }, token), env);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('90');
    expect(await limited.text()).not.toContain('private-provider-detail');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('private-error-detail');
      }),
    );
    const failed = await worker.fetch(request('/identify-cover', { image }, token), env);
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('private-error-detail');
  });
});
describe('Persistent shared limits', () => {
  test('global budget is atomic across IPs and sessions, persists, resets next UTC day', async () => {
    const { env, restart } = environment({ DAILY_LIMIT: '1' });
    const a = await login(env, '192.0.2.1');
    const b = await login(env, '192.0.2.2');
    mockVision();
    const responses = await Promise.all([
      worker.fetch(
        request('/identify-cover', { image }, a, { 'CF-Connecting-IP': '192.0.2.1' }),
        env,
      ),
      worker.fetch(
        request('/identify-cover', { image }, b, { 'CF-Connecting-IP': '192.0.2.2' }),
        env,
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
    restart();
    expect((await worker.fetch(request('/identify-cover', { image }, b), env)).status).toBe(429);
    vi.advanceTimersByTime(86_400_000);
    const tomorrow = await login(env);
    expect((await worker.fetch(request('/identify-cover', { image }, tomorrow), env)).status).toBe(
      200,
    );
  });
  test('session minute budget holds after IP change and resets next minute', async () => {
    const { env } = environment({ RATE_LIMIT_PER_MINUTE: '1' });
    const token = await login(env);
    mockVision();
    expect(
      (
        await worker.fetch(
          request('/identify-cover', { image }, token, { 'CF-Connecting-IP': '192.0.2.3' }),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          request('/identify-cover', { image }, token, { 'CF-Connecting-IP': '192.0.2.4' }),
          env,
        )
      ).status,
    ).toBe(429);
    vi.advanceTimersByTime(60_000);
    expect(
      (
        await worker.fetch(
          request('/identify-cover', { image }, token, { 'CF-Connecting-IP': '192.0.2.4' }),
          env,
        )
      ).status,
    ).toBe(200);
  });
  test('IP minute budget covers different sessions', async () => {
    const { env } = environment({ IP_RATE_LIMIT_PER_MINUTE: '1' });
    const a = await login(env);
    const b = await login(env);
    mockVision();
    expect((await worker.fetch(request('/identify-cover', { image }, a), env)).status).toBe(200);
    expect((await worker.fetch(request('/identify-cover', { image }, b), env)).status).toBe(429);
  });
  test('session and IP daily budgets hold after minute rollover', async () => {
    const { env } = environment({ SESSION_DAILY_LIMIT: '1', IP_DAILY_LIMIT: '2' });
    const a = await login(env);
    mockVision();
    expect((await worker.fetch(request('/identify-cover', { image }, a), env)).status).toBe(200);
    vi.advanceTimersByTime(60_000);
    expect((await worker.fetch(request('/identify-cover', { image }, a), env)).status).toBe(429);
    const b = await login(env);
    const c = await login(env);
    expect((await worker.fetch(request('/identify-cover', { image }, b), env)).status).toBe(200);
    vi.advanceTimersByTime(60_000);
    expect((await worker.fetch(request('/identify-cover', { image }, c), env)).status).toBe(429);
  });
});
describe('Metadata and barcode adapters', () => {
  test('absent TMDB token reports configured false without provider call', async () => {
    const { env } = environment();
    const token = await login(env);
    const upstream = mockVision();
    expect(
      await (
        await worker.fetch(request('/search-movie', { title: 'Alien', year: 1979 }, token), env)
      ).json(),
    ).toEqual({ candidates: [], selected: null, source: 'tmdb', configured: false });
    expect(upstream).not.toHaveBeenCalled();
  });
  test('TMDB ranks title and year, fetches details for numeric ids only', async () => {
    const { env } = environment({ TMDB_READ_TOKEN: 'test-only-tmdb' });
    const token = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const path = new URL(url).pathname;
        if (path.endsWith('/search/movie'))
          return json({
            page: 1,
            total_pages: 1,
            total_results: 3,
            results: [
              {
                id: 2,
                title: 'Alien',
                original_title: 'Alien',
                release_date: '2025-01-01',
                overview: 'Wrong version',
                poster_path: null,
              },
              {
                id: 1,
                title: 'Alien',
                original_title: 'Alien',
                release_date: '1979-05-25',
                overview: 'Space terror',
                poster_path: '/cover.jpg',
              },
              {
                id: '../malicious',
                title: 'Alien',
                original_title: 'Alien',
                release_date: '1979-01-01',
              },
            ],
          });
        if (path === '/3/movie/1')
          return json({
            id: 1,
            title: 'Alien',
            original_title: 'Alien',
            release_date: '1979-05-25',
            overview: 'Space terror',
            poster_path: '/cover.jpg',
            runtime: 117,
            genres: [{ id: 27, name: 'Gyser' }],
            credits: {
              crew: [{ job: 'Director', name: 'Ridley Scott' }],
              cast: [{ name: 'Sigourney Weaver' }],
            },
          });
        if (path === '/3/movie/2')
          return json({
            id: 2,
            title: 'Alien',
            original_title: 'Alien',
            release_date: '2025-01-01',
            runtime: 100,
            genres: [],
            credits: { crew: [], cast: [] },
          });
        throw new Error('Unexpected provider path');
      }),
    );
    const response = await worker.fetch(
      request('/search-movie', { title: 'Alien', originalTitle: 'Alien', year: 1979 }, token),
      env,
    );
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.candidates.map((item) => item.id)).toEqual([1, 2]);
    expect(result.selected.id).toBe(1);
    expect(result.selected).toMatchObject({
      director: 'Ridley Scott',
      actors: 'Sigourney Weaver',
      genre: 'Gyser',
      runtime: 117,
      cover: 'https://image.tmdb.org/t/p/w500/cover.jpg',
    });
    expect(result.selected.score).toBeGreaterThan(result.candidates[1].score);
  });
  test('trial barcode lookup normalizes query, preserves description, filters images, handles misses', async () => {
    const { env } = environment();
    const token = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        expect(new URL(url).pathname).toBe('/prod/trial/lookup');
        expect(new URL(url).searchParams.get('upc')).toBe('5708758695664');
        return json({
          code: 'OK',
          total: 1,
          offset: 0,
          items: [
            {
              ean: '5708758695664',
              title: 'Alien Blu-ray',
              description: 'Udgave fra 1979',
              images: ['https://example.test/cover.jpg', 'javascript:bad'],
              offers: [],
            },
          ],
        });
      }),
    );
    expect(
      await (
        await worker.fetch(request('/lookup-barcode', { barcode: ' 5708758695664 ' }, token), env)
      ).json(),
    ).toEqual({
      found: true,
      title: 'Alien',
      description: 'Udgave fra 1979',
      format: 'Blu-ray',
      images: ['https://example.test/cover.jpg'],
      source: 'upcitemdb',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'OK', total: 0, offset: 0, items: [] })),
    );
    expect(
      (
        await (
          await worker.fetch(request('/lookup-barcode', { barcode: '5708758695664' }, token), env)
        ).json()
      ).found,
    ).toBe(false);
  });
  test('paid provider uses server key and custom JSON adapter enforces HTTPS', async () => {
    const { env } = environment({ BARCODE_PROVIDER_KEY: 'test-only-barcode' });
    const token = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        expect(new URL(url).pathname).toBe('/prod/v1/lookup');
        expect(options.headers.user_key).toBe('test-only-barcode');
        return json({ code: 'OK', total: 0, items: [] });
      }),
    );
    expect(
      (await worker.fetch(request('/lookup-barcode', { barcode: '5708758695664' }, token), env))
        .status,
    ).toBe(200);
    env.BARCODE_PROVIDER = 'json';
    env.BARCODE_PROVIDER_URL = 'https://provider.test/lookup';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        expect(new URL(url).searchParams.get('barcode')).toBe('5708758695664');
        expect(options.headers.Authorization).toBe('Bearer test-only-barcode');
        return json({ found: true, title: 'Alien', description: '', format: 'DVD', images: [] });
      }),
    );
    expect(
      (
        await (
          await worker.fetch(request('/lookup-barcode', { barcode: '5708758695664' }, token), env)
        ).json()
      ).source,
    ).toBe('json');
    env.BARCODE_PROVIDER_URL = 'http://provider.test/lookup';
    expect(
      (await worker.fetch(request('/lookup-barcode', { barcode: '5708758695664' }, token), env))
        .status,
    ).toBe(503);
  });
  test('rejects malformed barcode and surfaces provider throttling safely', async () => {
    const { env } = environment();
    const token = await login(env);
    const upstream = mockVision();
    expect(
      (await worker.fetch(request('/lookup-barcode', { barcode: 'not-a-barcode' }, token), env))
        .status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'TOO_MANY_REQUESTS', message: 'private' }, 429)),
    );
    const response = await worker.fetch(
      request('/lookup-barcode', { barcode: '5708758695664' }, token),
      env,
    );
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain('private');
  });
  test('provider 404 is a clean barcode miss', async () => {
    const { env } = environment({
      BARCODE_PROVIDER: 'json',
      BARCODE_PROVIDER_URL: 'https://provider.test/lookup',
    });
    const token = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'private' }, 404)),
    );
    const absent = await worker.fetch(
      request('/lookup-barcode', { barcode: '5708758695664' }, token),
      env,
    );
    expect(absent.status).toBe(200);
    expect((await absent.json()).found).toBe(false);
  });
  test('malformed provider JSON fails safely', async () => {
    const { env } = environment({
      BARCODE_PROVIDER: 'json',
      BARCODE_PROVIDER_URL: 'https://provider.test/lookup',
    });
    const token = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ found: 'broken' })),
    );
    expect(
      (await worker.fetch(request('/lookup-barcode', { barcode: '5708758695664' }, token), env))
        .status,
    ).toBe(502);
  });
  test('UPC-A and zero-prefixed EAN lookup fall back to the equivalent variant on a miss', async () => {
    const { env } = environment();
    const token = await login(env);
    const queries = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const code = new URL(url).searchParams.get('upc');
        queries.push(code);
        return json({
          code: 'OK',
          total: code.length === 12 ? 1 : 0,
          items: code.length === 12 ? [{ title: 'Alien DVD', description: '', images: [] }] : [],
        });
      }),
    );
    const response = await worker.fetch(
      request('/lookup-barcode', { barcode: '012345678905' }, token),
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).found).toBe(true);
    expect(queries).toEqual(['0012345678905', '012345678905']);
  });
  test.each([
    ['The Wicked (Blu-ray) [Collector Edition]', 'The Wicked', 'Blu-ray'],
    ['Alien 4K UHD Blu-ray', 'Alien', '4K UHD'],
    ['Blade Runner 2049 [4K UHD + Blu-ray]', 'Blade Runner 2049', '4K UHD'],
    ['2001: A Space Odyssey (DVD)', '2001: A Space Odyssey', 'DVD'],
    ['The Collector', 'The Collector', ''],
  ])('separates physical edition from film identity: %s', async (raw, title, format) => {
    const { env } = environment();
    const token = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          code: 'OK',
          total: 1,
          items: [{ title: raw, description: 'Original produktbeskrivelse', images: [] }],
        }),
      ),
    );
    const response = await worker.fetch(
      request('/lookup-barcode', { barcode: '5708758695664' }, token),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      found: true,
      title,
      format,
      description: 'Original produktbeskrivelse',
    });
  });
  test('custom provider 4K product text outranks a generic Blu-ray format label', async () => {
    const { env } = environment({
      BARCODE_PROVIDER: 'json',
      BARCODE_PROVIDER_URL: 'https://provider.test/lookup',
    });
    const token = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          found: true,
          title: 'Alien',
          description: '4K UHD Blu-ray',
          format: 'Blu-ray',
          images: [],
        }),
      ),
    );
    expect(
      await (
        await worker.fetch(request('/lookup-barcode', { barcode: '5708758695664' }, token), env)
      ).json(),
    ).toMatchObject({ title: 'Alien', format: '4K UHD' });
  });
});

test('alarm cleans more than 1000 expired counters within the storage delete limit', async () => {
  const storage = memoryStorage();
  await storage.put(
    Object.fromEntries(
      Array.from({ length: 1200 }, (_, i) => [
        'counter:expired:' + String(i).padStart(5, '0'),
        { count: 1, expiresAt: Date.now() - 1 },
      ]),
    ),
  );
  await storage.put('counter:keep', { count: 7, expiresAt: Date.now() + 60000 });
  const remove = storage.delete.bind(storage);
  storage.delete = vi.fn(async (keys) => {
    if (keys.length > 128) throw new RangeError('Storage delete accepts at most 128 keys');
    return remove(keys);
  });
  const limiter = new RateLimiter({ storage }, {});
  await expect(limiter.alarm()).resolves.toBeUndefined();
  expect([...(await storage.list({ prefix: 'counter:' }))]).toEqual([
    ['counter:keep', expect.objectContaining({ count: 7 })],
  ]);
  expect(storage.delete.mock.calls.length).toBeGreaterThan(1);
  expect(await storage.getAlarm()).toBeGreaterThan(Date.now());
});
