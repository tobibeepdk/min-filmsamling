// Local decorative SVGs: no external assets, HTML interpolation or network requests.
const paths = {
  film: ['M4 3h16v18H4z', 'M4 7h16M4 17h16M8 3v18M16 3v18'],
  barcode: ['M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3', 'M8 8v8M11 8v8M14 8v8M17 8v8'],
  camera: ['M3 7h4l2-3h6l2 3h4v13H3z', 'M15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0'],
  plus: ['M12 5v14M5 12h14'],
  settings: ['M4 6h16M4 12h16M4 18h16', 'M8 3v6M16 9v6M10 15v6'],
  search: ['M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0', 'M15 15l5 5'],
  star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z'],
  check: ['m5 12 4 4L19 6'],
  download: ['M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5'],
  phone: ['M7 2h10v20H7z', 'M11 18h2'],
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'icon',
  }))
    svg.setAttribute(key, value);
  for (const d of paths[name] || paths.film) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
