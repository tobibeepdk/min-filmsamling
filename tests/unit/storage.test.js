import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { openDatabase } from '../../src/db.js';
import { migrateLegacy } from '../../src/migration.js';
import { exportBackup, importBackup } from '../../src/backup.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII=';
const movie = {
  id: 'film-1',
  title: 'Min nabo Totoro',
  originalTitle: 'Tonari no Totoro',
  year: '1988',
  format: 'DVD',
  genre: 'Animation',
  plot: 'To søstre flytter på landet.',
  director: 'Hayao Miyazaki',
  actors: 'Noriko Hidaka',
  runtime: '86 min',
  barcode: '0 123456789012',
  location: 'Reol 2, øverst',
  notes: 'Gave fra mor\nDanske tekster',
  cover: PNG,
  watched: true,
  favorite: true,
  createdAt: '2020-02-03T00:00:00.000Z',
  updatedAt: '2024-04-05T12:13:14.000Z',
};
const opened = [];
async function database() {
  const name = `storage-test-${crypto.randomUUID()}`;
  const db = await openDatabase(name);
  opened.push({ name, db });
  return db;
}
function legacy(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}
function legacyCollection(overrides = {}) {
  return legacy({
    filmsamling_v4: JSON.stringify([movie]),
    filmsamling_draft_v4: JSON.stringify({ ...movie, notes: 'Kladde med egne noter' }),
    filmsamling_settings_v4: JSON.stringify({
      language: 'da-DK',
      tmdbToken: 'legacy-secret',
      accessKey: 'private',
      workerUrl: 'https://api.example.test',
    }),
    ...overrides,
  });
}
function v2(overrides = {}) {
  return {
    version: 2,
    exportedAt: '2026-10-01T12:00:00.000Z',
    movies: [{ ...movie, cover: '', coverId: 'cover-1' }],
    coverBlobs: [{ id: 'cover-1', dataUrl: PNG }],
    barcodeMap: [{ id: '0123456789012', movieId: 'film-1', title: movie.title, year: '1988' }],
    ...overrides,
  };
}
afterEach(async () => {
  for (const { name, db } of opened.splice(0)) {
    db.close();
    await deleteDB(name);
  }
});

describe('IndexedDB storage', () => {
  it('persists film records in six stores with id keys', async () => {
    const db = await database();
    expect([...db.objectStoreNames]).toEqual([
      'barcodeMap',
      'coverBlobs',
      'drafts',
      'movies',
      'session',
      'settings',
    ]);
    await db.put('movies', { id: 'test', notes: 'Egne noter' });
    expect(await db.get('movies', 'test')).toEqual({ id: 'test', notes: 'Egne noter' });
  });
});

