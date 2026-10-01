import { el, button, field } from './ui.js';
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
      onsubmit: (event) => {
        event.preventDefault();
        const value = access.querySelector('input').value;
        access.querySelector('input').value = '';
        actions.login(url.querySelector('input').value, value);
      },
    },
    el('h2', {}, 'Indstillinger og backup'),
    el(
      'p',
      { class: 'muted' },
      'Film og kladder gemmes på denne enhed. AI og filmopslag kræver din Worker og en kortvarig session.',
    ),
    url,
    access,
    el(
      'div',
      { class: 'actions' },
      el('button', { type: 'submit', class: 'primary' }, 'Log ind'),
      button('Test forbindelse', () => actions.health(url.querySelector('input').value)),
      button('Log ud', actions.logout),
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
      {},
      el('h3', {}, 'Backup'),
      el(
        'p',
        {},
        'Eksportér jævnligt. Backup indeholder film, egne covers, noter og stregkodekoblinger.',
      ),
      button('Eksportér backup', actions.export),
      el('label', { class: 'field' }, el('span', {}, 'Importér backup'), input),
    ),
    el(
      'p',
      { class: 'muted' },
      'Installation: Åbn appen i Safari → Del → Føj til hjemmeskærm. Dine data følger webstedets origin. Slet ikke Safari-data uden backup.',
    ),
  );
  return form;
}
