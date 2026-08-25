/**
 * MAIN-world fetch interceptor (spec §3.3). Runs inside the page's JS world:
 * no chrome.* APIs here, communication is postMessage only. Never decodes
 * response bodies — only counts bytes.
 */
export function installFetchInterceptor(defaultPatternSources: string[]): void {
  const w = window as Window & { __dwellInstalled?: boolean };
  if (w.__dwellInstalled) return;
  w.__dwellInstalled = true;

  let patterns: RegExp[] = compile(defaultPatternSources);

  function compile(sources: string[]): RegExp[] {
    const out: RegExp[] = [];
    for (const s of sources) {
      try {
        out.push(new RegExp(s));
      } catch {
        // ignore broken pattern
      }
    }
    return out;
  }

  // ISOLATED side can push updated endpoint patterns (remote config, spec §3.5).
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const d = ev.data as { __dwell_cfg?: boolean; endpointPatterns?: unknown } | null;
    if (!d || d.__dwell_cfg !== true) return;
    if (Array.isArray(d.endpointPatterns) && d.endpointPatterns.every((p) => typeof p === 'string')) {
      const compiled = compile(d.endpointPatterns as string[]);
      if (compiled.length > 0) patterns = compiled;
    }
  });

  function post(type: string, data: Record<string, unknown> = {}): void {
    window.postMessage({ __dwell: true, type, t: performance.now(), ...data }, '*');
  }

  const origFetch = window.fetch;

  window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    let url = '';
    const first = args[0];
    if (typeof first === 'string') url = first;
    else if (first instanceof URL) url = first.href;
    else if (first && typeof first === 'object' && 'url' in first) url = (first as Request).url;

    const method =
      (args[1]?.method ?? (first instanceof Request ? first.method : 'GET')).toUpperCase();
    const isTarget = method === 'POST' && patterns.some((p) => p.test(url));
    if (!isTarget) return origFetch.apply(this, args);

    post('stream:submit');
    let res: Response;
    try {
      res = await origFetch.apply(this, args);
    } catch (e) {
      post('stream:error');
      throw e;
    }

    if (!res.ok || !res.body) {
      post(res.ok ? 'stream:end' : 'stream:error', { status: res.status });
      return res;
    }

    // Split the body so the page keeps its own stream untouched (spec §3.3).
    let toPage: ReadableStream<Uint8Array>;
    let toObserver: ReadableStream<Uint8Array>;
    try {
      [toPage, toObserver] = res.body.tee();
    } catch {
      post('stream:end');
      return res;
    }
    void observe(toObserver);
    return new Response(toPage, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };

  async function observe(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    let first = true;
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (first) {
          post('stream:first_token');
          first = false;
        }
        bytes += value?.byteLength ?? 0; // count only — NEVER decode (spec §0.2)
      }
    } catch {
      post('stream:error');
    } finally {
      post('stream:end', { bytes });
    }
  }
}
