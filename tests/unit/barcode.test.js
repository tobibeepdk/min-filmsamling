import { describe, expect, it } from 'vitest';
import { barcodeVariants, normalizeBarcode } from '../../shared/barcode.js';

describe('barcode validation and canonical identity', () => {
  it.each([
    ['7393834487707', '7393834487707'],
    ['4006381333931', '4006381333931'],
    ['96385074', '96385074'],
    ['036000291452', '0036000291452'],
    ['0036000291452', '0036000291452'],
    [' 7393834487707\n', '7393834487707'],
  ])('normalizes %s to %s after checking its checksum', (input, canonical) => {
    expect(normalizeBarcode(input)).toBe(canonical);
  });

  it.each([
    '7393834487708',
    '4006381333930',
    '96385075',
    '036000291453',
    '',
    '1234567',
    '123456789',
    '12345678901234',
    '73938344877O7',
    '7393 834487707',
    null,
    7393834487707,
  ])('rejects invalid code %s with a Danish explanation', (input) => {
    expect(() => normalizeBarcode(input)).toThrow(/stregkode/i);
  });

  it('maps both UPC-A and its zero-prefixed EAN-13 to both lookup variants', () => {
    expect(barcodeVariants('036000291452')).toEqual(['0036000291452', '036000291452']);
    expect(barcodeVariants('0036000291452')).toEqual(['0036000291452', '036000291452']);
  });

  it('does not invent a UPC variant for nonzero EAN-13 or EAN-8', () => {
    expect(barcodeVariants('7393834487707')).toEqual(['7393834487707']);
    expect(barcodeVariants('96385074')).toEqual(['96385074']);
  });

  it('does not produce provider variants from an invalid checksum', () => {
    expect(() => barcodeVariants('7393834487708')).toThrow();
  });
});
