import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

// WordPress derives the plugin slug from the top-level folder inside the zip,
// so it MUST be `seo-potion`, not the source dir name `wordpress-org`.
const SLUG = 'seo-potion';
const pluginSrc = join(repoRoot, 'apps/integration-clients/wordpress-org');
const outDir = join(repoRoot, 'apps/web/public/downloads');
const outZip = join(outDir, `${SLUG}.zip`);

const EXCLUDE = new Set(['.DS_Store', '.git', 'node_modules', '.idea', 'Thumbs.db']);

const staging = mkdtempSync(join(tmpdir(), 'wp-plugin-'));
const stagedPlugin = join(staging, SLUG);

cpSync(pluginSrc, stagedPlugin, {
  recursive: true,
  filter: (src) => !EXCLUDE.has(basename(src)),
});

mkdirSync(outDir, { recursive: true });
rmSync(outZip, { force: true });

try {
  execFileSync('zip', ['-r', '-X', outZip, SLUG], { cwd: staging, stdio: 'inherit' });
} catch {
  rmSync(staging, { recursive: true, force: true });
  console.error('\nFailed to run `zip`. Ensure the `zip` CLI is installed and on PATH.');
  process.exit(1);
}

rmSync(staging, { recursive: true, force: true });
console.log(`Built ${outZip}`);
