import { test, expect } from '@playwright/test';
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
const recognition = {
  recognized: true,
  title: 'The Wicked',
  originalTitle: 'The Wicked',
  year: 2013,
  confidence: 0.94,
  visibleText: ['THE WICKED'],
  candidates: [{ title: 'The Wicked', year: 2013, confidence: 0.94 }],
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
      '/identify-cover': recognition,
      '/search-movie': { configured: true, candidates: [movie], selected: movie },
    };
    const body = handlers[path]
      ? await handlers[path](route.request())
      : defaults[path] || { ok: true };
    try {
      await route.fulfill({ json: body, headers });
    } catch (error) {
      // Delayed requests are intentionally aborted by navigation or retaking a photo.
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

test('et fejlet coveropslag bevarer fotoet og kan prøves igen uden ny titel eller nyt foto', async ({
  page,
}, testInfo) => {
  await setup(page);
  let calls = 0;
  let firstImage;
  await page.route(`${worker}/identify-cover`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    calls += 1;
    const image = route.request().postDataJSON().image;
    if (calls === 1) firstImage = image;
    else expect(image).toBe(firstImage);
    await route.fulfill({
      status: calls === 1 ? 502 : 200,
      json:
        calls === 1 ? { error: 'private-provider-detail', code: 'PROVIDER_TIMEOUT' } : recognition,
      headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin },
    });
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Noter').fill('Bevar mine noter efter fejlen');
  await page.getByLabel('Placering').fill('Reol ved sofaen');
  await page.getByRole('button', { name: 'Find film fra cover', exact: true }).click();
  await uploadCover(page);
  const dialog = page.getByRole('dialog', { name: 'Find film fra cover', exact: true });
  await expect(dialog).toContainText('PROVIDER_TIMEOUT');
  await expect(dialog).not.toContainText('private-provider-detail');
  await expect(dialog.getByAltText('Dit coverfoto')).toBeVisible();
  await expect(dialog.getByLabel('Coverkamera')).not.toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Tag billede', exact: true })).not.toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('cover-retry.png') });
  await dialog.getByRole('button', { name: 'Prøv analysen igen', exact: true }).click();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Instruktør')).toHaveValue('Peter Winther');
  await expect(page.getByLabel('Noter')).toHaveValue('Bevar mine noter efter fejlen');
  await expect(page.getByLabel('Placering')).toHaveValue('Reol ved sofaen');
  expect(calls).toBe(2);
  expect((await records(page)).drafts.find((draft) => draft.id === 'new')).toMatchObject({
    title: 'The Wicked',
    notes: 'Bevar mine noter efter fejlen',
    location: 'Reol ved sofaen',
  });
});

test('et forsinket genforsøg kan annulleres med nyt foto uden at ændre den nyere kladde', async ({
  page,
}) => {
  await setup(page);
  const requested = deferred();
  const release = deferred();
  let calls = 0;
  await page.route(`${worker}/identify-cover`, async (route) => {
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
        json: ownCall === 1 ? { code: 'PROVIDER_TIMEOUT' } : recognition,
        headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin },
      });
    } catch (error) {
      if (!route.request().failure() && !page.isClosed()) throw error;
    }
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Noter').fill('Noten må ikke mistes ved genforsøg');
  await page.getByRole('button', { name: 'Find film fra cover', exact: true }).click();
  await uploadCover(page);
  await page.getByRole('button', { name: 'Prøv analysen igen', exact: true }).click();
  await requested.promise;
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url() === `${worker}/identify-cover`,
  });
  await page.getByRole('button', { name: 'Tag nyt billede', exact: true }).click();
  await cancelled;
  release.resolve();
  await expect(
    page.getByRole('dialog', { name: 'Find film fra cover', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('');
  await uploadCover(page);
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Noter')).toHaveValue('Noten må ikke mistes ved genforsøg');
});

test('et utilgængeligt livekamera viser foto-reserven uden et sort kamerafelt', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Find film fra cover', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Find film fra cover', exact: true });
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
  await page.getByRole('button', { name: 'Find film fra cover', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Find film fra cover', exact: true });
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

for (const source of ['stregkode', 'cover']) {
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
    if (source === 'cover') {
      await page.getByRole('button', { name: 'Find film fra cover', exact: true }).click();
      await uploadCover(page);
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

for (const action of ['Find film fra cover', 'Hent filmoplysninger']) {
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

test('et gammelt coversvar lukker ikke kameraet efter Tag nyt billede', async ({ page }) => {
  const requested = deferred();
  const release = deferred();
  let coverCalls = 0;
  await setup(page, {
    '/identify-cover': async () => {
      coverCalls += 1;
      if (coverCalls === 1) {
        requested.resolve();
        await release.promise;
      }
      return recognition;
    },
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Noter').fill('Bevar ved nyt foto');
  await page.getByRole('button', { name: 'Find film fra cover', exact: true }).click();
  await uploadCover(page);
  await requested.promise;
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url() === `${worker}/identify-cover`,
  });
  await page.getByRole('button', { name: 'Tag nyt billede', exact: true }).click();
  await cancelled;
  release.resolve();
  await expect(
    page.getByRole('dialog', { name: 'Find film fra cover', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('');
  await uploadCover(page);
  await expect(page.getByLabel('Instruktør')).toHaveValue('Peter Winther');
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Noter')).toHaveValue('Bevar ved nyt foto');
  expect(coverCalls).toBe(2);
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

test('lav cover-confidence kan forbedres med beskæring uden at miste noter', async ({ page }) => {
  const images = [];
  await setup(page, {
    '/identify-cover': (request) => {
      images.push(request.postDataJSON().image);
      return images.length === 1
        ? {
            ...recognition,
            confidence: 0.6,
            candidates: [
              { title: 'The Wicked', year: 2013, confidence: 0.6 },
              { title: 'Wicked', year: 2024, confidence: 0.4 },
            ],
          }
        : recognition;
    },
  });
  await login(page);
  await page.getByRole('button', { name: 'Tilføj', exact: true }).click();
  await page.getByLabel('Noter').fill('Note før beskæring');
  await page.getByRole('button', { name: 'Find film fra cover', exact: true }).click();
  await uploadCover(page);
  await page.getByRole('button', { name: 'Beskær titelområdet og prøv igen', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Beskær titelområdet', exact: true }),
  ).toBeVisible();
  for (const [label, value] of [
    ['Venstre', 10],
    ['Højre', 90],
    ['Top', 20],
    ['Bund', 80],
  ]) {
    const slider = page.getByRole('slider', { name: label, exact: true });
    await expect(slider).toBeVisible();
    await slider.evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  await page.getByRole('button', { name: 'Beskær og prøv igen', exact: true }).click();
  await expect(page.getByLabel('Instruktør')).toHaveValue('Peter Winther');
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('The Wicked');
  await expect(page.getByLabel('Noter')).toHaveValue('Note før beskæring');
  expect(images).toHaveLength(2);
  expect(images[0]).toMatch(/^data:image\/jpeg;base64,/);
  expect(images[1]).toMatch(/^data:image\/jpeg;base64,/);
  expect(images[1]).not.toBe(images[0]);
});
