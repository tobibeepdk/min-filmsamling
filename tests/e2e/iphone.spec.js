import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
// Routed API mocks must stay visible to Playwright instead of passing through a service worker.
test.use({ serviceWorkers: 'block' });
const wicked = {
  title: 'The Wicked',
  originalTitle: 'The Wicked',
  year: 2013,
  plot: 'Teenagere opsøger en mystisk skov.',
  genre: 'Gyser',
  director: 'Peter Winther',
  actors: 'Devon Werkheiser',
  runtime: 105,
  source: 'tmdb',
  cover: '',
  score: 1,
};
const recognition = {
  recognized: true,
  title: 'The Wicked',
  originalTitle: 'The Wicked',
  year: 2013,
  confidence: 0.94,
  visibleText: ['THE WICKED'],
  candidates: [{ title: 'The Wicked', year: 2013, confidence: 0.94 }],
};
async function setup(page, { low = false, legacy = false, url = './' } = {}) {
  await page.addInitScript(
    ({ legacy }) => {
      if (legacy && !localStorage.getItem('fixtureLoaded')) {
        localStorage.setItem(
          'filmsamling_v4',
          JSON.stringify([
            {
              id: 'old',
              title: 'Gammel film',
              notes: 'Bevar noten',
              location: 'Reol 2',
              favorite: true,
              watched: true,
            },
          ]),
        );
        localStorage.setItem(
          'filmsamling_draft_v4',
          JSON.stringify({ title: 'Gammel kladde', notes: 'Kladde-note' }),
        );
        localStorage.setItem(
          'filmsamling_settings_v4',
          JSON.stringify({ language: 'da-DK', tmdbToken: 'example-old-credential' }),
        );
        localStorage.setItem('fixtureLoaded', 'true');
      }
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            const c = document.createElement('canvas');
            c.width = 640;
            c.height = 960;
            const x = c.getContext('2d');
            x.fillRect(0, 0, 640, 960);
            x.fillStyle = 'white';
            x.font = 'bold 50px sans-serif';
            x.fillText('THE WICKED', 30, 450);
            if (c.captureStream) return c.captureStream(5);
            throw new DOMException('Mock fallback', 'NotAllowedError');
          },
        },
      });
      globalThis.BarcodeDetector = class {
        static async getSupportedFormats() {
          return ['ean_13', 'ean_8', 'upc_a'];
        }
        async detect() {
          return [{ rawValue: '7393834487707' }];
        }
      };
    },
    { legacy },
  );
  await page.route('https://films.example.workers.dev/**', async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/session'
        ? { token: 'mock-session', expiresAt: new Date(Date.now() + 3600000).toISOString() }
        : path === '/lookup-barcode'
          ? { found: false }
          : path === '/identify-cover'
            ? {
                ...recognition,
                confidence: low ? 0.6 : 0.94,
                candidates: low
                  ? [
                      { title: 'The Wicked', year: 2013, confidence: 0.6 },
                      { title: 'Wicked', year: 2024, confidence: 0.4 },
                    ]
                  : recognition.candidates,
              }
            : path === '/search-movie'
              ? { configured: true, candidates: [wicked], selected: wicked }
              : { ok: true };
    await route.fulfill({ json: body, headers });
  });
  await page.goto(url);
}
async function login(page) {
  await page.getByRole('button', { name: 'Indstillinger', exact: true }).click();
  await page.getByLabel('Worker-adresse').fill('https://films.example.workers.dev');
  await page.getByLabel('Adgangsnøgle').fill('example-access');
  await page.getByRole('button', { name: 'Log ind', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Logget ind');
}
async function uploadCover(page) {
  const bytes = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 150;
    c.getContext('2d').fillRect(0, 0, 100, 150);
    return [...atob(c.toDataURL('image/png').split(',')[1])].map((c) => c.charCodeAt(0));
  });
  await page
    .getByLabel('Tag eller vælg coverfoto')
    .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
}
async function isolatedOfflineServer() {
  const directory = resolve('dist');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/min-filmsamling/')) {
      response.writeHead(404).end();
      return;
    }
    const path = resolve(directory, pathname.slice('/min-filmsamling/'.length) || 'index.html');
    if (!path.startsWith(directory + '/')) {
      response.writeHead(404).end();
      return;
    }
    try {
      const contents = await readFile(path);
      response.writeHead(200, {
        'Content-Type': mime[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        Vary: 'Origin',
        'Access-Control-Allow-Origin': request.headers.origin || '*',
      });
      response.end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/min-filmsamling/`,
    close: () =>
      new Promise((done) => {
        if (!server.listening) {
          done();
          return;
        }
        server.close(done);
        server.closeAllConnections();
      }),
  };
}
test('ukendt EAN går til AI og gemmer The Wicked uden titelindtastning', async ({
  page,
  browserName,
}) => {
  await setup(page);
  await login(page);
  await page.getByRole('button', { name: 'Film', exact: true }).click();
  await page.getByRole('button', { name: 'Scan stregkode', exact: true }).click();
  if (browserName === 'webkit') {
    await page.getByLabel('Stregkodenummer').fill('7393834487707');
    await page.getByRole('button', { name: 'Brug nummer' }).click();
  }
  await expect(
    page.getByText('Stregkoden er ukendt. Tag et billede af forsiden, så finder appen filmen.'),
  ).toBeVisible();
  await uploadCover(page);
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Instruktør')).toHaveValue('Peter Winther');
  await page.getByLabel('Noter').fill('Min personlige note');
  await page.getByRole('button', { name: 'Gem film', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The Wicked' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The Wicked' })).toBeVisible();
  let calls = 0;
  await page.route('https://films.example.workers.dev/lookup-barcode', (route) => {
    calls++;
    return route.abort();
  });
  await page.getByRole('button', { name: 'Scan stregkode', exact: true }).click();
  if (browserName === 'webkit') {
    await page.getByLabel('Stregkodenummer').fill('7393834487707');
    await page.getByRole('button', { name: 'Brug nummer' }).click();
  }
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  expect(calls).toBe(0);
});
test('lav confidence giver store kandidatknapper', async ({ page }) => {
  await setup(page, { low: true });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Noter').fill('Denne kladde bevares');
  await page.getByRole('button', { name: 'Find film fra cover' }).click();
  await uploadCover(page);
  await page.getByRole('button', { name: 'The Wicked · 2013', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Noter')).toHaveValue('Denne kladde bevares');
});
test('migration bevarer samling og kladde og fjerner gammelt token', async ({ page }) => {
  await setup(page, { legacy: true });
  await expect(page.getByRole('heading', { name: 'Gammel film' })).toBeVisible();
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Gammel kladde');
  expect(await page.evaluate(() => localStorage.getItem('filmsamling_settings_v4'))).not.toContain(
    'example-old-credential',
  );
});
test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });
  test('gemte film vises offline med service worker', async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    // WebKit's runner-level setOffline rejects navigation before its SW can serve it.
    // Shut down a real isolated origin instead; every shell response must still come from Cache API.
    const isolated = browserName === 'webkit' ? await isolatedOfflineServer() : null;
    try {
      await setup(page, { legacy: true, url: isolated?.url || './' });
      await expect(page.getByRole('heading', { name: 'Gammel film', exact: true })).toBeVisible();
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
      const cached = await page.evaluate(async () => {
        const assets = [
          ...new Set([
            new URL('index.html', location.href).href,
            ...performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .filter(
                (url) =>
                  url.startsWith(location.origin + '/min-filmsamling/') &&
                  (url.includes('/assets/') || url.endsWith('/boot.js')),
              ),
          ]),
        ];
        const missing = [];
        for (const url of assets) {
          const response = await caches.match(url);
          if (!response?.ok) missing.push(url);
        }
        return {
          assets,
          missing,
          cacheNames: (await caches.keys()).filter((name) => name.startsWith('filmsamling-')),
        };
      });
      expect(cached.cacheNames.length).toBeGreaterThan(0);
      expect(cached.assets.some((url) => url.endsWith('.js'))).toBe(true);
      expect(
        cached.missing,
        'The active shell and every loaded JS/CSS resource must be cached together',
      ).toEqual([]);
      await page.evaluate(() => {
        // Offline reload must read IndexedDB, never recreate films from the legacy fixture.
        for (const key of ['filmsamling_v4', 'filmsamling_draft_v4', 'filmsamling_settings_v4'])
          localStorage.removeItem(key);
        window.offlineReloadMarker = 'original-page';
      });
      if (isolated) {
        await isolated.close();
        const rejected = await page.evaluate(async () => {
          try {
            await fetch(new URL('uncached-offline-probe', location.href), { cache: 'no-store' });
            return false;
          } catch {
            return true;
          }
        });
        expect(rejected, 'The test origin must be unreachable, not replaced by routed HTML').toBe(
          true,
        );
      } else await context.setOffline(true);
      try {
        const response = await page.reload({ waitUntil: 'domcontentloaded' });
        expect(response.status()).toBe(200);
      } catch (error) {
        const evidence = await page.evaluate(() => ({
          online: navigator.onLine,
          marker: window.offlineReloadMarker,
          ready: window.filmsamlingReady,
          controller: navigator.serviceWorker.controller?.scriptURL,
          title: document.querySelector('.movie-card h3')?.textContent,
        }));
        await testInfo.attach('offline-reload-evidence', {
          body: JSON.stringify({ cached, evidence }, null, 2),
          contentType: 'application/json',
        });
        throw error;
      }
      await page.waitForFunction(
        () => window.filmsamlingReady === true && window.offlineReloadMarker === undefined,
      );
      if (!isolated) expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      await expect(page.getByRole('heading', { name: 'Gammel film', exact: true })).toBeVisible();
      if (!isolated) await expect(page.locator('#network')).toContainText('Offline');
      else
        expect(
          await page.evaluate(async () => {
            try {
              await fetch(new URL('uncached-offline-probe-after-reload', location.href), {
                cache: 'no-store',
              });
              return false;
            } catch {
              return true;
            }
          }),
        ).toBe(true);
      const films = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('filmsamling-v2');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const movies = await new Promise((resolve, reject) => {
          const request = db.transaction('movies', 'readonly').objectStore('movies').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return movies;
      });
      expect(films).toHaveLength(1);
      expect(films[0]).toMatchObject({
        id: 'old',
        title: 'Gammel film',
        notes: 'Bevar noten',
        location: 'Reol 2',
        favorite: true,
        watched: true,
      });
      await page
        .locator('article')
        .getByRole('button', { name: 'Åbn og rediger', exact: true })
        .click();
      await expect(page.getByLabel('Noter')).toHaveValue('Bevar noten');
      await expect(page.getByLabel('Placering')).toHaveValue('Reol 2');
    } finally {
      await isolated?.close();
    }
  });
});
test('manglende modul viser brugbar fejl frem for hvid skærm', async ({ page }) => {
  await page.route('**/assets/*', (route) => route.abort());
  await page.goto('./');
  await expect(page.getByText('Appen kunne ikke starte', { exact: true })).toBeVisible();
});
