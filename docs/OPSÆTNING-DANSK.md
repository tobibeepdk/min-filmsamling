# Opsætning af Min filmsamling

Appen består af en statisk frontend på GitHub Pages og en Cloudflare Worker til login, stregkodeopslag og TMDB-metadata. Standardflowet bruger ingen betalt cover-AI. Filmene og egne coverfotos ligger lokalt på din enhed; de bliver ikke uploadet som en fælles samling eller til covergenkendelse.

Frontendens adresse er **https://tobibeepdk.github.io/min-filmsamling/** efter Pages-deploy. Ved en ny installation oprettes først Worker og secrets, og derefter gemmes Workerens HTTPS-adresse i appens indstillinger.

Den hidtidige Worker-adresse til appens indstillinger er `https://min-filmsamling-api.min-filmsamling.workers.dev`. På en eksisterende installation genbruges login-secrets og et eventuelt TMDB-token; de skal ikke oprettes eller roteres igen. Login kræver kun de to secrets i trin 3 samt limiter-bindingen. En vellykket forbindelsestest alene bekræfter ikke, at login eller metadataopslag virker.

Ved opdatering skal den nye Worker med `COVER_AI_ENABLED = "false"` udgives manuelt, før også ældre appversioners AI-kald er spærret på serveren. En frontendopdatering alene ændrer ikke den allerede udgivne Worker. Denne vejledning er ikke et bevis for, at opdateringen er deployet. Eksisterende Cloudflare- eller providerplaner kan fortsat have deres egne udgifter og kvoter; der loves ikke gratis hosting eller ubegrænsede opslag.

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
COVER_AI_ENABLED = "false"
DAILY_LIMIT = "100"
BARCODE_PROVIDER = "upcitemdb"
```

`ALLOWED_ORIGIN` er frontendens **origin**: protokol og værtsnavn, uden `/min-filmsamling/` og uden afsluttende skråstreg. Appens fulde URL indeholder stien; CORS-indstillingen gør det ikke. Worker afviser andre origins.

Bevar `COVER_AI_ENABLED = "false"`. Worker svarer `AI_DISABLED` på `/identify-cover` før et providerkald, også hvis en gammel app stadig forsøger at sende et cover. Kun den præcise streng `"true"` aktiverer den tidligere adapter; en manglende indstilling eller andre værdier aktiverer den ikke. En eksisterende `OPENAI_MODEL`-indstilling eller OpenAI-secret er ubrugt, så længe funktionen er deaktiveret.

Opret Worker og dens Durable Object-binding med den første deploy:

```bash
pnpm worker:deploy
```

Wrangler viser Workerens HTTPS-adresse. Gem adressen til senere. API-funktionerne kræver de obligatoriske login-secrets fra næste trin.

## 3. Tilføj secrets sikkert

På en ny Worker bruges to forskellige tilfældige værdier fra din adgangskodeadministrator:

```bash
pnpm exec wrangler secret put APP_ACCESS_KEY --config worker/wrangler.toml
pnpm exec wrangler secret put SESSION_SIGNING_KEY --config worker/wrangler.toml
```

Som genvej kan du køre de to interaktive login-secret-prompts samlet fra en terminal:

```bash
pnpm worker:setup
```

Genvejen bruger Wranglers skjulte prompts og tilbyder også det valgfrie TMDB-token. Den beder som standard ikke om en OpenAI-nøgle. Secretværdier skal kun indtastes i prompts; genvejen modtager dem ikke som argumenter eller fra filer. På en eksisterende installation med fungerende login behøver du ikke køre genvejen igen.

Brug mindst 32 tegn til `SESSION_SIGNING_KEY`; brug også en lang tilfældig `APP_ACCESS_KEY`. `APP_ACCESS_KEY` er den adgangsnøgle, du senere bruger til login i appen. `SESSION_SIGNING_KEY` bruges kun på serveren til at signere sessioner.

Hvis du ændrer adgangsnøglen i Cloudflare-dashboardet, betyder **Value encrypted**, at den gamle værdi er skjult. Indtast selv en ny værdi for `APP_ACCESS_KEY`. Efter **Save version** skal den nye version være aktiveret under **Deployments → Promote version**, før adgangskoden virker i appen. Log ind igen i appens indstillinger. Et login på iPhonen gælder kun i den browser; en anden enhed skal logge ind særskilt.

Secrets skal blive i Cloudflares secret-lager. Indsæt dem aldrig i `wrangler.toml`, frontendkode, et `VITE_`-felt, en backup, et issue eller en commit. Kommandolinjen ovenfor indeholder kun secretens navn, så værdien ikke bliver et shell-argument.

Login og den almindelige app kræver hverken `OPENAI_API_KEY` eller `OPENAI_MODEL`. Gamle OpenAI-secrets kan blive liggende ubrugt; du skal ikke købe kredit, oprette en ny nøgle eller rotere en eksisterende for at bruge standardflowet.

### Valgfrit: TMDB

Et TMDB API Read Access Token giver opslag af handling, skuespillere, instruktør, spilletid og onlinecovers. Opret tokenet på din TMDB-konto og gem det som:

```bash
pnpm exec wrangler secret put TMDB_READ_TOKEN --config worker/wrangler.toml
```

Uden dette token kan du stadig registrere film manuelt og gemme dine egne coverfotos. Appen viser, at TMDB-opslag mangler opsætning. Har du allerede et fungerende TMDB-token, genbruges det.

Appens **Indstillinger → Om appen** krediterer TMDB med et godkendt logo, et link til TMDB og den krævede tekst: “This product uses the TMDB API but is not endorsed or certified by TMDB.” Se TMDBs [attributionkrav](https://developer.themoviedb.org/docs/faq) og [godkendte logoer](https://www.themoviedb.org/about/logos-attribution). Det lokale `public/tmdb-logo.svg` er den uændrede **Alt short (blue)**-variant fra TMDBs officielle logoside. Logoet bruger appens `/min-filmsamling/`-basesti og medtages i det almindelige build og den statiske offlinecache.

### Valgfrit: stregkodeudbyder

Standardværdien `BARCODE_PROVIDER = "upcitemdb"` bruger UPCitemDBs trial-endpoint uden en udbydernøgle. En betalt UPCitemDB-nøgle aktiverer den tilsvarende `v1`-adgang:

```bash
pnpm exec wrangler secret put BARCODE_PROVIDER_KEY --config worker/wrangler.toml
```

Udbyderens egne kvoter og datadækning gælder stadig. En ukendt kode eller providerfejl åbner **Søg efter film**, hvor du indtaster titlen og eventuelt årstal. Et coverfoto kan gemmes som dit eget lokale cover, men giver ikke automatisk en filmtitel.

Der findes også en JSON-adapter. Sæt `BARCODE_PROVIDER = "json"` og `BARCODE_PROVIDER_URL` til din egen HTTPS-lookup-adresse i `[vars]`. Worker tilføjer queryparameteren `barcode`; en eventuel `BARCODE_PROVIDER_KEY` sendes som Bearer-header. Svaret skal have `found`, `title`, `description`, `format` og `images`, som angivet i `worker/src/providers.js`.

Genudrul efter ændringer i konfigurationen:

```bash
pnpm worker:deploy
```

## 4. Forbrugsgrænser

`DAILY_LIMIT` er Workerens globale dagsgrænse for autentificerede API-kald til stregkode- og filmopslag. Hvis den tidligere cover-AI-adapter senere aktiveres udtrykkeligt, er den også omfattet. Den aktuelle værdi er 100. Grænsen nulstilles ved nyt UTC-døgn og gælder på tværs af enheder og Worker-instanser via `RATE_LIMITER`, en Durable Object med vedvarende lagring. Et kald tælles før udbyderopslaget, så et mislykket eksternt opslag kan også bruge et kald.

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

Ved en overskredet grænse svarer Worker med HTTP 429 og en ventetid. Grænserne tæller kald; de er ikke et beløb i kroner. Bevar en dagsgrænse, der passer til de anvendte tjenesters kvoter. Deaktiveret cover-AI giver `AI_DISABLED` og kontakter ikke OpenAI.

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

Hvis et andet projekt bruger port 4173, kør `FILMSAMLING_TEST_PORT=4183 pnpm test:e2e`. Preview-serveren bruger den valgte port og stopper ved en portkonflikt.

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
2. Appens indstillinger har standardadressen `https://min-filmsamling-api.min-filmsamling.workers.dev` forudfyldt på nye installationer, eller hvis ingen Worker-adresse er gemt. En eksisterende tilpasset adresse bevares. Hvis du bruger din egen Worker, kan du ændre adressen. Tryk **Test forbindelse** for at kontrollere forbindelsen.
3. Log på med `APP_ACCESS_KEY`. Appen gemmer kun den kortlivede session og dens udløbstid; selve adgangsnøglen gemmes ikke.
4. Vælg **Del → Føj til hjemmeskærm → Tilføj**.
5. Tryk **Scan stregkode**, og giv kameratilladelse. En kendt kode kan finde filmdata automatisk. En kode, der allerede er knyttet til en film på enheden, bruger den lokale kobling.
6. Ved ukendt kode eller providerfejl åbnes **Søg efter film**. Skriv **Filmtitel** og eventuelt **År**, tryk **Søg**, og vælg blandt TMDB-kandidaterne. Du kan også åbne søgningen fra forsiden eller filmredigeringen. Ukendte koder kræver titelindtastning i dette flow.
7. Brug **Tag eget coverfoto** i filmredigeringen, hvis du vil gemme dit eget billede. Appen roterer efter EXIF, fjerner metadata og komprimerer fotoet til lokalt lager; billedet sendes ikke til AI. Egne coverfotos bevares, når metadata tilføjes.
8. Hvis live-scanneren ikke virker på din telefon, vælg et stregkodefoto eller indtast koden. Kontrollér filmkandidaterne, før du gemmer. Når filmen gemmes med en gyldig kode, kan næste scanning bruge den lokale kobling.

