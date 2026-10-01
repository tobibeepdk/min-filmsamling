import { describe, it, expect } from 'vitest';
import { decideRecognition } from '../../src/cover-ai.js';

describe('AI response schema', () => {
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
  ])('rejects malformed optional fields: %j', (fields) => {
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
  it.each(['2013', 2013.5, 1799, 2201, {}])('rejects malformed candidate year: %j', (year) => {
    expect(() =>
      decideRecognition({
        recognized: true,
        title: 'The Wicked',
        confidence: 0.7,
        candidates: [{ title: 'The Wicked', year, confidence: 0.7 }],
      }),
    ).toThrow(/Filmforslagene kunne ikke læses/);
  });
  it('accepts omitted optional fields and an unknown null year', () => {
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
});
