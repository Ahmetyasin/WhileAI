# Permission Justifications

One justification per manifest entry, prepared before store review asks for it.

WhileAI does two things: it **measures** how long you wait for AI answers, and
it **broadcasts** one prompt to the AI sites you are already signed in to. The
broadcast half is why this extension needs more than the measurement half did.

## `storage`

Persists settings, daily summaries, open-turn state and the broadcast queue in
`chrome.storage.local`; volatile tab/window ids in `chrome.storage.session`.
Raw turn records live in IndexedDB (no permission needed). Without this,
nothing survives a restart — and an MV3 service worker restarts constantly.

## `alarms`

Periodic jobs: sweep "open turn" records whose tab died (once a minute), fetch
the updated selector-config JSON (daily), prune records past the retention
period (daily), and re-check the broadcast queue for timed-out or newly
startable runs. MV3 service workers sleep, so timers must be alarms.

## `tabs`

Broadcast delivers your prompt to each provider **in its own tab**. This
permission is used to open or reuse one tab per provider, to tell whether a
tab still exists before sending it anything, and to bring a tab to the front
when it needs you — for example when a provider has signed you out or is
showing a verification check.

It is not used to read your browsing history or to look at pages other than
the AI providers you have switched on.

Earlier versions of this document said the extension used no `tabs`
permission. That was true of the measurement-only releases (≤ 0.4.0) and
stopped being true in 0.5.0, when broadcasting was added.

## `scripting`

One narrow use: Chrome's Memory Saver silently discards background tabs, which
kills the content script inside them. Before sending a command, the extension
pings the tab; if nothing answers, it re-injects **its own bundled script**
(`broadcast.js`) so the prompt can still be delivered.

No remote code is ever fetched or executed (MV3 forbids it, and so do we).

## `sidePanel`

Hosts the broadcast UI: the prompt box, the provider switches and the queue.

## `webNavigation`

AI chat sites are single-page apps: switching conversations changes the URL
without reloading the page, so a content script cannot tell on its own that
its view has changed. This permission is used only to notice those in-page
navigations on the supported provider sites and re-check the page state.

## `notifications`

Used to tell you a provider signed you out, is showing a verification check,
timed out, or failed — states that need you to act, and that you would
otherwise only discover by checking each tab yourself.

Granted at install rather than on demand. As an optional permission it was
never actually requested in practice, so these alerts were silently dropped
and failures went unseen. You can still switch the alerts off in the popup;
the permission being present is what makes the switch mean something.

Nothing is sent on success, and no notification ever contains your prompt or
an AI's answer — only which provider needs attention and why.

## `host_permissions`: chatgpt.com, claude.ai, www.perplexity.ai

The platforms supported out of the box. Content scripts observe response
start/end signals and, when broadcasting is on, place your prompt into the
composer and click send. Response streaming is observed via an in-page `fetch`
wrapper that counts bytes and never decodes content.

## `optional_host_permissions`: gemini.google.com, chat.deepseek.com

Additional broadcast targets. These are **not** granted at install: the
extension asks for a site only when you switch that provider on, and you can
revoke it at any time.

## What is deliberately absent

- No `<all_urls>` — the extension can only see the provider sites you enable.
- No `webRequest` — network activity is observed in-page, not intercepted.
- No `cookies`, no `identity` — WhileAI never sees or stores your credentials
  and never signs you in. You sign in yourself, in your own browser.
- No remote code, no analytics, no server. Nothing leaves your machine.