EAN `7393834487707` er tidligere livefundet som **National Treasure (2004)**. Udbyderens dækning kan ændres, så brug et mocked missing-result til at teste den ukendte kode og titelsøgningen; dette nummer beviser ikke længere det ukendte flow.

Samlingen, filmredigering og egne coverfotos kan bruges offline efter første indlæsning. TMDB- og eksterne stregkodeopslag kræver netforbindelse og en gyldig session. Du kan altid skrive filmoplysninger manuelt.

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

Tests bruger mocks til TMDB, stregkodeudbyder og kamera. Worker-tests bruger også mocks til at kontrollere, at deaktiveret cover-AI ikke kontakter OpenAI. De kræver ingen rigtige API-nøgler. Fysisk iPhone-kamera og liveudbyderadgang kræver særskilt kontrol efter deployment. Der skal ikke foretages betalte AI-forsøg for at verificere standardflowet.

| Symptom | Kontrollér |
| --- | --- |
| Login eller lookup afvises af CORS | `ALLOWED_ORIGIN` skal være præcis `https://tobibeepdk.github.io`, uden sti eller skråstreg. |
| Login udløber | Log på igen; standardlevetiden er 15 minutter. |
| HTTP 503 / opsætning mangler | Login kræver `APP_ACCESS_KEY`, `SESSION_SIGNING_KEY` og limiter-bindingen. TMDB-token er særskilt og valgfrit; OpenAI-model og -nøgle kræves ikke. |
| HTTP 429 | Vent den angivne tid; kontrollér egne grænser og udbyderens kvote. |
| Stregkoden har intet resultat | Indtast titel og eventuelt årstal i **Søg efter film**; alle filmudgaver findes ikke hos udbyderen. |
| Kamera starter ikke | HTTPS, Safari-kameratilladelse og foto-/indtastningsreserven. |
| En gammel app viser `AI_DISABLED` | Workerens AI-spærring virker. Brug appens opdateringsknap og derefter **Søg efter film**; køb ikke kredit eller rotér nøgler. |
| Gammel samling er ikke synlig | Samme origin og browserprofil, eller eksportér fra den gamle adresse og importér backupen. |

