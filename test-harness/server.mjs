// Local mock of a ChatGPT-like chat app for end-to-end extension testing
// without an account. Serves a page whose DOM mimics chatgpt.com's signals
// (send/stop button, .result-streaming) and streams SSE from
// /backend-api/conversation so the MAIN-world fetch interceptor fires.
//
//   npm run harness   →  http://localhost:4173
//
// Load the dist/ folder built with `npm run build:dev` (adds localhost matches).
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(dirname(here), 'dist');
const PORT = 4173;

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(here, 'mock-chat.html')));
    return;
  }

  // UI previews outside the extension: patched dist pages + chrome shim.
  if (url.pathname === '/dashboard' || url.pathname === '/popup') {
    const page = url.pathname.slice(1);
    const html = readFileSync(join(dist, `${page}.html`), 'utf8').replace(
      `<script src="${page}.js"></script>`,
      `<script src="/chrome-shim.js"></script><script src="/${page}.js"></script>`,
    );
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (url.pathname === '/chrome-shim.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(readFileSync(join(here, 'chrome-shim.js')));
    return;
  }
  // Static files from dist (dashboard.js, theme.css, icons…)
  const distFile = join(dist, url.pathname.slice(1));
  if (url.pathname !== '/' && !url.pathname.includes('..') && existsSync(distFile) && !distFile.endsWith('dist')) {
    const ext = distFile.slice(distFile.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(readFileSync(distFile));
    return;
  }

  if (url.pathname === '/backend-api/conversation' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let ttft = 800;
    let duration = 5000;
    try {
      const parsed = JSON.parse(body);
      ttft = Number(parsed.ttft) || ttft;
      duration = Number(parsed.duration) || duration;
    } catch { /* defaults */ }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });

    const chunks = 20;
    const interval = Math.max(50, (duration - ttft) / chunks);
    await sleep(ttft);
    let aborted = false;
    req.on('close', () => (aborted = true));
    for (let i = 0; i < chunks && !aborted; i++) {
      res.write(`data: {"delta": "token ${i} "}\n\n`);
      await sleep(interval);
    }
    if (!aborted) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

server.listen(PORT, () => {
  console.log(`Dwell test harness → http://localhost:${PORT}`);
  console.log('Build the extension with: npm run build:dev  (adds localhost permissions)');
});
