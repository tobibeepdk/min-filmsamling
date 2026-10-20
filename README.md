# Min filmsamling

En dansk PWA til en lokal filmsamling på iPhone. Samlingen, kladder og egne coverfotos gemmes i IndexedDB. Appen kan åbne samlingen offline efter den første indlæsning.

**Appadresse efter GitHub Pages-deploy:** [tobibeepdk.github.io/min-filmsamling](https://tobibeepdk.github.io/min-filmsamling/).

**Verificeret implementation:** [Arkitektur, ændrede filer og faktiske testresultater](docs/VERIFIKATION.md).

**Komplet vejledning:** [Opsætning, secrets, backup og iPhone](docs/OPSÆTNING-DANSK.md).

**Fejlfinding:** [Afprøvede fejl og løsninger](docs/fejl-og-loesninger.md).

## Funktioner

- Scan EAN-13, EAN-8 og UPC-A med kameraet eller fra et foto; indtastning er også mulig.
- Den lille lokale liste over verificerede DVD-udgaver indeholder `5706710213130` → **Freddy vs. Jason (2003)** og `5708758654715` → **Wrong Turn (2003)**. Brugerens egne gemte koblinger har forrang; derefter bruges kataloget før netopslag. Listen ændrer ikke den eksterne database, og øvrige ukendte koder kræver titelsøgning.
- Søg efter en film med titel og eventuelt årstal, og vælg blandt TMDB-kandidater.
- Ukendte stregkoder og mislykkede opslag åbner titelsøgningen. Kendte koder og lokale koblinger kan fortsat finde filmen automatisk.
- Tag dit eget coverfoto, som komprimeres og gemmes lokalt uden AI-upload. Fejl vises med sikre fejlkoder uden udbyderens rå fejltekst.
- Hent filmoplysninger fra TMDB og stregkodeoplysninger fra en konfigurerbar udbyder.
- Bevar egne covers, noter, placering, favoritter og set-status, når metadata tilføjes.
- Gem kladder automatisk og eksportér/importér JSON-backups med coverbilleder.
- Installér fra Safari via **Del → Føj til hjemmeskærm**.
- Mørkt biografdesign med gyldne knapper, formatmærker på filmkort og overblik over film, set og favoritter. Bundmenuen har ikoner og store touchmål til iPhone.

Standardflowet bruger ingen betalt cover-AI. Worker har `COVER_AI_ENABLED = "false"` og afviser også ældre appversioners cover-AI-kald med `AI_DISABLED` før providerkontakt, når denne Worker-version er udgivet. En ukendt stregkode kræver titelindtastning; appen lover ikke gratis automatisk covergenkendelse. Eksisterende Cloudflare- eller providerplaner kan stadig have deres egne udgifter og kvoter.

Workerens secrets bliver på serveren. Login kræver `APP_ACCESS_KEY` og `SESSION_SIGNING_KEY` samt den eksisterende limiter-binding. OpenAI-nøgle og model er ikke nødvendige for standardflowet; eksisterende OpenAI-secrets kan blive liggende ubrugt. TMDB-token er valgfrit. Secretværdier indtastes kun i Wranglers interaktive prompts, som beskrevet i vejledningen.

## Lokal udvikling

Brug Node.js 24 og pnpm 11.19.0. `pnpm-workspace.yaml` tillader de nødvendige installationsscripts for `esbuild` og `workerd`.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Åbn den lokale adresse med stien `/min-filmsamling/`. API-funktionerne kræver en konfigureret Worker og login; de automatiske tests bruger mocks.

```bash
pnpm test
pnpm lint
pnpm build
pnpm security
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Produktionsfiler dannes i `dist/`. GitHub Actions verificerer ændringer og udgiver Pages fra `main`; Worker udgives særskilt med en manuel workflow eller `pnpm worker:deploy`.

Hvis port 4173 bruges af et andet lokalt projekt, kan browser-testene køres med `FILMSAMLING_TEST_PORT=4183 pnpm test:e2e`.

## Data og drift

Frontend: Vite, ES-moduler og lokal service worker. Backend: Cloudflare Worker til login, stregkode- og TMDB-opslag samt en Durable Object til vedvarende fælles forbrugsgrænser. Den tidligere cover-AI-adapter er deaktiveret som standard. De seks IndexedDB-stores er `movies`, `drafts`, `barcodeMap`, `settings`, `coverBlobs` og `session`.

Ældre data fra samme origin migreres og verificeres. De gamle film og kladder bevares; gamle settings-secrets fjernes efter verificering. Data fra eksempelvis Netlify skal flyttes med eksport og import. Backups indeholder film og coverbilleder, mens indstillinger, login-sessioner og kladder udelades.

Mock-tests dokumenterer kodeadfærd. Reelt kamera på en fysisk iPhone og adgang til liveudbyderne kræver særskilt kontrol efter deployment. Den nye standard kræver ingen AI-forsøg, API-kredit eller nye OpenAI-secrets.

Stregkodeudbyderens adapter testes også i den samme `workerd`-runtime, som Wrangler bruger, med en mocked ekstern database. Testen kontrollerer både et filmfund og afvisning af omdirigeringer uden at videresende providercredentials. En grøn `/health` alene bekræfter ikke, at provideropslag virker.

Worker renser kendte produktangivelser før filmopslag. Eksempelvis bliver `National Treasure - Scandinavian Edition.` til `National Treasure`; årstal og tvetydige titler bevares. Samme rensning bruges ved opslag fra gamle kladder, så titlen ikke skal rettes manuelt. Filmoplysningerne krediterer TMDB under **Indstillinger → Om appen**, og logoet er bundlet til offlinebrug.
