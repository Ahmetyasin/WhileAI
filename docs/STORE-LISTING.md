# Chrome Web Store listing — copy and answers

Everything the submission form asks for, written out. Two things shape the
wording, and both come from current policy rather than taste:

1. **There is no paywall at launch**, so the disclosure rule about paid
   functionality does not apply yet. If that changes, the price has to appear
   in the description a user reads BEFORE installing — the most common
   complaint on paid extensions is "paid-only, not disclosed before install".
2. **Since August 2026 the store prohibits extensions "designed to circumvent
   safety guardrails, usage restrictions, or other protective measures
   implemented by AI-powered services."** whileAI does not do that — but it
   automates five AI sites, so it *looks* like something that might, and a
   reviewer skimming will see "automates ChatGPT". The description and the
   permission justifications below say plainly what it does and does not do.

---

## Name

    WhileAI — Ask Every AI, Track Your Wait

This is what is live on the store, and it is what `src/manifest.json` says.
The two must agree: the name comes from the package, so changing it means
uploading a new zip and going through review again. It is not one of the
listing fields you can edit without review.

39 of the 75 characters allowed.

## Short description and detailed description

**Moved to `docs/STORE-COPY.md`**, rewritten 2026-09-12. The version that was
here read as machine-written: a dash standing in for punctuation in every
other sentence, and abstract where it could have been concrete. Paste from
STORE-COPY.md, not from here.

## Category

Productivity

## Single purpose

Send one prompt to the AI chat services you are signed into, and measure how
long their answers take.

## Permission justifications

Copy each into the matching box. Say what it is FOR, in one breath.

**storage** — Remembers which AIs you picked, your settings, and your answer
timings. All of it stays on your machine.

**alarms** — Wakes the extension to check whether an answer has finished. The
service worker is stopped by Chrome when idle, so without an alarm a long
answer would never be timed.

**notifications** — Tells you when an AI needs you: signed out, hit a usage
limit, or showing a verification check. Without it a prompt could fail
silently while you are looking at another tab.

**tabs** — Finds the tab for each AI you picked so the prompt goes to the one
you are already using, rather than opening a duplicate. Reads only the URL, to
tell one AI's tab from another's.

**scripting** — Re-inserts the extension's own script into an AI tab after the
page navigates or Chrome discards it. Without it the extension silently stops
working in tabs you left open.

**webNavigation** — These sites are single-page apps: switching conversations
changes the URL without reloading. This tells the extension the page it is
watching has changed, so it re-checks state.

**tabGroups** — Puts the AI tabs it opens into one named group, so you can see
at a glance which tabs are the extension's and close them together.

**Host permissions (chatgpt.com, claude.ai, perplexity.ai, gemini.google.com,
chat.deepseek.com)** — The five AI sites the extension works with. On each it
reads the message box and the newest message so it can copy your prompt across
and time the reply, and clicks send on the sites you chose. It runs on no
other site.

## Data usage disclosure

Tick **Website content**, and explain:

> whileAI reads the text of the prompt you type and whether a reply is still
> arriving, on the five AI sites it supports. The prompt text is held only
> while it is being delivered to the other AIs you chose, then deleted.
> Keeping a history is off by default. None of it is transmitted anywhere:
> there is no account and no server that receives it.

Certify all three Limited Use statements — they are all true:
- Data use is limited to the single purpose above
- Data is not sold or transferred to third parties
- Data is not used for creditworthiness or lending

## Remote code

**No.** All logic ships in the package. The extension downloads a JSON file of
CSS selectors so it can keep working when a site changes its markup; that is
data, not code, and it is never executed.

## Assets

All built and in `store-assets/`. Regenerate the five screenshots with:

    node scripts/make-store-shots.mjs

**The store takes a MAXIMUM OF 5 screenshots**, 1280×800, 24-bit PNG with no
alpha. Upload in this order:

| # | File | What it shows |
|---|---|---|
| 1 | `screenshot-1-fanout.png` | The one thing no screenshot can show: a prompt leaving one AI for four others |
| 2 | `screenshot-2-proof.png` | The five real panes from the recorded run. The only image that proves the claim |
| 3 | `screenshot-3-panel.png` | The panel, five AIs listed "ready" |
| 4 | `screenshot-4-dashboard.png` | Totals and the per-day chart |
| 5 | `screenshot-5-metrics.png` | Per-AI table and attention metrics, stacked |

| Other asset | Size | Notes |
|---|---|---|
| `store-icon-128.png` | 128×128 | 96×96 of art, 16px transparent padding |
| `promo-small-440x280.png` | 440×280 | Listings without one rank below listings with one |
| `promo-marquee-1400x560.png` | 1400×560 | Only needed to be eligible for featuring |

**Promotional video** takes a YouTube URL, not a file — there is no upload.
`store-assets/demo.mp4` (1920×1080, 29s) exists to be uploaded to YouTube
first if you want to fill that field. It is optional; the listing is complete
without it.

### How they are built

Each frame is an HTML page (`scripts/shots/frames.mjs`, styled by
`scripts/shots/theme.css`) rendered by headless Chrome at deviceScaleFactor 2
and downsampled once to 1280x800. Real font rendering is why they no longer
look generated. The pieces embedded in them are only ever cropped, never
enlarged: the dashboard was captured at 4 device px per CSS px and the
provider panes at 2x. Do not resize a piece before placing it; resampling
twice is what made the old set mushy.

`node scripts/make-site-images.mjs` builds the same pieces WITHOUT the
marketing frame, for ahmetaytar.com. The site has its own headlines in HTML,
so reusing the store frames there printed every claim twice.

## Before submitting

- [x] Privacy policy live at https://ahmetaytar.com/whileai/privacy
      — paste that into the Privacy tab's "Privacy policy URL" field
- [x] Declared **non-trader** — the right answer while nothing is being sold.
      **But non-trader does NOT hide your contact details.** Checked
      2026-09-12: the live listing still shows the account's postal address
      and email under "Developer", next to the "Non-trader" label, rendered
      and visible (viewed from Turkey; the EEA view was not tested). The
      earlier note here said non-trader keeps them off the page; that was
      wrong. Which dashboard setting feeds them is not confirmed yet — see
      CLAUDE.md §0 for the follow-up.

Do NOT put the site URL in the description. Store descriptions are plain
text, so a URL there renders as characters nobody can click. The clickable
links come from the dashboard fields instead (Homepage, Support, Privacy
policy) and the values are listed in `docs/STORE-COPY.md`.

Not needed while the extension is free — but the moment a price appears, all
three of these do:

- [ ] Terms of sale published, with a refund policy
- [ ] Seller name in the description ("Sold by X, not by Google")
- [ ] Trader status — switching back to trader republishes those contact
      details, so decide on a business address before flipping it, not after
