import { normalizeBarcode } from '../shared/barcode.js';

const MAX_RECORDS = 10000;
const MAX_COVER_BYTES = 15 * 1024 * 1024;
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const STRING_LIMITS = {
  title: 1000,
  originalTitle: 1000,
  format: 100,
  genre: 5000,
  plot: 50000,
  director: 5000,
  actors: 10000,
  barcode: 100,
  location: 2000,
  notes: 100000,
  createdAt: 64,
  updatedAt: 64,
  source: 1000,
  metadataSource: 1000,
};

function fail(message) {
  throw new Error(`Backup eller ældre data er ugyldige: ${message}`);
}

export function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${label} skal være et objekt.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    fail(`${label} har et ugyldigt format.`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value) || value.length > MAX_RECORDS)
    fail(`${label} skal være en liste med højst ${MAX_RECORDS} poster.`);
  return value;
}

export function validateId(value, label = 'id') {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200 ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    fail(`${label} er ugyldigt.`);
  return value;
}

function text(value, limit, label) {
  if (typeof value !== 'string' || value.length > limit)
    fail(`${label} er ugyldigt eller for langt.`);
  return value;
}

function yearOrRuntime(value, limit, label) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000)
    return value;
  return text(value, limit, label);
}

function validateCoverUrl(value) {
  text(value, 4096, 'cover');
  if (!value) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('Cover-adressen er ugyldig.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    fail('Cover-adressen skal være en billedadresse på nettet.');
  return value;
}

/** Copy only collection fields. Credentials and unknown nested objects never cross this boundary. */
export function cleanMovie(value, { draft = false, inlineCover = false } = {}) {
  requireRecord(value, 'Film');
  const result = {};
  if (draft) {
    if (value.id !== undefined && value.id !== '') validateId(value.id);
    result.id = value.id || '';
  } else result.id = validateId(value.id);
  for (const [key, limit] of Object.entries(STRING_LIMITS)) {
    if (value[key] !== undefined) result[key] = text(value[key], limit, key);
  }
  if (!draft && (!result.title || !result.title.trim())) fail('Filmen mangler en titel.');
  for (const key of ['year', 'runtime']) {
    if (value[key] !== undefined) result[key] = yearOrRuntime(value[key], 100, key);
  }
  for (const key of ['watched', 'favorite']) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') fail(`${key} skal være sand eller falsk.`);
      result[key] = value[key];
    }
  }
  if (value.tmdbId !== undefined) {
    if (!Number.isSafeInteger(value.tmdbId) || value.tmdbId <= 0) fail('tmdbId er ugyldigt.');
    result.tmdbId = value.tmdbId;
  }
  if (value.coverSource !== undefined) {
    if (!['own', 'online'].includes(value.coverSource)) fail('Coverets kilde er ugyldig.');
    result.coverSource = value.coverSource;
  }
  if (value.coverId !== undefined && value.coverId !== '')
    result.coverId = validateId(value.coverId, 'coverId');
  if (value.cover !== undefined) {
    if (inlineCover && typeof value.cover === 'string' && value.cover.startsWith('data:'))
      result.cover = value.cover;
    else result.cover = validateCoverUrl(value.cover);
  }
  return result;
}

function bytesMatch(bytes, start, expected) {
  return expected.every((value, index) => bytes[start + index] === value);
}

function validateImage(bytes, mime) {
  if (!bytes.length || bytes.length > MAX_COVER_BYTES) fail('Billedet er tomt eller for stort.');
  let matches = false;
  if (mime === 'image/png' && bytes.length >= 45) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    matches =
      bytesMatch(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10]) &&
      view.getUint32(8) === 13 &&
      bytesMatch(bytes, 12, [73, 72, 68, 82]) &&
      width > 0 &&
      height > 0 &&
      width <= 30000 &&
      height <= 30000 &&
      bytesMatch(bytes, bytes.length - 12, [0, 0, 0, 0, 73, 69, 78, 68]);
  } else if (mime === 'image/jpeg') {
    matches =
      bytes.length >= 20 &&
      bytesMatch(bytes, 0, [255, 216, 255]) &&
      bytesMatch(bytes, bytes.length - 2, [255, 217]);
  } else if (mime === 'image/gif') {
    matches =
      bytes.length >= 14 &&
      (bytesMatch(bytes, 0, [71, 73, 70, 56, 55, 97]) ||
        bytesMatch(bytes, 0, [71, 73, 70, 56, 57, 97])) &&
      (bytes[6] || bytes[7]) &&
      (bytes[8] || bytes[9]) &&
      bytes[bytes.length - 1] === 59;
  } else if (mime === 'image/webp' && bytes.length >= 20) {
    matches =
      bytesMatch(bytes, 0, [82, 73, 70, 70]) &&
      bytesMatch(bytes, 8, [87, 69, 66, 80]) &&
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) ===
        bytes.length - 8;
  }
  if (!matches) fail('Billedets indhold passer ikke til billedtypen.');
}

