// These fixed codes contain no request data or provider error text.
export const serviceErrors = Object.freeze({
  PROVIDER_AUTH: 'Tjenestens adgang kunne ikke godkendes. Kontrollér tjenestens opsætning.',
  PROVIDER_ACCESS: 'Tjenesten afviste adgangen. Kontrollér kontoens adgang og modelopsætning.',
  PROVIDER_QUOTA:
    'Tjenestens forbrugsbudget er opbrugt. Kontrollér kontoens saldo og forbrugsgrænse.',
  PROVIDER_RATE_LIMIT: 'Tjenesten har nået sin grænse for opslag. Vent lidt og prøv igen.',
  PROVIDER_REQUEST: 'Tjenesten afviste forespørgslen. Kontrollér tjenestens opsætning.',
  PROVIDER_TIMEOUT: 'Tjenesten svarede ikke i tide. Du kan prøve igen med samme billede.',
  PROVIDER_FAILURE: 'Tjenesten kunne ikke gennemføre opslaget. Prøv igen senere.',
  PROVIDER_RESPONSE: 'Tjenesten sendte et svar, som ikke kunne læses. Prøv igen senere.',
  AI_INCOMPLETE: 'AI-analysen blev ikke færdig. Prøv igen eller beskær titelområdet.',
  AI_REFUSED: 'AI kunne ikke analysere dette foto. Prøv et tydeligt billede af filmens forside.',
  AI_INVALID_RESULT: 'AI gav ikke et brugbart filmsvar. Prøv igen eller tag et nyt billede.',
});

export function serviceErrorMessage(code) {
  return typeof code === 'string' && Object.hasOwn(serviceErrors, code) ? serviceErrors[code] : '';
}
