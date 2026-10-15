import * as esbuild from 'esbuild';
const options = {
  entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian', 'electron'],
  format: 'cjs', platform: 'node', target: 'es2022', outfile: 'main.js',
  sourcemap: 'inline', logLevel: 'info',
};
if (process.argv.includes('--watch')) await (await esbuild.context(options)).watch();
else await esbuild.build({ ...options, sourcemap: false, minify: false });
