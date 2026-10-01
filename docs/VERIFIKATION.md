# Implementering og verifikation – 1. oktober 2026

Løsningen er implementeret på `feat/secure-iphone-pwa` i repositoryet `tobibeepdk/min-filmsamling` og merged til `main` i pull request #1. Den efterfølgende kameratestrettelse ligger på `codex/deterministic-camera-tests`.

## Fund i den tidligere version

Den gamle `index.html` samlede brugerflade, localStorage, metadataopslag, kamera og OCR. TMDB-token blev gemt i browserens indstillinger og kom med i backupen. Scanner og Tesseract blev hentet dynamisk, og OCR kunne ikke sikkert forstå stiliserede filmtitler. Ved opstart afregistrerede appen service workers og slettede caches. Repositoryet havde ingen reproducerbar build- eller testopsætning.

Eksisterende mørkt tema, danske filmfelter og appikoner er genbrugt. Gamle kompilerede bundles og installationsvejledninger erstattes af kildemoduler og den danske opsætningsvejledning. Ingen brugerfilm eller kladder slettes som del af opdateringen.

## Arkitektur og ændrede filer

Frontend bygges med Vite under `/min-filmsamling/`. Scannerbiblioteker bundles lokalt. IndexedDB indeholder `movies`, `drafts`, `barcodeMap`, `settings`, `coverBlobs` og `session`. Kladdesnapshots for nye film og redigeringer bevares særskilt. Annullering stopper igangværende operationer; sene svar anvendes ikke på nyere input.

Cloudflare Worker håndterer login, HMAC-sessioner, covergenkendelse i Responses API, stregkodeudbyder og TMDB. En SQLite-baseret Durable Object håndhæver fælles vedvarende grænser for session, IP og samlet dagsforbrug. Præcis Origin, MIME, requeststørrelse og providerdata valideres. Secrets ligger kun i Worker-konfigurationen. Produktionsmodellen vælges med `OPENAI_MODEL`; den aktuelle officielle modelunderstøttelse og kilder er dokumenteret i [opsætningsvejledningen](OPSÆTNING-DANSK.md).

| Område | Filer |
| --- | --- |
| App og brugerflade | `index.html`, `src/app.js`, `src/ui.js`, `src/library-ui.js`, `src/editor-ui.js`, `src/settings-ui.js`, `src/dialogs.js`, `src/styles.css` |
| Data og backup | `src/db.js`, `src/migration.js`, `src/backup.js` |
| Kamera, identifikation og opslag | `src/camera.js`, `src/barcode.js`, `src/cover-ai.js`, `src/workflow.js`, `src/api.js`, `shared/barcode.js`, `shared/movie.js` |
| PWA | `src/pwa.js`, `public/boot.js`, `public/service-worker.js`, `public/manifest.webmanifest`, tre genbrugte PNG-ikoner i `public/icons/`, `scripts/build-sw.mjs` |
| Worker | `worker/src/index.js`, `http.js`, `security.js`, `limits.js`, `vision.js`, `providers.js`, `worker/wrangler.toml`, `worker/.dev.vars.example` |
| Enhedstests | `tests/unit/barcode.test.js`, `camera.test.js`, `camera-zxing.test.js`, `flow.test.js`, `recognition.test.js`, `storage.test.js`, `api.test.js`, `worker.test.js`, `service-worker.test.js` |
| Browsertests | `tests/e2e/iphone.spec.js`, `tests/e2e/regressions.spec.js`, `playwright.config.js` |
| Build og kontrol | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vite.config.js`, `eslint.config.js`, `.prettierrc.json`, `.gitignore`, `scripts/security-check.mjs` |
| Deployment og dokumentation | `.github/workflows/pages.yml`, `.github/workflows/worker.yml`, `README.md`, `AGENTS.md`, `docs/OPSÆTNING-DANSK.md`, denne rapport |

## Faktiske kontrolresultater

Kørt med Node.js `v24.19.0` og pnpm `11.19.0`. På grund af filer, som iCloud ikke kunne gøre læsbare, blev kontrollerne kørt i en lokal clone i `/private/tmp/min-filmsamling-local`. 71 kilde- og buildfiler er derefter kopieret tilbage til den oprindelige projektmappe og verificeret med SHA-256. Følgende er uddrag af konsoloutput fra den afsluttende kodeverifikation:

```text
pnpm install --frozen-lockfile
Already up to date
Done in 459ms using pnpm v11.19.0

pnpm test
Test Files  9 passed (9)
     Tests  178 passed (178)
  Duration  1.11s

pnpm lint
$ eslint src shared worker/src scripts tests *.js --no-warn-ignored
[exit 0; ingen lintfejl]

pnpm build
vite v7.3.6 building client environment for production...
✓ 246 modules transformed.
✓ built in 967ms
Service worker 442cb6cec1eab610: 10 lokale filer; ingen API-cache.

pnpm security
Sikkerhed: 64 filer + 39 git-commits kontrolleret; 0 secret-fund.
Browser-build: ingen servernøgler eller direkte OpenAI-kald.

pnpm test:e2e
Running 28 tests using 1 worker
28 passed (28.3s)

