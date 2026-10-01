import { el, button, image } from './ui.js';
export function renderLibrary(
  movies,
  actions,
  query = '',
  onSearch = () => {},
  format = 'Alle',
  onFormat = () => {},
) {
  const search = el('input', {
    type: 'search',
    placeholder: 'Søg titel, genre, noter…',
    'aria-label': 'Søg i samlingen',
    value: query,
    oninput: (e) => onSearch(e.target.value),
  });
  const formats = el(
    'select',
    { 'aria-label': 'Filtrér format', onchange: (e) => onFormat(e.target.value) },
    ['Alle', 'DVD', 'Blu-ray', '4K UHD', 'VHS', 'Digital', 'Andet'].map((f) =>
      el('option', { selected: f === format ? '' : null }, f),
    ),
  );
  const filtered = movies
    .filter(
      (m) =>
        [m.title, m.originalTitle, m.genre, m.notes, m.location, m.barcode]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (format === 'Alle' || m.format === format),
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'da'));
  const cards = filtered.map((movie) =>
    el(
      'article',
      { class: 'movie-card' },
      image(movie.displayCover, movie.title),
      el(
        'div',
        { class: 'card-body' },
        el('h3', {}, movie.title),
        el(
          'p',
          { class: 'muted' },
          [
            movie.year,
            movie.format,
            movie.favorite ? '★ Favorit' : '',
            movie.watched ? '✓ Set' : '',
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        button('Åbn og rediger', () => actions.edit(movie.id)),
      ),
    ),
  );
  return el(
    'div',
    {},
    el(
      'section',
      { class: 'hero' },
      el('p', { class: 'eyebrow' }, 'DIN EGEN BIOGRAF'),
      el('h2', {}, 'Samlingen i lommen'),
      el(
        'p',
        {},
        'Scan stregkoden eller fotografér forsiden. Appen finder filmen og gemmer den på denne enhed.',
      ),
      el(
        'div',
        { class: 'actions' },
        button('Scan stregkode', actions.scan, { class: 'primary' }),
        button('Find film fra cover', actions.cover),
      ),
    ),
    el(
      'div',
      { class: 'stats' },
      el('strong', {}, movies.length + ' film'),
      el(
        'span',
        {},
        movies.filter((m) => m.watched).length +
          ' set · ' +
          movies.filter((m) => m.favorite).length +
          ' favoritter',
      ),
    ),
    el('div', { class: 'toolbar' }, search, formats),
    filtered.length
      ? el('div', { class: 'movie-grid' }, cards)
      : el(
          'section',
          { class: 'empty' },
          el('h3', {}, movies.length ? 'Ingen film matcher søgningen' : 'Din samling starter her'),
          el('p', {}, 'Film, egne covers og noter kan åbnes offline.'),
          button('Tilføj første film', actions.newMovie),
        ),
  );
}
