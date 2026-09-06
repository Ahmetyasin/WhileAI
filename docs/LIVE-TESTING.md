# Live testing Claude and Perplexity

## Why this exists

Claude and Perplexity showed "Just a moment..." Cloudflare walls in earlier
sessions. The cause was pinned down precisely:

| Browser | `navigator.webdriver` | Result |
|---|---|---|
| Launched by Playwright / automation | `true` | Cloudflare wall |
| Chrome you launch yourself | `false` | **no wall** |

So the fix is not to hide the flag — that is fingerprint spoofing, CLAUDE.md
§5.18 forbids it, it risks your accounts, and the Web Store treats evasion as
grounds for removal. The fix is to test in a browser where the flag is
honestly false: **your own Chrome**.

Confirmed 2026-09-06: `webdriver=false`, both sites loaded with no wall.

---

## The workflow

### 1. Start Chrome yourself

One window, opened with a debugging port so the scripts can attach:

```bash
npm run browser
```

That is a normal Chrome. It uses a separate profile (`~/.whileai-chrome`) so
it never touches your everyday browser or its cookies.

### 2. Sign in by hand

In that window, sign in to Claude and Perplexity. **Nothing here ever asks for
or handles your password** — you type it, the scripts only read the page
afterwards.

### 3. Preflight — costs nothing

```bash
npm run live:check
```

Read-only. It sends no prompt and spends no quota. It reports, per provider:

- whether a verification wall is up (and if so, whether automation caused it)
- whether you are signed in
- which composer and send selectors actually match the live DOM
- **how many rival `contenteditable` regions are on the page** — this is the
  exact bug that made Claude type into an artifact surface instead of the chat
  box, so it is called out explicitly

Fix anything it reports before spending a real prompt.

### 4. Send one real prompt

```bash
npm run live:send -- claude perplexity
```

This costs real account quota. It uses the shipped insertion ladder
(execCommand → paste → native setter, §5.8), verifies the site actually
accepted the text before submitting, clicks send rather than synthesising
Enter (§5.10), then measures until generation stops (§5.11). Providers are
paced 3s apart (§5.18).

Custom prompt, single provider:

```bash
npm run live:send -- --prompt "In one sentence: what is a vector?" claude
```

### 5. Read the log

```bash
npm run logs              # summary of the last run
npm run logs -- --all     # every run on disk
npm run logs -- --raw     # raw JSONL
```

Every run is written to `logs/*.jsonl`. Prompt text is **not** logged by
default — only its length and a hash (CLAUDE.md §26). Pass `--log-prompts`
when you are specifically debugging insertion.

`logs/` is gitignored.

---

## What to look for on Claude

The Claude composer selector was fixed on 2026-09-06 by reasoning from
CLAUDE.md §4, **not** by observing the live page. It replaced a bare
`div[contenteditable="true"]` that would bind to whichever editable region came
first in document order. So on the live page, confirm:

- `composer:` reports `div.ProseMirror[contenteditable="true"]` — not one of
  the broader fallbacks further down the list
- the editable-region count: if it says more than one, the anchoring matters
  and the old config would have picked wrong
- `send:` reports `[data-testid="send-button"]`, or whether Claude only exposes
  a localized aria-label (your Gemini renders Turkish, and that already broke
  Gemini's send control once)

Then update the comment in `src/core/config.ts` to say it was **observed**, not
inferred — and bump the version and run `npm run sync:selectors` if anything
changed (§6: the selectors live in two hand-maintained copies).

---

## If a wall does appear

Solve it yourself in the browser, then re-run. The scripts stop and report;
they never retry into a block (§5.17) and never attempt to bypass a CAPTCHA.


---

## Two things live testing proved (2026-09-06)

### Hidden tabs break everything — keep the window visible

Chrome throttles timers and defers rendering in background tabs (CLAUDE.md
§5.6). With both provider tabs `hidden`:

- `setInterval` recorders died after ~700ms
- `MutationObserver` stopped firing entirely
- the stop button never rendered long enough to observe
- **two submitted prompts never arrived at all**

With the tab visible, the same recorder ran 7.9s without interruption. Check
it with `document.visibilityState`.

This is not just a testing constraint — it is why §5.6 requires the Compare
window to stay visible, and users must be told. A minimised or fully occluded
window will silently drop sends.

### A usage wall does not remove the composer

Perplexity's free-search-limit modal appears while `#ask-input` and the Submit
button stay in the DOM. Anything that only asks "is there a composer?" says
yes, sends, and fails with a meaningless error. `npm run live:check` now
reports `QUOTA` and refuses to spend a prompt.

Watch your own quota while testing: a handful of diagnostic prompts is enough
to exhaust a free tier for hours.
