import { el, button, field } from './ui.js';
import { icon } from './icons.js';
export function renderSettings(settings, actions) {
  const url = field('Worker-adresse', 'workerUrl', settings.workerUrl || '', {
    type: 'url',
    placeholder: 'https://din-worker.workers.dev',
    autocomplete: 'url',
  });
  const access = field('Adgangsnøgle', 'accessKey', '', {
    type: 'password',
    autocomplete: 'off',
    maxlength: 256,
  });
  const form = el(
    'form',
    {
      class: 'settings',
      onsubmit: (event) => {
        event.preventDefault();
        const value = access.querySelector('input').value;
        access.querySelector('input').value = '';
        actions.login(url.querySelector('input').value, value);
      },
    },
    el('p', { class: 'eyebrow' }, 'DIN SAMLING, TRYGT GEMT'),
    el('h2', {}, 'Indstillinger og backup'),
    el(
      'p',
      { class: 'muted' },
      'Film, kladder og egne coverfotos gemmes på denne enhed. Stregkode- og filmopslag kræver din Worker og login. Appen bruger ikke betalt AI.',
    ),
    el(
      'section',
      { class: 'panel' },
      el('h3', {}, icon('settings'), 'Forbindelse til filmopslag'),
      url,
      access,
      el(
        'div',
        { class: 'actions' },
        el('button', { type: 'submit', class: 'primary' }, 'Log ind'),
        button('Test forbindelse', () => actions.health(url.querySelector('input').value)),
        button('Log ud', actions.logout),
      ),
    ),
  );
  const input = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    'aria-label': 'Importér backup',
    onchange: (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) actions.import(file);
    },
  });
  form.append(
    el(
      'section',
      { class: 'panel' },
      el('h3', {}, icon('download'), 'Backup'),
      el(
        'p',
        {},
        'Eksportér jævnligt. Backup indeholder film, egne covers, noter og stregkodekoblinger.',
      ),
      button([icon('download'), 'Eksportér backup'], actions.export),
      el('label', { class: 'field' }, el('span', {}, 'Importér backup'), input),
    ),
    el(
      'section',
      { class: 'panel installation' },
      el('h3', {}, icon('phone'), 'Tag samlingen med dig'),
      el('p', {}, 'Åbn appen i Safari → Del → Føj til hjemmeskærm.'),
      el(
        'p',
        { class: 'muted' },
        'Dine data følger webstedets origin. Slet ikke Safari-data uden backup.',
      ),
    ),
    el(
      'section',
      { class: 'panel tmdb-attribution' },
      el('h3', {}, 'Om appen'),
      el('p', {}, 'Filmoplysninger og onlinecovers fra TMDB.'),
      el(
        'a',
        {
          class: 'tmdb-link',
          href: 'https://www.themoviedb.org',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        el('img', {
          class: 'tmdb-logo',
          src: `${import.meta.env.BASE_URL}tmdb-logo.svg`,
          alt: 'The Movie Database (TMDB)',
        }),
      ),
      el(
        'p',
        { lang: 'en' },
        'This product uses the TMDB API but is not endorsed or certified by TMDB.',
      ),
    ),
  );
  return form;
}
