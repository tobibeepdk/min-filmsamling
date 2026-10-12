# Fejl, udfordringer og afprøvede løsninger

Denne genbrugelige oversigt samler erfaringerne frem til 12. oktober 2026. Slå symptomet op før nye forsøg; versioner, kontogrænser og runtimes skal revalideres, når miljøet ændrer sig. Den tilhørende [JSON-fil](fejl-og-loesninger.json) har samme poster til maskinopslag.

Løsninger markeret **mocktestet** er implementeret og testet med mocks; de beviser ikke fysisk iPhone-kamera eller live AI-præcision. **Uafklaret** angiver manglende årsagsbevis. Brugerens ønske om ingen flere udgifter gælder fortsat: køb ikke API-kredit eller foretag yderligere betalte OpenAI-forsøg som automatisk fejlsøgning.

| ID | Fejl eller udfordring | Status |
| --- | --- | --- |
| [F01](#f01) | Appen starter ikke: indexedDB mangler | Årsag uafklaret |
| [F02](#f02) | OCR læser stiliseret covertekst forkert | Implementeret og mocktestet |
| [F03](#f03) | Ukendt stregkode giver ingen filmtitel | Implementeret og mocktestet |
| [F04](#f04) | Providerkald fejler straks, men health er grøn | Løst og liveverificeret |
| [F05](#f05) | Barcode-titel findes, men TMDB finder ingen metadata | Løst og liveverificeret |
| [F06](#f06) | Sort kamerafelt eller mistet cover efter fejl | Implementeret og mocktestet |
| [F07](#f07) | Forsinkede svar overskriver nyere kladde eller noter | Implementeret og mocktestet |
| [F08](#f08) | Login virker på iPhone, men ikke i testfanen | Løst og liveverificeret |
| [F09](#f09) | Worker-adressen er tom eller viser en eksempeladresse | Implementeret og mocktestet |
| [F10](#f10) | TMDB afviser adgang eller tokenet kan ikke findes | Løst og liveverificeret |
| [F11](#f11) | Cover-AI afvises med HTTP 429; ingen flere udgifter | Fortsat blokeret |
| [F12](#f12) | Risiko for tab ved migration, backup eller anden origin | Forebyggelse og testdækning |
| [F13](#f13) | Gammel frontend, forkert PWA-fil eller blank side | Forebyggelse og testdækning |
| [F14](#f14) | GitHub-skrivning afvises med 403 | Løst |
| [F15](#f15) | Lokale filer hænger, eller primær Git-mappe er skrivebeskyttet | Håndteret |
| [F16](#f16) | Testværktøj stopper før assertions eller fejler på typeantagelse | Løst |
| [F17](#f17) | Browserstyring viser gammel tilstand eller forkert loginfane | Håndteret |
| [F18](#f18) | Grøn health eller mocktest bliver forvekslet med livebevis | Forebyggelse og testdækning |

Verificeret kilde ved sidste udgivelse: main `e95c678d9ad39c392996081484550fc0e9d00077`, tree `f7d64bcea1fa3b38a10b26a91b1f813674b1fcd3`. [Main-CI og Pages](https://github.com/tobibeepdk/min-filmsamling/actions/runs/38296925440) bestod med 227 enhedstests, 52 E2E-tests, lint, build og 0 secret-fund. Worker-version `11cb2ef0-bee3-42b8-8eaf-49fd2e52dd3f` var aktiv på 100 %. Dette er et historisk kontrolpunkt, ikke automatisk bevis for en senere version.

<a id="f01"></a>

## F01. Appen starter ikke: indexedDB mangler

**Status:** Årsag uafklaret.

**Symptom:** iPhone viste “Can’t find variable: indexedDB” samtidig med Nedlukningstilstand.

**Årsag:** Den konkrete årsag og en bestemt kodeændring er ikke dokumenteret. Samtidig Nedlukningstilstand beviser ikke årsagen.

**Løsning eller næste sikre trin:** Brugeren meldte senere, at appen virkede. Ved gentagelse: undersøg API-tilgængelighed, Safari-/iOS-version, origin og appversion på samme enhed før en ændring.

**Forebyggelse:** Bevar Nedlukningstilstand og Safari-data. Lov ikke en implementeret lagerreserve: den verificerede db.js bruger IndexedDB og indeholder ikke en dokumenteret localStorage-reserve.

**Bevis og testscope:** Brugerens skærmbillede og beskeden “virker nu”; kildeinspektion af db.js fra main e95c678d. Ingen separat fysisk regression af denne fejl.

**Sikkerhed:** Ingen sletning af samling eller nedjustering af browserbeskyttelse.

**Kilder:** Brugerens fejlskærmbillede og efterfølgende besked; src/db.js.

<a id="f02"></a>

## F02. OCR læser stiliseret covertekst forkert

**Status:** Implementeret og mocktestet.

**Symptom:** Tidligere OCR gav meningsløs tekst for coveret The Wicked.

**Årsag:** OCR alene kan miste titel, layout, grafik og øvrige coverledetråde.

**Løsning eller næste sikre trin:** Hele det roterede, omtegnede og komprimerede cover sendes gennem Worker til billedforståelse i Responses API. Struktureret JSON og confidence styrer automatisk valg eller højst fem kandidater.

**Forebyggelse:** Bevar billedinput, EXIF-behandling, faste JSON-krav og kandidatvalg. Kontrollér modelstøtte i officiel dokumentation, hvis OPENAI_MODEL ændres.

**Bevis og testscope:** Automatiske tests håndterer The Wicked, år 2013, høj/lav confidence og ukendt stregkode. Live AI blev afvist med 429; genkendelsespræcision er ikke liveverificeret.

**Sikkerhed:** Send ikke originalfilen. Midlertidigt AI-foto må ikke gemmes i localStorage, backup eller logs.

**Kilder:** min-filmsamling-levering.md; min-filmsamling-slutrapport-20261012.md.

<a id="f03"></a>

## F03. Ukendt stregkode giver ingen filmtitel

**Status:** Implementeret og mocktestet.

**Symptom:** En gyldig EAN/UPC kan mangle i den eksterne database eller ramme providerens grænse.

**Årsag:** Stregkodedatabaser har ufuldstændig dækning; fravær af fund er ikke en ugyldig kode.

**Løsning eller næste sikre trin:** Kontrollér kontrolciffer og normalisering, derefter lokal barcodeMap, derefter provider. Et manglende fund går videre til coverkamera; gem den lokale kobling, når filmen gemmes.

**Forebyggelse:** Test missing-result, providerfejl og lokal genbrug særskilt. EAN 7393834487707 findes nu live som National Treasure; brug et mocked missing-result til regressionen for ukendt kode.

**Bevis og testscope:** 52 afsluttende mockede browsertests inkluderer ukendt kode til coverflow og gemning samt kendt kode til metadata og lokal genbrug. Nummeropslag for 7393834487707 er liveverificeret.

**Sikkerhed:** Opfind ingen titel. Automatisk coveridentifikation for ukendte koder kræver fungerende AI-adgang, som aktuelt er blokeret.

**Kilder:** min-filmsamling-scan-slutrapport-2026-10-11.md; min-filmsamling-slutrapport-20261012.md.

<a id="f04"></a>

## F04. Providerkald fejler straks, men health er grøn

**Status:** Løst og liveverificeret.

**Symptom:** Stregkodeopslag gav PROVIDER_FAILURE, mens Test forbindelse eller /health svarede OK.

**Årsag:** redirect: error blev afvist af den anvendte Workers-runtime, før providerkontakt. Node-mocks skjulte forskellen.

**Løsning eller næste sikre trin:** Brug redirect: manual i den fælles upstreamJson, og afvis alle redirects uden at følge dem med credentials. Deploy selve Worker-rettelsen.

**Forebyggelse:** Test den faktiske adapter i workerd ved transportændringer. En frontendopdatering eller et nyt login ændrer ikke Workerens serverkode.

**Bevis og testscope:** To workerd-regressioner fejlede før rettelsen og bestod efter. Secretfri Cloudflare-preview fandt faktisk EAN 7393834487707. PR #5 blev udgivet fra main 37688e35.

**Sikkerhed:** Følg aldrig en providerredirect med Authorization. Udskriv ikke rå upstream-fejl.

**Kilder:** min-filmsamling-scan-slutrapport-2026-10-11.md; PR #5.

<a id="f05"></a>

## F05. Barcode-titel findes, men TMDB finder ingen metadata

**Status:** Løst og liveverificeret.

**Symptom:** UPCitemDB returnerede National Treasure - Scandinavian Edition., hvorefter TMDB gav ingen filmdata.

**Årsag:** Det regionale udgavesuffiks og punktummet blev søgt som en del af filmtitlen.

**Løsning eller næste sikre trin:** shared/product-title.js renser kendte produktangivelser både ved stregkodeopslag og ved søgning fra gamle kladder, også originalTitle.

**Forebyggelse:** Fjern kun en kendt afsluttende udgaveangivelse efter tydelig separator eller i parentes/bracket. Bevar årstal, tvetydig tekst og ukendte udgaver.

**Bevis og testscope:** Efter PR #6 gav appens nummerreserve automatisk National Treasure (2004), TMDB-metadata og cover uden titelindtastning. Fysisk kamera blev ikke prøvet; ingen testfilm blev gemt.

**Sikkerhed:** Rens søgefelter uden at overskrive egne noter, placering eller coverfoto.

**Kilder:** min-filmsamling-slutrapport-20261012.md; PR #6.

<a id="f06"></a>

## F06. Sort kamerafelt eller mistet cover efter fejl

**Status:** Implementeret og mocktestet.

**Symptom:** Et stoppet/utilgængeligt kamera kunne efterlade sort video og en aktiv billedknap. Et fejlet opslag krævede tidligere et nyt foto.

**Årsag:** Kameraets livscyklus og det midlertidige cover blev ikke håndteret konsekvent ved fejl og forsinkede svar.

**Løsning eller næste sikre trin:** Skjul stoppet eller utilgængeligt livekamera. Vis input-capture-reserve. Behold det komprimerede foto i hukommelsen, så Prøv analysen igen kan genbruge bytes; tilbyd beskæring, nyt foto og annullering.

**Forebyggelse:** Dæk afvist kamera, forsinket kamerastart, genforsøg, beskæring og annullering. Undersøg fysisk enhed særskilt ved nye kamerafejl.

**Bevis og testscope:** PR #4 implementerede rettelsen med 198 enhedstests og 50 E2E-tests. De afsluttende 52 mockede browsertests dækker også disse regressioner.

**Sikkerhed:** Stop kamerastreams ved afslutning. Gem ikke midlertidige AI-fotos i lager eller logs.

**Kilder:** min-filmsamling-cover-levering.md; min-filmsamling-slutrapport-20261012.md.

<a id="f07"></a>

## F07. Forsinkede svar overskriver nyere kladde eller noter

**Status:** Implementeret og mocktestet.

**Symptom:** Overlappende opslag, kamera, nyt foto og navigation kunne ændre en nyere kladde.

**Årsag:** Gamle asynkrone operationer kan afslutte efter brugerens næste handling.

**Løsning eller næste sikre trin:** Ignorér forældede svar, bevar egne noter og placering, og gem kladden ved hvert trin. Annullering beholder kladden; metadatafejl beholder den allerede fundne titel.

**Forebyggelse:** Regressionstest redigering under opslag, navigation under lagring, annullering, nyt foto og eksisterende filmredigering.

**Bevis og testscope:** Mockede iPhone-WebKit/Chromium-regressioner for alle nævnte forløb indgår i de 52 beståede afsluttende cases.

**Sikkerhed:** Overskriv ikke egne coverfotos uden accept, og gem ikke en testfilm i brugerens samling uden særskilt ønske.

**Kilder:** min-filmsamling-cover-levering.md; tests/e2e/regressions.spec.js.

<a id="f08"></a>

## F08. Login virker på iPhone, men ikke i testfanen

**Status:** Løst og liveverificeret.

**Symptom:** Codex-fanen viste Adgang blev afvist, selv om brugeren var logget ind på iPhonen. Senere udløb login under længere testarbejde.

**Årsag:** Sessioner gælder den konkrete browser/enhed og udløber efter 900 sekunder. Den første afvisnings præcise årsag blev ikke fastslået.

**Løsning eller næste sikre trin:** Log ind i den præcise appfane, og kontrollér den synlige besked Logget ind. Filmopslag og AI er klar. Forny session ved udløb med eksisterende APP-kode.

**Forebyggelse:** Kontrollér fane, Worker-adresse og loginstatus før providerdiagnose. Rotér ikke adgangskoden blot for at løse et udløbet token.

**Bevis og testscope:** Ejerens login i den faktisk synlige appfane blev bekræftet før det vellykkede live barcode/TMDB-opslag. En udløbet session nåede ikke OpenAI.

**Sikkerhed:** APP_ACCESS_KEY bruges kun til login og gemmes ikke råt af frontend. Ingen adgangskoder eller tokens i chat eller logs.

**Kilder:** min-filmsamling-loginverifikation-20261012.md; min-filmsamling-slutrapport-20261012.md.

<a id="f09"></a>

## F09. Worker-adressen er tom eller viser en eksempeladresse

**Status:** Implementeret og mocktestet.

**Symptom:** Indstillinger viste https://din-worker.workers.dev som placeholder, så brugeren manglede en rigtig forbindelsesadresse.

**Årsag:** Et tomt gemt felt eller en manglende standardadresse kan gøre opsætningen uklar.

**Løsning eller næste sikre trin:** Brug standarden https://min-filmsamling-api.min-filmsamling.workers.dev ved ny installation og tom indstilling. Bevar en bevidst brugerdefineret adresse.

**Forebyggelse:** Skeln mellem placeholder og faktisk værdi. Test ny installation, tom indstilling og brugerdefineret adresse efter reload.

**Bevis og testscope:** Fire config-enhedstests og målrettede iPhone-browsercases dækker standard/tom/brugerdefineret adresse. Live Test forbindelse gav OK.

**Sikkerhed:** Adresse er offentlig konfiguration, ikke en API-nøgle. Origin skal være https://tobibeepdk.github.io uden sti.

**Kilder:** tests/unit/config.test.js; tests/e2e/iphone.spec.js; min-filmsamling-loginverifikation-20261012.md.

<a id="f10"></a>

## F10. TMDB afviser adgang eller tokenet kan ikke findes

**Status:** Løst og liveverificeret.

**Symptom:** Autentificeret filmopslag gav PROVIDER_AUTH. TMDB viste Request an API key i stedet for et Read Access Token.

**Årsag:** TMDB-adgang var ikke accepteret. Den oprindelige afvisnings årsag blev ikke bekræftet som forkert type, udløb eller andet.

**Løsning eller næste sikre trin:** Ejeren gennemførte Developer-ansøgningen, kontaktoplysninger og vilkår. API Read Access Token blev gemt som TMDB_READ_TOKEN i Cloudflare og deployet; Worker tilføjer Bearer-headeren.

**Forebyggelse:** Brug Read Access Token, ikke feltet API Key. En krypteret secret og grøn health er kun konfigurations-/forbindelsesbevis; kontrollér et autentificeret filmopslag bagefter.

**Bevis og testscope:** Efter ejerens tokenopsætning returnerede live TMDB National Treasure (2004), komplet metadata og et indlæst cover.

**Sikkerhed:** Ejeren indtaster token og accepterer vilkår selv. Ingen værdier eller kontaktoplysninger i fejlloggen.

**Kilder:** min-filmsamling-tmdb-ansoegning-status-20261012.md; min-filmsamling-slutrapport-20261012.md.

<a id="f11"></a>

## F11. Cover-AI afvises med HTTP 429; ingen flere udgifter

**Status:** Fortsat blokeret.

**Symptom:** Autentificeret live cover gav PROVIDER_RATE_LIMIT, også efter pause og efter opdateret fejlklassifikation.

**Årsag:** OpenAI afviste med en grænsefejl. Den forbundne Personal-kontovisning viste 0 kredit; Worker-nøglens præcise projektgrænse er ikke fastslået alene af dette.

**Løsning eller næste sikre trin:** Fire nyere kredit/spend/usage-koder blev tilføjet den faste PROVIDER_QUOTA-allowlist. Ukendte 429-koder forbliver konservative. Efter brugerens fravalg af flere udgifter blev yderligere AI-forsøg stoppet, og ingen kredit købt.

**Forebyggelse:** Skeln mellem rate, kredit, projekt-/organisationsbudget og modeladgang, før der gives kontoråd. Kontrollér aktuelle officielle koder, og gentag ikke blindt requests eller nøgleoprettelse.

**Bevis og testscope:** Fire regressioner fejlede før allowlist-rettelsen, 76 adaptertests bestod efter. PR #7 er udgivet. Live AI gav fortsat 429 og intet genkendelsesresultat.

**Sikkerhed:** Brugerens nulbudget gælder fortsat. Ingen køb eller betalte liveforsøg som fejlsøgningsløsning uden nyt udtrykkeligt ønske.

**Kilder:** min-filmsamling-slutrapport-20261012.md; PR #7.

<a id="f12"></a>

## F12. Risiko for tab ved migration, backup eller anden origin

**Status:** Forebyggelse og testdækning.

**Symptom:** Ældre film, kladder, egne covers og indstillinger skal overleve opdatering; tidligere browserdata kan ligge på en anden origin.

**Årsag:** Browserlager er adskilt efter origin/profil. En delvis migration eller uvalideret import kan skade data.

**Løsning eller næste sikre trin:** Migrér atomisk og verificér filmfelter/coverbytes før færdigmarkering og oprydning af gamle settings-secrets. Bevar gammel filmsamling og kladde. Eksportér på gammel origin og importér backup på ny origin.

**Forebyggelse:** Valider hele backupformatet og versionen før atomisk merge. Bevar eksisterende ID, noter, placering, set/favorit og egne covers; eksportér jævnligt.

**Bevis og testscope:** Lager-/backup-/migrationsenhedstests og mockede iPhone-migrationstests består. Der er ikke dokumenteret et faktisk produktionstab i dette forløb.

**Sikkerhed:** Backup må ikke indeholde settings-secrets, APP-kode eller session-token. Slet ikke Safari-data for at reparere opslag.

**Kilder:** docs/OPSÆTNING-DANSK.md; tests/unit/storage.test.js; min-filmsamling-slutrapport-20261012.md.

<a id="f13"></a>

## F13. Gammel frontend, forkert PWA-fil eller blank side

**Status:** Forebyggelse og testdækning.

**Symptom:** Cache kan fastholde en tidligere appversion; manglende modul kan forhindre start. Et kontrolscript fik 404 på service-worker.js.

**Årsag:** Appen registrerer sw.js, ikke service-worker.js. GitHub Pages kræver /min-filmsamling/-base. Manglende moduler er en separat startupfejl.

**Løsning eller næste sikre trin:** Byg med pnpm build og brug versioneret statisk cache samt Opdatér appen. Behold boot-fejlsiden ved modulfejl, og kontrollér registreret filnavn og path før kodeændring.

**Forebyggelse:** Cache aldrig API-svar. Bevar IndexedDB ved opdatering. Ændr ikke boot.js alene på grund af den kendte ikke-blokerende classic-script-advarsel.

**Bevis og testscope:** sw.js og TMDB-logo gav HTTP 200; SW a727676d3202dfbb har 11 lokale filer. Ejerens opdateringsknap og efterfølgende TMDB-kreditering blev bekræftet. Offline- og manglende-modul-tests er mockede browsercases.

**Sikkerhed:** Ingen cache-/Safari-sletning som standardløsning. Service-worker.js-404 var en forkert testadresse, ikke en appfejl.

**Kilder:** min-filmsamling-scan-slutrapport-2026-10-11.md; min-filmsamling-slutrapport-20261012.md.

<a id="f14"></a>

## F14. GitHub-skrivning afvises med 403

**Status:** Løst.

**Symptom:** Connectoren gav HTTP 403, mens Git-CLI manglede login; genforbindelse alene gav ikke bevis for skriveadgang.

**Årsag:** En bestemt connector/CLI-skrivevej havde ikke adgang, selv om ejerens almindelige browserlogin virkede.

**Løsning eller næste sikre trin:** Publicér godkendte sikre kildefiler gennem ejerens GitHub-UI på ny branch. Verificér hele remote-tree mod testet lokal tree før PR/merge, og afvent CI.

**Forebyggelse:** Kontrollér den konkrete skrivevej. Gentag ikke uændrede 403-forsøg eller brug et permissionsflag som bevis. Worker deployes manuelt; Pages kun fra main efter checks.

**Bevis og testscope:** PR #5, #6 og #7 blev flettet; tree f7d64bcea1fa3b38a10b26a91b1f813674b1fcd3 matcher testet slutkilde. Main-CI og Pages er success på e95c678d.

**Sikkerhed:** Udtræk ikke browsercookies, credentials eller sessioner for at omgå connectorens afvisning.

**Kilder:** min-filmsamling-scan-slutrapport-2026-10-11.md; min-filmsamling-slutrapport-20261012.md.

<a id="f15"></a>

## F15. Lokale filer hænger, eller primær Git-mappe er skrivebeskyttet

**Status:** Håndteret.

**Symptom:** Nogle filreads hang, primær checkout var gammel/ændret, og .git kunne ikke muteres sikkert.

**Årsag:** Filadgang og checkout-miljø var problemet; en bestemt underliggende filsynkronisering blev ikke bevist.

**Løsning eller næste sikre trin:** Brug den verificerede komplette bundle i en isoleret, fungerende checkout. Arbejd dér, sammenlign offentlig main-tree, og eksportér en verificeret ny bundle.

**Forebyggelse:** Genbrug fungerende runtime og checkout. Kontrollér version og indhold før copy/sync; skriv ikke en blanding af gamle og nye kilder tilbage.

**Bevis og testscope:** Main e95c678d-tree er verificeret; min-filmsamling-main-final-20261012.bundle er verificeret og indeholder komplet historik. Primær checkout blev ikke nulstillet.

**Sikkerhed:** Bevar brugerændringer og historik. Ingen reset, tvungen partial-sync eller produktionstilpasning for lokale filproblemer.

**Kilder:** min-filmsamling-slutrapport-20261012.md.

<a id="f16"></a>

## F16. Testværktøj stopper før assertions eller fejler på typeantagelse

**Status:** Løst.

**Symptom:** Miniflare-konvertering afviste modulesRules; workerd fik listen EPERM; en E2E-test forventede et numerisk år i stedet for formens streng.

**Årsag:** Testopsætning, manglende lokal porttilladelse og forkert assertion; de fejl dokumenterede ikke en ny produktionsfejl.

**Løsning eller næste sikre trin:** Brug en eksplicit ES-modulliste og kompatibel pinnet Miniflare. Giv den nødvendige lokale testserver tilladelse; vælg ledig testport, hvis optaget. Ret kun år-assertionen til eksisterende formtype.

**Forebyggelse:** Bekræft at testen når relevante assertions. Brug Node 24 og pnpm 11.19.0, frozen lockfile og eksisterende esbuild/workerd allowBuilds.

**Bevis og testscope:** Uændret produktionskilde bestod 227 enhedstests og 52 E2E-tests efter miljø-/testrettelser. Tidligere port 4173 var optaget; afsluttende lokal port var 4193.

**Sikkerhed:** Ingen rigtige providerkald eller secrets er nødvendige til disse mock-tests. Undlad produktionsrettelser for miljø- og værktøjsfejl.

**Kilder:** min-filmsamling-cover-levering.md; min-filmsamling-slutrapport-20261012.md.

<a id="f17"></a>

## F17. Browserstyring viser gammel tilstand eller forkert loginfane

**Status:** Håndteret.

**Symptom:** UI-handlinger kunne se uændrede ud i samme toolkald; virtuelle faner var ikke den ejerens synlige appfane. Secretfølsom DOM-læsning blev afvist.

**Årsag:** Asynkron native browseropdatering, forskellige faneidentiteter og sikkerhedsgrænser i testværktøjet.

**Løsning eller næste sikre trin:** Tag en frisk DOM-observation i næste kald og genfind fane/provider-ID ved faktisk lukning. Brug den synlige Codex-appfane til brugerlogin. Læs kun nødvendige ufølsomme labels/status.

**Forebyggelse:** Kontrollér aktuel fane og tilstand før genforsøg. Bed ikke om gentaget login, før den konkrete fane er identificeret. Gem kun screenshots, hvor resultatet faktisk ses.

**Bevis og testscope:** Faktisk native appfane blev identificeret og brugt til live barcode/TMDB. Ældre beskårne Cloudflare-billeder viste baggrund og må ikke bruges som secret-/deploybevis.

**Sikkerhed:** Ingen token-/cookie-/IndexedDB-sessionudtræk, fuld secret-side eller logning af autentificeringsfelter.

**Kilder:** min-filmsamling-tmdb-ansoegning-status-20261012.md; min-filmsamling-slutrapport-20261012.md.

<a id="f18"></a>

## F18. Grøn health eller mocktest bliver forvekslet med livebevis

**Status:** Forebyggelse og testdækning.

**Symptom:** Der kunne drages for brede konklusioner af health, secret-navne, eksisterende titel eller et syntetisk AI-resultat.

**Årsag:** Forbindelse, autentificering, provideradgang, metadata, fysisk scanning og AI-præcision er forskellige testtrin.

**Løsning eller næste sikre trin:** Angiv altid version, faktisk kommando/resultat, runtime og mock/live-scope. Kontrollér resultatet efter hele handlingen; bevar tidligere evidens tidsstemplet.

**Forebyggelse:** Test health, session, barcode, TMDB og AI særskilt. Bevis en ny titel fra opslag frem for et allerede udfyldt felt. Brug ingen nye API-nøgler eller gentagne beståede tests uden en ny grund.

**Bevis og testscope:** Slut-main e95c678d: 227 unit, 52 E2E, lint/build/security og Pages success. Rekursiv dist-søgning: 0 secret-fund. Live barcode/TMDB virker; live AI og fysisk kamerascanning er ikke bekræftet.

**Sikkerhed:** Secrets forbliver i Worker. Ingen providertekst, billeder, nøgler eller persondata i huskenoter eller testlogs.

**Kilder:** min-filmsamling-slutrapport-20261012.md; min-filmsamling-kontroloutput-20261012.log.

## Fremgangsmåde næste gang

1. Find den tilsvarende post og dens bevisgrænse; begynd med konkrete symptomer og version.
2. Skeln mellem frontend, session, Worker, provider, data og testværktøj.
3. Brug den mindste sikre kontrol, og bevar film, kladder, Safari-data og Nedlukningstilstand.
4. Gentag kun checks, når ny kode, en fejl eller ændret miljø giver en grund. Produktionsændringer kræver relevante regressioner og projektets normale afsluttende kontroller. Dokumentationsrettelser kræver format-, indholds- og sikkerhedskontrol.
5. Gem nye erfaringer i både denne oversigt og JSON med symptom, årsag eller usikkerhed, løsning, sikkerhed, forebyggelse og faktisk bevis. Undlad værdier fra secrets og personoplysninger.

Historiske rapporter ligger i den holdbare artefaktmappe for denne opgave. Den samlede slutrapport indeholder testoutput, ændrede filer, deployment og begrænsninger. En verificeret komplet kildehistorik er gemt i `min-filmsamling-main-final-20261012.bundle`.

## Tidligere detaljerede noter – bevaret

De tidligere offentliggjorte detaljerede noter følger uændret. De omfatter også de oprindelige lokale poster.

# Fejl og afprøvede løsninger

## 12. oktober 2026: kendt stregkode findes, men filmoplysninger mangler

**Symptom:** EAN `7393834487707` findes hos UPCitemDB som `National Treasure - Scandinavian Edition.`, men det efterfølgende TMDB-opslag finder ingen yderligere filmdata. En tidligere `PROVIDER_AUTH` skyldtes en separat TMDB-credentialfejl; denne forsvandt efter ejerens sikre tokenopsætning.

**Årsag og sikkerhed:** Den eksisterende produkttitelrensning kendte ikke den regionale udgaveangivelse og dens afsluttende punktum. TMDB søgte derfor efter produktnavnet. Ændringen berører kun kendte produktangivelser i forespørgsler; den ændrer ingen secrets, sessiongrænser, film-ID'er, noter, placeringer eller egne covers.

**Afprøvet løsning:** Den fælles `shared/product-title.js` bruges både ved stregkodeopslag og ved TMDB-søgning fra ældre kladder. `Scandinavian Edition` fjernes kun som afsluttende angivelse efter en tydelig separator eller i parentes/bracket. Ukendte udgaver, tvetydig titeltekst og årstal bevares.

**Bevis:** I den udgivne app med ejerens nye login gav den rå produkttitel ingen TMDB-kandidater. En kontrolleret ændring af kun titlen til `National Treasure` fandt automatisk originaltitel og år `2004` med datakilden `tmdb`. Dette var en live diagnose af titelproblemet, ikke en genprøve af den endnu ikke udgivne kodeændring. De nye adapterregressioner havde 12 forventede assertion-fejl før rettelsen; efter rettelsen består 69 adaptertests og de to eksisterende workerd-tests med mocked providertransport. Samlet verifikation og efterfølgende deployment dokumenteres særskilt.

**Forebyggelse:** Bevar regressionerne for den faktiske UPCitemDB-produkttekst, gamle kladder, årstal og titler med ordet Edition. Sondr mellem vellykket login, aktiveret Worker-secret, live filmopslag og et fuldt gennemspillet scannerforløb. `/health` dokumenterer kun forbindelsen. Login på en iPhone overføres ikke til en anden browser.

**Testmiljø:** Det første workerd-testforsøg stoppede før assertions med lokal `listen EPERM`. Testen bestod med tilladelse til en lokal testserver; dette var ikke en produktionsfejl. Offlineinstallation manglede pnpm-registrymetadata for Miniflare, mens den efterfølgende frosne installation genbrugte de låste pakker. Projektets pnpm 11.19.0 anvendes til de afsluttende checks.

## 7. oktober 2026: stregkodeopslag fejler straks i Workers-runtime

**Symptom:** Appens coverkamera åbner efter scanning med `Stregkodeopslag` og `PROVIDER_FAILURE`. `/health` kan samtidig svare korrekt. Problemet ligger før AI-genkendelsen.

**Årsag og sikkerhed:** Den fælles `upstreamJson` anvendte `fetch` med `redirect: 'error'`. Den anvendte Workers-runtime afviser denne indstilling, før et outbound-kald bliver sendt. Barcode, TMDB og OpenAI bruger samme transport. Node-mocks skjulte forskellen. Produktionskode ved diagnosen: main `085ed11da52a4996e6a2ac5cca8820426a59d0a9`, Wrangler `4.145.0`, Miniflare `5.20260930.0-alpha` med bundlet workerd, compatibility date `2026-10-01`. Runtimeadfærd skal revalideres ved versionsskift.

**Afprøvet løsning:** Brug `redirect: 'manual'`. Den eksisterende kontrol af ikke-2xx-svar afviser alle omdirigeringer, annullerer deres body og returnerer en fast ufølsom fejl. Der bruges aldrig automatisk `follow`, som kunne videresende credentials. CORS, sessioner, tids- og størrelsesgrænser, Durable Object, secrets og filmdata ændres ikke.

**Bevis:** En tidligere secretfri Cloudflare remote-preview med den faktiske `lookupBarcode`-adapter og EAN `7393834487707` gav HTTP 502, `PROVIDER_FAILURE`, klassifikation `REDIRECT_MODE` og 0 ms, før providerkontakt. Ingen rå providerfejl, tokens eller request bodies blev returneret. Den nye automatiske test indlæser de faktiske `providers.js` og `http.js` i workerd; kun den eksterne database er mocked. Før rettelsen fejlede 2 tests: filmfundet gav 502 i stedet for 200, og ingen outbound-anmodning blev sendt. Efter rettelsen består begge: filmen returneres, og en 302-redirect udløser kun ét outbound-kald og ingen videresendelse eller læk af providertekst.

**Forebyggelse:** Bevar `tests/unit/worker-runtime.test.js` i standardkommandoen `pnpm test` og CI. Test transport i mål-runtime ved ændringer; brug ikke `/health`, Node-fetch eller mocked browser som bevis for liveprovideradgang. Automatiske mocks beviser ikke fysisk kamerafunktion, AI-præcision eller en providerkontos kvote. Deployment og aktuelle livekontroller dokumenteres særskilt i `VERIFIKATION.md`.

**Livekontrol efter kodeændringen:** Den 7. oktober returnerede en secretfri Cloudflare remote-preview med den rettede `lookupBarcode` og samme EAN `{ "probe": "manual-v1", "found": true, "title": "National Treasure - Scandinavian Edition." }`. Previewen havde hverken app-session, providersecrets, filmdata eller produktionsbindinger. Dette verificerer faktisk providertransport på Cloudflares netværk, men ikke et autentificeret AI-/TMDB-kald eller fysisk iPhone-scanning.

## Testværktøj: Miniflare v4-indstillinger og v5-konvertering

Et tidligere testforsøg med `modulesRules` kunne ikke konverteres til Miniflare v5 og stoppede i setup med 2 ikke-kørte tests. Dette var en testværktøjsfejl og ikke en reproduktion af produktionsfejlen. Løsningen er en eksplicit liste af ES-moduler til `convertV4MiniflareOptions`, som den installerede version understøtter. Først derefter kunne regressionen dokumenteres med faktiske assertion-fejl. Pin testafhængigheden til den samme Miniflare-version som Wrangler.

## Miljø: pakkehentning og manglende testoutput

Sandboxens DNS-adgang til npm kan give `ENOTFOUND`. Kør den nødvendige pakkehentning med godkendt netværksadgang; ændr ikke appkode eller dependencyversion for en lokal netværksfejl. Hvis en afbrudt toolsession mister testoutput, gem output fra en ny fuld kontrol i en lokal, ikke-committed fil. Bevar fungerende runtime og beståede kontroller, når output allerede er tilgængeligt.

## 12. oktober 2026: OpenAI 429 kræver skelnen mellem konto- og rategrænser

**Symptom:** Et autentificeret liveforsøg med et offentligt testcover gav `PROVIDER_RATE_LIMIT`, også efter en pause. Stregkode og TMDB virkede. En tidligere udløbet session var en separat hændelse og nåede ikke OpenAI.

**Årsag og sikkerhed:** Den gamle allowlist dækkede kun to ældre kvotekoder. De aktuelle [officielle fejlkoder](https://developers.openai.com/api/docs/guides/error-codes) omfatter også `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded` og `organization_usage_limit_exceeded`. Derfor kunne klientens gamle kode ikke alene udelukke en kontogrænse. Den konkrete årsag på ejerens konto er endnu ikke bekræftet.

**Afprøvet løsning:** De fire faste koder klassificeres som `PROVIDER_QUOTA`; almindelig `rate_limit_exceeded`, ukendte og manglende koder forbliver `PROVIDER_RATE_LIMIT`. Rå providertekst, nøgler og billeder returneres eller logges ikke. Rettelsen ændrer ingen sessioner, secrets, lagrede film eller bindings.

**Bevis:** Fire nye regressioner fejlede før rettelsen; bagefter består alle 76 adaptertests, samlet 227 enhedstests og 52 mocked iPhone-browsertests. Lint, build og secret-kontrol består. Livekontrollen efter Worker-opdateringen gav stadig `PROVIDER_RATE_LIMIT`; AI-genkendelse er derfor ikke live-verificeret. Dette er en rettet klassifikationsmangel, ikke dokumentation for løst kontoadgang.

**Forebyggelse:** Kontrollér aktuelle officielle fejlkoder før kontoråd. Bekræft quota/kredit-/spendårsag før anbefaling om betaling; gentag ikke requests eller roter nøgler som blind løsning. Skeln mellem mock-tests, vellykket TMDB-opslag og et faktisk AI-resultat. Ejeren håndterer selv login og eventuelle betalingsændringer.
