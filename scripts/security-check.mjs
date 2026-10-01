import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const ROOTS = ['.'];
const EXCLUDED = new Set([
  'node_modules',
  '.pnpm-store',
  '.git',
  '.wrangler',
  '.codex',
  '.agents',
  'test-results',
  'playwright-report',
  'artifacts',
]);
const secretPatterns = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
];
let scanned = 0;
const failures = [];
async function scan(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      EXCLUDED.has(entry.name) ||
      (/^\.(?:env|dev\.vars)(?:\.|$)/.test(entry.name) && !entry.name.endsWith('.example'))
    )
      continue;
    const next = path === '.' ? entry.name : `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== '.wrangler') await scan(next);
      continue;
    }
    if (!/\.(js|mjs|html|css|json|toml|md|yaml|yml|example|webmanifest|sh|txt)$/.test(next))
      continue;
    const text = await readFile(next, 'utf8');
    scanned++;
    if (secretPatterns.some((pattern) => pattern.test(text)))
      failures.push(next + ': mulig credential (værdi skjult)');
    if (
      next.startsWith('dist/') &&
      /OPENAI_API_KEY|APP_ACCESS_KEY|TMDB_READ_TOKEN|BARCODE_PROVIDER_KEY|SESSION_SIGNING_KEY|api\.openai\.com/.test(
        text,
      )
    )
      failures.push(next + ': serverkonfiguration i browser-build');
  }
}
try {
  await readFile('dist/index.html');
} catch {
  failures.push('Browser-build mangler. Kør pnpm build før sikkerhedskontrollen.');
}
for (const path of ROOTS) await scan(path);
const revisions = spawnSync('git', ['rev-list', '--all'], { encoding: 'utf8' });
if (revisions.status !== 0) throw new Error('Git-historikken kunne ikke kontrolleres.');
const historyPattern =
  'sk-(proj-|svcacct-)?[A-Za-z0-9_-]{30,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}';
const commits = revisions.stdout.trim().split('\n').filter(Boolean);
for (const commit of commits) {
  const result = spawnSync('git', ['grep', '-I', '-l', '-E', historyPattern, commit], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status === 0)
    failures.push(
      `Historik ${commit.slice(0, 8)}: mulig credential i ${result.stdout.trim().split('\n').length} fil(er), værdier skjult`,
    );
  else if (result.status !== 1) throw new Error('Historikscan fejlede.');
}
if (failures.length) {
  failures.forEach((f) => console.error(f));
  process.exitCode = 1;
} else
  console.log(
    `Sikkerhed: ${scanned} filer + ${commits.length} git-commits kontrolleret; 0 secret-fund. Browser-build: ingen servernøgler eller direkte OpenAI-kald.`,
  );
