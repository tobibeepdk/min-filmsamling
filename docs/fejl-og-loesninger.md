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
