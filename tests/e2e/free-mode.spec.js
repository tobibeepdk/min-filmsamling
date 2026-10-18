import { test, expect } from './fixtures.js';

// Only the external API and camera are mocked; forms, IndexedDB, and image processing stay real.
test.use({ serviceWorkers: 'block' });
const worker = 'https://films.example.workers.dev';
const wicked = {
  title: 'The Wicked',
  originalTitle: 'The Wicked',
  year: 2013,
  plot: 'En gruppe teenagere opsøger en skov.',
  genre: 'Gyser',
  director: 'Peter Winther',
  actors: 'Devon Werkheiser',
  runtime: 105,
  source: 'tmdb',
  cover: '',
  score: 1,
};

async function setup(page, { barcodeError = false, candidates = [wicked] } = {}) {
  const requests = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Use the photo fallback', 'NotAllowedError');
        },
      },
    });
    globalThis.BarcodeDetector = undefined;
  });
  await page.route(`${worker}/**`, async (route) => {
    const request = route.request();
    const headers = {
      'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname;
    requests.push({ path, body: request.postDataJSON() });
    const bodies = {
      '/session': {
        token: 'mock-session',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      '/lookup-barcode': barcodeError ? { code: 'PROVIDER_TIMEOUT' } : { found: false },
      '/search-movie': {
        configured: true,
        candidates,
        selected: candidates.length === 1 ? candidates[0] : null,
      },
      '/identify-cover': { code: 'PAID_AI_DISABLED' },
    };
    await route.fulfill({
      status: path === '/lookup-barcode' && barcodeError ? 502 : 200,
      json: bodies[path] || { ok: true },
      headers,
    });
  });
  await page.goto('./');
  await page.waitForFunction(() => window.filmsamlingReady === true);
  return requests;
}

async function login(page) {
  await page.getByRole('button', { name: 'Indstillinger', exact: true }).click();
  await page.getByLabel('Worker-adresse').fill(worker);
  await page.getByLabel('Adgangsnøgle').fill('example-access');
  await page.getByRole('button', { name: 'Log ind', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Logget ind');
}

async function scanUnknownBarcode(page) {
  await page.getByRole('button', { name: 'Scan stregkode', exact: true }).click();
  await page.getByLabel('Stregkodenummer').fill('7393834487707');
  await page.getByRole('button', { name: 'Brug nummer', exact: true }).click();
}

async function uploadCover(page) {
  // Same small, generated PNG fixture as the existing camera regressions.
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 300;
    const context = canvas.getContext('2d');
    context.fillStyle = '#19132e';
    context.fillRect(0, 0, 200, 300);
    context.fillStyle = 'white';
    context.font = 'bold 20px sans-serif';
    context.fillText('THE WICKED', 20, 150);
    return [...atob(canvas.toDataURL('image/png').split(',')[1])].map((char) => char.charCodeAt(0));
  });
  await page
    .getByLabel('Tag eller vælg coverfoto')
    .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
}

async function records(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('filmsamling-v2');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(['movies', 'drafts', 'coverBlobs'], 'readonly');
      const data = {};
      for (const store of ['movies', 'drafts', 'coverBlobs']) {
        const request = tx.objectStore(store).getAll();
        request.onsuccess = () => {
          data[store] = request.result;
        };
      }
      tx.oncomplete = () => resolve(data);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close();
    return {
      ...result,
      coverBlobs: await Promise.all(
        result.coverBlobs.map(async ({ id, blob }) => ({
          id,
          type: blob.type,
          size: blob.size,
          signature: [...new Uint8Array(await blob.slice(0, 2).arrayBuffer())],
        })),
      ),
    };
  });
}

