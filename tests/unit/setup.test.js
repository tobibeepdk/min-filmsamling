import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const setupScript = fileURLToPath(
  new URL('../../scripts/setup-worker-secrets.sh', import.meta.url),
);
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

async function runSetup(args = []) {
  const directory = mkdtempSync(join(tmpdir(), 'film-setup-'));
  temporaryDirectories.push(directory);
  const callsFile = join(directory, 'calls');
  writeFileSync(callsFile, '');
  writeFileSync(
    join(directory, 'pnpm'),
    '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$TASK_WRANGLER_CALLS"\n',
    { mode: 0o700 },
  );
  const command = ['bash', setupScript, ...args];
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const scriptArgs =
    process.platform === 'darwin'
      ? ['-q', '/dev/null', ...command]
      : ['-q', '-e', '-c', command.map(quote).join(' '), '/dev/null'];
  // A real pipe avoids macOS script rejecting Node's stdio socket. Keep it open
  // until the prompt is answered so script cannot inject EOF before read runs.
  const child = spawn('bash', ['-c', `cat | script ${scriptArgs.map(quote).join(' ')}`], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      TASK_WRANGLER_CALLS: callsFile,
    },
  });
  const result = await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let answered = false;
    const timeout = setTimeout(() => {
      child.stdin.end();
      child.kill();
      reject(new Error('Interactive setup did not finish with stubbed Wrangler'));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!answered && stdout.includes('(j/N) ')) {
        answered = true;
        child.stdin.write('n\n');
      }
      if (stdout.includes('Opsætningen er gennemført.')) child.stdin.end();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
  return { ...result, calls: readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean) };
}

test('default interactive setup only requests app and session secrets', async () => {
  const result = await runSetup();
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(result.calls).toEqual([
    'exec wrangler secret put APP_ACCESS_KEY --config worker/wrangler.toml',
    'exec wrangler secret put SESSION_SIGNING_KEY --config worker/wrangler.toml',
  ]);
  expect(result.stdout).not.toContain('OPENAI_API_KEY');
});

test('cover AI secret is requested through explicit setup opt-in', async () => {
  const result = await runSetup(['--with-cover-ai']);
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(result.calls).toContain(
    'exec wrangler secret put OPENAI_API_KEY --config worker/wrangler.toml',
  );
});
