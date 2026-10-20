// Exact verified physical editions only; provenance and scope: docs/fejl-og-loesninger.md#f21.
const editions = new Map([
  [
    '5706710213130',
    {
      title: 'Freddy vs. Jason',
      originalTitle: 'Freddy vs. Jason',
      year: 2003,
      format: 'DVD',
      source: 'Verificeret DVD-udgave',
    },
  ],
]);

export function barcodeCatalogEntry(barcode) {
  const edition = editions.get(barcode);
  return edition ? { ...edition } : null;
}
