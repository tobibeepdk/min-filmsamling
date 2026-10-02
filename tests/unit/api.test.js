import { it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { openDatabase } from '../../src/db.js';
import { createApi } from '../../src/api.js';
it('login gemmer kun session-token og aldrig adgangsnøglen', async () => {
  const db = await openDatabase('api-' + crypto.randomUUID());
  const api = createApi(
    db,
    () => 'https://films.example.workers.dev',
    async () =>
      new Response(JSON.stringify({ token: 'session-example', expiresAt: Date.now() + 10000 }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  await api.login('example-access');
  const saved = JSON.stringify(await db.getAll('session'));
  expect(saved).not.toContain('example-access');
  expect(saved).toContain('session-example');
  db.close();
});
it('HTTP og Worker URLs med credentials afvises', async () => {
  const db = await openDatabase('bad-api-' + crypto.randomUUID());
  for (const url of [
    'http://films.example',
    'https://user:pass@films.example',
    'https://films.example/path?token=bad',
  ])
    await expect(createApi(db, () => url).login('example-access')).rejects.toThrow();
  db.close();
});

it('annullering efter svarheaders bevarer AbortError uden at vise en ny fejl', async () => {
  const db = await openDatabase('api-cancel-body-' + crypto.randomUUID()),
    controller = new AbortController(),
    origin = 'https://films.example.workers.dev';
  await db.put('session', {
    id: 'current',
    token: 'test-session',
    expiresAt: Date.now() + 60000,
    origin,
  });
  const api = createApi(
    db,
    () => origin,
    async () => ({
      ok: true,
      status: 200,
      json: async () => {
        controller.abort();
        throw new DOMException('cancelled', 'AbortError');
      },
    }),
  );
  await expect(
    api.post('/search-movie', { title: 'The Wicked' }, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  db.close();
});

it('et forsinket login må ikke knytte et token til en anden Worker-origin', async () => {
  const db = await openDatabase('api-origin-change-' + crypto.randomUUID());
  let url = 'https://old.example.workers.dev';
  const api = createApi(
    db,
    () => url,
    async () => {
      url = 'https://new.example.workers.dev';
      return new Response(JSON.stringify({ token: 'test-token', expiresAt: Date.now() + 60000 }));
    },
  );
  await expect(api.login('test-access')).rejects.toThrow('Worker-adressen blev ændret');
  expect(await db.get('session', 'current')).toBeUndefined();
  db.close();
});

it.each([
  [413, {}, /for stor/i],
  [503, {}, /opsætning/i],
  [502, { code: 'PROVIDER_AUTH' }, /PROVIDER_AUTH/],
  [429, { code: 'PROVIDER_QUOTA' }, /PROVIDER_QUOTA/],
  [502, { code: 'AI_INCOMPLETE' }, /AI_INCOMPLETE/],
])(
  'HTTP %s giver en sikker fejl, som kan bruges til fejlfinding',
  async (status, body, expected) => {
    const db = await openDatabase('api-diagnostic-' + crypto.randomUUID());
    const origin = 'https://films.example.workers.dev';
    await db.put('session', {
      id: 'current',
      token: 'mock-token',
      expiresAt: Date.now() + 60000,
      origin,
    });
    const api = createApi(
      db,
      () => origin,
      async () =>
        new Response(
          JSON.stringify({
            ...body,
            error: 'private-provider-content',
          }),
          { status, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(api.post('/identify-cover', { image: 'mock-image' })).rejects.toThrow(expected);
    await expect(api.post('/identify-cover', { image: 'mock-image' })).rejects.not.toThrow(
      'private-provider-content',
    );
    expect(await db.get('session', 'current')).toMatchObject({ token: 'mock-token' });
    db.close();
  },
);

it('ukendte fejlkoder og rå providerfejl vises aldrig i appen', async () => {
  const db = await openDatabase('api-untrusted-error-' + crypto.randomUUID());
  const origin = 'https://films.example.workers.dev';
  await db.put('session', {
    id: 'current',
    token: 'mock-token',
    expiresAt: Date.now() + 60000,
    origin,
  });
  const api = createApi(
    db,
    () => origin,
    async () =>
      new Response(
        JSON.stringify({
          code: 'private-code-and-credential',
          error: 'private-provider-content',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  await expect(api.post('/identify-cover', {})).rejects.not.toThrow(/private-/);
  db.close();
});
