import { el, button, field } from './ui.js';
import { showSheet } from './dialogs.js';

export function openMovieSearch({ title = '', year = '', message, onSearch, onCancel }) {
  const titleField = field('Filmtitel', 'searchTitle', title, {
    required: '',
    maxlength: 300,
    autocomplete: 'off',
  });
  const titleInput = titleField.querySelector('input');
  titleInput.addEventListener('input', () => titleInput.setCustomValidity(''));
  const yearField = field('År (valgfrit)', 'searchYear', year, {
    type: 'number',
    inputmode: 'numeric',
    min: 1800,
    max: 2200,
    step: 1,
  });
  const submit = el('button', { type: 'submit', class: 'primary' }, 'Søg');
  const form = el(
    'form',
    {
      onsubmit: async (event) => {
        event.preventDefault();
        const title = titleInput.value.trim();
        if (!title) {
          titleInput.setCustomValidity('Skriv filmens titel.');
          titleInput.reportValidity();
          return;
        }
        if (submit.disabled) return;
        submit.disabled = true;
        try {
          await onSearch({ title, year: yearField.querySelector('input').value });
        } finally {
          submit.disabled = false;
        }
      },
    },
    titleField,
    yearField,
    el('div', { class: 'actions' }, submit, button('Annuller – behold kladden', onCancel)),
  );
  showSheet(
    'Søg efter film',
    el(
      'p',
      {},
      message || 'Skriv filmens titel og eventuelt årstal. Vælg den rigtige film fra TMDB.',
    ),
    form,
  );
}
