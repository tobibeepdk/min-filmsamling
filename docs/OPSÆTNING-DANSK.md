# Opsætning af Min filmsamling

Appen består af en statisk frontend på GitHub Pages og en Cloudflare Worker til login, covergenkendelse og metadataopslag. Filmene ligger lokalt på din enhed; de bliver ikke uploadet som en fælles samling.

Frontendens adresse er **https://tobibeepdk.github.io/min-filmsamling/** efter Pages-deploy. Du skal først oprette Worker og secrets og derefter gemme Workerens HTTPS-adresse i appens indstillinger.

Worker er udgivet for dette repository. Dens adresse til appens indstillinger er `https://min-filmsamling-api.min-filmsamling.workers.dev`. Login og AI kræver stadig de tre obligatoriske secrets i trin 3; en vellykket forbindelsestest alene bekræfter ikke, at secrets er konfigureret.

## 1. Installér udviklingsværktøjerne

Brug Node.js 24 og pnpm 11.19.0. Hvis pnpm mangler, kan det installeres med:

```bash
npm install --global pnpm@11.19.0
```

Kør fra repositoryets rod:

```bash
pnpm install --frozen-lockfile
```

Repositoryets `pnpm-workspace.yaml` tillader installationsscripts for `esbuild` og `workerd`. Bevar disse tilladelser, så Vite og Wrangler kan starte.

## 2. Opret Cloudflare Worker

Log på Cloudflare gennem Wrangler:

```bash
pnpm exec wrangler login
```

Wrangler gemmer Cloudflare-login i brugerens CLI-profil uden for repositoryet. Kopiér aldrig profilen eller dens credentials ind i projektet.

Kontrollér `[vars]` i `worker/wrangler.toml`:

```toml
ALLOWED_ORIGIN = "https://tobibeepdk.github.io"
OPENAI_MODEL = "gpt-6.1-sol"
DAILY_LIMIT = "100"
BARCODE_PROVIDER = "upcitemdb"
```

`ALLOWED_ORIGIN` er frontendens **origin**: protokol og værtsnavn, uden `/min-filmsamling/` og uden afsluttende skråstreg. Appens fulde URL indeholder stien; CORS-indstillingen gør det ikke. Worker afviser andre origins.

Opret Worker og dens Durable Object-binding med den første deploy:

```bash
pnpm worker:deploy
```

Wrangler viser Workerens HTTPS-adresse. Gem adressen til senere. API-funktionerne kræver de obligatoriske secrets fra næste trin.

## 3. Tilføj secrets sikkert

