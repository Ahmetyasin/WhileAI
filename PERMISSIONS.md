# Permission Justifications

Written per spec §12.3 — one justification per manifest entry, prepared before
review asks for it.

## `storage`

Persists measurement settings, daily summaries, and open-turn state in
`chrome.storage.local`. Raw turn records live in IndexedDB (no permission
needed). Without this, nothing can be remembered between sessions.

## `alarms`

Three periodic jobs: (1) once a minute, sweep "open turn" records whose tab
died so they are marked `orphaned` instead of leaking; (2) once a day, fetch
the updated selector-config JSON; (3) once a day, prune raw records past the
retention period. MV3 service workers sleep, so timers must be alarms.

## `notifications` (optional)

Only requested if the user turns on "notify me when a long response finishes".
Off by default; the permission is not requested at install.

## `host_permissions: chatgpt.com, claude.ai, www.perplexity.ai, chat.deepseek.com`

The supported platforms. Content scripts observe response start/end signals
on these pages only. No broader patterns: no `tabs`, no `webRequest`, no
`<all_urls>` — response streaming is observed via an in-page `fetch` wrapper
that counts bytes and never decodes content.
