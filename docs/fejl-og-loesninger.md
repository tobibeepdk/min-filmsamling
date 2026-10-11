# Fejl og afprøvede løsninger

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
