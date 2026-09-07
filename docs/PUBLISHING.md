# Publishing to the Chrome Web Store

The package is `release/chrome.zip`. Everything below is account setup and
copy — no code changes.

## Before you start: two things to prepare

**A privacy policy at a public URL.** Done:

    https://ahmetyasin.github.io/WhileAI/privacy.html

Paste that into the Privacy tab. The site is `index.html` and `privacy.html`
at the repo root, served by GitHub Pages — no build step, so editing either
file and pushing is the whole update process.

**Five screenshots at 1280×800.** Lead with the dashboard — it is the thing
people screenshot and share, and it is what makes the listing look like a
product rather than a script. Suggested order:

1. The dashboard, with real data in it
2. The popup, with the five AIs switched on
3. A prompt landing in three AIs at once (tab group visible)
4. The waiting-time-per-day chart
5. A notification saying an AI needs attention

Take them at exactly 1280×800, square corners, no browser chrome if you can
avoid it.

## Step by step

1. **Register.** https://chrome.google.com/webstore/devconsole — one-time $5,
   per account not per extension. The developer email cannot be changed
   later, so pick one you will keep. 2-Step Verification must be on.

2. **Upload** `release/chrome.zip`.

3. **Store listing tab.** Everything is written out in
   `docs/STORE-LISTING.md`: name, short description, detailed description,
   category. Paste it as-is.

4. **Privacy tab.** This is where submissions get delayed, so take it slowly:
   - **Single purpose** — the one sentence from STORE-LISTING.md.
   - **Permission justifications** — one per permission, all written out.
     They matter: `scripting` plus host permissions on five sites is the
     combination reviewers look hardest at.
   - **Data usage** — tick "Website content" and paste the explanation. Yes,
     you disclose it even though nothing leaves the machine; the rule is
     about collection, not transmission.
   - **Limited Use** — certify all three. They are all true.
   - **Remote code: No.** The selector JSON is data, never executed. Say so.

5. **Distribution** — public, all regions.

6. **Submit.** Expect a few days; several weeks is possible and does not mean
   anything is wrong.

## What could get it rejected, and what protects you

**The August 2026 rule on AI services** is the one to think about: the store
prohibits extensions "designed to circumvent safety guardrails, usage
restrictions, or other protective measures implemented by AI-powered
services." whileAI does not — but it automates five AI sites, and a reviewer
skimming will see "automates ChatGPT".

What protects you is true, and is already in the listing copy: it works only
inside sessions the user signed into themselves, types at human pace, one
prompt at a time per AI, never touches CAPTCHA or Cloudflare, and stops and
reports when a site shows a check or a usage limit. Do not soften that
paragraph to save space — it is the paragraph that answers the objection.

**Narrow permissions.** No `<all_urls>`, five named hosts, no localhost in the
shipped manifest (verified). This is the single biggest reason a review goes
quickly rather than slowly.

**Readable code.** esbuild output is minified but not obfuscated; obfuscation
is banned outright.

## After it is live

`npm run health:watch` daily. It checks every provider's selectors against
your own signed-in browser and tells you what broke since the last run. A
break fixed in `config/selectors.json` reaches every install within six
hours, with no store review — that is the whole reason the config is remote.

Watch the uninstall curve at day 7 and day 28. See
`docs/LEARNING-FROM-USERS.md` for why that number, and not revenue, is the
one that decides what happens next.
