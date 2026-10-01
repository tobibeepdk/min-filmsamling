const INVALID_BARCODE =
  'Ugyldig stregkode. Brug EAN-13, EAN-8 eller UPC-A med korrekt kontrolciffer.';

/** A UPC-A and its zero-prefixed EAN-13 share one local identity. */
export function normalizeBarcode(input) {
  if (typeof input !== 'string') throw new Error(INVALID_BARCODE);
  const code = input.trim();
  if (!/^(?:\d{8}|\d{12}|\d{13})$/.test(code)) throw new Error(INVALID_BARCODE);
  let sum = 0;
  for (
    let index = code.length - 2, weight = 3;
    index >= 0;
    index -= 1, weight = weight === 3 ? 1 : 3
  ) {
    sum += Number(code[index]) * weight;
  }
  if ((10 - (sum % 10)) % 10 !== Number(code.at(-1))) throw new Error(INVALID_BARCODE);
  return code.length === 12 ? `0${code}` : code;
}

export function barcodeVariants(input) {
  const canonical = normalizeBarcode(input);
  return canonical.length === 13 && canonical.startsWith('0')
    ? [canonical, canonical.slice(1)]
    : [canonical];
}
