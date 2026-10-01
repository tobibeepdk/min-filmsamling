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
      'Film og kladder gemmes på denne enhed. AI og filmopslag kræver din Worker og en kortvarig session.',
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
  );
  return form;
}
