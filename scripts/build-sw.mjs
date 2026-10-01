import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function files(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(`${folder}/${entry.name}`) : `${folder}/${entry.name}`,
      ),
    )
  ).flat();
}
const paths = (await files('dist'))
  .filter((path) => !path.endsWith('service-worker.js') && !path.endsWith('sw.js'))
  .sort();
const hash = createHash('sha256');
for (const path of paths) hash.update(await readFile(path));
const version = hash.digest('hex').slice(0, 16);
const assets = paths.map((path) => '/min-filmsamling/' + path.slice(5));
const source = await readFile('public/service-worker.js', 'utf8');
await writeFile(
  'dist/sw.js',
  source.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets)),
);
await unlink('dist/service-worker.js');
console.log(`Service worker ${version}: ${assets.length} lokale filer; ingen API-cache.`);
