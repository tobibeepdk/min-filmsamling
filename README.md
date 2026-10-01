# Min filmsamling

En dansk PWA til en lokal filmsamling på iPhone. Samlingen, kladder og egne coverfotos gemmes i IndexedDB. Appen kan åbne samlingen offline efter den første indlæsning.

**Appadresse efter GitHub Pages-deploy:** [tobibeepdk.github.io/min-filmsamling](https://tobibeepdk.github.io/min-filmsamling/).

**Verificeret implementation:** [Arkitektur, ændrede filer og faktiske testresultater](docs/VERIFIKATION.md).

**Komplet vejledning:** [Opsætning, secrets, backup og iPhone](docs/OPSÆTNING-DANSK.md).

## Funktioner

- Scan EAN-13, EAN-8 og UPC-A med kameraet eller fra et foto; indtastning er også mulig.
- Genkend en filmtitel fra et coverfoto med OpenAI gennem en Cloudflare Worker.
- Hent filmoplysninger fra TMDB og stregkodeoplysninger fra en konfigurerbar udbyder.
- Bevar egne covers, noter, placering, favoritter og set-status, når metadata tilføjes.
- Gem kladder automatisk og eksportér/importér JSON-backups med coverbilleder.
- Installér fra Safari via **Del → Føj til hjemmeskærm**.
- Mørkt biografdesign med gyldne knapper, formatmærker på filmkort og overblik over film, set og favoritter. Bundmenuen har ikoner og store touchmål til iPhone.

Workerens secrets bliver på serveren. Appen bruger en kortlivet session efter login med en særskilt adgangsnøgle. OpenAI- og TMDB-nøgler skal indtastes i Wranglers secret-prompts, som beskrevet i vejledningen.

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

## Data og drift

Frontend: Vite, ES-moduler og lokal service worker. Backend: Cloudflare Worker, Responses API og en Durable Object til vedvarende fælles forbrugsgrænser. De seks IndexedDB-stores er `movies`, `drafts`, `barcodeMap`, `settings`, `coverBlobs` og `session`.

Ældre data fra samme origin migreres og verificeres. De gamle film og kladder bevares; gamle settings-secrets fjernes efter verificering. Data fra eksempelvis Netlify skal flyttes med eksport og import. Backups indeholder film og coverbilleder, mens indstillinger, login-sessioner og kladder udelades.

Mock-tests dokumenterer kodeadfærd. Reelt kamera på en fysisk iPhone, AI-genkendelsens præcision og adgang til liveudbyderne kontrolleres efter brugerens deployment.
