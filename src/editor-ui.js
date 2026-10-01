import { el, button, field, image } from './ui.js';
const fields = [
  ['Titel', 'title'],
  ['Originaltitel', 'originalTitle'],
  ['År', 'year'],
  ['Genre', 'genre'],
  ['Instruktør', 'director'],
  ['Skuespillere', 'actors'],
  ['Spilletid (minutter)', 'runtime'],
  ['Stregkode', 'barcode'],
  ['Placering', 'location'],
  ['Handling', 'plot'],
  ['Noter', 'notes'],
];
export function renderEditor(draft, actions) {
  const form = el(
    'form',
    {
      id: 'film-form',
      onsubmit: (event) => {
        event.preventDefault();
        actions.save();
      },
      oninput: actions.change,
      onchange: actions.change,
    },
    el('h2', {}, draft.editingMovieId ? 'Rediger film' : 'Tilføj film'),
    el('p', { class: 'muted' }, 'Kladden gemmes efter hvert trin, også når du annullerer.'),
    el(
      'div',
      { class: 'actions' },
      button('Scan stregkode', actions.scan),
      button('Find film fra cover', actions.cover, { class: 'primary' }),
    ),
    el(
      'div',
      { class: 'form-grid' },
      fields.map(([label, name]) =>
        field(label, name, draft[name], {
          multiline: ['plot', 'notes'].includes(name),
          required: name === 'title' ? '' : null,
          inputmode: ['year', 'runtime', 'barcode'].includes(name) ? 'numeric' : null,
        }),
      ),
      el(
        'label',
        { class: 'field' },
        el('span', {}, 'Format'),
        el(
          'select',
          { name: 'format' },
          ['DVD', 'Blu-ray', '4K UHD', 'VHS', 'Digital', 'Andet'].map((format) =>
            el('option', { selected: format === draft.format ? '' : null }, format),
          ),
        ),
      ),
    ),
    el(
      'div',
      { class: 'checks' },
      ['watched', 'favorite'].map((name, i) =>
        el(
          'label',
          {},
          el('input', { name, type: 'checkbox', checked: draft[name] }),
          i ? 'Favorit' : 'Set',
        ),
      ),
    ),
    el(
      'div',
      { class: 'cover-editor' },
      image(draft.displayCover, draft.title),
      el(
        'div',
        {},
        el('h3', {}, 'Omslag'),
        button('Tag eget coverfoto', actions.ownCover),
        draft.coverId && draft.onlineCover
          ? button('Brug onlineomslaget i stedet', actions.replaceCover)
          : null,
      ),
    ),
    el('p', { class: 'muted' }, `Datakilde: ${draft.source || 'Egne oplysninger'}`),
    el(
      'div',
      { class: 'actions' },
      button('Hent filmoplysninger', actions.lookup),
      el('button', { class: 'primary', type: 'submit' }, 'Gem film'),
      button('Annuller – behold kladden', actions.cancel),
    ),
    draft.editingMovieId ? button('Slet film', actions.remove, { class: 'danger' }) : null,
  );
  return form;
}
export function readEditor(previous) {
  const form = document.querySelector('#film-form');
  if (!form) return previous;
  const data = new FormData(form);
  const draft = { ...previous };
  for (const [, name] of fields) draft[name] = String(data.get(name) || '');
  draft.format = String(data.get('format') || 'DVD');
  draft.watched = data.has('watched');
  draft.favorite = data.has('favorite');
  return draft;
}
