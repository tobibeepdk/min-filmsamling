import { test, expect } from './fixtures.js';
// Real service-worker behavior is verified separately; these tests route the Worker API.
test.use({ serviceWorkers: 'block' });

const worker = 'https://films.example.workers.dev';
const movie = {
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
const filmA = {
  id: 'film-a',
  title: 'Film A',
  format: 'DVD',
  notes: 'Original note A',
  location: 'Reol A',
  favorite: true,
  watched: true,
};
const filmB = {
  id: 'film-b',
  title: 'Film B',
  format: 'Blu-ray',
  barcode: '7393834487707',
  notes: 'Original note B',
  location: 'Reol B',
  favorite: false,
  watched: false,
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(page, handlers = {}) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Use file capture in this regression', 'NotAllowedError');
        },
      },
    });
    globalThis.BarcodeDetector = undefined;
  });
  await page.route(`${worker}/**`, async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': new URL(page.url()).origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const path = new URL(route.request().url()).pathname;
    const defaults = {
      '/session': {
        token: 'mock-session',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      '/lookup-barcode': { found: false },
      '/search-movie': { configured: true, candidates: [movie], selected: movie },
    };
    const body = handlers[path]
      ? await handlers[path](route.request())
      : defaults[path] || { ok: true };
    try {
      await route.fulfill({ json: body, headers });
    } catch (error) {
      // Delayed requests are intentionally aborted by navigation or starting another operation.
      if (!route.request().failure() && !page.isClosed()) throw error;
    }
  });
  await page.goto('./');
  await page.waitForFunction(() => window.filmsamlingReady === true);
}

async function login(page) {
  await page.getByRole('button', { name: 'Indstillinger', exact: true }).click();
  await page.getByLabel('Worker-adresse').fill(worker);
  await page.getByLabel('Adgangsnøgle').fill('example-access');
  await page.getByRole('button', { name: 'Log ind', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Logget ind');
}

async function seed(page, films, mappings = []) {
  await page.evaluate(
    async ({ films, mappings }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('filmsamling-v2');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['movies', 'barcodeMap'], 'readwrite');
        films.forEach((film) => tx.objectStore('movies').put(film));
        mappings.forEach((mapping) => tx.objectStore('barcodeMap').put(mapping));
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    { films, mappings },
  );
}

async function records(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('filmsamling-v2');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(['movies', 'drafts'], 'readonly');
      const data = {};
      for (const store of ['movies', 'drafts']) {
        const request = tx.objectStore(store).getAll();
        request.onsuccess = () => {
          data[store] = request.result;
        };
      }
      tx.oncomplete = () => resolve(data);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close();
    return result;
  });
}

