const physicalEdition =
  /\b(?:4k|uhd|ultra[ -]*hd|blu[ -]?ray|dvd|steelbook|(?:collector['’]?s?|special|limited|ultimate|anniversary|extended|deluxe)\s+edition|\d+[ -]*discs?|region\s*[a-c0-9])\b/i;
const physicalSuffix =
  /\s+(?:[-–—:]\s*)?(?:4k|uhd|ultra[ -]*hd|blu[ -]?ray|dvd|steelbook|(?:collector['’]?s?|special|limited|ultimate|anniversary|extended|deluxe)\s+edition|\d+[ -]*discs?|region\s*[a-c0-9])\s*$/i;
const regionalSuffix =
  /\s*(?:[-–—:]\s*Scandinavian\s+Edition\.?|\(\s*Scandinavian\s+Edition\.?\s*\)\.?|\[\s*Scandinavian\s+Edition\.?\s*\]\.?)\s*$/i;

export function movieProductTitle(raw) {
  // Remove known product annotations; retain title years and ambiguous edition text.
  let title = raw
    .replace(/\s*(?:\(([^()]*)\)|\[([^[\]]*)\])/g, (annotation, round, square) =>
      physicalEdition.test(round ?? square) ? '' : annotation,
    )
    .replace(/\s+/g, ' ')
    .trim();
  for (let count = 0; count < 10; count++) {
    const next = title.replace(physicalSuffix, '').replace(regionalSuffix, '');
    if (next === title) break;
    title = next.replace(/\s+[-–—+,&/]\s*$/, '').trim();
  }
  return title || raw;
}
