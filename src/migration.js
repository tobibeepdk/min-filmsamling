import {
  barcodeRecords,
  cleanMovie,
  dataUrlToBlob,
  prepareLegacyMovies,
  requireRecord,
  validateId,
} from './backup.js';

export const MIGRATION_MARKER = 'legacy-v4-migration';
const LEGACY_MOVIES = 'filmsamling_v4';
const LEGACY_DRAFT = 'filmsamling_draft_v4';
const LEGACY_SETTINGS = 'filmsamling_settings_v4';

function readLegacy(storage, key, fallback) {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('De tidligere gemte data kunne ikke læses. Ingen data er fjernet.');
  }
}

function cleanPreferences(value) {
  requireRecord(value, 'Indstillinger');
  const preferences = {};
  const limits = { language: 35, theme: 40, sortOrder: 40, formatFilter: 100 };
  for (const [key, limit] of Object.entries(limits)) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || value[key].length > limit)
        throw new Error('De tidligere indstillinger er ugyldige.');
      preferences[key] = value[key];
    }
  }
  if (value.workerUrl !== undefined) {
    let url;
    try {
      url = new URL(value.workerUrl);
    } catch {
      throw new Error('Den tidligere serveradresse er ugyldig.');
    }
    if (
      typeof value.workerUrl !== 'string' ||
      value.workerUrl.length > 2048 ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Den tidligere serveradresse er ugyldig.');
    preferences.workerUrl = value.workerUrl;
  }
  return preferences;
}

function equalRecord(actual, expected) {
  if (!actual || Object.keys(actual).length !== Object.keys(expected).length) return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

async function verifyMigration(db, records) {
  for (const [store, values] of Object.entries(records)) {
    for (const expected of values) {
      const actual = await db.get(store, expected.id);
      if (store !== 'coverBlobs') {
        if (!equalRecord(actual, expected))
          throw new Error('Migreringen kunne ikke verificeres. De tidligere data er bevaret.');
      } else {
        if (!actual || !(actual.blob instanceof Blob) || actual.blob.type !== expected.blob.type)
          throw new Error('Et migreret cover kunne ikke verificeres.');
        const [saved, original] = await Promise.all([
          actual.blob.arrayBuffer(),
          expected.blob.arrayBuffer(),
        ]);
        const savedBytes = new Uint8Array(saved);
        const originalBytes = new Uint8Array(original);
        if (
          savedBytes.length !== originalBytes.length ||
          savedBytes.some((byte, index) => byte !== originalBytes[index])
        )
          throw new Error('Et migreret cover kunne ikke verificeres.');
      }
    }
  }
}

/** Commit all collection data together, verify bytes, and only then scrub settings and mark complete. */
export async function migrateLegacy(db, storage = localStorage) {
  if (await db.get('settings', MIGRATION_MARKER)) {
    // A stale older tab may have written a token back after the migration completed.
    const raw = storage.getItem(LEGACY_SETTINGS);
    if (raw !== null)
      storage.setItem(
        LEGACY_SETTINGS,
        JSON.stringify(cleanPreferences(readLegacy(storage, LEGACY_SETTINGS, {}))),
      );
    return { migrated: false, movies: 0 };
  }

  const prepared = prepareLegacyMovies(readLegacy(storage, LEGACY_MOVIES, []));
  const draftValue = readLegacy(storage, LEGACY_DRAFT, null);
  const drafts = [];
  if (draftValue !== null) {
    const draft = cleanMovie(draftValue, { draft: true, inlineCover: true });
    const editingMovieId = draft.id || null;
    draft.id = 'current';
    draft.editingMovieId = editingMovieId;
    if (editingMovieId) validateId(editingMovieId, 'Kladdens film-id');
    if (draft.cover?.startsWith('data:')) {
      const id = 'legacy-draft:current';
      prepared.coverBlobs.push({ id, blob: dataUrlToBlob(draft.cover) });
      draft.cover = '';
      draft.coverId = id;
    }
    drafts.push(draft);
  }
  const hasSettings = storage.getItem(LEGACY_SETTINGS) !== null;
  const preferences = cleanPreferences(readLegacy(storage, LEGACY_SETTINGS, {}));
  const records = {
    movies: prepared.movies,
    drafts,
    coverBlobs: prepared.coverBlobs,
    barcodeMap: barcodeRecords(prepared.movies),
    settings: hasSettings ? [{ id: 'preferences', ...preferences }] : [],
  };
  const transaction = db.transaction(Object.keys(records), 'readwrite');
  const done = transaction.done;
  done.catch(() => {});
  const requests = [];
  try {
    const stores = Object.keys(records);
    const existingLists = await Promise.all(
      stores.map((store) => transaction.objectStore(store).getAll()),
    );
    for (let index = 0; index < stores.length; index++) {
      const store = stores[index];
      const existing = new Map(existingLists[index].map((record) => [record.id, record]));
      for (const value of records[store]) {
        if (existing.has(value.id)) {
          if (store !== 'coverBlobs' && !equalRecord(existing.get(value.id), value))
            throw new Error(
              'Migreringen fandt en eksisterende post med samme id. Ingen data er overskrevet.',
            );
        } else requests.push(transaction.objectStore(store).add(value));
      }
    }
    await Promise.all(requests);
    await done;
  } catch (error) {
    const settledRequests = Promise.allSettled(requests);
    try {
      transaction.abort();
    } catch {
      /* A failed request may already have aborted it. */
    }
    await settledRequests;
    await done.catch(() => {});
    throw error;
  }
  await verifyMigration(db, records);
  if (hasSettings) storage.setItem(LEGACY_SETTINGS, JSON.stringify(preferences));
  await db.put('settings', {
    id: MIGRATION_MARKER,
    version: 4,
    completedAt: new Date().toISOString(),
  });
  return {
    migrated: true,
    movies: prepared.movies.length,
    drafts: drafts.length,
    coverBlobs: prepared.coverBlobs.length,
  };
}
