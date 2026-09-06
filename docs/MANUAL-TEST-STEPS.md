# Installing and testing whileAI in your own Chrome

Folder to load:

    /Users/ahmetyasinaytar/Desktop/WhileAI/whileai/dist

Load the **folder**, not `release/chrome.zip` — the zip is only for store
submission.

---

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist` folder above

**Expect:** a card reading *WhileAI — Ask Every AI, Track Your Wait*, version
**0.6.0**, enabled, with **no red "Errors" button**.

If you see an Errors button, stop and send me what it says.

### What it asks for, and why

Granted at install: ChatGPT, Claude, Perplexity.
Asked for later, only when you switch them on: **Gemini, DeepSeek**.
Optional, only if you tick them: notifications, tab labelling.

The extension never sees your passwords. It uses sessions you are already
signed in to.

---

## Test 1 — Broadcast (2 min)

1. Sign in to the AI sites you want to use.
2. Click the **whileAI** toolbar icon. The side panel opens.
3. Tick the providers you signed in to. Gemini and DeepSeek show a Chrome
   permission prompt the first time — **Allow**.
4. Type `Name one animal.` and click **Send to all**.

**Expect:**
- The panel says *"Sent. Answers open in a separate whileAI window — your own
  tabs are not touched."*
- A **Show answers** button appears. Click it: a separate window comes
  forward with one tab per provider.
- Each provider received the prompt **once**.
- Each row in the queue turns green with a time (usually 3–10s).

**Why a separate window:** broadcasting types into the composer and presses
send. Reusing a tab you are already chatting in would inject the prompt into
your conversation, so the extension only ever uses tabs it opened itself.

Optional: in **Settings**, tick *Label the answer tabs "whileAI"* to group them
into a blue tab group.

---

## Test 2 — Queue (2 min)

1. Send a prompt.
2. **Immediately** send a second one without waiting.

**Expect:** the second shows *"waiting its turn"* per provider, then goes
automatically as each provider finishes. Providers move at different speeds and
that is fine — each has its own lane.

On a queued item try: **↑ / ↓** (reorder), **Edit** (only before it starts),
**Cancel**, **Copy**. At the top: **Cancel all**, **Clear finished**.

---

## Test 3 — Dashboard (1 min)

Click **dashboard** (top-right of the panel).

**Expect:** total time spent waiting, response count, median and p90, a
per-provider table, a 7-day chart, and JSON/CSV export.

Two totals are shown deliberately: the **sum** of per-provider waits, and the
**real elapsed** time. They differ because providers run in parallel.

---

## Test 4 — The hard cases

These are the ones I have reasoned about but not exercised by hand. They are
where surprises live.

**a. Service worker death (most important)**
Send a prompt, then immediately: `chrome://extensions` → whileAI card → click
the blue **"service worker"** link → close the DevTools window that opens.
*Expect:* the run survives and still completes.

**b. Signed out**
Sign out of one provider, then send.
*Expect:* a banner saying you are signed out — not a silent failure. Sign back
in; the run should continue by itself.

**c. Long prompt**
Paste a few thousand characters including a code block.
*Expect:* it arrives intact, not split or truncated.

**d. Close the whileAI window mid-run**
*Expect:* the next prompt opens a fresh one instead of erroring.

---

## If something looks wrong

- A red **"needs an update"** chip means a provider's selectors stopped
  matching. It never fails silently.
- Every failure offers **Copy**, so you can paste the prompt by hand.
- Nothing leaves your browser. No server, no analytics.

Tell me what you saw and on which provider — the specifics are what I need.

---

## Removing it

`chrome://extensions` → **Remove**. Your data is local, so it goes with it.
Export from the dashboard first if you want to keep it.
