# Implementering og verifikation

## Verificeret DVD-kobling 5706710213130 – 20. oktober 2026

Brugerens konkrete DVD er **Freddy vs. Jason (2003)**, EAN `5706710213130`. Nummeret er gyldigt. Ét anonymt, nøglefrit opslag mod `https://api.upcitemdb.com/prod/trial/lookup?upc=5706710213130` svarede HTTP 200 med `code: "OK"`, `total: 0`, `items: []`. Det afklarer manglende dækning i det offentlige produktopslag; det er ikke bevis for en kamerafejl. Titel/EAN/DVD kommer fra den faktiske bagside, og filmens år 2003 er kontrolleret i [Australian Classifications register](https://www.classification.gov.au/titles/freddy-vs-jason).

`src/barcode-catalog.js` supplerer nu brugerens egen `barcodeMap` med netop denne dokumenterede udgave før providerkontakt. Titlen, originaltitlen, året og DVD-formatet udfyldes uden titelindtastning. Det normale TMDB-opslag henter øvrige metadata med en gyldig session. Uden login kan grundregistreringen gemmes. Egne koblinger har forrang, og øvrige ukendte koder følger det eksisterende søgeflow. Ingen Worker-, kamera-, secret- eller dataskemaændring; ingen AI-kald eller køb. Den foregående autosave-rettelse fra F20 indgår også.

Som reserve til den allerede udgivne app er der forberedt en 529 bytes version 2-importfil med én film og én stregkodekobling. Den er verificeret med appens faktiske `importBackup` mod en isoleret fake-indexeddb: første import tilføjer én film og én kobling; gentagelse tilføjer intet og springer filmen over. Eksisterende film, noter, placering og coverbytes bevares. Filen indeholder ingen session eller secrets. Det er ikke en import på brugerens enhed, og det er ikke et appdeploy.

En ny flow-test fejlede før kataloget; alle 30 flow-tests består bagefter. Fire browsertests fejlede mod det tidligere build med tom titel. De fire målrettede DVD-forløb består efter rettelsen i WebKit/Chromium med og uden login. Første kørsel mod den nye kode havde en forkert testvælger til formatfeltet; titlen/året var korrekte, og kun testvælgeren blev rettet. Ingen produktionsændring for denne testværktøjsfejl.

Slutkørsel med Node 24.19.0 og pnpm 11.19.0 på branch `fix/iphone-barcode-recognition`, baseret på main `13a636efc634b8ddc237ce3c52c60532f74117df`:

```text
pnpm test
Test Files  12 passed (12)
     Tests  242 passed (242)
  Duration  2.13s
[exit 0]

pnpm lint
[exit 0; ingen lintfejl]

pnpm build
✓ 250 modules transformed.
✓ built in 842ms
Service worker 999bf1350df2c94d: 11 lokale filer; ingen API-cache.
[exit 0]

pnpm security
Sikkerhed: 79 filer + 95 git-commits kontrolleret; 0 secret-fund.
Browser-build: ingen servernøgler eller direkte OpenAI-kald.
[exit 0]

FILMSAMLING_TEST_PORT=4215 pnpm test:e2e
Running 70 tests using 1 worker
70 passed (1.2m)
[exit 0]
```

Browserkørslen er 35 cases i WebKit og 35 i Chromium med iPhone-viewport. Nummeret indtastes i scannervinduet; kamera og TMDB er mocked, mens editor, gemning, genindlæsning og `barcodeMap` er reelle. Der er ikke udført fysisk iPhone-scanning eller autentificeret live-TMDB-opslag. Det anonyme UPC-resultat dokumenterer kun produktdatabasens svar. Se F21 for kilder og forebyggelse.

**Release og bevisgrænse:** De ovenstående kontroller dokumenterer den lokale kilde og buildet. Ved klargøringen afviste GitHub-forbindelsen skriveadgang med HTTP 403; senere adgang via repositoryets browserflade skal verificeres særskilt. PR, CI, Pages-version og livekontrol registreres i opgavens leveringsrapport, så de ikke forveksles med de lokale mock-tests. Udgiv den samlede branch gennem PR og checks til main, og kontrollér Pages med **999bf1350df2c94d**. Ingen Worker-deploy er nødvendig. De følgende afsnit bevarer tidligere kontrolpunkter i samme opgave og er ikke det nyeste build.

## Stregkoden bevares efter mislykket opslag – 20. oktober 2026

Kameraet kan læse et gyldigt nummer, selv om produktdatabasen ikke finder filmen eller svarer med en fejl. En konkret frontendfejl betød, at `processBarcode` gemte nummeret i IndexedDB, mens editoren stadig havde den gamle værdi. Titelsøgningens autosave kunne derfor fjerne nummeret og forhindre en lokal kobling efter filmvalg. `src/app.js` synkroniserer nu den validerede kode i kladde og editor **før første asynkrone skrivning**. Dette beskytter også mod noter skrevet, mens den første gemning venter.

Ændrede produktionsfiler: kun `src/app.js`, seks tilføjede linjer. Regressioner ligger i `tests/e2e/free-mode.spec.js`; fejlloggen er opdateret som F20 i Markdown og JSON. Ingen ændring af kamera, Worker, secrets, loginlevetid, API-grænser, IndexedDB-skema eller gamle film. Betalt AI forbliver deaktiveret. En faktisk ukendt udgave kræver fortsat titelsøgning første gang; rettelsen udvider ikke den eksterne database.

Kilde: `fix/iphone-barcode-recognition`, baseret på main `13a636efc634b8ddc237ce3c52c60532f74117df`. Node.js 24.19.0, pnpm 11.19.0. Arbejdskopi under `/private/tmp`; den gamle primære arbejdsmappe er bevaret. Fire nye eller udvidede browsercases fejlede før den første rettelse. Review fandt derefter et skrivevindue, som yderligere to cases reproducerede før den endelige synkrone editoropdatering. Alle seks målrettede cases består bagefter. Samlet slutoutput:

```text
pnpm test
Test Files  12 passed (12)
     Tests  240 passed (240)
  Duration  1.89s
[exit 0]

pnpm lint
$ eslint src shared worker/src scripts tests *.js --no-warn-ignored
[exit 0]

pnpm build
✓ 249 modules transformed.
✓ built in 693ms
Service worker cd249198fd19fead: 11 lokale filer; ingen API-cache.
[exit 0]

pnpm security
Sikkerhed: 78 filer + 94 git-commits kontrolleret; 0 secret-fund.
Browser-build: ingen servernøgler eller direkte OpenAI-kald.
[exit 0]

FILMSAMLING_TEST_PORT=4211 pnpm test:e2e
Running 66 tests using 1 worker
66 passed (1.2m)
[exit 0]

rg --files-with-matches --hidden 'OPENAI_API_KEY|APP_ACCESS_KEY|SESSION_SIGNING_KEY|TMDB_READ_TOKEN|BARCODE_PROVIDER_KEY|sk-(proj-)?[A-Za-z0-9_-]{20,}|api\.openai\.com' dist
[intet output; exit 1; 0 fund]
```

De 66 browsercases består af 33 i WebKit og 33 i Chromium med iPhone-viewport. Kamera og eksterne API'er er mocked, mens editor og IndexedDB er reelle. Annullering, genindlæsning, samtidig noteskrivning, filmvalg, gemt `barcodeMap` og næste scanning uden API-kald er dækket. Testkode `7393834487707` og syntetisk The Wicked-resultat dokumenterer kodeadfærd, ikke den virkelige produkttitel. Ingen fysisk iPhone eller autentificeret liveprovider er verificeret. Der er ingen betalte API-kald.

Første lokale unitkørsel var blokeret af `listen EPERM` i de to workerd-tests; med tilladt lokal testserver bestod de uændret. Dette er et testmiljøproblem, ikke en ny produktionsfejl. En første offlineinstallation manglede pakker; den efterfølgende frozen installation genbrugte de 170 låste pakker.

**Status ved den lokale verifikation:** Denne rettelse var endnu ikke udgivet. GitHub-forbindelsen afviser oprettelse af en branch med HTTP 403 (`Resource not accessible by integration`), og lokal Git har ingen eksisterende login til push. Native browserudgivelse er ikke tilgængelig i dette miljø. Der er derfor hverken oprettet en ny PR, merged eller deployet Pages. Efter skriveadgang: push den forberedte branch, opret PR, vent på checks, merge til main og kontrollér Pages med den endelige versions build-id i det øverste afsnit. Ingen Worker-deploy er nødvendig.

## Standard uden betalt cover-AI – 18. oktober 2026

Den aktuelle ændring erstatter covergenkendelse med **Søg efter film**: titel og valgfrit årstal bruges til TMDB-opslag og kandidatvalg. Ukendt stregkode eller providerfejl åbner søgningen. Kendte koder og lokale stregkodekoblinger udfylder fortsat automatisk. Egne coverfotos komprimeres og gemmes lokalt uden AI-upload. Ved ukendte koder kræves titelindtastning; appen lover ikke gratis billedgenkendelse.

Worker afviser `/identify-cover` med `AI_DISABLED`, medmindre `COVER_AI_ENABLED` er præcis strengen `"true"`. Standardkonfigurationen er `"false"`, også når der allerede findes en OpenAI-secret. Login, stregkode og metadata kræver ikke OpenAI-nøgle eller model. CORS, autentificering, requestgrænser, providertransport, Durable Object-binding og migration `v1` er bevaret. Ingen databaseændring, secretrotation, nye afhængigheder eller API-kreditkøb.

Ændrede filer: `src/app.js`, `src/api.js`, `src/movie-search.js`, `src/workflow.js`, `src/library-ui.js`, `src/editor-ui.js`, `src/settings-ui.js`, `shared/service-errors.js`, `worker/src/index.js`, `worker/src/security.js`, `worker/wrangler.toml`, `worker/.dev.vars.example`, `scripts/setup-worker-secrets.sh`, tre enhedstestfiler, fire E2E-/fixturefiler, `AGENTS.md`, `README.md`, den danske opsætningsvejledning, fejlloggen i Markdown/JSON og denne rapport.

Kontrollerne bruger Node.js **24.19.0**, pnpm **11.19.0** og branch `codex/no-paid-ai`, baseret på main `0f2f55926ca5823c41dec747d6a8b23b83efe668`. En identisk kildekopi med de samme låste pakker under `/private/tmp` undgår det lokale filadgangsproblem beskrevet i F15. Faktisk output:

```text
pnpm test
Test Files  12 passed (12)
     Tests  240 passed (240)
  Duration  5.40s

pnpm lint
$ eslint src shared worker/src scripts tests *.js --no-warn-ignored
[exit 0; ingen lintfejl]

pnpm build
✓ 249 modules transformed.
✓ built in 992ms
Service worker c4b1eb813c6930e4: 11 lokale filer; ingen API-cache.

pnpm security
Sikkerhed: 78 filer + 84 git-commits kontrolleret; 0 secret-fund.
Browser-build: ingen servernøgler eller direkte OpenAI-kald.

FILMSAMLING_TEST_PORT=4197 pnpm test:e2e
Running 62 tests using 1 worker
62 passed (1.2m)

wrangler deploy --dry-run --config worker/wrangler.toml
Total Upload: 33.10 KiB / gzip: 10.32 KiB
env.COVER_AI_ENABLED ("false")
--dry-run: exiting now.
[exit 0]
```

En særskilt rekursiv `rg`-kontrol af `dist` fandt ingen servernøgler eller direkte OpenAI-adresser. En dry-run er ikke et produktionsdeploy. Pages skal udgives fra `main` efter CI, og Worker skal udgives særskilt; de konkrete produktionsversioner kontrolleres derefter og registreres i leveringsrapporten.

Før ændringen fejlede de nye regressioner på manglende titelsøgning, afhængigheden af OpenAI-konfiguration ved login og uønsket providerkontakt fra den deaktiverede AI-route. De består efter ændringen. Mock-tests dækker også noter, placering, eget cover, annullering, forældede svar og lokal genbrug af stregkoder.

Den første E2E-kørsel havde seks WebKit-fejl ved Blob-lagring. En minimal test uden appkode reproducerede fejlen i WebKits ephemeral context; samme Blob-roundtrips bestod med en frisk, vedvarende profil. Testfixturen bruger derfor en ny isoleret WebKit-profil pr. test, mens assertions og produktionslager er uændrede. Se [F16](fejl-og-loesninger.md#f16) for diagnose og bevis. Fysisk iPhone-kamera, Safari privattilstand og liveprovideradgang er ikke verificeret af disse tests. Der er ikke foretaget OpenAI-kald.

Afsnittene nedenfor er historiske kontrolpunkter. De beskriver også det tidligere AI-flow og må ikke forveksles med standardflowet ovenfor.

## TMDB-opslag efter stregkode – 12. oktober 2026

Rensning af kendte produktangivelser bruges nu både ved stregkodeopslag og ved søgning fra gamle kladder. EAN `7393834487707` gav i den offentlige stregkodedatabase titlen `National Treasure - Scandinavian Edition.`. Den rå titel fandt ingen TMDB-film, mens en kontrolleret søgning efter `National Treasure` i den udgivne app hentede titel, originaltitel, år `2004`, handling, genre, instruktør, skuespillere, spilletid og et indlæst onlineomslag. Denne live diagnose skete efter ejerens sikre TMDB-tokenopsætning og før udgivelsen af den nye titelrensning. Et fysisk iPhone-kamera blev ikke brugt til diagnosen.

Ændringen bevarer brugerdata, sessionregler, secrets, providertransport, Durable Object-bindinger og migrationshistorik. Indstillinger viser nu TMDBs officielle, lokalt bundlede logo og attributiontekst. Ingen nye produktionsafhængigheder. Den officielle OpenAI-modelreference bekræfter det eksisterende konfigurerbare `gpt-6.1-sol` med billedinput, Responses API og Structured Outputs: https://developers.openai.com/api/docs/models/gpt-6.1-sol.

Afsluttende lokale kontroller på branch `codex/fix-edition-movie-lookup`, baseret på main `37688e35e7ecd8612b97a40df399b51920f0f8c2`, med Node.js 24 og pnpm 11.19.0:

```text
pnpm test
Test Files  11 passed (11)
     Tests  220 passed (220)
  Duration  2.16s

pnpm lint
$ eslint src shared worker/src scripts tests *.js --no-warn-ignored
[exit 0]

pnpm build
✓ 249 modules transformed.
✓ built in 805ms
Service worker a727676d3202dfbb: 11 lokale filer; ingen API-cache.

pnpm security
Sikkerhed: 73 filer + 69 git-commits kontrolleret; 0 secret-fund.
Browser-build: ingen servernøgler eller direkte OpenAI-kald.

FILMSAMLING_TEST_PORT=4193 pnpm test:e2e
Running 52 tests using 1 worker
52 passed (41.9s)

rg --files-with-matches --hidden \
  'OPENAI_API_KEY|APP_ACCESS_KEY|SESSION_SIGNING_KEY|TMDB_READ_TOKEN|BARCODE_PROVIDER_KEY|sk-(proj-)?[A-Za-z0-9_-]{20,}|api\.openai\.com' dist
[intet output; exit 1; 0 fund]
```

Den nye browserregression scanner en kendt kode uden titelindtastning, henter metadata, bevarer noter og placering, gemmer filmen, genindlæser og genbruger koblingen uden nye API-kald. Tests bruger mocks til provider og kamera i WebKit og Chromium med iPhone-viewport. Den første kørsel havde to fejl i den nye tests forventning: et gemt år er en streng fra formularen, ikke et tal. Kun testforventningen blev rettet; produktionskode og brugerdata blev ikke ændret af dette testproblem. De oprindelige 50 browserchecks bestod i begge kørsler.

Et forsøg på live cover-AI med det offentlige onlineomslag stoppede ved frontendens udløbne session, før providerkald. Det dokumenterer derfor ikke OpenAI-kontoens adgang eller genkendelsespræcision. De automatiske tests dækker fortsat det strukturerede resultat `The Wicked` og lav/høj confidence. Release, CI, Worker-version og efterfølgende live genprøve dokumenteres i leveringsrapporten.

## Scanningsrettelse – 7. oktober 2026

Stregkodeopslaget fejlede før providerkontakt, fordi Workers-runtime afviste `redirect: 'error'` i det fælles API-kald. `worker/src/http.js` bruger nu `redirect: 'manual'` og afviser stadig alle omdirigeringer, så credentials ikke sendes videre. Barcode, TMDB og AI bruger samme helper. Der er ingen ændring i frontendens filmdata, kamera, IndexedDB, secrets, Durable Object-bindinger eller migrationshistorik. Den statiske PWA beholder `/min-filmsamling/` og samme service-worker-version.

Ændrede filer: `worker/src/http.js`, `package.json`, `pnpm-lock.yaml`, `tests/fixtures/upstream-worker.js`, `tests/unit/worker-runtime.test.js`, `AGENTS.md`, `README.md`, `docs/OPSÆTNING-DANSK.md`, `docs/fejl-og-loesninger.md` og denne rapport. Miniflare er nu en eksplicit, pinnet testafhængighed med samme version som Wranglers eksisterende dependency. Der er ingen ny produktionsafhængighed.

Kontrollerne er kørt i `/private/tmp/min-filmsamling-scan-fix` med Node.js 24.19.0 og pnpm 11.19.0, baseret på main `085ed11da52a4996e6a2ac5cca8820426a59d0a9`. De to nye tests blev først kørt røde mod den uændrede adapter: forventet 200, modtaget 502, og ingen outbound-kald. Efter rettelsen består de i workerd med kun providerens svar mocked.

```text
pnpm test
Test Files  11 passed (11)
     Tests  200 passed (200)
  Duration  2.93s

pnpm lint
$ eslint src shared worker/src scripts tests *.js --no-warn-ignored
[exit 0; ingen lintfejl]

pnpm build
✓ 249 modules transformed.
✓ built in 1.03s
Service worker c075f143f0f6e0e4: 10 lokale filer; ingen API-cache.

pnpm security
Sikkerhed: 72 filer + 63 git-commits kontrolleret; 0 secret-fund.
Browser-build: ingen servernøgler eller direkte OpenAI-kald.

FILMSAMLING_TEST_PORT=4183 pnpm test:e2e
Running 50 tests using 1 worker
50 passed (2.7m)
test-results/.last-run.json: status passed, failedTests []

rg --files-with-matches --hidden \
  'OPENAI_API_KEY|APP_ACCESS_KEY|SESSION_SIGNING_KEY|TMDB_READ_TOKEN|BARCODE_PROVIDER_KEY|sk-(proj-)?[A-Za-z0-9_-]{20,}|api\.openai\.com' dist
[intet output; exit 1; 0 fund]

git diff --check
[intet output; exit 0]

wrangler deploy --dry-run --config worker/wrangler.toml
Total Upload: 32.31 KiB / gzip: 10.09 KiB
--dry-run: exiting now.
[exit 0]
```

En midlertidig Cloudflare remote-preview indlæste den rettede `lookupBarcode` og slog `7393834487707` op i UPCitemDBs offentlige trial-database. Faktisk svar: `{ "probe": "manual-v1", "found": true, "title": "National Treasure - Scandinavian Edition." }`. Ingen app-secrets eller produktionsbindinger blev brugt, og previewen gemte ingen brugerfilm. Resultatet **The Wicked** testes separat som et struktureret, mocked AI-svar, når stregkoden ikke findes.

De automatiske browsertests bekræfter kendt og ukendt stregkode, AI-kandidatvalg, cover-genforsøg, noter og kladder med iPhone-viewport i WebKit og Chromium. De dokumenterer ikke fysisk kamerafunktion eller live AI-/TMDB-kontoens adgang. En preview er ikke et produktionsdeploy; Worker udgives særskilt efter kodekontrol. Se [fejl og løsninger](fejl-og-loesninger.md) for årsag, sikkerhed og forebyggelse.

## Tidligere implementering – 2. oktober 2026

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
