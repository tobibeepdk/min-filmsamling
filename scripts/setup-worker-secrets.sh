#!/usr/bin/env bash
set -euo pipefail

# Only Wrangler receives secret values through its own masked prompts.
# Never read keys into this script, environment variables or files.
if [[ ! -t 0 || ! -t 1 ]]; then
  printf '%s\n' 'Åbn en interaktiv terminal og kør pnpm worker:setup. Secrets må ikke sendes som argumenter eller via en fil.' >&2
  exit 2
fi

task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$task_root"

printf '%s\n' 'Indtast værdierne i Wranglers skjulte prompts. De gemmes kun som Cloudflare Worker-secrets.'
printf '%s\n' 'OPENAI_API_KEY: din OpenAI-projektnøgle.'
pnpm exec wrangler secret put OPENAI_API_KEY --config worker/wrangler.toml

printf '%s\n' 'APP_ACCESS_KEY: vælg en stærk adgangsnøgle på mindst 12 tegn. Brug den til login i appen.'
pnpm exec wrangler secret put APP_ACCESS_KEY --config worker/wrangler.toml

printf '%s\n' 'SESSION_SIGNING_KEY: en særskilt tilfældig signeringsnøgle på mindst 32 tegn, fx fra en adgangskodeadministrator.'
pnpm exec wrangler secret put SESSION_SIGNING_KEY --config worker/wrangler.toml

read -r -p 'Vil du også indtaste et TMDB Read Access Token til fulde filmoplysninger? (j/N) ' task_tmdb_choice
case "$task_tmdb_choice" in
  j|J|ja|JA)
    pnpm exec wrangler secret put TMDB_READ_TOKEN --config worker/wrangler.toml
    ;;
esac

printf '%s\n' 'Opsætningen er gennemført. Kontrollér forbindelsen i appens Indstillinger, og log ind med appens adgangsnøgle.'
