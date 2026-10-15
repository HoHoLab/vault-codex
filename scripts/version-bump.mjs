import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';

const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, data) => writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
const [pkg, manifest, versions] = await Promise.all([
  readJson('package.json'), readJson('manifest.json'), readJson('versions.json'),
]);
assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Use a plain x.y.z release version.');
manifest.version = pkg.version;
versions[pkg.version] = manifest.minAppVersion;
await writeJson('manifest.json', manifest);
await writeJson('versions.json', versions);
console.log(`Updated manifest.json and versions.json for ${pkg.version}. Add releases/${pkg.version}.md before packaging.`);
