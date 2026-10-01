import { barcodeVariants, normalizeBarcode } from '../../shared/barcode.js';
import { HttpError, onlyFields, upstreamJson } from './http.js';
const text = (value, maximum = 300) =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const physicalEdition =
  /\b(?:4k|uhd|ultra[ -]*hd|blu[ -]?ray|dvd|steelbook|(?:collector['’]?s?|special|limited|ultimate|anniversary|extended|deluxe)\s+edition|\d+[ -]*discs?|region\s*[a-c0-9])\b/i;
const physicalSuffix =
  /\s+(?:[-–—:]\s*)?(?:4k|uhd|ultra[ -]*hd|blu[ -]?ray|dvd|steelbook|(?:collector['’]?s?|special|limited|ultimate|anniversary|extended|deluxe)\s+edition|\d+[ -]*discs?|region\s*[a-c0-9])\s*$/i;
function movieProductTitle(raw) {
  // Only physical-product annotations are removed; years remain part of movie names.
  let title = raw
    .replace(/\s*(?:\(([^()]*)\)|\[([^[\]]*)\])/g, (annotation, round, square) =>
      physicalEdition.test(round ?? square) ? '' : annotation,
    )
    .replace(/\s+/g, ' ')
    .trim();
  for (let count = 0; count < 10; count++) {
    const next = title.replace(physicalSuffix, '');
    if (next === title) break;
    title = next.replace(/\s+[-–—+,&/]\s*$/, '').trim();
  }
  return title || raw;
}
function movieProductFormat(edition) {
  if (/\b(?:4k|uhd|ultra[ -]*hd)\b/i.test(edition)) return '4K UHD';
  if (/\b(?:blu[ -]?ray|bd)\b/i.test(edition)) return 'Blu-ray';
  if (/\bdvd\b/i.test(edition)) return 'DVD';
  return '';
}
function safeImages(images) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, 10).filter((value) => {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  });
}
export async function lookupBarcode(body, env) {
  onlyFields(body, ['barcode']);
  let code;
  try {
    code = normalizeBarcode(body.barcode);
  } catch {
    throw new HttpError(400);
  }
  const provider = env.BARCODE_PROVIDER || 'upcitemdb';
  if (!['upcitemdb', 'json'].includes(provider)) throw new HttpError(503);
  for (const variant of barcodeVariants(code)) {
    let url;
    let headers = { Accept: 'application/json' };
    if (provider === 'upcitemdb') {
      url = new URL(
        `https://api.upcitemdb.com/prod/${env.BARCODE_PROVIDER_KEY ? 'v1' : 'trial'}/lookup`,
      );
      url.searchParams.set('upc', variant);
      if (env.BARCODE_PROVIDER_KEY)
        headers = { ...headers, user_key: env.BARCODE_PROVIDER_KEY, key_type: '3scale' };
    } else {
      try {
        url = new URL(env.BARCODE_PROVIDER_URL);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash)
          throw new Error();
      } catch {
        throw new HttpError(503);
      }
      url.searchParams.set('barcode', variant);
      if (env.BARCODE_PROVIDER_KEY) headers.Authorization = `Bearer ${env.BARCODE_PROVIDER_KEY}`;
    }
    const data = await upstreamJson(url.toString(), { headers }, { notFoundIsMiss: true });
    if (provider === 'upcitemdb' && data.code && data.code !== 'OK') {
      if (data.code === 'TOO_MANY_REQUESTS' || data.code === 'EXCEED_LIMIT')
        throw new HttpError(429, 60);
      throw new HttpError(502);
    }
    if (provider === 'upcitemdb' ? !Array.isArray(data.items) : typeof data.found !== 'boolean')
      throw new HttpError(502);
    const item =
      provider === 'upcitemdb'
        ? Array.isArray(data.items)
          ? data.items[0]
          : null
        : data.found === true
          ? data
          : null;
    if (!item) continue;
    if (
      typeof item !== 'object' ||
      !text(item.title) ||
      (item.description !== undefined && typeof item.description !== 'string') ||
      (item.images !== undefined && !Array.isArray(item.images))
    )
      throw new HttpError(502);
    const rawTitle = text(item.title);
    const description = text(item.description, 3000);
    const suppliedFormat = provider === 'json' ? text(item.format, 40) : '';
    const title = movieProductTitle(rawTitle);
    const format =
      movieProductFormat(`${rawTitle} ${description} ${suppliedFormat}`) || suppliedFormat;
    return {
      found: true,
      title,
      description,
      format,
      images: safeImages(item.images),
      source: provider,
    };
  }
  return { found: false, title: '', description: '', format: '', images: [], source: provider };
}
function normalizeTitle(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function similarity(left, right) {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const first = new Set(a.split(' '));
  const second = new Set(b.split(' '));
  const common = [...first].filter((word) => second.has(word)).length;
  return common / new Set([...first, ...second]).size;
}
function movieYear(value) {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(value || '');
  return match ? Number(match[1]) : null;
}
function rank(candidate, query) {
  const titleScore = Math.max(
    ...[query.title, query.originalTitle]
      .filter(Boolean)
      .flatMap((title) => [
        similarity(title, candidate.title),
        similarity(title, candidate.original_title),
      ]),
  );
  const year = movieYear(candidate.release_date);
  const yearScore = query.year
    ? year
      ? Math.max(0, 1 - Math.abs(query.year - year) / 3)
      : 0.25
    : 1;
  return Math.round((query.year ? titleScore * 0.78 + yearScore * 0.22 : titleScore) * 1000) / 1000;
}
function candidateFrom(item, score) {
  const names = (values, maximum = 12) =>
    (Array.isArray(values) ? values : [])
      .slice(0, maximum)
      .map((entry) => text(entry.name))
      .filter(Boolean)
      .join(', ');
  const poster =
    typeof item.poster_path === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(item.poster_path)
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : '';
  return {
    id: item.id,
    tmdbId: item.id,
    title: text(item.title),
    originalTitle: text(item.original_title),
    year: movieYear(item.release_date),
    plot: text(item.overview, 5000),
    genre: names(item.genres, 6),
    director: names(
      (item.credits?.crew || []).filter((entry) => entry.job === 'Director'),
      4,
    ),
    actors: names(item.credits?.cast),
    runtime:
      Number.isInteger(item.runtime) && item.runtime > 0 && item.runtime <= 2000
        ? item.runtime
        : null,
    cover: poster,
    source: 'tmdb',
    score,
  };
}
export async function searchMovie(body, env) {
  onlyFields(body, ['title', 'originalTitle', 'year']);
  if (
    (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 300)) ||
    (body.originalTitle !== undefined &&
      (typeof body.originalTitle !== 'string' || body.originalTitle.length > 300)) ||
    (body.year !== undefined &&
      body.year !== null &&
      (!Number.isInteger(body.year) || body.year < 1800 || body.year > 2200))
  )
    throw new HttpError(400);
  const query = {
    title: text(body.title),
    originalTitle: text(body.originalTitle),
    year: body.year || null,
  };
  if (!query.title && !query.originalTitle) throw new HttpError(400);
  if (!env.TMDB_READ_TOKEN)
    return { candidates: [], selected: null, source: 'tmdb', configured: false };
  const headers = { Authorization: `Bearer ${env.TMDB_READ_TOKEN}`, Accept: 'application/json' };
  const titles = [...new Set([query.title, query.originalTitle].filter(Boolean))];
  const results = await Promise.all(
    titles.map(async (title) => {
      const url = new URL('https://api.themoviedb.org/3/search/movie');
      url.searchParams.set('query', title);
      url.searchParams.set('include_adult', 'false');
      url.searchParams.set('language', 'da-DK');
      const data = await upstreamJson(url.toString(), { headers });
      if (!Array.isArray(data.results)) throw new HttpError(502);
      return data.results.slice(0, 20);
    }),
  );
  const unique = new Map();
  for (const item of results.flat())
    if (item && Number.isSafeInteger(item.id) && item.id > 0 && text(item.title))
      unique.set(item.id, item);
  const ranked = [...unique.values()]
    .map((item) => ({ item, score: rank(item, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const candidates = await Promise.all(
    ranked.map(async ({ item, score }) => {
      const url = new URL(`https://api.themoviedb.org/3/movie/${item.id}`);
      url.searchParams.set('append_to_response', 'credits');
      url.searchParams.set('language', 'da-DK');
      const details = await upstreamJson(url.toString(), { headers });
      if (details.id !== item.id || !text(details.title)) throw new HttpError(502);
      return candidateFrom({ ...item, ...details }, score);
    }),
  );
  return { candidates, selected: candidates[0] || null, source: 'tmdb', configured: true };
}