Del fejlstatus og tidspunkt ved fejlfinding. Del ikke adgangsnøgler, session-token, foto-request bodies eller rå udbydersvar.

Hvis alle provideropslag straks giver `PROVIDER_FAILURE`, mens **Test forbindelse** er grøn, skal Workerens kodeversion kontrolleres. Rettelsen fra 7. oktober bruger `redirect: 'manual'` og afviser omdirigeringer sikkert. Den tidligere `redirect: 'error'` blev afvist af den anvendte Workers-runtime, før databasen blev kontaktet. Deploy den rettede Worker med `pnpm worker:deploy`; et nyt app-login eller en frontendopdatering alene ændrer ikke serverkoden. Se [fejl og løsninger](fejl-og-loesninger.md). Safari-data og Nedlukningstilstand skal bevares.

Worker sender kun faste, ufølsomme fejlkoder. Appen angiver, om fejlen kom fra stregkodeopslag eller filmopslag. En metadatafejl bevarer den fundne titel, som stadig kan gemmes. Egne coverfotos ligger i det lokale `coverBlobs`-lager og følger med en filmbackup.

| Fejlkode | Næste trin |
| --- | --- |
| `AI_DISABLED` | Den tidligere cover-AI-adapter er slået fra. Opdatér en gammel frontend, og brug titelsøgning. |
| `PROVIDER_AUTH` | Kontrollér den pågældende tjenestes adgang i Worker. Et nyt app-login ændrer ikke TMDB-adgangen. |
| `PROVIDER_ACCESS` | Kontrollér den pågældende providerkontos rettigheder. |
| `PROVIDER_QUOTA` | Den pågældende providers kvote er afvist. Gentagne forsøg løser ikke kvoten; brug manuel registrering, og køb ikke API-kredit som automatisk fejlfinding. |
| `PROVIDER_RATE_LIMIT` | Vent den angivne tid, før du prøver igen. |
| `PROVIDER_TIMEOUT` / `PROVIDER_FAILURE` | Tjenesten svarede ikke i tide eller kunne ikke gennemføre kaldet. Indtast titlen eller registrér filmen manuelt. |
| `PROVIDER_REQUEST` / `PROVIDER_RESPONSE` | Kontrollér provideropsætningen. Del kun fejlkode, handling og tidspunkt til fejlfinding. |