describe('legacy migration', () => {
  it('preserves every film field, draft editing id and exact cover bytes', async () => {
    const db = await database();
    const storage = legacyCollection();
    const result = await migrateLegacy(db, storage);
    expect(result.migrated).toBe(true);
    const saved = await db.get('movies', 'film-1');
    expect(saved).toMatchObject({ ...movie, cover: '', coverId: expect.any(String) });
    const cover = await db.get('coverBlobs', saved.coverId);
    expect(cover.blob.type).toBe('image/png');
    expect([...new Uint8Array(await cover.blob.arrayBuffer())].slice(0, 8)).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(await db.get('drafts', 'current')).toMatchObject({
      id: 'current',
      editingMovieId: 'film-1',
      notes: 'Kladde med egne noter',
      favorite: true,
      location: 'Reol 2, øverst',
      coverId: expect.any(String),
    });
    expect(await db.get('barcodeMap', '0123456789012')).toMatchObject({
      movieId: 'film-1',
      title: movie.title,
      year: '1988',
    });
    expect(JSON.parse(storage.getItem('filmsamling_v4'))).toEqual([movie]);
    expect(JSON.parse(storage.getItem('filmsamling_draft_v4')).cover).toBe(PNG);
  });

  it('removes legacy secrets only after preserving nonsecret preferences', async () => {
    const db = await database();
    const storage = legacyCollection();
    await migrateLegacy(db, storage);
    expect(await db.get('settings', 'preferences')).toEqual({
      id: 'preferences',
      language: 'da-DK',
      workerUrl: 'https://api.example.test',
    });
    expect(JSON.parse(storage.getItem('filmsamling_settings_v4'))).toEqual({
      language: 'da-DK',
      workerUrl: 'https://api.example.test',
    });
    expect(JSON.stringify(await db.getAll('settings'))).not.toContain('legacy-secret');
    expect(await db.getAll('session')).toEqual([]);
  });

  it('is idempotent after reopening and never reverts later edits', async () => {
    let db = await database();
    const storage = legacyCollection();
    await migrateLegacy(db, storage);
    await db.put('movies', { ...(await db.get('movies', 'film-1')), notes: 'Ny note' });
    const registration = opened[opened.length - 1];
    db.close();
    db = await openDatabase(registration.name);
    registration.db = db;
    const second = await migrateLegacy(db, storage);
    expect(second.migrated).toBe(false);
    expect((await db.get('movies', 'film-1')).notes).toBe('Ny note');
    expect(await db.getAll('movies')).toHaveLength(1);
    expect(await db.getAll('coverBlobs')).toHaveLength(2);
  });

  it.each(['{broken json', '{}', '[null]', '[{"id":"x","title":8}]'])(
    'rejects malformed legacy movies before writing a marker: %s',
    async (raw) => {
      const db = await database();
      const storage = legacyCollection({ filmsamling_v4: raw });
      await expect(migrateLegacy(db, storage)).rejects.toThrow();
      expect(await db.getAll('settings')).toEqual([]);
      expect(await db.getAll('movies')).toEqual([]);
      expect(storage.getItem('filmsamling_settings_v4')).toContain('legacy-secret');
    },
  );

  it('rejects an invalid cover without partially saving valid movies', async () => {
    const db = await database();
    const storage = legacyCollection({
      filmsamling_v4: JSON.stringify([
        movie,
        { ...movie, id: 'bad', cover: 'data:image/png;base64,aGVsbG8=' },
      ]),
    });
    await expect(migrateLegacy(db, storage)).rejects.toThrow();
    expect(await db.getAll('movies')).toEqual([]);
    expect(await db.getAll('coverBlobs')).toEqual([]);
    expect(storage.getItem('filmsamling_settings_v4')).toContain('legacy-secret');
  });

  it('does not create a marker when migration read-back fails', async () => {
    const db = await database();
    const storage = legacyCollection();
    const brokenReadBack = new Proxy(db, {
      get(target, property) {
        if (property === 'get')
          return (store, id) =>
            store === 'movies' ? Promise.resolve(undefined) : target.get(store, id);
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(migrateLegacy(brokenReadBack, storage)).rejects.toThrow();
    expect((await db.getAll('settings')).some((entry) => entry.id !== 'preferences')).toBe(false);
    expect(storage.getItem('filmsamling_settings_v4')).toContain('legacy-secret');
  });

  it('preserves a handwritten invalid barcode while omitting an invalid lookup key', async () => {
    const db = await database();
    await migrateLegacy(
      db,
      legacyCollection({
        filmsamling_v4: JSON.stringify([{ ...movie, barcode: 'Hylde A / ingen kode' }]),
      }),
    );
    expect((await db.get('movies', 'film-1')).barcode).toBe('Hylde A / ingen kode');
    expect(await db.getAll('barcodeMap')).toEqual([]);
  });

  it('migrates an unsaved draft without inventing an editing movie id', async () => {
    const db = await database();
    await migrateLegacy(
      db,
      legacyCollection({ filmsamling_draft_v4: JSON.stringify({ ...movie, id: '', title: '' }) }),
    );
    expect(await db.get('drafts', 'current')).toMatchObject({
      id: 'current',
      title: '',
      editingMovieId: null,
      notes: movie.notes,
    });
  });

  it('keeps legacy secrets when a late migration write fails and rolls back all stores', async () => {
    const db = await database();
    const storage = legacyCollection();
    const broken = failWrite(db, 'settings');
    await expect(migrateLegacy(broken, storage)).rejects.toThrow('Disk full');
    for (const store of ['movies', 'coverBlobs', 'drafts', 'barcodeMap', 'settings'])
      expect(await db.getAll(store)).toEqual([]);
    expect(storage.getItem('filmsamling_settings_v4')).toContain('legacy-secret');
  });
});

describe('backups', () => {
  it('exports allowlisted films and image bytes without private records or unknown fields', async () => {
    const db = await database();
    await migrateLegacy(db, legacyCollection());
    const stored = await db.get('movies', 'film-1');
    await db.put('movies', {
      ...stored,
      token: 'hidden-movie-secret',
      accessKey: 'hidden-key',
      nested: { password: 'nested-secret' },
    });
    await db.put('session', { id: 'current', token: 'private-session' });
    await db.put('settings', { id: 'preferences', accessKey: 'private-access' });
    const backup = await exportBackup(db);
    expect(backup.version).toBe(2);
    expect(backup.movies[0]).toMatchObject({
      notes: movie.notes,
      favorite: true,
      location: movie.location,
    });
    expect(backup.coverBlobs).toHaveLength(1);
    expect(backup.coverBlobs[0].dataUrl).toBe(PNG);
    for (const secret of [
      'hidden-movie-secret',
      'hidden-key',
      'nested-secret',
      'private-session',
      'private-access',
      'Kladde med egne noter',
    ])
      expect(JSON.stringify(backup)).not.toContain(secret);
    expect(Object.keys(backup).sort()).toEqual([
      'barcodeMap',
      'coverBlobs',
      'exportedAt',
      'movies',
      'version',
    ]);
  });

  it('roundtrips notes, favorites, location and photo bytes into a fresh collection', async () => {
    const db = await database();
    await migrateLegacy(db, legacyCollection());
    const backup = await exportBackup(db);
    const restored = await database();
    expect(await importBackup(restored, JSON.stringify(backup))).toMatchObject({
      movies: 1,
      coverBlobs: 1,
      barcodeMap: 1,
    });
    const record = await restored.get('movies', 'film-1');
    expect(record).toEqual(await db.get('movies', 'film-1'));
    expect(await exportBackup(restored)).toMatchObject({
      movies: backup.movies,
      coverBlobs: backup.coverBlobs,
      barcodeMap: backup.barcodeMap,
    });
  });

  it('roundtrips metadata provenance and custom-cover protection', async () => {
    const db = await database();
    await importBackup(
      db,
      v2({
        movies: [
          {
            ...movie,
            cover: '',
            coverId: 'cover-1',
            source: 'AI / TMDB',
            metadataSource: 'TMDB',
            coverSource: 'own',
          },
        ],
      }),
    );
    const backup = await exportBackup(db);
    expect(backup.movies[0]).toMatchObject({
      source: 'AI / TMDB',
      metadataSource: 'TMDB',
      coverSource: 'own',
    });
    const restored = await database();
    await importBackup(restored, backup);
    expect(await restored.get('movies', 'film-1')).toMatchObject({
      source: 'AI / TMDB',
      metadataSource: 'TMDB',
      coverSource: 'own',
    });
  });

  it('retains online cover provenance in a legacy migration', async () => {
    const db = await database();
    const film = {
      ...movie,
      cover: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      source: 'TMDB',
      coverSource: 'online',
    };
    await migrateLegacy(db, legacyCollection({ filmsamling_v4: JSON.stringify([film]) }));
    expect((await exportBackup(db)).movies[0]).toMatchObject({
      source: 'TMDB',
      coverSource: 'online',
      cover: film.cover,
    });
  });

  it('rejects invalid provenance types and cover ownership values before writing', async () => {
    const db = await database();
    for (const provenance of [
      { source: { token: 'private' } },
      { metadataSource: false },
      { coverSource: 'unsafe' },
    ]) {
      await expect(
        importBackup(
          db,
          v2({ movies: [{ ...movie, cover: '', coverId: 'cover-1', ...provenance }] }),
        ),
      ).rejects.toThrow();
    }
    expect(await db.getAll('movies')).toEqual([]);
  });

  it.each([
    { version: 3 },
    { movies: [{}] },
    { movies: [{ ...movie, cover: '', notes: 'a'.repeat(100001) }] },
    { movies: [{ ...movie, cover: '', coverId: 'missing' }] },
    {
      movies: [
        { ...movie, cover: '', coverId: 'cover-1' },
        { ...movie, cover: '', coverId: 'cover-1' },
      ],
    },
    { coverBlobs: [{ id: 'cover-1', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }] },
    { coverBlobs: [{ id: 'cover-1', dataUrl: 'data:image/png;base64,aGVsbG8=' }] },
    { barcodeMap: [{ id: '0123456789012', movieId: 'missing', title: 'X', year: '' }] },
    { barcodeMap: [{ id: 'not-a-code', movieId: 'film-1', title: 'X', year: '' }] },
  ])('validates the whole import before any database mutation (case %#)', async (invalid) => {
    const db = await database();
    await db.put('movies', { id: 'existing', title: 'Egen film', notes: 'Behold' });
    await expect(importBackup(db, v2(invalid))).rejects.toThrow();
    expect(await db.getAll('movies')).toEqual([
      { id: 'existing', title: 'Egen film', notes: 'Behold' },
    ]);
    expect(await db.getAll('coverBlobs')).toEqual([]);
    expect(await db.getAll('barcodeMap')).toEqual([]);
  });

  it('merges without overwriting existing notes, favorites or location', async () => {
    const db = await database();
    await db.put('movies', {
      id: 'film-1',
      title: 'Egen titel',
      notes: 'Nyere noter',
      location: 'Egen reol',
      favorite: false,
    });
    const result = await importBackup(db, v2());
    expect(result.skipped).toBe(1);
    expect(await db.get('movies', 'film-1')).toEqual({
      id: 'film-1',
      title: 'Egen titel',
      notes: 'Nyere noter',
      location: 'Egen reol',
      favorite: false,
    });
    expect(await db.getAll('coverBlobs')).toEqual([]);
  });

  it('recognizes a version 4 films backup but never imports its secrets', async () => {
    const db = await database();
    const result = await importBackup(db, {
      version: 4,
      films: [movie],
      settings: { tmdbToken: 'unsafe-secret' },
    });
    expect(result.movies).toBe(1);
    expect((await db.get('movies', 'film-1')).notes).toBe(movie.notes);
    expect(await db.getAll('settings')).toEqual([]);
    expect(await db.getAll('session')).toEqual([]);
    expect(JSON.stringify(await exportBackup(db))).not.toContain('unsafe-secret');
  });

  it('rejects dangling cover references in a legacy films backup', async () => {
    const db = await database();
    await expect(
      importBackup(db, { version: 4, films: [{ ...movie, cover: '', coverId: 'missing' }] }),
    ).rejects.toThrow();
    expect(await db.getAll('movies')).toEqual([]);
  });

  it('remaps imported cover ids without replacing photos used by local films', async () => {
    const db = await database();
    const localPhoto = new Blob(['existing-photo'], { type: 'image/jpeg' });
    await db.put('coverBlobs', { id: 'cover-1', blob: localPhoto });
    await db.put('movies', { id: 'local-film', title: 'En lokal film', coverId: 'cover-1' });
    await importBackup(db, v2());
    expect((await db.get('coverBlobs', 'cover-1')).blob.type).toBe('image/jpeg');
    expect(await (await db.get('coverBlobs', 'cover-1')).blob.text()).toBe('existing-photo');
    const imported = await db.get('movies', 'film-1');
    expect(imported.coverId).not.toBe('cover-1');
    expect((await db.get('coverBlobs', imported.coverId)).blob.type).toBe('image/png');
  });

  it('rolls back already queued cover and film writes when a barcode write fails', async () => {
    const db = await database();
    await db.put('movies', { id: 'local-film', title: 'En lokal film', notes: 'Behold mig' });
    await expect(importBackup(failWrite(db, 'barcodeMap'), v2())).rejects.toThrow('Disk full');
    expect(await db.getAll('movies')).toEqual([
      { id: 'local-film', title: 'En lokal film', notes: 'Behold mig' },
    ]);
    expect(await db.getAll('coverBlobs')).toEqual([]);
    expect(await db.getAll('barcodeMap')).toEqual([]);
  });

  it('refuses to produce an apparently complete backup when a referenced photo is missing', async () => {
    const db = await database();
    await db.put('movies', { id: 'local-film', title: 'En lokal film', coverId: 'missing' });
    await expect(exportBackup(db)).rejects.toThrow();
  });
});

// The real IndexedDB transaction still runs. Only a late external disk failure is injected.
function failWrite(db, failingStore) {
  return new Proxy(db, {
    get(target, property) {
      if (property !== 'transaction') {
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (...args) => {
        const transaction = target.transaction(...args);
        return new Proxy(transaction, {
          get(tx, txProperty) {
            if (txProperty !== 'objectStore') {
              const value = tx[txProperty];
              return typeof value === 'function' ? value.bind(tx) : value;
            }
            return (name) => {
              const store = tx.objectStore(name);
              if (name !== failingStore) return store;
              return new Proxy(store, {
                get(objectStore, storeProperty) {
                  if (storeProperty === 'add')
                    return () => {
                      throw new Error('Disk full');
                    };
                  const value = objectStore[storeProperty];
                  return typeof value === 'function' ? value.bind(objectStore) : value;
                },
              });
            };
          },
        });
      };
    },
  });
}