Rekursiv rg-kontrol af dist: 0 fund (rg exit 1)
```

Sikkerhedsscanningen ovenfor blev kørt før testrettelsens commits og kontrollerer mønstre for credentials, serverkonfiguration i browser-buildet og eksisterende git-historik. Den rekursive `rg`-kontrol søgte efter OpenAI-, app-, signerings-, TMDB- og stregkodenøgler samt direkte OpenAI-endpoint i `dist`. En afsluttende historikscan køres også efter commits.

Den første Pages-kørsel efter merge blev stoppet af en race i WebKit-testens mock: et automatisk kamerafund kunne lukke scanneren, mens testen trykkede på den manuelle reserveknap. Reserveforløbet afviser nu kameraadgang udtrykkeligt. En ny test kontrollerer afvist kameraadgang og videre covergenkendelse i begge browserprojekter. De to berørte tests blev desuden kørt tre gange i begge browsere: `12 passed (27.4s)`. Ingen timeout eller retry er hævet for at skjule fejlen.

Vite viser en forventet advarsel om den separate klassiske `boot.js`. Filen kopieres fra `public` og skal kunne vise en fejlside, selv når appens modul ikke kan indlæses. Testen med blokerede modulfiler består i begge browsere. Projektet bruger JavaScript; ESLint anvendes, og der er ingen separat TypeScript-typekontrol.

Wrangler har også bygget Worker med `--dry-run` (exit 0). Logstien blev placeret i `/private/tmp` i kontrolmiljøet:

```text
WRANGLER_LOG_PATH=/private/tmp/min-filmsamling-worker-final.log WRANGLER_SEND_METRICS=false pnpm exec wrangler deploy --config worker/wrangler.toml --dry-run --outdir /private/tmp/min-filmsamling-worker-final
⛅️ wrangler 4.145.0
Total Upload: 29.38 KiB / gzip: 9.29 KiB
--dry-run: exiting now.
```

Dette er en lokal bundlekontrol, ikke en udgivelse.

## Hvad testene verificerer

- Kontrolcifre og normalisering af EAN-13, EAN-8, UPC-A og tilsvarende nulpræfiksvarianter.
- `7393834487707` uden databasefund åbner coverkameraet og ender med **The Wicked**, metadata og gemning uden titelindtastning. Gentagen scanning anvender lokal `barcodeMap` uden providerkald.
- Høj confidence vælger automatisk; lav confidence giver store kandidatknapper, beskæring og nyt foto. Ugyldige AI-/providerdata afvises.
- Migrering bevarer alle tidligere filmfelter, egne coverbytes, kladde, noter, placering, set/favorit og ikkehemmelige indstillinger. Fejl og konflikter giver rollback; gamle film og kladder bevares.
- Backup allowlister filmfelter og egne covers; tokens, sessioner og settings udelades. Import validerer hele filen før atomisk merge og bevarer eksisterende film-ID'er og nyere noter.
- Metadata og forsinkede svar overskriver ikke brugerens noter, placering eller eget cover. Navigation og annullering bevarer kladder, også mens lagring eller analyse er i gang.
- Forkert Origin, ugyldig/udløbet session, for store billeder, ugyldig JSON/MIME og provider-rate limits håndteres sikkert. Durable Object-grænser overlever en genstart og er atomiske på tværs af sessioner/IP'er; oprydning følger Cloudflares 128-nøglers deletegrænse.
- Service worker genbruger statiske filer offline, også med `Vary: Origin`, og cacher aldrig API-kald, adgangsheaders eller query-parametre.

Browsertestene kører med iPhone 13-viewport i WebKit og Chromium. Kamera og eksterne API'er er mocked. API-mocktests blokerer service workers, fordi Playwright ellers kan omgå routemocks; særskilte offlinetests anvender den rigtige service worker. Chromium bruger browserens offlinetilstand. WebKits runner afbrød navigation før service-worker-svar i den tilstand, så testen slukker en isoleret HTTP-testserver: ukachede forespørgsler fejler, en ny JavaScript-kontekst indlæses fra cache, og film/noter læses fra den rigtige IndexedDB. Testen accepterer ikke den gamle sides DOM som et vellykket reload.

## Deployment og egne secrets

1. Følg [OPSÆTNING-DANSK.md](OPSÆTNING-DANSK.md): opret Cloudflare/OpenAI, og indtast `OPENAI_API_KEY`, `APP_ACCESS_KEY` og `SESSION_SIGNING_KEY` i Wranglers interaktive secret-prompts.
2. Tilføj valgfrit `TMDB_READ_TOKEN` for de fulde filmoplysninger og eventuelt `BARCODE_PROVIDER_KEY`. Standard-stregkodeadapteren kan bruge UPCitemDB trial uden nøgle.
3. Deploy Worker manuelt med `pnpm worker:deploy`; bevar Durable Object-binding og migration `v1`. Produktionsorigin er præcis `https://tobibeepdk.github.io`.
4. Vælg GitHub Actions som Pages-source. Efter merge til `main` bygger og verificerer workflowen og udgiver `dist`.
5. Indtast Worker-adressen i appen, test forbindelsen, log ind, og installér i Safari via **Føj til hjemmeskærm**.

Ingen produktionssecrets er indtastet, ingen liveprovider er kaldt, og Worker er ikke udgivet. Fysisk iPhone-kamera, AI-præcision og brugerens model-/provideradgang kræver en efterfølgende liveprøve. Samlingen synkroniseres ikke mellem enheder. Data fra en anden origin, eksempelvis Netlify, flyttes med backup. Onlineomslag kræver netværk; egne gemte fotos kan vises offline.