## 9. Avanceret og valgfrit: tidligere cover-AI

Dette afsnit beskriver kun den bevarede serveradapter. Den er ikke del af standardflowet eller frontendens filmoprettelse. Den skal forblive deaktiveret under brugerens ønske om ingen flere udgifter. Tidligere liveforsøg gav HTTP 429 uden et genkendelsesresultat; den præcise projektgrænse er ikke bekræftet. Se [F11](fejl-og-loesninger.md#f11) og [F19](fejl-og-loesninger.md#f19) i fejlloggen.

En fremtidig genaktivering kræver et nyt udtrykkeligt ønske, en valgt model med verificeret billed- og schema-understøttelse, passende provideradgang og bevidst accept af eventuelt betalt API-forbrug. Ingen modeladgang eller genkendelsespræcision er lovet her. Bevar `COVER_AI_ENABLED = "false"`, indtil en sådan ændring er ønsket og testet.

Hvis opsætning af den tidligere adapter senere ønskes, findes den udtrykkelige genvej:

```bash
pnpm worker:setup --with-cover-ai
```

Flaget tilføjer en interaktiv `OPENAI_API_KEY`-prompt. Det ændrer ikke `COVER_AI_ENABLED`, aktiverer ikke funktionen og køber ikke API-kredit. Secretværdien skal kun indtastes i Wranglers skjulte prompt. En eksisterende OpenAI-secret behøver ikke roteres eller fjernes for standardflowet. Den bevarede adapter anvender `OPENAI_MODEL`; en ændring af denne indstilling kræver ny kontrol i providerens officielle dokumentation.

Kun den præcise streng `COVER_AI_ENABLED = "true"` kan aktivere `/identify-cover` efter en manuel Worker-deploy. En gammel frontend får fortsat `AI_DISABLED`, når flaget er `"false"`, uanset om der allerede findes OpenAI-secrets. Frontendopdatering, nyt app-login og ændring af TMDB-token aktiverer ikke cover-AI.
