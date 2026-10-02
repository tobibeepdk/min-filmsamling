# Implementering og verifikation – 2. oktober 2026

## Rettelse af cover- og opslagfejl

Et fejlet coveropslag efterlod tidligere et stoppet, sort kamera og en aktiv **Tag billede**-knap. Appen viser nu det komprimerede foto, mens analysen kører og ved en fejl. Brugeren kan vælge **Prøv analysen igen**, beskære, tage et nyt foto eller annullere med kladden bevaret. Samme komprimerede billedbytes genbruges ved et manuelt genforsøg. Preview og midlertidigt foto frigives, når vinduet lukkes; fotoet gemmes ikke som AI-materiale i databasen eller backup.

Fejl fra metadataopslag vises også efter en allerede identificeret titel. Titlen og egne noter kan fortsat gemmes. Stoppet eller utilgængeligt livekamera skjules; input-capture-reserven er tilgængelig.

Worker og frontend bruger en fælles allowlist af ufølsomme fejlkoder. De skelner mellem provideradgang, kvote, throttling, timeout og et ufærdigt eller ugyldigt AI-svar. Rå providerbeskeder, credentials, tokens og fotoindhold returneres eller logges ikke. OpenAI-fejlindhold til kvoteklassifikation læses med en grænse på 8192 bytes. Kamera-/API-annullering afviser forældede svar.

## Arkitektur og ændrede filer

Frontend er fortsat en statisk Vite-PWA under `/min-filmsamling/`. Cloudflare Worker beskytter alle providerkald med kortlivede signerede sessioner, præcis Origin og en Durable Object med vedvarende globale, IP- og sessionsgrænser. IndexedDB indeholder `movies`, `drafts`, `barcodeMap`, `settings`, `coverBlobs` og `session`. Denne rettelse ændrer ingen databasestruktur, migrationshistorik, Worker-binding, providersecret eller forbrugsgrænse.

| Område | Ændrede filer |
| --- | --- |
| Kamera og appflow | `src/dialogs.js`, `src/app.js` |
| Sikre API-fejl | `src/api.js`, `shared/service-errors.js`, `worker/src/http.js`, `worker/src/vision.js` |
| Regressionstests | `tests/unit/api.test.js`, `tests/unit/worker.test.js`, `tests/e2e/regressions.spec.js` |
| Testport og API-mocks | `playwright.config.js`, `tests/e2e/iphone.spec.js` |
| Dokumentation | `README.md`, `docs/OPSÆTNING-DANSK.md`, denne rapport |

## Faktiske kontrolresultater

Kontrollerne er kørt i `/private/tmp/min-filmsamling-final` med Node.js 24.19.0 og pnpm 11.19.0. Udgangspunktet er main-commit `9438020495ad9c7a82938d92b53b60208af68d6f`. De nye fejl blev først reproduceret med røde regressionstests og derefter verificeret grønne.

```text
pnpm test
Test Files  10 passed (10)
     Tests  198 passed (198)
  Duration  828ms

pnpm lint
$ eslint src shared worker/src scripts tests *.js --no-warn-ignored
[exit 0; ingen lintfejl]

pnpm build
✓ 249 modules transformed.
✓ built in 744ms
Service worker c075f143f0f6e0e4: 10 lokale filer; ingen API-cache.

pnpm security
Sikkerhed: 69 filer + 48 git-commits kontrolleret; 0 secret-fund.
Browser-build: ingen servernøgler eller direkte OpenAI-kald.

FILMSAMLING_TEST_PORT=4183 pnpm test:e2e
Running 50 tests using 1 worker
50 passed (28.1s)

Rekursiv rg-kontrol af dist: intet output, exit 1 (0 fund)
git diff --check: intet output, exit 0

Worker-bundlekontrol med wrangler deploy --dry-run
Total Upload: 32.31 KiB / gzip: 10.09 KiB
--dry-run: exiting now.
[exit 0]
```

Port 4173 bruges i dette miljø af et andet projekt. Første browserforsøg blev derfor stoppet før testene kørte. Testporten kan vælges med `FILMSAMLING_TEST_PORT`; den afsluttende kørsel ovenfor anvendte port 4183. API-mocks tillader præcis testfrontendens origin. Produktions-CORS er fortsat præcis `https://tobibeepdk.github.io`.

Vites advarsel om den separate klassiske `boot.js` er forventet. Filen kopieres fra `public` og viser en brugbar fejlside, hvis appens moduler mangler; den tilhørende test består. Der anvendes JavaScript og ESLint, ingen separat TypeScript-typekontrol.

## Hvad der er verificeret

- EAN/UPC-kontrol, normalisering, lokal barcodeMap og automatisk ukendt stregkode → coverfoto.
- Struktureret **The Wicked**-resultat med høj confidence udfylder filmen; lav confidence giver kandidatvalg og beskæring.
- Et fejlet coverkald kan prøves igen med samme foto og uden manuel titelindtastning. Et forsinket genforsøg kan afbrydes med nyt foto.
- Migration, backup, egne covers, noter, placering, favorit/set og kladder bevares; forsinkede svar overskriver ikke nyere input.
- CORS, sessioner, MIME, requeststørrelse, persistent rate limiting og sikre providerfejl håndhæves.
- Static-only service-worker-cache, offline filmvisning, GitHub Pages-base-path og fejlside ved manglende JavaScript.

Kamera, OpenAI, TMDB og stregkode-API er mocked i de automatiske tests. De 50 browsercases bruger iPhone 13-viewport i WebKit og Chromium. Der er ingen påstand om fysisk iPhone-kameraverifikation eller live AI-præcision.

## Deployment og livegrænser

Pages udgives fra `main` efter GitHub Actions-checks. Worker udgives manuelt med `pnpm worker:deploy`; secrets, Durable Object-binding og migration `v1` bevares. En ny frontend-version aktiveres med appens opdateringsknap og bevarer IndexedDB-data. Se [den danske vejledning](OPSÆTNING-DANSK.md) for login, sikre secrets, fejlkoder og backup.

Workerens secret-navne `OPENAI_API_KEY`, `APP_ACCESS_KEY`, `SESSION_SIGNING_KEY` og `TMDB_READ_TOKEN` blev verificeret med `wrangler secret list`. Værdierne blev ikke læst. Dette bekræfter konfigurationens tilstedeværelse, ikke providerkontoens adgang eller saldo. Brugeren har selv opdateret og aktiveret APP-adgangsnøglen i Cloudflare.

Et separat, offentligt UPCitemDB-trialopslag for `7393834487707` gav HTTP 200, `code: OK` og ét produkt med titlen **National Treasure - Scandinavian Edition.** den 2. oktober. Det er et aktuelt databasefund, ikke testens mockede coverresultat **The Wicked**. Den automatiske test simulerer stadig et manglende fund for at verificere cover-reserven. Ingen OpenAI- eller TMDB-secrets blev brugt til dette offentlige opslag.

En vellykket `/health`-kontrol bekræfter forbindelse og Origin, men ikke en gyldig providerkonto. En live cover-/metadatafejl skal diagnosticeres ud fra den nye, ufølsomme fejlkode. Safari-webstedsdata og sikkerhedsindstillinger skal ikke slettes eller ændres som del af denne rettelse.
