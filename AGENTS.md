# Arbejde i repositoryet

## Tidligere fejl

- Slå relevante symptomer op i `docs/fejl-og-loesninger.md` før nye forsøg. Gem nye erfaringer med årsag, afprøvet løsning, sikkerhed, forebyggelse og konkret bevis.
- Skeln mellem produktionsfejl, testværktøjsfejl og miljøproblemer. Providertransport skal testes i Workers-runtime; et Node-mock eller `/health` beviser ikke et fungerende providerkald.

## Arkitektur og værktøjer

- Brug Node.js 24 og pnpm 11.19.0; installér med `pnpm install --frozen-lockfile`.
- Bevar `allowBuilds` for `esbuild` og `workerd` i `pnpm-workspace.yaml`.
- Frontend er en statisk Vite-PWA med base-path `/min-filmsamling/`. Redigér kildemoduler; generér `dist` og service-worker-manifestet gennem `pnpm build`.
- Backend er Cloudflare Worker med en Durable Object til fælles vedvarende grænser. Bevar bindinger og migrationshistorik ved opdateringer.

## Secrets og API'er

- Standardflowet må ikke bruge betalt cover-AI. Bevar `COVER_AI_ENABLED = "false"`; kun den præcise streng `"true"` må aktivere den tidligere `/identify-cover`-adapter. Deaktiverede kald skal give `AI_DISABLED` før providerkontakt, også fra ældre frontends.
- Login må kun kræve `APP_ACCESS_KEY`, `SESSION_SIGNING_KEY` og limiter-bindingen, ikke OpenAI-nøgle eller model. Eksisterende OpenAI-secrets kan blive liggende ubrugt. Ingen køb, rotation eller live AI-forsøg uden brugerens nye udtrykkelige ønske.
- Providersecrets og session-signering ligger kun i Worker-secrets. Ingen rigtige nøgler eller tokenværdier i frontend, `VITE_`-variabler, source, git-historik, backups eller logs.
- Appens adgangsnøgle må kun bruges til login; gem kun kortlivet token og udløbstid i `session`-store.
- Bevar præcis Origin-validering, autentificering, requeststørrelsesgrænser, upstream-validering og persistent global rate limiting. Produktionsorigin er `https://tobibeepdk.github.io`, uden sti eller afsluttende skråstreg.
- Log ikke request bodies, billeder, session-token eller rå providerfejl. Sikkerhedsfejl skal have redigeret output.
- Providerkald bruger `redirect: 'manual'` og afviser omdirigeringer som fejl. Følg aldrig en providerredirect med credentials.
- Brug mocks til automatiske API- og kameratests. Bed ikke om API-nøgler for at implementere eller teste koden. Ægte secrets indtastes af brugeren i Wranglers interaktive secret-prompts.
- Worker udgives manuelt; en pull request må ikke udløse Worker-deploy.

## Data og brugeradfærd

- IndexedDB har seks stores med `id` som keyPath: `movies`, `drafts`, `barcodeMap`, `settings`, `coverBlobs`, `session`.
- Bevar filmfelter, egne coverbilleder, noter, placering, favorit- og set-status. Metadataopslag må ikke overskrive egne fotos eller brugerens noter.
- Migrér ældre localStorage-data atomisk og verificér felter og coverbytes før færdigmarkering og cleanup af gamle settings-secrets. Fjern aldrig den gamle filmsamling eller kladde som del af migrationen.
- Valider hele en backup før en atomisk merge. Backup allowlister filmfelter og tilknyttede covers; settings, sessioner og kladder udelades. Bevar eksisterende film-ID'er ved import.
- Gem kladder automatisk. Annullering og overlappende kamera-/API-kald må ikke overskrive nyere brugerinput.
- Bevar stregkodernes kontrolciffervalidering og normalisering. Ukendte koder og providerfejl giver titelsøgning med valgfrit årstal; opfind ikke en filmtitel eller lov gratis covergenkendelse. Kendte koder og lokale koblinger bruger fortsat automatisk opslag.
- Kontroller først brugerens `barcodeMap`, derefter det præcise lokale udgavekatalog i `src/barcode-catalog.js`, derefter provider. Tilføj kun katalogposter med dokumenteret stregkode/titel fra den faktiske udgave; gem kilder i fejlloggen. Gæt ikke beslægtede koder, og tilsidesæt ikke brugerens egne koblinger.
- Egne coverfotos komprimeres og gemmes lokalt uden AI-upload. Metadata må ikke overskrive dem.
- Billedbehandling skal anvende EXIF-retning, fjerne metadata og overholde de aftalte størrelsegrænser.
- Service worker cacher statiske appfiler, aldrig API-svar. Opdatering aktiveres af brugeren og bevarer IndexedDB-data.

## Verifikation og dokumentation

Kør relevante regressionstests under arbejdet og følgende kontroller før afslutning:

```bash
pnpm test
pnpm lint
pnpm build
pnpm security
pnpm test:e2e
```

Installér nødvendige Playwright-browsere med `pnpm exec playwright install chromium webkit`; Linux-CI bruger også `--with-deps`.

Hold [den danske opsætningsvejledning](docs/OPSÆTNING-DANSK.md) opdateret ved ændringer i konfiguration, secrets, backup eller deployment. Pages-deploy sker kun fra `main` efter checks. Påstå ikke, at fysisk iPhone-kamera, AI-præcision eller live provideradgang er verificeret af mock-tests.
