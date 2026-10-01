import { icon } from './icons.js';
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on') && typeof value === 'function')
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined)
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
export const button = (text, handler, attributes = {}) =>
  el('button', { type: 'button', onclick: handler, ...attributes }, text);
export function field(
  label,
  name,
  value = '',
  { type = 'text', multiline = false, ...attributes } = {},
) {
  const input = el(multiline ? 'textarea' : 'input', {
    name,
    type: multiline ? null : type,
    ...attributes,
  });
  input.value = value ?? '';
  return el('label', { class: 'field' }, el('span', {}, label), input);
}
export function image(url, title) {
  if (
    typeof url !== 'string' ||
    !/^(https:\/\/|blob:|data:image\/(jpeg|png|webp|gif);base64,)/i.test(url)
  )
    return el('div', { class: 'placeholder', 'aria-label': 'Intet cover' }, icon('film'));
  const picture = el('img', {
    src: url,
    alt: 'Cover til ' + (title || 'filmen'),
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
  });
  picture.addEventListener(
    'error',
    () => picture.replaceWith(el('div', { class: 'placeholder' }, 'Intet cover')),
    { once: true },
  );
  return picture;
}
export function status(text) {
  document.querySelector('#status').textContent = text;
}
export function fatal(error) {
  document.querySelector('#fatal').hidden = false;
  status(error?.message || 'Din samling kunne ikke åbnes. Dine gamle data er bevaret.');
}
export async function coverUrl(db, movie, urls) {
  if (movie.coverId) {
    const record = await db.get('coverBlobs', movie.coverId);
    if (record) {
      const url = URL.createObjectURL(record.blob);
      urls.push(url);
      return url;
    }
  }
  return movie.cover || '';
}
