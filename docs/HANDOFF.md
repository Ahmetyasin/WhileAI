# WhileAI — session handoff

Written 2026-09-05, end of the session that added the broadcast half and tested
it against live signed-in accounts. Read this first in a new session; it holds
the things that are **not** obvious from the code or `git log`.

**Updated 2026-09-06** — see §9 at the bottom for what changed since. Three
items in §7 below are now stale; §9 says which.

---

## 1. Where the project stands

`whileai/` is a working MV3 extension at **v0.5.0** with two halves:

- **Tracking** (shipped since 0.4.0): measures how long you wait for AI answers
  and whether you stayed on the tab.
- **Broadcast** (added this session): one prompt goes to every provider you are
  signed in to, with a per-provider queue.

**160 tests pass**, typecheck clean, production bundle 132K, `release/chrome.zip`
built. 20 commits since the pre-broadcast baseline (`7bee2c9`).

Read `../CLAUDE.md` for the product spec. Its §16 decision log records why this
repo does **not** use WXT / Preact / zod / idb even though §2 and §10 call for
them — the repo already existed and rewriting it would have bought nothing.

---

## 2. Live test results (2026-09-05, real signed-in accounts)

| Provider | Selectors | Single prompt | 2nd prompt while 1st ran | Notes |
|---|---|---|---|---|
| ChatGPT | PASS | 4.5s | ✓ | `#prompt-textarea`, `[data-testid="send-button"]` |
| Gemini | PASS | 12.6s | ✓ | UI renders **Turkish** for this user |
| DeepSeek | PASS | answered | ✓ | streams over **XHR**, not fetch |
| Perplexity | PASS (selectors) | not tested | not tested | signed out at test time |
| Claude | untested | not tested | not tested | signed out at test time |

**One prompt reached all three working providers and each accepted the next
prompt the moment its own answer finished** — the core promise, verified live.

### Bugs live testing found (all fixed, all re-verified)

1. **DeepSeek was completely invisible.** It posts its completion over
   `XMLHttpRequest`, and the MAIN-world interceptor only wrapped `fetch`. No
   network signal at all. Fixed in `src/adapters/mainWorldCore.ts`.
2. **Gemini reported "always generating".** `.model-response-text` wraps every
   *finished* answer (3 present on an idle page), so its lane never freed and a
   queued second prompt was never delivered. Now keyed on the stop icon.
3. **Gemini's send button was unreachable** because aria-labels are localized.
   Now keyed on `mat-icon[fonticon="arrow_upward"]`, which is not translated.
4. **DeepSeek's controls** are unlabelled `div[role="button"]` — keyed on the
   component class `.ds-button--primary`.
