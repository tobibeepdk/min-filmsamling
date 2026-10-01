export function normalizeTitle(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('da')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
export function rankMovies(movies, query) {
  const wanted = [query.title, query.originalTitle].filter(Boolean).map(normalizeTitle);
  return movies
    .map((movie) => {
      const titles = [movie.title, movie.originalTitle].filter(Boolean).map(normalizeTitle);
      let score = titles.some((title) => wanted.includes(title)) ? 100 : 0;
      if (
        !score &&
        titles.some((title) => wanted.some((w) => title.includes(w) || w.includes(title)))
      )
        score = 40;
      if (query.year && movie.year)
        score +=
          String(query.year) === String(movie.year)
            ? 35
            : -Math.min(35, Math.abs(Number(query.year) - Number(movie.year)) * 5);
      return { ...movie, score };
    })
    .sort((a, b) => b.score - a.score);
}
const METADATA = [
  'title',
  'originalTitle',
  'year',
  'plot',
  'genre',
  'director',
  'actors',
  'runtime',
  'source',
  'tmdbId',
];
export function mergeMovieMetadata(draft, data, { replaceOwnCover = false } = {}) {
  const result = { ...draft };
  for (const key of METADATA)
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') result[key] = data[key];
  if (data.cover && (!(draft.coverId || draft.coverSource === 'own') || replaceOwnCover)) {
    result.cover = data.cover;
    result.coverSource = 'online';
    if (replaceOwnCover) delete result.coverId;
  }
  return result;
}
