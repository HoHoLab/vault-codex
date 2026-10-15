import {mkdir, copyFile, cp, rm, readFile, writeFile, lstat, readdir} from 'node:fs/promises';
import {resolve, join, basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pluginAssets, validateRelease} from './check-release.mjs';

const {id, version} = await validateRelease();
const installRoot = resolve('artifacts/release');
const sourceRoot = resolve('artifacts/source');
const destination = join(installRoot, id);
const source = join(sourceRoot, id);
const release = resolve('artifacts/releases', version);
for (const directory of [destination, source, release]) {
  await rm(directory, {recursive: true, force: true});
  await mkdir(directory, {recursive: true});
}

for (const file of [...pluginAssets, 'LICENSE', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'RELEASING.md']) {
  await copyFile(file, join(destination, file));
}
for (const file of pluginAssets) await copyFile(file, join(release, file));

// Copy an explicit public-source list, never the entire working directory.
const sourceEntries = [
  'src', 'tests', 'scripts', '.github', 'releases', 'manifest.json', 'versions.json',
  'package.json', 'package-lock.json', 'tsconfig.json', 'esbuild.config.mjs', 'styles.css',
  '.gitignore', 'LICENSE', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'RELEASING.md',
];
const privateNames = new Set(['node_modules', 'artifacts', '.git', '.obsidian', 'data.json', 'auth.json', '.DS_Store']);
for (const entry of sourceEntries) {
  await cp(entry, join(source, entry), {
    recursive: true,
    filter: async path => {
      const name = basename(path);
      if (privateNames.has(name) || name.startsWith('.env') || name.endsWith('.log')) return false;
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Source archives must not follow symbolic links: ${path}`);
      return true;
    },
  });
}

const installName = `${id}-${version}.zip`;
const sourceName = `${id}-${version}-source.zip`;
execFileSync('zip', ['-X', '-qr', join(release, installName), id], {cwd: installRoot});
execFileSync('zip', ['-X', '-qr', join(release, sourceName), id], {cwd: sourceRoot});
await copyFile(`releases/${version}.md`, join(release, 'RELEASE_NOTES.md'));
const checksums = [];
for (const file of [...pluginAssets, installName, sourceName]) {
  checksums.push(`${createHash('sha256').update(await readFile(join(release, file))).digest('hex')}  ${file}`);
}
await writeFile(join(release, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
// A concurrent edit must not leave a source archive that differs from this checkout.
const verifySnapshot = async (directory, relative = '') => {
  for (const entry of await readdir(join(directory, relative), {withFileTypes: true})) {
    const file = join(relative, entry.name);
    if (entry.isDirectory()) await verifySnapshot(directory, file);
    else assert.ok((await readFile(join(directory, file))).equals(await readFile(file)), `Source changed during packaging: ${file}. Re-run npm run package.`);
  }
};
await verifySnapshot(source);
await verifySnapshot(destination);
await validateRelease();
console.log(`GitHub release attachments: ${release}`);
console.log(`Installable plugin: ${join(release, installName)}`);
console.log(`Public source: ${join(release, sourceName)}`);
