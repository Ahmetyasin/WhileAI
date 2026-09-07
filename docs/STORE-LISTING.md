# Chrome Web Store listing — copy and answers

Everything the submission form asks for, written out. Two things shape the
wording, and both come from current policy rather than taste:

1. **The paywall must be visible before install.** "If your Product requires
   the user to pay to obtain basic functionality, you must make that clear in
   the description that the user sees when choosing whether to install it."
2. **Since August 2026 the store prohibits extensions "designed to circumvent
   safety guardrails, usage restrictions, or other protective measures
   implemented by AI-powered services."** whileAI does not do that — but it
   automates five AI sites, so it *looks* like something that might, and a
   reviewer skimming will see "automates ChatGPT". The description and the
   permission justifications below say plainly what it does and does not do.

---

## Name

whileAI — ask every AI, and see what waiting costs you

## Short description (132 char max)

Type a prompt in one AI. It goes to the others you picked, in your own
tabs. See how long you actually spend waiting.

## Detailed description

Ask once, get answers from every AI you already pay for.

Type your prompt in ChatGPT, Claude, Perplexity, Gemini or DeepSeek. whileAI
puts the same prompt into the others you chose — in your own tabs, in your own
signed-in sessions — so you can compare answers without typing it five times.

It also times how long you wait. Every answer, every AI, with a dashboard
showing where your waiting actually goes: which AI is slowest, how often you
switch tabs mid-answer, and what that adds up to over a week.

WHAT IT DOES
• One prompt, every AI you pick — ChatGPT, Claude, Perplexity, Gemini, DeepSeek
• Opens them as tabs in one group, never a separate window
• Tells you when an AI needs you: signed out, rate limited, or showing a check
• Times every answer and shows the total on a dashboard you can export

HOW IT BEHAVES
whileAI works only inside sessions you have already signed into yourself. It
types into the message box and clicks send, at human pace, one prompt at a
time per AI. It does not bypass anything: no CAPTCHA solving, no working
around a usage limit, no hidden or background sessions, no pretending to be a
different browser. When a site shows a verification check or says you have hit
a limit, whileAI stops and tells you — that is the whole of its response.

PRIVACY
Your prompts and timings stay in your browser. No account, no analytics, no
telemetry. whileAI never reads the AI's replies — it watches only whether an
answer is still arriving, so it can time it. It never sees your password: you
sign in yourself.

PRICE
Free to install. Response timing and the full dashboard are free, always.
Broadcasting a prompt to the other AIs is free for the first 10 prompts, then
$3.99 once for unlimited use. Sold by [SELLER NAME], not by Google.
Terms and refunds: [TERMS URL]

Not affiliated with OpenAI, Anthropic, Perplexity, Google or DeepSeek.

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

## Assets needed

| Asset | Size | Notes |
|---|---|---|
| Store icon | 128×128 PNG | 96×96 of art, 16px transparent padding |
| Screenshots | 1280×800, 1–5 | The dashboard is the strongest one — lead with it |
| Small promo tile | 440×280 | Listings without one rank below listings with one |
| Marquee tile | 1400×560 | Only needed to be eligible for featuring |

## Before submitting

- [ ] Privacy policy published at a public URL, matching the answers above
- [ ] Terms of sale published, with a refund policy, since money changes hands
- [ ] Seller name filled into the description where marked
- [ ] Trader status declared — required once you charge, and the contact
      details you give are shown publicly to EEA users, so use a business
      address rather than your home one if you have the choice
