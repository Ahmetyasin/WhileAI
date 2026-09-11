# Publishing to the Chrome Web Store

**The extension is live:**
https://chromewebstore.google.com/detail/jkemgnopkjenepaohooaghojmoabplmp

So most of this file is now a record of how it got there, plus the part you
actually repeat — "Shipping an update", below. The package is
`release/chrome.zip`, built by `npm run zip`.

## Shipping an update

1. Bump `version` in **both** `package.json` and `src/manifest.json`. They
   must match; the store reads the manifest, and a version that is not higher
   than the live one is rejected.
2. Add a `CHANGELOG.md` entry.
3. `npm run typecheck && npm test`, then `npm run zip`.
4. Verify what you are about to upload actually contains the fix — the zip is
   built from `dist/`, and a stale `dist/` is silent:

       unzip -p release/chrome.zip manifest.json | grep version

5. Developer Dashboard → **Package** → Upload new package → `release/chrome.zip`.
6. Change listing fields if needed (see `docs/STORE-LISTING.md`), then
   **Submit for review**.
7. Tag and publish a GitHub release so the site's "Releases" link is not
   empty:

       gh release create v0.8.2 release/chrome.zip --title "whileAI 0.8.2" --notes "..."

8. If you changed `../CLAUDE.md`, copy it into the repo so it is versioned —
   the parent directory is NOT a git repo, so the canonical file has no
   backup of its own:

       cp ../CLAUDE.md docs/CLAUDE.md

**The name lives in the manifest**, so renaming the extension is a package
upload and a fresh review — it is not one of the listing fields you can edit
without one.

Updates reach users automatically within a few hours of approval; Chrome
checks roughly every five hours. A selector break does NOT need any of this —
see "After it is live" at the bottom.

## How it was set up the first time

**A privacy policy at a public URL.** Done:

    https://ahmetyasin.github.io/WhileAI/privacy.html

Paste that into the Privacy tab. The site is `index.html` and `privacy.html`
at the repo root, served by GitHub Pages — no build step, so editing either
file and pushing is the whole update process.

**Five screenshots at 1280×800.** The store's maximum is five. They are built
and in `store-assets/` — the file list and the order to upload them in are in
`docs/STORE-LISTING.md`. Rebuild with `node scripts/make-store-shots.mjs`.

Two things learned making them, both worth not relearning:

- **Check what state the app is in before you capture.** The panel shot was
  taken while a "Nothing was sent: Perplexity is not ready" banner was up, so
  a transient error was the product's shop window until someone noticed.
- **Do not resize twice.** Composing at 2× and downsampling once is sharp;
  shrinking a section and then shrinking the frame again is not.

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
