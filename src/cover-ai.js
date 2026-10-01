const responseFields = [
  'recognized',
  'title',
  'originalTitle',
  'year',
  'confidence',
  'visibleText',
  'candidates',
];
const candidateFields = ['title', 'year', 'confidence'];
const validString = (value) => typeof value === 'string' && value.length <= 300;
const validYear = (value) =>
  value === null || (Number.isInteger(value) && value >= 1800 && value <= 2200);
const validConfidence = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
const knownFields = (value, fields) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => fields.includes(key));
const optional = (value, name, validate) => !Object.hasOwn(value, name) || validate(value[name]);
const validVisibleText = (value) =>
  Array.isArray(value) && value.length <= 30 && value.every(validString);

export function decideRecognition(result) {
  if (
    !knownFields(result, responseFields) ||
    typeof result.recognized !== 'boolean' ||
    !validString(result.title) ||
    (result.recognized && !result.title.trim()) ||
    !validConfidence(result.confidence) ||
    !optional(result, 'originalTitle', validString) ||
    !optional(result, 'year', validYear) ||
    !optional(result, 'visibleText', validVisibleText) ||
    !Array.isArray(result.candidates) ||
    result.candidates.length > 5
  ) {
    throw new Error('Filmgenkendelsen gav et ugyldigt svar. Tag et nyt billede og prøv igen.');
  }
  const candidates = result.candidates
    .map((candidate) => {
      if (
        !knownFields(candidate, candidateFields) ||
        !validString(candidate.title) ||
        !candidate.title.trim() ||
        !validConfidence(candidate.confidence) ||
        !optional(candidate, 'year', validYear)
      )
        throw new Error('Filmforslagene kunne ikke læses. Prøv igen.');
      return candidate;
    })
    .sort((a, b) => b.confidence - a.confidence);
  const rivals = candidates.filter(
    (c) =>
      c.title.toLowerCase() !== result.title.toLowerCase() ||
      (c.year && result.year && c.year !== result.year),
  );
  const clear = !rivals.length || result.confidence - rivals[0].confidence >= 0.15;
  const selected =
    result.recognized && result.title.trim() && result.confidence >= 0.88 && clear
      ? {
          title: result.title,
          originalTitle: result.originalTitle || result.title,
          year: result.year,
          source: 'AI-covergenkendelse',
        }
      : null;
  return { selected, candidates };
}