async function uploadCover(page) {
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

test('kendt stregkode henter filmdata uden titelindtastning og genbruger lokal kobling', async ({
  page,
}) => {
  const treasure = {
    ...movie,
    title: 'National Treasure',
    originalTitle: 'National Treasure',
    year: 2004,
    genre: 'Eventyr',
    runtime: 131,
    tmdbId: 100,
  };
  let barcodeCalls = 0;
  let searchCalls = 0;
  await setup(page, {
    '/lookup-barcode': (request) => {
      barcodeCalls += 1;
      expect(request.postDataJSON()).toEqual({ barcode: '7393834487707' });
      // The real adapter's edition removal is covered by worker.test.js.
      return { found: true, title: 'National Treasure', format: 'DVD', source: 'upcitemdb' };
    },
    '/search-movie': (request) => {
      searchCalls += 1;
      expect(request.postDataJSON().title).toBe('National Treasure');
      return { configured: true, candidates: [treasure], selected: treasure };
    },
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('');
  await page.getByLabel('Noter').fill('Min note før scanning');
  await page.getByLabel('Placering').fill('Reol 4');
  await page.getByRole('button', { name: 'Scan stregkode', exact: true }).click();
  await page.getByLabel('Stregkodenummer').fill('7393834487707');
  await page.getByRole('button', { name: 'Brug nummer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Filmoplysninger hentet');
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('National Treasure');
  await expect(page.getByLabel('Originaltitel', { exact: true })).toHaveValue('National Treasure');
  await expect(page.getByLabel('År', { exact: true })).toHaveValue('2004');
  await expect(page.getByLabel('Genre', { exact: true })).toHaveValue('Eventyr');
  await expect(page.getByLabel('Spilletid (minutter)', { exact: true })).toHaveValue('131');
  await expect(page.getByLabel('Noter')).toHaveValue('Min note før scanning');
  await expect(page.getByLabel('Placering')).toHaveValue('Reol 4');
  await page.getByRole('button', { name: 'Gem film', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'National Treasure', exact: true })).toBeVisible();
  expect((await records(page)).movies[0]).toMatchObject({
    title: 'National Treasure',
    year: '2004',
    barcode: '7393834487707',
    notes: 'Min note før scanning',
    location: 'Reol 4',
  });
  await page.reload();
  await page.getByRole('button', { name: 'Scan stregkode', exact: true }).click();
  await page.getByLabel('Stregkodenummer').fill('7393834487707');
  await page.getByRole('button', { name: 'Brug nummer', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('National Treasure');
  await expect(page.getByLabel('År', { exact: true })).toHaveValue('2004');
  expect(barcodeCalls).toBe(1);
  expect(searchCalls).toBe(1);
});

test('et fejlet titelopslag kan prøves igen og bevarer eget foto og brugerens felter', async ({
  page,
}) => {
  await setup(page);
  let calls = 0;
  await page.route(`${worker}/search-movie`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    calls += 1;
    expect(route.request().postDataJSON().title).toBe('The Wicked');
    await route.fulfill({
      status: calls === 1 ? 502 : 200,
      json:
        calls === 1
          ? { error: 'private-provider-detail', code: 'PROVIDER_TIMEOUT' }
          : { configured: true, candidates: [movie], selected: movie },
      headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin },
    });
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Noter').fill('Bevar mine noter efter fejlen');
  await page.getByLabel('Placering').fill('Reol ved sofaen');
  await page.getByRole('button', { name: 'Tag eget coverfoto', exact: true }).click();
  await uploadCover(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const coverId = (await records(page)).drafts.find((draft) => draft.id === 'new').coverId;
  await page.getByRole('button', { name: 'Søg efter film', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Søg efter film', exact: true });
  await search.getByLabel('Filmtitel', { exact: true }).fill('The Wicked');
  await search.getByRole('button', { name: 'Søg', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('PROVIDER_TIMEOUT');
  await expect(page.getByRole('status')).not.toContainText('private-provider-detail');
  await expect(page.locator('.cover-editor img')).toBeVisible();
  await page.getByRole('button', { name: 'Hent filmoplysninger', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Instruktør')).toHaveValue('Peter Winther');
  await expect(page.getByLabel('Noter')).toHaveValue('Bevar mine noter efter fejlen');
  await expect(page.getByLabel('Placering')).toHaveValue('Reol ved sofaen');
  expect(calls).toBe(2);
  expect((await records(page)).drafts.find((draft) => draft.id === 'new')).toMatchObject({
    title: 'The Wicked',
    notes: 'Bevar mine noter efter fejlen',
    location: 'Reol ved sofaen',
    coverId,
    coverSource: 'own',
  });
});

test('et forsinket genforsøg kan afbrydes af en ny titelsøgning uden at ændre den nyere kladde', async ({
  page,
}) => {
  await setup(page);
  const requested = deferred();
  const release = deferred();
  let calls = 0;
  await page.route(`${worker}/search-movie`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    calls += 1;
    const ownCall = calls;
    if (ownCall === 2) {
      requested.resolve();
      await release.promise;
    }
    try {
      await route.fulfill({
        status: ownCall === 1 ? 502 : 200,
        json:
          ownCall === 1
            ? { code: 'PROVIDER_TIMEOUT' }
            : { configured: true, candidates: [movie], selected: movie },
        headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin },
      });
    } catch (error) {
      if (!route.request().failure() && !page.isClosed()) throw error;
    }
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Noter').fill('Noten må ikke mistes ved genforsøg');
  await page.getByLabel('Titel', { exact: true }).fill('Første søgetitel');
  await page.getByRole('button', { name: 'Hent filmoplysninger', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('PROVIDER_TIMEOUT');
  await page.getByRole('button', { name: 'Hent filmoplysninger', exact: true }).click();
  await requested.promise;
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url() === `${worker}/search-movie`,
  });
  await page.getByLabel('Titel', { exact: true }).fill('Nyere søgetitel');
  await page.getByRole('button', { name: 'Søg efter film', exact: true }).click();
  await cancelled;
  release.resolve();
  const search = page.getByRole('dialog', { name: 'Søg efter film', exact: true });
  await expect(search).toBeVisible();
  await expect(search.getByLabel('Filmtitel', { exact: true })).toHaveValue('Nyere søgetitel');
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Nyere søgetitel');
  await search.getByLabel('Filmtitel', { exact: true }).fill('The Wicked');
  await search.getByRole('button', { name: 'Søg', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Noter')).toHaveValue('Noten må ikke mistes ved genforsøg');
});

test('et utilgængeligt livekamera viser foto-reserven uden et sort kamerafelt', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByRole('button', { name: 'Tag eget coverfoto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Eget coverfoto', exact: true });
  await expect(dialog).toContainText('Brug fotoknappen');
  await expect(dialog.getByLabel('Coverkamera')).not.toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Tag billede', exact: true })).not.toBeVisible();
  await expect(dialog.getByLabel('Tag eller vælg coverfoto')).toBeVisible();
});

test('et forsinket kamera efter et ugyldigt foto efterlader ingen sort kameraflade', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.stoppedCameraTracks = 0;
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        window.finishCameraStartup = () =>
          resolve({
            getTracks: () => [
              {
                stop: () => {
                  window.stoppedCameraTracks += 1;
                },
              },
            ],
          });
      });
  });
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByRole('button', { name: 'Tag eget coverfoto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Eget coverfoto', exact: true });
  await dialog.getByLabel('Tag eller vælg coverfoto').setInputFiles({
    name: 'invalid.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not-a-photo'),
  });
  await expect(dialog).toContainText('Vælg en billedfil');
  await page.evaluate(() => window.finishCameraStartup());
  await expect.poll(() => page.evaluate(() => window.stoppedCameraTracks)).toBe(1);
  await expect(dialog.getByLabel('Coverkamera')).not.toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Tag billede', exact: true })).not.toBeVisible();
  await expect(dialog.getByLabel('Tag eller vælg coverfoto')).toBeVisible();
});

for (const source of ['stregkode', 'titelsøgning']) {
  test(`metadatafejl efter ${source} vises og bevarer den fundne titel og brugerens noter`, async ({
    page,
  }) => {
    await setup(page, {
      '/lookup-barcode': () => ({
        found: true,
        title: 'The Wicked',
        format: 'DVD',
        source: 'upcitemdb',
      }),
    });
    await page.route(`${worker}/search-movie`, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      await route.fulfill({
        status: 502,
        json: { code: 'PROVIDER_AUTH', error: 'private-provider-detail' },
        headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin },
      });
    });
    await login(page);
    await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
    await page.getByLabel('Noter').fill('Bevar trods metadatafejl');
    if (source === 'titelsøgning') {
      await page.getByRole('button', { name: 'Søg efter film', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Søg efter film', exact: true });
      await dialog.getByLabel('Filmtitel', { exact: true }).fill('The Wicked');
      await dialog.getByRole('button', { name: 'Søg', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Scan stregkode', exact: true }).click();
      await page.getByLabel('Stregkodenummer').fill('7393834487707');
      await page.getByRole('button', { name: 'Brug nummer', exact: true }).click();
    }
    await expect(page.getByRole('status')).toContainText('PROVIDER_AUTH');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
    await expect(page.getByLabel('Noter')).toHaveValue('Bevar trods metadatafejl');
    await page.getByRole('button', { name: 'Gem film', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The Wicked', exact: true })).toBeVisible();
    expect((await records(page)).movies[0]).toMatchObject({
      title: 'The Wicked',
      notes: 'Bevar trods metadatafejl',
    });
  });
}

test('en ny lokal stregkodescanning overskriver ikke en annulleret filmredigering', async ({
  page,
}) => {
  let remoteLookups = 0;
  await setup(page, {
    '/lookup-barcode': () => {
      remoteLookups += 1;
      return { found: false };
    },
  });
  await seed(page, [filmA, filmB], [{ id: '7393834487707', movieId: 'film-b', title: 'Film B' }]);
  await page.getByRole('button', { name: 'Film', exact: true }).click();
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Film A', exact: true }) })
    .getByRole('button', { name: 'Åbn og rediger' })
    .click();
  await page.getByLabel('Noter').fill('Kladde til redigering af A');
  await page.getByRole('button', { name: 'Annuller – behold kladden', exact: true }).click();
  await page.getByRole('button', { name: 'Scan stregkode', exact: true }).click();
  await page.getByLabel('Stregkodenummer').fill('7393834487707');
  await page.getByRole('button', { name: 'Brug nummer', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Film B');
  await expect(page.getByRole('heading', { name: 'Tilføj film', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Gem film', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Film A', exact: true })).toBeVisible();
  const saved = await records(page);
  expect(saved.movies).toHaveLength(3);
  expect(saved.movies.find((film) => film.id === 'film-a')).toMatchObject(filmA);
  expect(
    saved.movies.find((film) => film.id !== 'film-b' && film.title === 'Film B'),
  ).toBeDefined();
  expect(saved.drafts.find((draft) => draft.id === 'edit:film-a')).toMatchObject({
    title: 'Film A',
    notes: 'Kladde til redigering af A',
    editingMovieId: 'film-a',
  });
  expect(remoteLookups).toBe(0);
});

test('en ny kladde gendannes efter redigering og gemning af en eksisterende film', async ({
  page,
}) => {
  await setup(page);
  await seed(page, [filmA]);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Ny film der ikke er gemt endnu');
  await page.getByLabel('Noter').fill('Personlig note i den nye kladde');
  await page.getByLabel('Placering').fill('Hylde til den nye film');
  await page.getByRole('button', { name: 'Film', exact: true }).click();
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Film A', exact: true }) })
    .getByRole('button', { name: 'Åbn og rediger' })
    .click();
  await page.getByLabel('Noter').fill('Opdateret note på film A');
  await page.getByRole('button', { name: 'Gem film', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Film A', exact: true })).toBeVisible();
  const saved = await records(page);
  expect(saved.movies).toHaveLength(1);
  expect(saved.movies[0]).toMatchObject({
    id: 'film-a',
    title: 'Film A',
    notes: 'Opdateret note på film A',
  });
  expect(saved.drafts.find((draft) => draft.id === 'new')).toMatchObject({
    title: 'Ny film der ikke er gemt endnu',
    notes: 'Personlig note i den nye kladde',
    location: 'Hylde til den nye film',
  });
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue(
    'Ny film der ikke er gemt endnu',
  );
  await expect(page.getByLabel('Noter')).toHaveValue('Personlig note i den nye kladde');
  await expect(page.getByLabel('Placering')).toHaveValue('Hylde til den nye film');
  await expect(page.getByRole('heading', { name: 'Tilføj film', exact: true })).toBeVisible();
});

for (const action of ['Søg efter film', 'Hent filmoplysninger']) {
  test(`navigation afviser ${action} mens handlingens kladdelagring er i gang`, async ({
    page,
  }) => {
    let searchCalls = 0;
    await setup(page, {
      '/search-movie': () => {
        searchCalls += 1;
        return { configured: true, candidates: [movie], selected: movie };
      },
    });
    await seed(page, [filmA]);
    await login(page);
    await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
    await page.getByLabel('Titel', { exact: true }).fill('Kladde før navigation');
    await page.getByLabel('Noter').fill('Gem noten før API og kamera starter');
    await page.evaluate((label) => {
      const trigger = [...document.querySelectorAll('#film-form button')].find(
        (button) => button.textContent === label,
      );
      trigger.click();
      document.querySelector('nav button[data-view="library"]').click();
    }, action);
    await expect(page.getByRole('heading', { name: 'Film A', exact: true })).toBeVisible();
    // Let queued actions and the resulting render finish before checking for a late modal.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(searchCalls).toBe(0);
    const saved = await records(page);
    expect(saved.movies).toHaveLength(1);
    expect(saved.movies[0]).toMatchObject(filmA);
    expect(saved.drafts.find((draft) => draft.id === 'new')).toMatchObject({
      title: 'Kladde før navigation',
      notes: 'Gem noten før API og kamera starter',
    });
  });
}

test('noter og placering skrevet under filmopslag bevares, når svaret ankommer', async ({
  page,
}) => {
  const requested = deferred();
  const release = deferred();
  await setup(page, {
    '/search-movie': async () => {
      requested.resolve();
      await release.promise;
      return { configured: true, candidates: [movie], selected: movie };
    },
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('The Wicked');
  await page.getByRole('button', { name: 'Hent filmoplysninger', exact: true }).click();
  await requested.promise;
  await page.getByLabel('Noter').fill('Skrevet mens opslaget var i gang');
  await page.getByLabel('Placering').fill('Reol under trappen');
  release.resolve();
  await expect(page.getByLabel('Instruktør')).toHaveValue('Peter Winther');
  await expect(page.getByLabel('Noter')).toHaveValue('Skrevet mens opslaget var i gang');
  await expect(page.getByLabel('Placering')).toHaveValue('Reol under trappen');
  await page.getByRole('button', { name: 'Gem film', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The Wicked', exact: true })).toBeVisible();
  expect((await records(page)).movies[0]).toMatchObject({
    notes: 'Skrevet mens opslaget var i gang',
    location: 'Reol under trappen',
  });
});

test('et gammelt filmsvar lukker ikke et nyere lokalt coverkamera', async ({ page }) => {
  const requested = deferred();
  const release = deferred();
  await setup(page, {
    '/search-movie': async () => {
      requested.resolve();
      await release.promise;
      return { configured: true, candidates: [movie], selected: movie };
    },
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Min manuelt rettede titel');
  await page.getByLabel('Noter').fill('Bevar ved nyt foto');
  await page.getByRole('button', { name: 'Hent filmoplysninger', exact: true }).click();
  await requested.promise;
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url() === `${worker}/search-movie`,
  });
  await page.getByRole('button', { name: 'Tag eget coverfoto', exact: true }).click();
  await cancelled;
  release.resolve();
  await expect(page.getByRole('dialog', { name: 'Eget coverfoto', exact: true })).toBeVisible();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Min manuelt rettede titel');
  await uploadCover(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Min manuelt rettede titel');
  await expect(page.getByLabel('Instruktør')).toHaveValue('');
  await expect(page.getByLabel('Noter')).toHaveValue('Bevar ved nyt foto');
  await expect(page.locator('.cover-editor img')).toBeVisible();
});

test('navigation til samlingen under et opslag bevarer film og tilføjelseskladde', async ({
  page,
}) => {
  const requested = deferred();
  const release = deferred();
  await setup(page, {
    '/search-movie': async () => {
      requested.resolve();
      await release.promise;
      return { configured: true, candidates: [movie], selected: movie };
    },
  });
  await seed(page, [filmA]);
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Ufærdig film');
  await page.getByLabel('Noter').fill('Bevar denne tilføjelseskladde');
  await page.getByRole('button', { name: 'Hent filmoplysninger', exact: true }).click();
  await requested.promise;
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url() === `${worker}/search-movie`,
  });
  await page.getByRole('button', { name: 'Film', exact: true }).click();
  await cancelled;
  release.resolve();
  await expect(page.getByRole('heading', { name: 'Film A', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await records(page);
  expect(saved.movies).toHaveLength(1);
  expect(saved.movies[0]).toMatchObject(filmA);
  expect(saved.drafts.find((draft) => draft.id === 'new')).toMatchObject({
    title: 'Ufærdig film',
    notes: 'Bevar denne tilføjelseskladde',
  });
  await page.reload();
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Ufærdig film');
  await expect(page.getByLabel('Noter')).toHaveValue('Bevar denne tilføjelseskladde');
});

test('usikker titelsøgning kan præciseres med år uden at miste noter eller eget cover', async ({
  page,
}) => {
  const searches = [];
  await setup(page, {
    '/search-movie': (request) => {
      searches.push(request.postDataJSON());
      return searches.length === 1
        ? {
            configured: true,
            selected: null,
            candidates: [
              { ...movie, score: 0.76 },
              { ...movie, title: 'Wicked', year: 2024, score: 0.74 },
            ],
          }
        : { configured: true, candidates: [movie], selected: movie };
    },
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Noter').fill('Note før præcisering');
  await page.getByRole('button', { name: 'Tag eget coverfoto', exact: true }).click();
  await uploadCover(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const coverId = (await records(page)).drafts.find((draft) => draft.id === 'new').coverId;
  await page.getByRole('button', { name: 'Søg efter film', exact: true }).click();
  let search = page.getByRole('dialog', { name: 'Søg efter film', exact: true });
  await search.getByLabel('Filmtitel', { exact: true }).fill('Wicked');
  await search.getByRole('button', { name: 'Søg', exact: true }).click();
  const choices = page.getByRole('dialog', { name: 'Vælg den rigtige film', exact: true });
  await expect(choices.getByRole('button', { name: 'Wicked · 2024', exact: true })).toBeVisible();
  await choices.getByRole('button', { name: 'Annuller – behold kladden', exact: true }).click();
  await page.getByRole('button', { name: 'Søg efter film', exact: true }).click();
  search = page.getByRole('dialog', { name: 'Søg efter film', exact: true });
  await search.getByLabel('Filmtitel', { exact: true }).fill('The Wicked');
  await search.getByLabel('År (valgfrit)', { exact: true }).fill('2013');
  await search.getByRole('button', { name: 'Søg', exact: true }).click();
  await expect(page.getByLabel('Instruktør')).toHaveValue('Peter Winther');
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Noter')).toHaveValue('Note før præcisering');
  await expect(page.locator('.cover-editor img')).toBeVisible();
  expect((await records(page)).drafts.find((draft) => draft.id === 'new')).toMatchObject({
    coverId,
    coverSource: 'own',
    notes: 'Note før præcisering',
  });
  expect(searches).toEqual([
    { title: 'Wicked', originalTitle: '', year: null },
    { title: 'The Wicked', originalTitle: '', year: 2013 },
  ]);
});