5. **Challenge detection missed "Human Verification"** (DeepSeek's wall title).

---

## 3. The Cloudflare finding — important, and easy to misread

Claude and Perplexity showed "Just a moment..." walls **only in the automated
browser**. The cause was identified precisely:

| Browser | `navigator.webdriver` | Result |
|---|---|---|
| Playwright/CDP-launched | `true` | Cloudflare wall |
| Normal Chrome, same profile | `false` | **no wall** |

**This is a testing artifact, not a product defect.** Real users run normal
Chrome where the flag is false.

**Do not "fix" it by hiding `navigator.webdriver`.** That is the
fingerprint-spoofing CLAUDE.md §5.18 forbids, it risks the user's accounts, and
Web Store review treats evasion as grounds for removal. The user was told this
and agreed.

What *was* verified: the shipped challenge detection correctly recognises a
real Cloudflare page, stops the run, and reports it — it does not retry into a
block (§5.17).

---

## 4. How to run a live test (the workflow the user agreed to)

The user asked twice not to have extra browser windows opened. **One window,
they log in, scripts attach to it.**

```bash
npm run session          # ONE window on .pw-profile, CDP port 9333
                         # leave running; user signs in by hand
node scripts/probe.mjs   # selector health on the open tabs
node scripts/broadcast-live.mjs "prompt"   # one prompt -> all providers
node scripts/queue-live.mjs                # 2nd prompt without waiting
node scripts/verify-signals.mjs deepseek   # MAIN-world signals for one provider
```

Two traps that cost real time this session:

- **Playwright's `connectOverCDP` hangs** against this already-running Chrome.
  Use the raw CDP client in `scripts/cdp.mjs` instead.
- **Chrome 152 ignores `--load-extension`** under automation *and* from a plain
  command line (verified with a minimal two-line extension). To test the
  extension itself, a human must load `dist/` once via `chrome://extensions`.
  The adapter scripts above do not need it — they exercise the same selector
  and insertion logic the extension ships.

For Cloudflare-protected providers, use a **normal** Chrome (no automation
flags) with `--remote-debugging-port=9334` and `scripts/cdp2.mjs` /
`scripts/probe2.mjs`.

---

## 5. Architecture, in one screen

```
service worker (background/index.ts)
  ├── tracking half   — unchanged from 0.4.0, do not regress it
  └── broadcast half  — behind FEATURES.broadcastEnabled
        ├── core/queue.ts        PURE reducer: all scheduling policy, no chrome.*
        ├── core/orchestrator.ts side effects: executes reducer commands
        ├── core/tabs.ts         tab lifecycle, PING + re-inject on discard
        └── core/adapterHealth.ts self-healing config refresh

content scripts (two, deliberately separate)
  ├── content.js    tracking, document_start, must beat the page's own fetch
  └── broadcast.js  broadcast, document_idle, must not race the SPA render
```

**The security boundary that matters:** `PlatformAdapter` (tracking) is pure
observation. `BroadcastAdapter` *composes* it and adds the mutating methods.
The tracking content script must never gain the ability to type or submit.
Keep them separate.

`core/queue.ts` takes `now` as a parameter and touches no `chrome.*`, so the
entire scheduling policy is testable without a browser. Keep it that way.

---

## 6. Selectors live in TWO hand-maintained copies

`src/core/config.ts` (`EMBEDDED_CONFIG`, the shipped fallback) and
`config/selectors.json` (served remotely). A fresh install runs on the embedded
one, so editing only the JSON changes nothing for new users.

```bash
# edit src/core/config.ts, BUMP version, then:
npm run sync:selectors   # regenerates config/selectors.json
npm test                 # a test fails if they drift
```

Remote config only wins when its version is **higher**. `refreshRemoteConfig()`
refuses older versions, configs missing a known platform, and malformed JSON.
Full process in `docs/REMOTE-UPDATES.md`.

---

## 7. What is NOT done

- **Claude and Perplexity delivery is unverified on live accounts.** Selectors
  probe clean for Perplexity; Claude's composer was never reached (signed out).
  This is the top remaining gap.
- **Payment / monetization** — not started. `core/features.ts` has the flags
  (`maxProviders`, `queueDepth`, `historyDays`) but everything is unlimited and
  there is no payment code. The user wants this after functionality is solid.
- **Store submission** — `PERMISSIONS.md` and `PRIVACY.md` are rewritten and
  honest (the `tabs` permission and prompt-text storage are both disclosed),
  but nothing has been submitted.
- **`whileai-demo.json` is committed by accident** (204K of generated fixture
  data). `.gitignore` still lists the pre-rename `dwell-demo.json`.
- **Open code-review findings** from this session that were identified but not
  all fixed — re-run a review pass. The confirmed ones were: a `needs_login`
  run never recovering after the user signs back in (§5.16 requires it to
  resume), and `INSERT_AND_SUBMIT` replies being discarded by the orchestrator
  so a failed insert hangs until timeout instead of failing fast.

---

## 8. Working agreements with this user

- **Never open extra browser windows.** One session window, they log in.
- **Never ask for passwords or 2FA codes**, and never enter them.
- **Never bypass CAPTCHAs or verification walls**, and never spoof automation
  fingerprints — say so plainly rather than routing around it.
- They test on **real paid accounts**; every live prompt costs real quota.
- They want honesty about what was and was not verified. Several times this
  session the useful answer was "that was my testing method, not your product".


---

## 9. Session of 2026-09-06

Desk work only — no live browser session was running, so nothing here is a
live verification. **162 tests pass**, typecheck clean, bundle builds.

### Corrections to §7 above

- **The two "open code-review findings" were already fixed** in the previous
  session; §7 undersold it. `needs_login` recovery lives in `core/queue.ts`
  (the `ready` case re-queues parked runs) and the discarded `INSERT_AND_SUBMIT`
  reply is handled by `applyInsertReply()` in `core/orchestrator.ts`. Both are
  covered by tests. No action needed.
- **`whileai-demo.json` was never actually tracked by git.** It was already
  ignored. Only the stale `dwell-demo.json` ignore line existed; removed.

### Fixed: Claude would have typed into the wrong box

`EMBEDDED_CONFIG.platforms.claude.composerSelectors` listed bare
`div[contenteditable="true"]` **first**. The composer picker takes the first
*visible* match in document order, and claude.ai renders other contenteditable
regions (artifact surfaces, renamable titles) — so the prompt could land in one
of those instead of the chat box. A regression test (`broadcastAdapter.test.ts`,
"claude composer targeting") reproduces it against the real shipped config: it
returned `artifact-surface`. Now anchored on `div.ProseMirror[contenteditable]`,
as CLAUDE.md §4 specified all along.

Claude's send button was keyed only on **English** aria-labels. This user's
Gemini UI renders Turkish, and that same localization trap already broke
Gemini's send control once (§2.3). `[data-testid="send-button"]` and the
fieldset submit button now come first.

`EMBEDDED_CONFIG` bumped to **version 7**; `config/selectors.json` regenerated.
Remember §6: both copies are hand-maintained and a test fails if they drift.

Perplexity was checked for the same flaw and is fine — `#ask-input` already
came first. A guard test now pins that ordering.

### Still the top gap: Claude / Perplexity live delivery

Unchanged from §7, and the Claude fix above **raises** its priority: the old
selector was wrong in a way that only a live signed-in page reveals, and the
new one is reasoned from CLAUDE.md rather than observed on the real DOM. It
needs the workflow in §4 — the user starts `npm run session`, signs in by hand,
then `node scripts/probe.mjs` and `node scripts/broadcast-live.mjs`.

Worth checking on that live page, specifically:
- Does `div.ProseMirror[contenteditable="true"]` match the real composer?
- Are there in fact other contenteditable regions ahead of it in the DOM?
- Does the send control expose `data-testid="send-button"`, or only a
  localized aria-label?

Then update `lastVerified` thinking in `src/core/config.ts` comments to say it
was observed, not inferred — right now the Claude comment is reasoning, and the
distinction matters (§8: honesty about what was verified).
