/**
 * Minimal CDP client over the session window's debugging port.
 *
 * Playwright's connectOverCDP proved unreliable against this already-running
 * Chrome, and the raw protocol is enough: list targets over HTTP, then drive
 * one with Runtime.evaluate over a WebSocket. No new browser, no new tabs.
 */
const PORT = 9333;

export async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return (await res.json()).filter((t) => t.type === 'page');
}

/** Evaluate an async expression in a target and return its JSON value. */
export function evaluate(target, expression, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('CDP evaluate timed out'));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(async () => { ${expression} })()`,
          awaitPromise: true,
          returnByValue: true,
          allowUnsafeEvalBlockedByCSP: true,
        },
      }));
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      const r = msg.result?.result;
      if (msg.result?.exceptionDetails) {
        return reject(new Error(msg.result.exceptionDetails.exception?.description ?? 'page threw'));
      }
      resolve(r?.value);
    });

    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error('CDP socket error: ' + (e.message ?? 'unknown')));
    });
  });
}

/** Find the open tab for a host, without opening anything. */
export async function targetForHost(host) {
  const targets = await listTargets();
  return targets.find((t) => {
    try { return new URL(t.url).hostname.includes(host); } catch { return false; }
  }) ?? null;
}
