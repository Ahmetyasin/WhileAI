// Build: esbuild bundles + static copies. `--dev` adds localhost test-harness
// matches to the manifest; `--zip` produces dist/chrome.zip and dist/edge.zip.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const isDev = process.argv.includes('--dev');
const doZip = process.argv.includes('--zip');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const entries = [
  { in: 'src/background/index.ts', out: 'background.js', format: 'esm' },
  { in: 'src/content/index.ts', out: 'content.js', format: 'iife' },
  { in: 'src/adapters/chatgpt/main-world.ts', out: 'main-world-chatgpt.js', format: 'iife' },
  { in: 'src/adapters/claude/main-world.ts', out: 'main-world-claude.js', format: 'iife' },
  { in: 'src/adapters/perplexity/main-world.ts', out: 'main-world-perplexity.js', format: 'iife' },
  { in: 'src/adapters/deepseek/main-world.ts', out: 'main-world-deepseek.js', format: 'iife' },
  { in: 'src/ui/popup/popup.ts', out: 'popup.js', format: 'iife' },
  { in: 'src/ui/dashboard/dashboard.ts', out: 'dashboard.js', format: 'iife' },
];

for (const e of entries) {
  await build({
    entryPoints: [join(root, e.in)],
    outfile: join(dist, e.out),
    bundle: true,
    format: e.format,
    target: 'chrome120',
    minify: !isDev,
    sourcemap: isDev ? 'inline' : false,
  });
}

// Static assets
cpSync(join(root, 'src/ui/popup/popup.html'), join(dist, 'popup.html'));
cpSync(join(root, 'src/ui/dashboard/dashboard.html'), join(dist, 'dashboard.html'));
cpSync(join(root, 'src/ui/theme.css'), join(dist, 'theme.css'));
if (!existsSync(join(root, 'public/icons/icon128.png'))) {
  execSync('node scripts/gen-icons.mjs', { cwd: root, stdio: 'inherit' });
}
cpSync(join(root, 'public/icons'), join(dist, 'icons'), { recursive: true });

// Manifest (patched per target)
const manifest = JSON.parse(readFileSync(join(root, 'src/manifest.json'), 'utf8'));
if (isDev) {
  const devMatches = ['http://localhost:4173/*', 'http://127.0.0.1:4173/*'];
  manifest.name += ' (dev)';
  manifest.host_permissions.push(...devMatches);
  manifest.content_scripts[0].matches.push(...devMatches);
  manifest.content_scripts[1].matches.push(...devMatches); // chatgpt main-world drives the mock
}
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Built ${isDev ? 'dev' : 'production'} bundle → dist/`);

if (doZip && !isDev) {
  // Chrome and Edge accept the same MV3 package (spec §12.1); Edge zip kept
  // separate so store-specific fields can diverge later. Zips land in
  // release/ so later builds (which wipe dist/) don't destroy them.
  const release = join(root, 'release');
  mkdirSync(release, { recursive: true });
  for (const target of ['chrome', 'edge']) {
    const zipPath = join(release, `${target}.zip`);
    rmSync(zipPath, { force: true });
    execSync(`cd "${dist}" && zip -qr "${zipPath}" .`, { stdio: 'inherit', shell: '/bin/zsh' });
    console.log(`→ ${zipPath}`);
  }
}
