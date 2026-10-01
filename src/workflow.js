import { normalizeBarcode } from '../shared/barcode.js';
import { mergeMovieMetadata } from '../shared/movie.js';
export async function processBarcode({ db, api, draft, signal }, code) {
  signal?.throwIfAborted();
  const barcode = normalizeBarcode(code);
  let nextDraft = { ...draft, id: 'current', barcode };
  await db.put('drafts', nextDraft);
  const mapping = await db.get('barcodeMap', barcode);
  signal?.throwIfAborted();
  if (mapping) {
    const film = await db.get('movies', mapping.movieId);
    signal?.throwIfAborted();
    nextDraft = mergeMovieMetadata(nextDraft, film || mapping);
    if (film?.format) nextDraft.format = film.format;
    if (!nextDraft.coverId && !nextDraft.cover && film?.coverId) {
      nextDraft.coverId = film.coverId;
      nextDraft.coverSource = 'own';
    }
    nextDraft.source = 'Lokal stregkodekobling';
    signal?.throwIfAborted();
    await db.put('drafts', nextDraft);
    return { draft: nextDraft, next: 'form', source: 'local' };
  }
  const result = await api.post('/lookup-barcode', { barcode });
  signal?.throwIfAborted();
  if (
    !result ||
    typeof result.found !== 'boolean' ||
    (result.found && (typeof result.title !== 'string' || !result.title.trim()))
  )
    throw new Error('Stregkodeopslaget gav et ugyldigt svar. Kladden er bevaret.');
  if (result.found && typeof result.title === 'string' && result.title.trim()) {
    nextDraft = mergeMovieMetadata(nextDraft, {
      title: result.title,
      source: result.source || 'Stregkodedatabase',
    });
    if (result.format) nextDraft.format = result.format;
    await db.put('drafts', nextDraft);
    return { draft: nextDraft, next: 'lookup', source: result.source };
  }
  return { draft: nextDraft, next: 'cover' };
}