Opret en OpenAI API-nøgle i dit eget projekt via [OpenAI API keys](https://platform.openai.com/api-keys). Projektet skal have adgang til den valgte model og API-forbrug. Gem nøglen med Wranglers prompt:

```bash
pnpm exec wrangler secret put OPENAI_API_KEY --config worker/wrangler.toml
```

Indsæt værdien i den interaktive secret-prompt. Brug samme fremgangsmåde til to forskellige tilfældige værdier fra din adgangskodeadministrator:

```bash
pnpm exec wrangler secret put APP_ACCESS_KEY --config worker/wrangler.toml
pnpm exec wrangler secret put SESSION_SIGNING_KEY --config worker/wrangler.toml
```

Brug mindst 32 tegn til `SESSION_SIGNING_KEY`; brug også en lang tilfældig `APP_ACCESS_KEY`. `APP_ACCESS_KEY` er den adgangsnøgle, du senere bruger til login i appen. `SESSION_SIGNING_KEY` bruges kun på serveren til at signere sessioner.

Secrets skal blive i Cloudflares secret-lager. Indsæt dem aldrig i `wrangler.toml`, frontendkode, et `VITE_`-felt, en backup, et issue eller en commit. Kommandolinjen ovenfor indeholder kun secretens navn, så værdien ikke bliver et shell-argument.

Worker bruger `gpt-6.1-sol` gennem Responses API med billedinput og et strict JSON-schema. Den officielle [modelbeskrivelse](https://developers.openai.com/api/docs/models/gpt-6.1-sol) angiver billedinput og Structured Outputs. Se også OpenAIs vejledninger om [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) og [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Modelunderstøttelsen er kontrolleret 1. oktober 2026; din konto skal selv have modeladgang.

### Valgfrit: TMDB

Et TMDB API Read Access Token giver opslag af handling, skuespillere, instruktør, spilletid og onlinecovers. Opret tokenet på din TMDB-konto og gem det som:

```bash
pnpm exec wrangler secret put TMDB_READ_TOKEN --config worker/wrangler.toml
```

Uden dette token kan du stadig registrere film manuelt og bruge covergenkendelse, når OpenAI og login er konfigureret. Appen viser, at TMDB-opslag mangler opsætning.

### Valgfrit: stregkodeudbyder

Standardværdien `BARCODE_PROVIDER = "upcitemdb"` bruger UPCitemDBs trial-endpoint uden en udbydernøgle. En betalt UPCitemDB-nøgle aktiverer den tilsvarende `v1`-adgang:

```bash
pnpm exec wrangler secret put BARCODE_PROVIDER_KEY --config worker/wrangler.toml
```

Udbyderens egne kvoter og datadækning gælder stadig. En ukendt kode kan indtastes manuelt eller suppleres med et coverfoto.

Der findes også en JSON-adapter. Sæt `BARCODE_PROVIDER = "json"` og `BARCODE_PROVIDER_URL` til din egen HTTPS-lookup-adresse i `[vars]`. Worker tilføjer queryparameteren `barcode`; en eventuel `BARCODE_PROVIDER_KEY` sendes som Bearer-header. Svaret skal have `found`, `title`, `description`, `format` og `images`, som angivet i `worker/src/providers.js`.

Genudrul efter ændringer i konfigurationen:

```bash
pnpm worker:deploy
```

## 4. Forbrugsgrænser

`DAILY_LIMIT` er Workerens globale dagsgrænse for autentificerede API-kald: covergenkendelse, stregkodeopslag og filmopslag. Den aktuelle værdi er 100. Grænsen nulstilles ved nyt UTC-døgn og gælder på tværs af enheder og Worker-instanser via `RATE_LIMITER`, en Durable Object med vedvarende lagring. Et kald tælles før udbyderopslaget, så et mislykket eksternt opslag kan også bruge et kald.

De øvrige aktuelle værdier i `worker/wrangler.toml` er:

| Indstilling | Værdi | Formål |
| --- | ---: | --- |
| `SESSION_TTL_SECONDS` | 900 | Sessionens levetid i sekunder |
| `RATE_LIMIT_PER_MINUTE` | 10 | API-kald pr. session pr. minut |
| `IP_RATE_LIMIT_PER_MINUTE` | 30 | API-kald pr. IP pr. minut |
| `SESSION_DAILY_LIMIT` | 100 | API-kald pr. session pr. UTC-døgn |
| `IP_DAILY_LIMIT` | 200 | API-kald pr. IP pr. UTC-døgn |
| `LOGIN_RATE_LIMIT_PER_MINUTE` | 5 | Loginforsøg pr. IP pr. minut |
| `LOGIN_DAILY_LIMIT` | 50 | Loginforsøg pr. IP pr. UTC-døgn |

Ved en overskredet grænse svarer Worker med HTTP 429 og en ventetid. Grænserne tæller kald; de er ikke et beløb i kroner. Vælg en dagsgrænse, der passer til dit API-budget, og brug også OpenAI-projektets forbrugskontroller.

Bevar Durable Object-bindingen og dens migrationshistorik ved opdateringer. Den gemmer forbrugstællere, ikke din filmsamling.

## 5. Udgiv frontend på GitHub Pages

I repositoryets **Settings → Pages** vælges **GitHub Actions** som source. Workflowen `.github/workflows/pages.yml` kører ved pull requests og ved push til `main`:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
pnpm security
pnpm exec playwright install --with-deps chromium webkit
pnpm test:e2e
```

Sikkerhedsscanningen kontrollerer kildekode, `dist` og git-historik med redigeret fejloutput. Workflowen uploader og deployer kun `dist` på `main`, efter at kontrollerne er bestået. Pull requests udgiver ikke en produktionsversion. Frontendens base-path er `/min-filmsamling/`.

Der skal ingen OpenAI-, TMDB- eller appadgangsnøgler ind i Pages-workflowen.

### Manuel Worker-workflow

`.github/workflows/worker.yml` kan startes i **Actions → Deploy Worker → Run workflow** fra `main`. Den udgiver ikke automatisk ved en pull request.

Tilføj disse GitHub Actions-secrets i repositoryets indstillinger:

- `CLOUDFLARE_API_TOKEN`: en Cloudflare API-token med rettigheder til at udgive Workers på den valgte konto.
- `CLOUDFLARE_ACCOUNT_ID`: ID for den samme Cloudflare-konto.

Workflowen verificerer koden og kører `pnpm worker:deploy`. Runtime-secrets fra trin 3 sættes i Cloudflare med Wrangler; de skal ikke kopieres til denne workflow. Secrets skrives ikke ud i workflowens kommandoer.

## 6. Brug appen på iPhone

1. Åbn **https://tobibeepdk.github.io/min-filmsamling/** i Safari.
2. Indtast Workerens HTTPS-adresse i appens indstillinger, og tryk **Test forbindelse**. Appen skal vise, at forbindelsen er OK.
3. Log på med `APP_ACCESS_KEY`. Appen gemmer kun den kortlivede session og dens udløbstid; selve adgangsnøglen gemmes ikke.
4. Vælg **Del → Føj til hjemmeskærm → Tilføj**.
5. Tryk **Scan stregkode**, og giv kameratilladelse. En ukendt kode åbner automatisk coverkameraet; fotografér hele forsiden. Appen identificerer titlen og søger filmdata. Ved tvivl vælger du en af de store kandidatknapper. Du behøver ikke indtaste titlen.
6. Hvis live-scanneren ikke virker på din telefon, vælg et foto eller indtast koden. Kontrollér AI-forslag og filmkandidater, før du gemmer.

Test flowet med `7393834487707`: når udbyderen ikke har et resultat, skal coverkameraet åbne direkte. Et AI-resultat med **The Wicked**, år **2013** og confidence **0,94** vælges automatisk, hvis ingen anden kandidat er tæt på. Gem filmen, og scan koden igen for at bruge den lokale kobling uden udbyderkald. Dette er et testscenarie; udbyderens aktuelle dækning kan ændres.

Samlingen og filmredigering kan bruges offline efter første indlæsning. AI-, TMDB- og eksterne stregkodeopslag kræver netforbindelse og en gyldig session. Egne coverfotos bevares, når metadata tilføjes.

En ny appversion tilbydes gennem appens opdateringsknap. Opdateringen ændrer appens cache og bevarer IndexedDB-data. Service worker cacher appens statiske filer; API-svar bliver ikke lagt i offlinecachen.

## 7. Backup og flytning af ældre data

Eksportér jævnligt en backup under appens indstillinger. Backupformat version 2 indeholder film, de tilknyttede coverbilleder og den lokale stregkodemapping. Det indeholder ikke indstillinger, sessioner, adgangsnøgler eller kladder. En backup indeholder dine egne filmnoter og fotos, så gem filen et passende sted.

Import validerer hele filen før én samlet databasetransaktion. Eksisterende film med samme ID bevares, så nyere noter, placering og favoritvalg ikke overskrives af en ældre backup. Nye covers med et allerede anvendt cover-ID får et nyt ID. Import sletter ingen eksisterende film.

Ved opgradering på samme origin læser appen de gamle nøgler `filmsamling_v4`, `filmsamling_draft_v4` og `filmsamling_settings_v4`. Den migrerer film, kladde og covers til IndexedDB og verificerer de gemte data. Den gamle filmsamling og kladde bevares. Først efter verificering fjernes gamle tokens og andre settings-secrets; tilladte ikkehemmelige præferencer bevares. Beskadigede gamle data markeres ikke som færdigmigreret.

Browserdata er adskilt efter origin og browserprofil. GitHub Pages kan derfor ikke hente localStorage fra en tidligere Netlify-adresse. Åbn den gamle app på dens oprindelige adresse, eksportér dens backup, og importér filen i den nye app. Importeren genkender også den gamle version 4-backup med `films`; gamle backup-indstillinger og tokens importeres ikke.

Slet ikke Safari-webstedsdata, før du har en brugbar backup. Samlingen synkroniseres ikke automatisk mellem forskellige enheder.

## 8. Lokal kontrol og fejlfinding

Kør kodekontrollerne lokalt med kommandoerne i trin 5. På en Mac kan browserinstallationen normalt køres uden `--with-deps`:

```bash
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Tests bruger mocks til OpenAI, TMDB, stregkodeudbyder og kamera. De kræver ingen rigtige API-nøgler. Reelt kamera på en fysisk iPhone, AI-præcision og liveudbyderadgang skal afprøves efter din deployment.

| Symptom | Kontrollér |
| --- | --- |
| Login eller lookup afvises af CORS | `ALLOWED_ORIGIN` skal være præcis `https://tobibeepdk.github.io`, uden sti eller skråstreg. |
| Login udløber | Log på igen; standardlevetiden er 15 minutter. |
| HTTP 503 / opsætning mangler | Workerens nødvendige secrets og modelkonfiguration. TMDB-token er særskilt og valgfrit. |
| HTTP 429 | Vent den angivne tid; kontrollér egne grænser og udbyderens kvote. |
| Stregkoden har intet resultat | Prøv coverfoto eller manuel titel; alle filmudgaver findes ikke hos udbyderen. |
| Kamera starter ikke | HTTPS, Safari-kameratilladelse og foto-/indtastningsreserven. |
| Gammel samling er ikke synlig | Samme origin og browserprofil, eller eksportér fra den gamle adresse og importér backupen. |

Del fejlstatus og tidspunkt ved fejlfinding. Del ikke adgangsnøgler, session-token, foto-request bodies eller rå udbydersvar.
