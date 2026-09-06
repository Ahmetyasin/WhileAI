// Same minimal CDP client, pointed at a chosen port.
export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return (await res.json()).filter((t) => t.type === 'page');
}
export function evaluate(target, expression, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('timeout')); }, timeoutMs);
    ws.addEventListener('open', () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true },
    })));
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== 1) return;
      clearTimeout(timer); try { ws.close(); } catch {}
      if (m.error) return reject(new Error(JSON.stringify(m.error)));
      if (m.result?.exceptionDetails) return reject(new Error(m.result.exceptionDetails.exception?.description ?? 'threw'));
      resolve(m.result?.result?.value);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('socket error')); });
  });
}
