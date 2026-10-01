import { el, button, image } from './ui.js';
import { icon } from './icons.js';
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
      el(
        'div',
        { class: 'poster' },
        image(movie.displayCover, movie.title),
        el('span', { class: 'format-badge' }, movie.format || 'DVD'),
        movie.favorite
          ? el(
              'span',
              { class: 'favorite-badge', role: 'img', 'aria-label': 'Favorit' },
              icon('star'),
            )
          : null,
      ),
      el(
        'div',
        { class: 'card-body' },
        el('h3', {}, movie.title),
        el(
          'p',
          { class: 'muted' },
          [movie.year, movie.watched ? '✓ Set' : ''].filter(Boolean).join(' · '),
        ),
        button('Åbn og rediger', () => actions.edit(movie.id)),
      ),
    ),
  );
  return el(
    'div',
    { class: 'library' },
    el(
      'section',
      { class: 'hero' },
      el('p', { class: 'eyebrow' }, 'DIN EGEN BIOGRAF'),
      el('h2', {}, 'Dine film. Din samling.'),
      el('p', {}, 'Scan stregkoden eller tag et coverfoto. Så finder appen filmen for dig.'),
      el(
        'div',
        { class: 'actions capture-actions' },
        button([icon('barcode'), 'Scan stregkode'], actions.scan, { class: 'primary' }),
        button([icon('camera'), 'Find film fra cover'], actions.cover),
      ),
    ),
    el(
      'section',
      { class: 'stats', 'aria-label': 'Samlingen i overblik' },
      [
        ['film', movies.length, 'film'],
        ['set', movies.filter((m) => m.watched).length, 'check'],
        ['favoritter', movies.filter((m) => m.favorite).length, 'star'],
      ].map(([label, count, symbol]) =>
        el('div', { class: 'stat' }, icon(symbol), el('strong', {}, count), el('span', {}, label)),
      ),
    ),
    el(
      'div',
      { class: 'collection-heading' },
      el('h2', {}, 'Din samling'),
      el('span', { class: 'muted' }, `${filtered.length} af ${movies.length} film`),
    ),
    el(
      'div',
      { class: 'toolbar' },
      el('div', { class: 'search-field' }, icon('search'), search),
      formats,
    ),
    filtered.length
      ? el('div', { class: 'movie-grid' }, cards)
      : el(
          'section',
          { class: 'empty' },
          el('div', { class: 'empty-icon' }, icon('film')),
          el('h3', {}, movies.length ? 'Ingen film matcher søgningen' : 'Din samling starter her'),
          el('p', {}, 'Film, egne covers og noter kan åbnes offline.'),
          movies.length ? null : button([icon('plus'), 'Tilføj første film'], actions.newMovie),
        ),
  );
}
