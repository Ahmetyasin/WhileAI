/**
 * MAIN-world fetch interceptor (spec §3.3). Runs inside the page's JS world:
 * no chrome.* APIs here, communication is postMessage only. Never decodes
 * response bodies — only counts bytes.
 */
export function installFetchInterceptor(defaultPatternSources: string[]): void {
  const w = window as Window & { __whileaiInstalled?: boolean };
  if (w.__whileaiInstalled) return;
  w.__whileaiInstalled = true;

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
    const d = ev.data as { __whileai_cfg?: boolean; endpointPatterns?: unknown } | null;
    if (!d || d.__whileai_cfg !== true) return;
    if (Array.isArray(d.endpointPatterns) && d.endpointPatterns.every((p) => typeof p === 'string')) {
      const compiled = compile(d.endpointPatterns as string[]);
      if (compiled.length > 0) patterns = compiled;
    }
  });

  function post(type: string, data: Record<string, unknown> = {}): void {
    window.postMessage({ __whileai: true, type, t: performance.now(), ...data }, '*');
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

  // ---- XMLHttpRequest ----
  // Not every provider streams over fetch: DeepSeek posts its completion over
  // XHR (verified live 2026-09-05), so a fetch-only interceptor sees nothing
  // and the turn never gets a network signal. Only the byte count and the
  // readyState transitions are observed; the body is never decoded (§0.2).
  const OrigXHR = window.XMLHttpRequest;
  if (typeof OrigXHR === 'function') {
    const openKey = Symbol('whileai-open');
    type Tracked = XMLHttpRequest & {
      [openKey]?: { method: string; url: string; matched: boolean; first: boolean };
    };

    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;

    OrigXHR.prototype.open = function (
      this: Tracked,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      const href = typeof url === 'string' ? url : url.href;
      this[openKey] = {
        method: String(method).toUpperCase(),
        url: href,
        matched: false,
        first: true,
      };
      // eslint-disable-next-line prefer-rest-params
      return origOpen.apply(this, [method, url, ...rest] as never);
    };

    OrigXHR.prototype.send = function (this: Tracked, ...args: unknown[]) {
      const meta = this[openKey];
      if (meta && meta.method === 'POST' && patterns.some((p) => p.test(meta.url))) {
        meta.matched = true;
        post('stream:submit');

        this.addEventListener('progress', () => {
          if (meta.first) {
            post('stream:first_token');
            meta.first = false;
          }
        });
        this.addEventListener('load', () => {
          // responseText length is a byte-ish count; the text is never read.
          let bytes = 0;
          try {
            bytes = this.responseType === '' || this.responseType === 'text'
              ? this.responseText.length
              : 0;
          } catch {
            bytes = 0;
          }
          post('stream:end', { bytes });
        });
        this.addEventListener('error', () => post('stream:error'));
        this.addEventListener('abort', () => post('stream:end', { bytes: 0 }));
      }
      return origSend.apply(this, args as never);
    };
  }
}
