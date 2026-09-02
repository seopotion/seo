// design-sync build for apps/web/components/ui. The web app has no library
// build, so this emits the three things the converter needs into
// .design-sync/pkg/dist/ (gitignored, regenerated on every sync):
//   dist/index.js                 ESM entry bundled from the ui barrel (esbuild,
//                                 bare deps external - the converter bundles them)
//   dist/components/ui/*.d.ts     declarations (tsc --emitDeclarationOnly)
//   dist/styles.css               globals.css compiled by the app's own Tailwind
//                                 v4, plus the safelist in .design-sync/tailwind.css
// Run from the repo root: node .design-sync/build.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const web = join(root, 'apps/web');
const entry = join(web, 'components/ui/index.ts');
const dist = join(here, 'pkg/dist');
const bin = (n) => join(root, 'node_modules/.bin', n);

rmSync(dist, { force: true, recursive: true });
mkdirSync(dist, { recursive: true });

execFileSync(
  bin('tsc'),
  [
    entry, '--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--outDir', dist, '--rootDir', web,
    '--jsx', 'react-jsx', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'esnext',
    '--strict', '--skipLibCheck', '--esModuleInterop', '--isolatedModules', '--verbatimModuleSyntax',
  ],
  { stdio: 'inherit' },
);

execFileSync(
  bin('esbuild'),
  [entry, '--bundle', '--format=esm', '--packages=external', '--jsx=automatic', `--outfile=${join(dist, 'index.js')}`],
  { stdio: 'inherit' },
);

const cssIn = join(here, 'tailwind.css');
const cssOut = join(dist, 'styles.css');
const result = await postcss([tailwind({ base: web })]).process(readFileSync(cssIn, 'utf8'), { from: cssIn, to: cssOut });
writeFileSync(cssOut, result.css);
console.error(`built ${dist}: index.js, .d.ts tree, styles.css (${(result.css.length / 1024).toFixed(0)} KB)`);
