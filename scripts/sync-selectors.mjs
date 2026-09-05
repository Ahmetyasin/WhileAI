// Regenerates config/selectors.json from EMBEDDED_CONFIG so the shipped
// fallback and the remotely-served copy cannot drift (a test enforces this).
//   node scripts/sync-selectors.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

// Bundle only the config module, stubbing the chrome wrapper it imports so the
// constant can be read in plain Node.
const out = await build({
  entryPoints: [join(root, 'src/core/config.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  plugins: [
    {
      name: 'stub-browser',
      setup(b) {
        b.onResolve({ filter: /browser$/ }, () => ({ path: 'browser-stub', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const ext = {};',
          loader: 'js',
        }));
      },
    },
  ],
});

const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
);

writeFileSync(
  join(root, 'config/selectors.json'),
  JSON.stringify(mod.EMBEDDED_CONFIG, null, 2) + '\n',
);
console.log(`config/selectors.json synced (version ${mod.EMBEDDED_CONFIG.version})`);
