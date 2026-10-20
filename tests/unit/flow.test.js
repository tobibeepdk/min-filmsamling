import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { openDatabase } from '../../src/db.js';
import { processBarcode } from '../../src/workflow.js';
import { rankMovies, mergeMovieMetadata } from '../../shared/movie.js';
import { decideRecognition } from '../../src/cover-ai.js';

describe('filmflow og metadata', () => {
  it('den verificerede Freddy vs. Jason-DVD findes uden stregkodeprovider og bevarer egne felter', async () => {
    const db = await openDatabase('verified-dvd-' + crypto.randomUUID());
    let remoteCalls = 0;
    const result = await processBarcode(
      {
        db,
        api: {
          post: async () => {
            remoteCalls += 1;
            return { found: false };
          },
        },
        draft: {
          notes: 'Min note på DVDen',
          location: 'Reol 3',
          coverId: 'eget-cover',
          coverSource: 'own',
          favorite: true,
          watched: true,
        },
      },
      '5706710213130',
    );
    expect(result).toMatchObject({
      next: 'lookup',
      source: 'Verificeret DVD-udgave',
      draft: {
        barcode: '5706710213130',
        title: 'Freddy vs. Jason',
        originalTitle: 'Freddy vs. Jason',
        year: 2003,
        format: 'DVD',
        notes: 'Min note på DVDen',
        location: 'Reol 3',
        coverId: 'eget-cover',
        coverSource: 'own',
        favorite: true,
        watched: true,
      },
    });
    expect(await db.get('drafts', 'current')).toEqual(result.draft);
    expect(remoteCalls).toBe(0);
    db.close();
  });
  it('brugerens lokale kobling har forrang over den verificerede DVD-udgave', async () => {
    const db = await openDatabase('verified-dvd-user-override-' + crypto.randomUUID());
    await db.put('movies', {
      id: 'user-film',
      title: 'Min egen registrering',
      originalTitle: 'Min originaltitel',
      year: 2004,
      format: 'Andet',
    });
    await db.put('barcodeMap', {
      id: '5706710213130',
      movieId: 'user-film',
      title: 'Min egen registrering',
      year: 2004,
    });
    const result = await processBarcode(
      {
        db,
        api: {
          post: () => {
            throw Error('API må ikke kaldes');
          },
        },
        draft: { notes: 'Min note', location: 'Reol 2', coverId: 'eget-cover' },
      },
      '5706710213130',
    );
    expect(result).toMatchObject({
      next: 'form',
      source: 'local',
      draft: {
        barcode: '5706710213130',
        title: 'Min egen registrering',
        originalTitle: 'Min originaltitel',
        year: 2004,
        format: 'Andet',
        notes: 'Min note',
        location: 'Reol 2',
        coverId: 'eget-cover',
      },
    });
    expect(await db.get('drafts', 'current')).toEqual(result.draft);
    db.close();
  });
  it('ukendt 7393834487707 åbner titelsøgning og gemmer kladden uden AI', async () => {
    const db = await openDatabase('unknown-' + crypto.randomUUID());
    const result = await processBarcode(
      {
        db,
        api: { post: async () => ({ found: false }) },
        draft: { notes: 'Bevar mig', location: 'Reol 2', coverId: 'eget-cover' },
      },
      '7393834487707',
    );
    expect(result.next).toBe('search');
    expect((await db.get('drafts', 'current')).barcode).toBe('7393834487707');
    expect(result.draft.notes).toBe('Bevar mig');
    expect(result.draft.location).toBe('Reol 2');
    expect(result.draft.coverId).toBe('eget-cover');
    db.close();
  });
  it('lokal barcodeMap udfylder straks uden API-kald', async () => {
    const db = await openDatabase('known-' + crypto.randomUUID());
    await db.put('movies', {
      id: 'movie1',
      title: 'The Wicked',
      year: 2013,
      notes: 'Original note',
    });
    await db.put('barcodeMap', {
      id: '7393834487707',
      movieId: 'movie1',
      title: 'The Wicked',
      year: 2013,
    });
    const result = await processBarcode(
      {
        db,
        api: {
          post: () => {
            throw Error('API må ikke kaldes');
          },
        },
        draft: { notes: 'Min note', location: 'Reol 2' },
      },
      '7393834487707',
    );
    expect(result.next).toBe('form');
    expect(result.draft.title).toBe('The Wicked');
    expect(result.draft.notes).toBe('Min note');
    expect(result.draft.location).toBe('Reol 2');
    db.close();
  });
  it('høj AI-confidence udfylder The Wicked automatisk', () => {
    expect(
      decideRecognition({
        recognized: true,
        title: 'The Wicked',
        originalTitle: 'The Wicked',
        year: 2013,
        confidence: 0.94,
        visibleText: ['THE WICKED'],
        candidates: [{ title: 'The Wicked', year: 2013, confidence: 0.94 }],
      }).selected.title,
    ).toBe('The Wicked');
  });
  it('lav confidence og konkurrerende kandidater kræver valg', () => {
    expect(
      decideRecognition({
        recognized: true,
        title: 'The Wicked',
        confidence: 0.6,
        candidates: [{ title: 'The Wicked', year: 2013, confidence: 0.6 }],
      }).selected,
    ).toBeNull();
    expect(
      decideRecognition({
        recognized: true,
        title: 'A',
        confidence: 0.94,
        candidates: [
          { title: 'A', year: 2013, confidence: 0.94 },
          { title: 'B', year: 2014, confidence: 0.9 },
        ],
      }).selected,
    ).toBeNull();
  });
  it('afviser ugyldigt AI-resultat', () => {
    expect(() =>
      decideRecognition({ recognized: true, title: '', confidence: 2, candidates: [] }),
    ).toThrow();
  });
  it.each([
    { originalTitle: {} },
    { originalTitle: null },
    { year: '2013' },
    { year: 2013.5 },
    { year: 1799 },
    { year: 2201 },
    { visibleText: 'THE WICKED' },
    { visibleText: [{}] },
    { visibleText: Array(31).fill('A') },
    { unexpected: 'bad' },
  ])('afviser malformede valgfrie AI-felter: %j', (fields) => {
    expect(() =>
      decideRecognition({
        recognized: true,
        title: 'The Wicked',
        confidence: 0.94,
        candidates: [],
        ...fields,
      }),
    ).toThrow(/Filmgenkendelsen gav et ugyldigt svar/);
  });
  it.each(['2013', 2013.5, 1799, 2201, {}])('afviser ugyldigt kandidatår: %j', (year) => {
    expect(() =>
      decideRecognition({
        recognized: true,
        title: 'The Wicked',
        confidence: 0.7,
        candidates: [{ title: 'The Wicked', year, confidence: 0.7 }],
      }),
    ).toThrow(/Filmforslagene kunne ikke læses/);
  });
  it('tillader udeladte valgfrie felter og et ukendt null-år', () => {
    expect(
      decideRecognition({ recognized: true, title: 'The Wicked', confidence: 0.94, candidates: [] })
        .selected.title,
    ).toBe('The Wicked');
    expect(
      decideRecognition({
        recognized: false,
        title: '',
        year: null,
        confidence: 0,
        visibleText: [],
        candidates: [{ title: 'The Wicked', year: null, confidence: 0.5 }],
      }).candidates[0].year,
    ).toBeNull();
  });
  it('rangerer ud fra titel, originaltitel og præcist år', () => {
    const ranked = rankMovies(
      [
        { title: 'The Wicked', year: 2020 },
        { title: 'De onde', originalTitle: 'The Wicked', year: 2013 },
        { title: 'Another film', year: 2013 },
      ],
      { title: 'The Wicked', year: 2013 },
    );
    expect(ranked[0].title).toBe('De onde');
  });
  it('metadata overskriver aldrig noter, placering eller eget cover', () => {
    const result = mergeMovieMetadata(
      {
        notes: 'Min',
        location: 'Reol',
        coverId: 'own',
        coverSource: 'own',
        cover: 'blob:local',
        favorite: true,
      },
      {
        title: 'The Wicked',
        notes: 'API',
        location: 'API',
        cover: 'https://image.tmdb.org/a.jpg',
        coverId: 'API',
        favorite: false,
      },
    );
    expect(result).toMatchObject({
      title: 'The Wicked',
      notes: 'Min',
      location: 'Reol',
      coverId: 'own',
      cover: 'blob:local',
      favorite: true,
    });
  });
});

it.each([{}, { found: 'false' }, { found: 1 }, { found: true, title: {} }])(
  'malformet stregkodeopslag må ikke opfinde en titel: %j',
  async (response) => {
    const db = await openDatabase('bad-barcode-' + crypto.randomUUID());
    await expect(
      processBarcode(
        { db, api: { post: async () => response }, draft: { notes: 'Bevar' } },
        '7393834487707',
      ),
    ).rejects.toThrow('Stregkodeopslaget gav et ugyldigt svar');
    db.close();
  },
);
it('annulleret API-opslag skriver aldrig et gammelt resultat til kladden', async () => {
  const db = await openDatabase('cancel-barcode-' + crypto.randomUUID()),
    controller = new AbortController();
  const result = processBarcode(
    {
      db,
      signal: controller.signal,
      api: {
        post: async () => {
          controller.abort();
          await db.put('drafts', { id: 'current', title: 'Nyere kladde', notes: 'Ny note' });
          return { found: true, title: 'Gammelt svar' };
        },
      },
      draft: {},
    },
    '7393834487707',
  );
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect((await db.get('drafts', 'current')).title).toBe('Nyere kladde');
  db.close();
});
