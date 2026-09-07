# Testing whileAI as a real extension

Everything below is done by hand in a normal Chrome. It takes about five
minutes and covers all three capabilities.

## 1. Build

```bash
npm run build
```

That produces `dist/`. Rebuild after any code change.

## 2. Load it

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Choose the `dist/` folder

The card should read **WhileAI — Ask Every AI, Track Your Wait**, version
0.6.0, with no "Errors" button. After each rebuild, click the card's **reload**
(↻) icon.

## 3. Sign in

Open and sign in to whichever providers you want to test:
ChatGPT, Claude, Gemini, Perplexity, DeepSeek. The extension never handles
credentials — it only uses sessions you have already signed in to.

## 4. Open the side panel

Click the whileAI toolbar icon. You should see the prompt box, five provider
chips, Settings, and Queue.

## 5. Capability 1 — multi-AI broadcast

1. Tick the providers you signed in to. **Gemini and DeepSeek ask for site
   access** the first time (their host permissions are optional) — accept the
   Chrome prompt. The other three are granted at install.
2. Type a short prompt and click **Send to all**.
3. The panel says: *"Sent. Answers open in a separate whileAI window — your own
   tabs are not touched."*
4. Click **Show answers** to bring that window forward.

**What to check:** each provider received the prompt **once**, in the
extension's own window. Your original tabs stay untouched — that is deliberate
(§5.20): broadcasting types and presses send, so adopting a tab you are already
using would inject a prompt into your conversation.

Optional: in Settings, tick **Label the answer tabs "whileAI"** to group them
into a blue tab group so they are easy to tell apart from your own tabs.

### Where answers go

| | |
|---|---|
| Your tabs | never touched |
| Answers | a separate whileAI window, opened unfocused so it does not steal focus |
| Reuse | one tab per provider, reused for later prompts |

## 6. Capability 2 — the prompt queue

1. Send a prompt, then **immediately** send a second without waiting.
2. The second shows *"waiting its turn"* per provider.
3. As each provider finishes, its next prompt goes automatically.

Try the controls on a queued item: **↑ / ↓** reorder, **Edit** (only before it
starts), **Cancel**, **Copy**. At the top of the queue: **Cancel all** and
**Clear finished**.

## 7. Capability 3 — the dashboard

Click **dashboard** at the top right of the panel. You should see time spent
waiting (both the per-provider sum and real elapsed time), response counts,
median and p90, a per-provider table, a 7-day chart, and export to JSON/CSV.

## 8. Worth testing before you ship

- **Kill the service worker.** On `chrome://extensions`, click the card's
  "service worker" link, then close it — or use `chrome://serviceworker-internals`.
  A queued run must survive and continue.
- **Sign out** of one provider and send. Expect a "you are signed out" banner,
  not a silent failure; sign back in and the run should continue by itself.
- **A long prompt** (a few thousand characters, with a code block) must arrive
  intact and unsplit.
- **Close the whileAI window** mid-run. The next prompt should open a fresh one.

## 9. If something looks wrong

- The panel shows a red **"needs an update"** chip when a provider's selectors
  stop matching — it never fails silently.
- Every failure offers **Copy**, so you can paste the prompt by hand.
- For a deeper look, `npm run live:check` inspects each provider's page without
  sending anything.
