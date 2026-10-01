import './styles.css';
import { openDatabase } from './db.js';
import { migrateLegacy } from './migration.js';
import { exportBackup, importBackup, cleanMovie } from './backup.js';
import { createApi, workerUrl } from './api.js';
import { withWorkerDefault } from './config.js';
import { processBarcode } from './workflow.js';
import { decideRecognition } from './cover-ai.js';
import { mergeMovieMetadata } from '../shared/movie.js';
import { normalizeBarcode } from '../shared/barcode.js';
import { blobToDataURL } from './camera.js';
import { el, button, status, fatal, coverUrl } from './ui.js';
import { renderLibrary } from './library-ui.js';
import { renderEditor, readEditor } from './editor-ui.js';
import { renderSettings } from './settings-ui.js';
import { openScanner, openCoverCamera, showCandidates, closeModal } from './dialogs.js';
import { registerPwa } from './pwa.js';

const app = document.querySelector('#app');
let db,
  api,
  settings,
  draft,
  view = 'library',
  movies = [],
  urls = [],
  query = '',
  format = 'Alle',
  operation;
let writes = Promise.resolve(),
  revision = 0,
  saving = false;
const blank = () => ({
  id: 'current',
  title: '',
  originalTitle: '',
  format: 'DVD',
  notes: '',
  location: '',
  watched: false,
  favorite: false,
  createdAt: new Date().toISOString(),
});
function safe(action) {
  return (...args) =>
    Promise.resolve()
      .then(() => action(...args))
      .catch((error) => {
        if (error.name !== 'AbortError')
          status(error.message || 'Handlingen kunne ikke gennemføres. Kladden er bevaret.');
      });
}
function begin() {
  operation?.abort();
  operation = new AbortController();
  return operation;
}
function cancel() {
  operation?.abort();
  closeModal();
  status('Annulleret. Kladden er bevaret.');
}
function persistDraft(read = true) {
  draft = read === false ? draft || blank() : readEditor(draft || blank());
  const snapshot = { ...draft };
  delete snapshot.displayCover;
  writes = writes
    .catch(() => {})
    .then(async () => {
      const tx = db.transaction('drafts', 'readwrite');
      await tx.store.put(snapshot);
      await tx.store.put({
        ...snapshot,
        id: snapshot.editingMovieId ? 'edit:' + snapshot.editingMovieId : 'new',
      });
      await tx.done;
    });
  writes.catch(() => status('Kladden kunne ikke gemmes. Eksportér backup og frigør lagerplads.'));
  return writes;
}
async function show(next) {
  const task = begin();
  if (view === 'form') await persistDraft();
  if (task.signal.aborted) return;
  view = next;
  closeModal();
  await render(task);
  if (!task.signal.aborted) window.scrollTo(0, 0);
}
async function prepareAdd(task = begin()) {
  if (!draft || draft.editingMovieId) {
    if (draft) await persistDraft(false);
    else await writes.catch(() => {});
    const archived = await db.get('drafts', 'new');
    if (task.signal.aborted) return false;
    draft = archived || blank();
    draft.id = 'current';
  }
  if (task.signal.aborted) return false;
  view = 'form';
  await persistDraft(false);
  return !task.signal.aborted;
}
async function add() {
  const task = begin();
  if (await prepareAdd(task)) await render(task);
}
async function render(task) {
  const renderingView = view;
  const ownRevision = ++revision,
    renderUrls = [],
    oldUrls = urls;
  let content;
  if (view === 'library') {
    movies = await db.getAll('movies');
    const displayed = await Promise.all(
      movies.map(async (m) => ({ ...m, displayCover: await coverUrl(db, m, renderUrls) })),
    );
    content = renderLibrary(
      displayed,
      { scan: safe(scan), cover: safe(() => cover()), edit: safe(edit), newMovie: safe(add) },
      query,
      safe(async (value) => {
        query = value;
        await render();
        const input = app.querySelector('input[type=search]');
        if (input) {
          input.focus();
          input.setSelectionRange(value.length, value.length);
        }
      }),
      format,
      safe(async (value) => {
        format = value;
        await render();
      }),
    );
  } else if (view === 'form') {
    draft ||= blank();
    const currentDraft = draft;
    const displayCover = await coverUrl(db, currentDraft, renderUrls);
    content = renderEditor(
      { ...currentDraft, displayCover },
      {
        save: safe(save),
        change: safe(persistDraft),
        scan: safe(scan),
        cover: safe(() => cover()),
        lookup: safe(lookup),
        cancel: safe(() => show('library')),
        ownCover: safe(ownCover),
        replaceCover: safe(replaceCover),
        remove: safe(remove),
      },
    );
  } else
    content = renderSettings(settings, {
      login: safe(login),
      health: safe(health),
      logout: safe(async () => {
        await db.delete('session', 'current');
        status('Logget ud. Film og kladder er bevaret.');
      }),
      export: safe(backup),
      import: safe(restore),
    });
  if (ownRevision !== revision || renderingView !== view || task?.signal.aborted) {
    renderUrls.forEach(URL.revokeObjectURL);
    return;
  }
  app.replaceChildren(content);
  oldUrls.forEach(URL.revokeObjectURL);
  urls = renderUrls;
  document
    .querySelectorAll('nav button')
    .forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
}
async function edit(id) {
  const task = begin();
  if (draft) await persistDraft(view === 'form');
  if (task.signal.aborted) return;
  const film = (await db.get('drafts', 'edit:' + id)) || (await db.get('movies', id));
  if (task.signal.aborted || !film) return;
  draft = { ...film, id: 'current', editingMovieId: id };
  view = 'form';
  await persistDraft(false);
  if (task.signal.aborted) return;
  await render(task);
  if (!task.signal.aborted) window.scrollTo(0, 0);
}
async function scan() {
  const task = begin();
  if (view !== 'form') {
    if (!(await prepareAdd(task))) return;
  } else await persistDraft();
  if (task.signal.aborted) return;
  await render(task);
  if (task.signal.aborted) return;
  await openScanner(safe(barcode), cancel);
}
async function barcode(code) {
  const task = begin();
  await persistDraft();
  if (task.signal.aborted) return;
  status('Slår stregkoden op…');
  try {
    const result = await processBarcode(
      {
        db,
        api: { post: (path, data) => api.post(path, data, { signal: task.signal }) },
        draft,
        signal: task.signal,
      },
      code,
    );
    if (task.signal.aborted) return;
    const latest = readEditor(draft);
    draft = {
      ...mergeMovieMetadata(latest, result.draft),
      barcode: result.draft.barcode,
      format: result.draft.format || latest.format,
    };
    if (!latest.coverId && result.draft.coverId) {
      draft.coverId = result.draft.coverId;
      draft.coverSource = 'own';
    }
    await persistDraft(false);
    if (task.signal.aborted) return;
    await render(task);
    if (task.signal.aborted) return;
    if (result.next === 'cover')
      await cover('Stregkoden er ukendt. Tag et billede af forsiden, så finder appen filmen.');
    else if (result.next === 'lookup') await lookup();
    else status('Filmen blev fundet i den lokale stregkodekobling.');
  } catch (error) {
    if (!task.signal.aborted) {
      status(error.message);
      await openCoverCamera({
        message: error.message + ' Du kan også finde filmen fra forsiden.',
        onBlob: analyze,
        onCancel: cancel,
        onStart: begin,
      });
    }
  }
}
async function cover(message) {
  const task = begin();
  if (view !== 'form') {
    if (!(await prepareAdd(task))) return;
  } else await persistDraft();
  if (task.signal.aborted) return;
  await render(task);
  if (task.signal.aborted) return;
  await openCoverCamera({ message, onBlob: analyze, onCancel: cancel, onStart: begin });
}
async function analyze(blob, retry) {
  const task = begin();
  status('Uploader cover og analyserer hele forsiden…');
  const result = await api.post(
    '/identify-cover',
    { image: await blobToDataURL(blob) },
    { signal: task.signal },
  );
  if (task.signal.aborted) return;
  const decision = decideRecognition(result);
  const extras = [
    button('Tag nyt billede', safe(retry.retry)),
    button('Beskær titelområdet og prøv igen', safe(retry.crop)),
    button('Annuller – behold kladden', cancel),
  ];
  if (decision.selected) await identified(decision.selected, task);
  else {
    status('Vælg en kandidat, eller tag et skarpere billede.');
    showCandidates(
      decision.candidates,
      safe((candidate) => identified({ ...candidate, source: 'AI-covergenkendelse' }, task)),
      extras,
    );
  }
}
async function identified(movie, task) {
  if (task.signal.aborted) return;
  draft = mergeMovieMetadata(readEditor(draft), movie);
  closeModal();
  await persistDraft(false);
  if (task.signal.aborted) return;
  await render(task);
  if (task.signal.aborted) return;
  status('Titlen er fundet. Henter filmoplysninger…');
  await lookup();
}
async function lookup() {
  const task = begin();
  await persistDraft();
  if (task.signal.aborted) return;
  if (!draft.title?.trim())
    throw new Error('Scan stregkoden eller fotografér coveret for at finde titlen.');
  status('Henter filmoplysninger og onlineomslag…');
  const result = await api.post(
    '/search-movie',
    {
      title: draft.title,
      originalTitle: draft.originalTitle || '',
      year: draft.year ? Number(draft.year) : null,
    },
    { signal: task.signal },
  );
  if (task.signal.aborted) return;
  if (!Array.isArray(result.candidates) || result.candidates.length > 5)
    throw new Error('Filmopslaget gav et ugyldigt svar. Kladden er bevaret.');
  if (!result.candidates.length) {
    status(
      result.configured === false
        ? 'Titlen er klar til at gemme. Tilføj TMDB-token i Worker for øvrige filmoplysninger.'
        : 'Titlen er klar til at gemme. Ingen yderligere filmdata blev fundet.',
    );
    return;
  }
  const apply = safe(async (candidate) => {
    if (task.signal.aborted) return;
    if (typeof candidate.title !== 'string' || !candidate.title.trim())
      throw new Error('Ugyldigt filmforslag. Kladden er bevaret.');
    draft = readEditor(draft);
    if (candidate.cover && draft.coverId) draft.onlineCover = candidate.cover;
    draft = mergeMovieMetadata(draft, candidate);
    await persistDraft(false);
    if (task.signal.aborted) return;
    closeModal();
    await render(task);
    if (task.signal.aborted) return;
    status('Filmoplysninger hentet. Du kan nu gemme filmen.');
  });
  const [first, second] = result.candidates;
  const automatic = first.score >= 0.9 && (!second || first.score - second.score >= 0.15);
  if (automatic) await apply(first);
  else
    showCandidates(result.candidates, apply, [
      button('Behold den fundne titel', () => {
        closeModal();
        status('Titlen er bevaret. Du kan gemme filmen.');
      }),
      button('Annuller – behold kladden', cancel),
    ]);
}
async function ownCover() {
  const opening = begin();
  await persistDraft();
  if (opening.signal.aborted) return;
  await openCoverCamera({
    own: true,
    onStart: begin,
    onCancel: cancel,
    onBlob: async (blob) => {
      const task = begin(),
        id = crypto.randomUUID();
      await db.put('coverBlobs', { id, blob });
      if (task.signal.aborted) return;
      draft.coverId = id;
      draft.coverSource = 'own';
      delete draft.cover;
      await persistDraft(false);
      if (task.signal.aborted) return;
      closeModal();
      await render(task);
      if (task.signal.aborted) return;
      status('Dit eget cover er gemt i kladden.');
    },
  });
}
async function replaceCover() {
  if (!confirm('Vil du erstatte dit eget coverfoto med onlineomslaget?')) return;
  draft.cover = draft.onlineCover;
  delete draft.coverId;
  draft.coverSource = 'online';
  await persistDraft(false);
  await render();
}
async function save() {
  if (saving) return;
  saving = true;
  try {
    const task = begin();
    await persistDraft();
    if (task.signal.aborted) return;
    if (!draft.title?.trim()) throw new Error('Find titlen ved at scanne eller tage et coverfoto.');
    const id = draft.editingMovieId || crypto.randomUUID(),
      data = { ...draft, id, title: draft.title.trim(), updatedAt: new Date().toISOString() };
    delete data.displayCover;
    delete data.editingMovieId;
    delete data.onlineCover;
    const film = cleanMovie(data),
      transaction = db.transaction(['movies', 'drafts', 'barcodeMap'], 'readwrite');
    await transaction.objectStore('movies').put(film);
    if (film.barcode) {
      let code;
      try {
        code = normalizeBarcode(film.barcode);
      } catch {
        /* Preserve invalid historical code in film. */
      }
      if (code)
        await transaction
          .objectStore('barcodeMap')
          .put({ id: code, movieId: id, title: film.title, year: film.year || '' });
    }
    await transaction.objectStore('drafts').delete('current');
    await transaction
      .objectStore('drafts')
      .delete(draft.editingMovieId ? 'edit:' + draft.editingMovieId : 'new');
    await transaction.done;
    if (task.signal.aborted) return;
    draft = null;
    view = 'library';
    await render(task);
    if (!task.signal.aborted) status('Filmen er gemt.');
  } finally {
    saving = false;
  }
}
async function remove() {
  if (!confirm('Vil du slette denne film? Eksportér en backup, hvis du vil kunne gendanne den.'))
    return;
  const task = begin(),
    id = draft.editingMovieId;
  await writes;
  if (task.signal.aborted) return;
  const tx = db.transaction(['movies', 'barcodeMap', 'drafts'], 'readwrite');
  await tx.objectStore('movies').delete(id);
  for (const map of await tx.objectStore('barcodeMap').getAll())
    if (map.movieId === id) await tx.objectStore('barcodeMap').delete(map.id);
  await tx.objectStore('drafts').delete('current');
  await tx.objectStore('drafts').delete('edit:' + id);
  await tx.done;
  if (task.signal.aborted) return;
  draft = null;
  view = 'library';
  await render(task);
  if (!task.signal.aborted) status('Filmen er slettet.');
}
async function login(url, key) {
  settings = { ...settings, workerUrl: workerUrl(url.trim()), id: 'preferences' };
  await db.put('settings', settings);
  status('Logger ind…');
  try {
    await api.login(key);
  } finally {
    // Drop the transient reference after the login request.
    // eslint-disable-next-line no-useless-assignment
    key = '';
  }
  status('Logget ind. Filmopslag og AI er klar.');
}
async function health(url) {
  const origin = workerUrl(url.trim());
  const result = await fetch(origin + '/health', {
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new Error('Worker-forbindelsen blev afvist. Kontrollér ALLOWED_ORIGIN.');
  status('Forbindelse til Worker er OK.');
}
async function backup() {
  const data = await exportBackup(db),
    blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    url = URL.createObjectURL(blob);
  const link = el('a', {
    href: url,
    download: 'filmsamling-' + new Date().toISOString().slice(0, 10) + '.json',
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  status('Backup eksporteret uden session eller nøgler.');
}
async function restore(file) {
  if (file.size > 80 * 1024 * 1024) throw new Error('Backupfilen er for stor (maks. 80 MB).');
  const result = await importBackup(db, await file.text());
  status(result.movies + ' film importeret. ' + result.skipped + ' eksisterende film bevaret.');
}
for (const b of document.querySelectorAll('nav button'))
  b.addEventListener(
    'click',
    safe(async () => {
      if (b.dataset.view === 'form' && view !== 'form') await add();
      else await show(b.dataset.view);
    }),
  );
window.addEventListener('pagehide', () => {
  operation?.abort();
  closeModal();
  if (db && view === 'form') persistDraft();
});
function network() {
  document.querySelector('#network').textContent = navigator.onLine
    ? 'Lokalt gemt'
    : 'Offline · lokalt gemt';
}
window.addEventListener('online', network);
window.addEventListener('offline', network);
async function start() {
  db = await openDatabase();
  const migrated = await migrateLegacy(db);
  settings = withWorkerDefault(
    (await db.get('settings', 'preferences')) || { id: 'preferences', language: 'da-DK' },
  );
  draft = (await db.get('drafts', 'current')) || null;
  api = createApi(db, () => settings.workerUrl);
  await render();
  window.filmsamlingReady = true;
  status(
    migrated.migrated
      ? 'Eksisterende film og kladder er overført sikkert.'
      : 'Din samling er klar.',
  );
  network();
  registerPwa(async () => {
    operation?.abort();
    if (view === 'form') await persistDraft();
  });
}
start().catch(fatal);
