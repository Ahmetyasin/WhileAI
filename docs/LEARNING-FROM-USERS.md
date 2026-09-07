# How to learn anything, given we collect nothing

The extension sends no telemetry, and that is a promise worth keeping — it is
the clearest differentiator against every AI sidebar in the store. But it
means the usual product feedback loop does not exist. Here is what does.

## What you CAN see without collecting anything

**Chrome Web Store dashboard** — free, no code, and the only source that
tells you about people who never write in:

- **Weekly installs and uninstalls.** The uninstall curve is the retention
  proxy: a spike in week 2-4 is the "looked at it twice" pattern, and that is
  precisely the question worth answering before charging for anything.
- **Total users vs total installs.** The gap is people who removed it.
- **Ratings and written reviews**, with the ability to reply publicly.
- **Impressions and install conversion** from the listing page — separates "no
  one finds it" from "people find it and are not convinced".

This is enough to answer the week-four question without collecting a byte.

**The uninstall page.** Chrome lets an extension open a URL when it is
removed (`chrome.runtime.setUninstallURL`). Pointing that at a two-question
form is the highest-yield feedback channel there is: the people who leave are
the ones who know what is wrong, and they are gone before they would ever
open the popup. Not implemented — it needs a page to point at, and it is
worth doing the day one exists.

## What the extension does today

**The feedback link in the popup** opens a mail draft pre-filled with the
version, the browser, which AIs are switched on, and anything currently
reported as broken. Nothing else: no prompts, no history, no identifier, and
the user reads the whole thing before sending. A test enforces that.

That context matters more than it looks. Most reports say "it stopped
working"; the version and the list of enabled providers turn that into
something reproducible.

## What you should NOT do

**Do not add analytics.** It would answer the retention question directly, and
it would cost the one claim that makes this extension worth choosing over
Sider or Monica. The store dashboard answers the same question well enough,
a week later.

**Do not ask for a review in the popup.** Extensions that nag convert worse
and rate worse. The review comes from the tool being good on the day someone
needed it.

## What to actually watch, in order

1. **Uninstall rate at day 7 and day 28.** This is the whole experiment. If
   people are still there at week four, the broadcast is a daily tool and
   pricing becomes a real question. If they leave in week two, no price would
   have worked and the answer is to fix the product, not the price.
2. **Written reviews mentioning a specific AI.** That is a selector break
   reaching you the slow way — `npm run health:watch` should have caught it
   first, and if it did not, that is the bug to fix.
3. **Feedback emails.** Low volume, high signal. Expect single digits.