// A wrong search route, dropped year, or missing metadata application must break this flow.
test('titelsøgning fra forsiden henter metadata med valgfrit år og gemmer filmen', async ({
  page,
}) => {
  const requests = await setup(page);
  await login(page);
  await page.getByRole('button', { name: 'Film', exact: true }).click();
  await page.getByRole('button', { name: 'Søg efter film', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Søg efter film', exact: true });
  await dialog.getByLabel('Filmtitel', { exact: true }).fill('The Wicked');
  await dialog.getByLabel('År (valgfrit)', { exact: true }).fill('2013');
  await dialog.getByRole('button', { name: 'Søg', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Instruktør')).toHaveValue('Peter Winther');
  await expect(page.getByLabel('År', { exact: true })).toHaveValue('2013');
  await page.getByRole('button', { name: 'Gem film', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The Wicked', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The Wicked', exact: true })).toBeVisible();
  expect(requests.filter(({ path }) => path === '/search-movie')).toEqual([
    { path: '/search-movie', body: { title: 'The Wicked', originalTitle: '', year: 2013 } },
  ]);
  expect(requests.some(({ path }) => path === '/identify-cover')).toBe(false);
});

// Auto-selecting an uncertain result, inventing a title, or losing draft fields is a regression.
test('ukendt stregkode giver titelsøgning og lader brugeren vælge blandt usikre film', async ({
  page,
}) => {
  const requests = await setup(page, {
    candidates: [
      { ...wicked, title: 'Wicked', originalTitle: 'Wicked', year: 2024, score: 0.76 },
      { ...wicked, score: 0.74 },
    ],
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Noter').fill('Min note før scanning');
  await page.getByLabel('Placering').fill('Reol 4');
  await scanUnknownBarcode(page);
  const dialog = page.getByRole('dialog', { name: 'Søg efter film', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/stregkode.*ukendt|ukendt.*stregkode/i);
  await expect(dialog).toContainText(/titel/i);
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Filmtitel', { exact: true }).fill('Wicked');
  await dialog.getByRole('button', { name: 'Søg', exact: true }).click();
  const choices = page.getByRole('dialog', { name: 'Vælg den rigtige film', exact: true });
  await expect(choices.getByRole('button', { name: 'Wicked · 2024', exact: true })).toBeVisible();
  await choices.getByRole('button', { name: 'The Wicked · 2013', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Noter')).toHaveValue('Min note før scanning');
  await expect(page.getByLabel('Placering')).toHaveValue('Reol 4');
  await expect(page.getByLabel('Stregkode', { exact: true })).toHaveValue('7393834487707');
  await page.getByRole('button', { name: 'Gem film', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The Wicked', exact: true })).toBeVisible();
  expect((await records(page)).movies[0]).toMatchObject({
    title: 'The Wicked',
    year: '2013',
    barcode: '7393834487707',
    notes: 'Min note før scanning',
    location: 'Reol 4',
  });
  expect(requests.some(({ path }) => path === '/identify-cover')).toBe(false);
});

// Provider failures must still offer the free fallback and keep the original draft on cancel.
test('stregkodeproviderfejl tilbyder titelsøgning og annullering bevarer kladden', async ({
  page,
}) => {
  const requests = await setup(page, { barcodeError: true });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Min ufærdige film');
  await page.getByLabel('Noter').fill('Bevar ved providerfejl');
  await page.getByLabel('Placering').fill('Kasse 2');
  await scanUnknownBarcode(page);
  const dialog = page.getByRole('dialog', { name: 'Søg efter film', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/titel/i);
  await dialog.getByRole('button', { name: 'Annuller – behold kladden', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Min ufærdige film');
  await expect(page.getByLabel('Noter')).toHaveValue('Bevar ved providerfejl');
  await expect(page.getByLabel('Placering')).toHaveValue('Kasse 2');
  await page.reload();
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Min ufærdige film');
  await expect(page.getByLabel('Noter')).toHaveValue('Bevar ved providerfejl');
  expect(requests.some(({ path }) => path === '/identify-cover')).toBe(false);
  expect(requests.some(({ path }) => path === '/search-movie')).toBe(false);
});

// Uploading an own photo must save real JPEG bytes locally even without an API session.
test('eget coverfoto komprimeres og gemmes lokalt uden login eller AI-kald', async ({ page }) => {
  const requests = await setup(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Min egen film');
  await page.getByLabel('Noter').fill('Mit foto og min note');
  await page.getByRole('button', { name: 'Tag eget coverfoto', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Eget coverfoto', exact: true })).toBeVisible();
  await uploadCover(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Dit eget cover er gemt');
  await page.getByRole('button', { name: 'Gem film', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Min egen film', exact: true })).toBeVisible();
  const saved = await records(page);
  expect(saved.movies[0]).toMatchObject({
    title: 'Min egen film',
    notes: 'Mit foto og min note',
    coverSource: 'own',
  });
  expect(saved.coverBlobs).toHaveLength(1);
  expect(saved.coverBlobs[0]).toMatchObject({
    id: saved.movies[0].coverId,
    type: 'image/jpeg',
    signature: [255, 216],
  });
  expect(saved.coverBlobs[0].size).toBeGreaterThan(0);
  expect(saved.coverBlobs[0].size).toBeLessThanOrEqual(1_500_000);
  await page.reload();
  await page.getByRole('button', { name: 'Åbn og rediger', exact: true }).click();
  await expect(page.getByLabel('Noter')).toHaveValue('Mit foto og min note');
  await expect(page.locator('.cover-editor img')).toBeVisible();
  expect(requests).toEqual([]);
});

// Cancelling the search must not discard a saved own photo or commit unsent search input.
test('annulleret titelsøgning bevarer eget cover, noter og placering efter genindlæsning', async ({
  page,
}) => {
  const requests = await setup(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Behold min titel');
  await page.getByLabel('Noter').fill('Behold min note');
  await page.getByLabel('Placering').fill('Reol B');
  await page.getByRole('button', { name: 'Tag eget coverfoto', exact: true }).click();
  await uploadCover(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = await records(page);
  const coverId = before.drafts.find(({ id }) => id === 'new').coverId;
  await page.getByRole('button', { name: 'Søg efter film', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Søg efter film', exact: true });
  await dialog.getByLabel('Filmtitel', { exact: true }).fill('En anden film');
  await dialog.getByRole('button', { name: 'Annuller – behold kladden', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Behold min titel');
  await expect(page.getByLabel('Noter')).toHaveValue('Behold min note');
  await expect(page.getByLabel('Placering')).toHaveValue('Reol B');
  await expect(page.locator('.cover-editor img')).toBeVisible();
  const after = await records(page);
  expect(after.drafts.find(({ id }) => id === 'new').coverId).toBe(coverId);
  expect(after.coverBlobs).toEqual(before.coverBlobs);
  expect(requests).toEqual([]);
});
