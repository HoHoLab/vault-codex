import assert from 'node:assert/strict';
import {readFile, stat, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Script} from 'node:vm';

export const pluginAssets = ['main.js', 'manifest.json', 'styles.css'];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function validateRelease({root = process.cwd(), tag} = {}) {
  const json = async file => JSON.parse(await readFile(resolve(root, file), 'utf8'));
  const [manifest, pkg, lock, versions] = await Promise.all([
    json('manifest.json'), json('package.json'), json('package-lock.json'), json('versions.json'),
  ]);
  assert.match(manifest.id, /^[a-z-]+$/, 'Plugin ID must use lowercase letters and hyphens.');
  assert.ok(!manifest.id.includes('obsidian') && !manifest.id.endsWith('plugin'), 'Plugin ID contains a forbidden term.');
  assert.ok(typeof manifest.name === 'string' && manifest.name.trim(), 'Plugin name is required.');
  assert.match(manifest.name, /^[A-Za-z0-9 +()-]+$/, 'Plugin name must use Basic Latin characters and supported punctuation.');
  assert.ok(!/obsidian|obsi-|sidian|\bplugin\b/i.test(manifest.name), 'Plugin name contains a forbidden term.');
  assert.match(manifest.version, versionPattern, 'Plugin version must be x.y.z without a prefix or prerelease suffix.');
  assert.match(manifest.minAppVersion, versionPattern, 'Minimum app version must be x.y.z.');
  assert.equal(manifest.isDesktopOnly, true, 'This plugin requires desktop-only Node.js APIs.');
  assert.ok(typeof manifest.author === 'string' && manifest.author.trim(), 'Author is required.');
  assert.ok(typeof manifest.description === 'string' && manifest.description.length > 0 && manifest.description.length <= 250 && manifest.description.endsWith('.'), 'Description must contain 1–250 characters and end with a period.');
  assert.equal(pkg.name, manifest.id, 'Package name must match the plugin ID.');
  assert.equal(pkg.version, manifest.version, 'Package and manifest versions differ.');
  assert.equal(pkg.license, 'MIT', 'Package metadata must declare the included MIT license.');
  assert.equal(lock.name, pkg.name, 'Lockfile name differs from package.json.');
  assert.equal(lock.version, pkg.version, 'Lockfile version differs from package.json.');
  assert.equal(lock.packages?.['']?.name, pkg.name, 'Lockfile root package name differs.');
  assert.equal(lock.packages?.['']?.version, pkg.version, 'Lockfile root package version differs.');
  assert.equal(lock.packages?.['']?.license, pkg.license, 'Lockfile license differs.');
  for (const [version, minimum] of Object.entries(versions)) {
    assert.match(version, versionPattern, 'Invalid version in versions.json.');
    assert.match(minimum, versionPattern, 'Invalid minimum app version in versions.json.');
  }
  assert.equal(versions[manifest.version], manifest.minAppVersion, 'versions.json must map this release to its minimum app version.');
  if (tag !== undefined) assert.equal(tag, manifest.version, 'Git tag must exactly match manifest.version, without a v prefix.');

  for (const file of [...pluginAssets, 'LICENSE', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'RELEASING.md', `releases/${manifest.version}.md`]) {
    const info = await stat(resolve(root, file));
    assert.ok(info.isFile() && info.size > 0, `Missing or empty release file: ${file}`);
  }
  const license = await readFile(resolve(root, 'LICENSE'), 'utf8');
  assert.ok(license.startsWith('MIT License\n') && license.includes('Permission is hereby granted'), 'LICENSE must contain the MIT license text.');
  const bundle = await readFile(resolve(root, 'main.js'), 'utf8');
  new Script(bundle, {filename: 'main.js'});
  assert.ok(!bundle.includes('sourceMappingURL='), 'Release bundle must not include a development source map.');
  assert.ok(!bundle.includes('Codex for Obsidian'), 'Release bundle still contains the old display name.');
  const builtAt = (await stat(resolve(root, 'main.js'))).mtimeMs;
  const checkFreshness = async directory => {
    for (const entry of await readdir(resolve(root, directory), {withFileTypes: true})) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await checkFreshness(file);
      else if (/\.(ts|json)$/.test(entry.name)) {
        assert.ok((await stat(resolve(root, file))).mtimeMs <= builtAt, `Source changed after the build: ${file}. Run npm run build again.`);
      }
    }
  };
  await checkFreshness('src');
  assert.ok((await stat(resolve(root, 'manifest.json'))).mtimeMs <= builtAt, 'Manifest changed after the build. Run npm run build again.');
  console.log(`Release files validated: ${manifest.name} ${manifest.version} (${manifest.id})`);
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--tag'), 'Usage: node scripts/check-release.mjs [--tag x.y.z]');
  await validateRelease({tag: args[1]});
}