/** Data URLs are decoded locally. Imported files can never trigger a network request. */
export function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_COVER_BYTES / 3) * 4 + 100)
    fail('Cover-billedet er for stort.');
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(
    dataUrl,
  );
  if (!match || match[2].length % 4 !== 0) fail('Cover-billedet har et ugyldigt dataformat.');
  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    fail('Cover-billedet kan ikke læses.');
  }
  if (btoa(binary) !== match[2]) fail('Cover-billedets kodning er ugyldig.');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const mime = match[1].toLowerCase();
  validateImage(bytes, mime);
  return new Blob([bytes], { type: mime });
}

export async function blobToDataUrl(blob) {
  if (!(blob instanceof Blob)) fail('Et gemt cover mangler billeddata.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  validateImage(bytes, blob.type);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

export function barcodeRecords(movies) {
  const map = new Map();
  for (const movie of movies) {
    let id;
    // Older versions accepted handwritten codes. Preserve the field even when it
    // cannot become a valid lookup key in the new barcode store.
    try {
      id = normalizeBarcode((movie.barcode || '').replace(/[\s-]/g, ''));
    } catch {
      continue;
    }
    if (id && !map.has(id))
      map.set(id, { id, movieId: movie.id, title: movie.title, year: movie.year ?? '' });
  }
  return [...map.values()];
}

export function prepareLegacyMovies(records, coverPrefix = 'legacy-cover:') {
  requireArray(records, 'Film');
  const ids = new Set();
  const coverBlobs = [];
  const movies = records.map((value) => {
    const movie = cleanMovie(value, { inlineCover: true });
    if (ids.has(movie.id)) fail('To film har samme id.');
    ids.add(movie.id);
    if (movie.cover?.startsWith('data:')) {
      const id = validateId(`${coverPrefix}${movie.id}`, 'coverId');
      coverBlobs.push({ id, blob: dataUrlToBlob(movie.cover) });
      movie.cover = '';
      movie.coverId = id;
    }
    return movie;
  });
  const coverIds = new Set(coverBlobs.map((cover) => cover.id));
  if (movies.some((movie) => movie.coverId && !coverIds.has(movie.coverId)))
    fail('En ældre film henviser til et manglende cover.');
  return { movies, coverBlobs, barcodeMap: barcodeRecords(movies) };
}

function cleanBarcodeMap(value, movieIds) {
  requireRecord(value, 'Stregkode');
  const id = validateId(value.id, 'Stregkode-id');
  if (!normalizeBarcode(id) || normalizeBarcode(id) !== id)
    fail('Stregkoden er ugyldig eller ikke normaliseret.');
  const movieId = validateId(value.movieId, 'movieId');
  if (!movieIds.has(movieId)) fail('En stregkode henviser til en ukendt film.');
  return {
    id,
    movieId,
    title: text(value.title, 1000, 'Stregkodens titel'),
    year: yearOrRuntime(value.year ?? '', 100, 'Stregkodens år'),
  };
}

function prepareBackup(input) {
  requireRecord(input, 'Backup');
  if (input.version === 4 && Array.isArray(input.films))
    return prepareLegacyMovies(input.films, 'import-cover:');
  if (input.version !== 2) fail('Backup-versionen understøttes ikke.');
  if (
    typeof input.exportedAt !== 'string' ||
    input.exportedAt.length > 64 ||
    !Number.isFinite(Date.parse(input.exportedAt))
  )
    fail('Backup-datoen er ugyldig.');
  const movies = requireArray(input.movies, 'Film').map((value) => cleanMovie(value));
  const movieIds = new Set(movies.map((movie) => movie.id));
  if (movieIds.size !== movies.length) fail('To film har samme id.');
  const coverBlobs = requireArray(input.coverBlobs, 'Covers').map((value) => {
    requireRecord(value, 'Cover');
    return { id: validateId(value.id, 'Cover-id'), blob: dataUrlToBlob(value.dataUrl) };
  });
  const coverIds = new Set(coverBlobs.map((cover) => cover.id));
  if (coverIds.size !== coverBlobs.length) fail('To covers har samme id.');
  for (const movie of movies) {
    if (movie.coverId && !coverIds.has(movie.coverId))
      fail('En film henviser til et manglende cover.');
  }
  const barcodeMap = requireArray(input.barcodeMap, 'Stregkoder').map((value) =>
    cleanBarcodeMap(value, movieIds),
  );
  if (new Set(barcodeMap.map((record) => record.id)).size !== barcodeMap.length)
    fail('To stregkoder har samme id.');
  return { movies, coverBlobs, barcodeMap };
}

export async function exportBackup(db) {
  const transaction = db.transaction(['movies', 'coverBlobs', 'barcodeMap'], 'readonly');
  const [storedMovies, storedCovers, storedMap] = await Promise.all([
    transaction.objectStore('movies').getAll(),
    transaction.objectStore('coverBlobs').getAll(),
    transaction.objectStore('barcodeMap').getAll(),
  ]);
  await transaction.done;
  const movies = storedMovies.map((value) => cleanMovie(value));
  const movieIds = new Set(movies.map((movie) => movie.id));
  const neededCovers = new Set(movies.map((movie) => movie.coverId).filter(Boolean));
  const covers = new Map(storedCovers.map((cover) => [cover.id, cover]));
  const coverBlobs = await Promise.all(
    [...neededCovers].map(async (id) => {
      if (!covers.has(id)) fail('Et cover i samlingen mangler.');
      return { id, dataUrl: await blobToDataUrl(covers.get(id).blob) };
    }),
  );
  const barcodeMap = storedMap
    .filter((record) => movieIds.has(record.movieId))
    .map((record) => cleanBarcodeMap(record, movieIds));
  return { version: 2, exportedAt: new Date().toISOString(), movies, coverBlobs, barcodeMap };
}

/** A complete validation pass precedes the single write transaction. Existing film IDs win. */
export async function importBackup(db, json) {
  let input = json;
  if (typeof json === 'string') {
    if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES)
      fail('Backupfilen er for stor.');
    try {
      input = JSON.parse(json);
    } catch {
      fail('Backupfilen er ikke gyldig JSON.');
    }
  }
  const prepared = prepareBackup(input);
  const transaction = db.transaction(['movies', 'coverBlobs', 'barcodeMap'], 'readwrite');
  const done = transaction.done;
  // Attach immediately: an individual failed request also rejects transaction.done.
  done.catch(() => {});
  const counts = { movies: 0, coverBlobs: 0, barcodeMap: 0, skipped: 0 };
  const requests = [];
  try {
    const movieStore = transaction.objectStore('movies');
    const coverStore = transaction.objectStore('coverBlobs');
    const barcodeStore = transaction.objectStore('barcodeMap');
    const [existingMovies, existingCovers, existingMap] = await Promise.all([
      movieStore.getAll(),
      coverStore.getAll(),
      barcodeStore.getAll(),
    ]);
    const existingIds = new Set(existingMovies.map((movie) => movie.id));
    const coverIds = new Set(existingCovers.map((cover) => cover.id));
    const mapIds = new Set(existingMap.map((record) => record.id));
    const movies = prepared.movies.filter((movie) => !existingIds.has(movie.id));
    counts.skipped = prepared.movies.length - movies.length;
    const neededCovers = new Set(movies.map((movie) => movie.coverId).filter(Boolean));
    const remap = new Map();
    for (const cover of prepared.coverBlobs) {
      if (!neededCovers.has(cover.id)) continue;
      let id = cover.id;
      // Do not replace a cover that an existing local movie still uses.
      if (coverIds.has(id)) id = `cover:${crypto.randomUUID()}`;
      coverIds.add(id);
      remap.set(cover.id, id);
      requests.push(coverStore.add({ id, blob: cover.blob }));
      counts.coverBlobs++;
    }
    for (const movie of movies) {
      requests.push(
        movieStore.add(
          movie.coverId ? { ...movie, coverId: remap.get(movie.coverId) || movie.coverId } : movie,
        ),
      );
      counts.movies++;
    }
    const addedIds = new Set(movies.map((movie) => movie.id));
    for (const record of prepared.barcodeMap) {
      if (mapIds.has(record.id) || !addedIds.has(record.movieId)) continue;
      requests.push(barcodeStore.add(record));
      mapIds.add(record.id);
      counts.barcodeMap++;
    }
    await Promise.all(requests);
    await done;
    return counts;
  } catch (error) {
    const settledRequests = Promise.allSettled(requests);
    try {
      transaction.abort();
    } catch {
      /* The failed request may already have aborted it. */
    }
    await settledRequests;
    await done.catch(() => {});
    throw error;
  }
}
