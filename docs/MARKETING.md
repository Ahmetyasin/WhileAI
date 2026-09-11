# Getting users — what the evidence actually supports

Researched 2026-09-12. Every claim here is labelled by how well it is backed.
Where the data does not exist, this file says so instead of guessing — several
of the confident numbers circulating about Chrome extension marketing are
SEO filler with no methodology behind them.

State when this was written: published 2026-09-10, **1 user, 0 ratings**.

## 1. Paid ads: no, and the reason is not "too early"

The reason is that **the measurement you would be buying does not exist.**

- **Google Ads cannot optimise for an extension install.** Since the 2023 CWS
  → GA4 change, the analytics property is Google-controlled with Marketer role
  only, and the docs state plainly it cannot be linked to Google Ads. A dev in
  the thread put it exactly: *"you can no longer run optimized Google Ads
  campaigns for your Chrome Extension. You can optimize for clicks, but not for
  installs."* Chrome DevRel acknowledged the limitation and offered only UTM
  parameters.
  https://groups.google.com/a/chromium.org/g/chromium-extensions/c/iOJ2-jTNlY4
- **There is no cost-per-install product for extensions.** Google App campaigns
  require an app on Play or the App Store; extensions are not eligible.
  https://support.google.com/google-ads/answer/6247380
- **The landing-page workaround is a policy risk.** Google Ads policy for free
  software points the ad at "the authoritative online distribution source" —
  the store listing. One dev reported being flagged for policy violations after
  routing ads through his own page (same thread).
- **No solo dev has published what an extension install costs.** Searched hard;
  the figures in circulation trace to affiliate-payout markets or to content
  farms. Order of magnitude for sanity: average Google Search CPC was **$5.42**
  in 2025 across 16,000+ campaigns (no software/AI breakdown published).
  https://searchengineland.com/google-ads-costs-keep-rising-but-conversion-rates-improved-in-2025-477927
- **The unit economics are upside down.** Matt Frisbie (author of *Building
  Browser Extensions*) puts the open-market value of an extension user at about
  **$0.20**. A bought click costs more than 25× a user is worth.
  https://mattfrisbie.substack.com/p/the-ugly-business-of-monetizing-browser

Named developers who grew real extensions say the same thing, from experience:

- dtnewman (teacher extension, 200k users, no budget): *"what probably won't
  work for finding those early users … google ads, facebook ads, pretty much
  anything that isn't manual outreach"*, and *"Worry about your first 5."*
  https://news.ycombinator.com/item?id=43766294
- Uladzimir Yankovich (Manganum, 300k+ users): organic is channel #1,
  advertising **inside other extensions** is #2; on Facebook/Twitter/YouTube
  ads — *"Honestly, almost not at all."*
  https://thesaasengineer.substack.com/p/building-and-promoting-chrome-extensions

**Counter-evidence: none found.** Caveat worth keeping: Reddit was not
reachable by the research agents, so that community's experience is
under-sampled here.

### What to do instead of buying data
Turn on the free **CWS → Google Analytics 4** integration and tag every link
you post with UTMs. The install event fires when the user accepts the
permission prompt and carries the campaign, so you learn which channel
converts — for free.
https://developer.chrome.com/docs/webstore/google-analytics
Limits, all official: Marketer role only, no link to Google Ads, **2-month
retention** (so read it monthly or export). This is store-side analytics about
the listing page; it does not touch the extension, so the "no analytics, no
telemetry" promise in the listing stays true. Keep it that way.

## 2. The listing is not in store search (2026-09-12)

Measured, not assumed: a fetch of the store's own search pages returns results
but never this item.

| Query | Result |
|---|---|
| `whileai` | 4 other extensions (`while-ai-thinks`, `uwait-earn-while-ai-thinks`, …), **not this one** |
| `ask every ai` | not present |
| `multi ai chat` | 8 competitors, not present |
| `compare ai answers` | not present |

Google says indexing takes *"a few hours"* after publishing
(https://developer.chrome.com/docs/webstore/discovery); it has been two days.
Developers have reported intermittent indexer bugs where an item is reachable
by direct URL but unsearchable
(https://groups.google.com/a/chromium.org/g/chromium-apps/c/p_OoMP6ooUI).

**Nothing organic can work while this is true**, so re-check it daily and open
a Chrome Web Store developer support request if it persists.

On renaming for keywords: the name field does appear to carry the most search
weight (documented by a security researcher studying keyword-stuffing abuse,
https://palant.info/2025/01/08/how-extensions-trick-cws-search/), and this
name contains no term anyone searches for. But renaming means a new package
and a fresh review (CLAUDE.md §16), and a 300k-user operator advises doing ASO
only after ~10k weekly users. So: fix indexing first, revisit the name later.

## 3. Launch venues: cheap lottery tickets, not a plan

- **Show HN**: 41,301 posts over a year — median **2 points, 0 comments**;
  61.7% get zero comments. https://jonno.nz/posts/your-show-hn-dies-in-7-hours/
- **Product Hunt**: no first-hand report found of PH driving meaningful
  extension installs. One documented zero-audience launch: **3 upvotes**.
  https://www.indiehackers.com/post/15-days-after-launching-to-zero-audience-0-1-follower-0-stars-the-full-numbers-c14435be6c

Both are free and take an evening. Do them for the backlink and the small
chance, with no expectation.

## 4. What named developers say actually worked

1. **Reddit, in a large adjacent community — not the extension subreddit.**
   ChatGPT Writer (700k downloads): *"I shared it on reddit and it grew from
   there."* https://news.ycombinator.com/item?id=42219767 — Notion Boost (90k):
   posted in the Notion community. https://gourav.io/blog/notion-boost —
   purple-leafy: r/chromeextensions is *"too niche — only other developers"*.
   https://news.ycombinator.com/item?id=42219090
2. **Answer the question where it is already being asked.** kevmo314: find the
   top Reddit result for the problem, leave a genuinely useful reply.
   https://news.ycombinator.com/item?id=42217504
3. **Manual 1:1 outreach for the first 5–20 users**, to people who just
   described the problem in public. Not mass email.
4. **List on Edge Add-ons.** `npm run zip` already produces `edge.zip`. One
   report puts Edge at ~40% of Chrome numbers for the same extension.
5. **Cross-promotion with other extensions** — Yankovich's #2 channel; ExBoost
   is a free mutual-promotion network built for exactly this.
   https://mattfrisbie.substack.com/p/introducing-exboost-revolutionizing
6. **Store-listing SEO, once indexed.** Web Highlights: 3,577 → ~6,000 users in
   two months, driven by search.
   https://dev.to/mariusbongarts/seo-strategies-i-used-to-gain-2000-users-in-two-months-3og1

## 5. Directories — use the free tier only

Free and worth the hour: SaaSHub, AlternativeTo (accepts extensions),
Peerlist, Fazier (requires a backlink), MicroLaunch, Startup Fame, Product
Hunt, Show HN. Chrome-Stats lists automatically, no submission.
Paid: Futurepedia is **$247+** with no free path and no verifiable numbers —
skip. TAAFT ($49) is the only paid one that even states an expected click
count. Tag every submission with a UTM or you will learn nothing.

### Amplifiers with a verified, free intake path
Most "AI tool" creators have no public submission route, and several sell
placement only (Jeff Su quotes $27,500; AI Valley $370–1,990). These four were
verified as free and public, so they are the ones worth the effort:

- **FutureTools** (Matt Wolfe, ~800k subs) — https://futuretools.io/submit-a-tool
- **TestingCatalog** (~45k on X) — tips address `support@testingcatalog.com`,
  published at https://www.testingcatalog.com/about/ . They cover UI changes in
  ChatGPT/Claude/Gemini, i.e. exactly this surface.
- **Grace Leung** (~127k subs) — https://www.graceleung.com/connect/ has a
  business-collaboration option.
- **Simpletivity** (Scott Friesen) — https://www.simpletivity.com/contact

Best topical fit overall is **Tool Finder / Keep Productive** (Francesco
D'Alessio), whose whole format is "here is a tool that solves X" — find the
submit path on toolfinder.com. Follower counts above are third-party estimates;
YouTube and X both block automated reading, so verify before spending time.

## 6. Calibration — what "normal" looks like

- Median Chrome extension has **18 users**; 70.4% have ≤100; 7.66% pass 1,000.
  https://chrome-stats.com/chrome/stats
- Real uninstall rates devs report: 15–20% daily, 30–40% immediate, one report
  of ~50% for a new no-signup product.
  https://www.indiehackers.com/post/what-does-your-install-uninstall-ratio-look-like-f44076717a
- Ratings feed ranking, officially: *"The number of ratings and the average
  rating are taken into account when prioritizing items."*
  https://support.google.com/chrome_webstore/answer/12225786
  Never buy them — Google removes items for it, and the reviews market is
  openly fraudulent.

## 7. Competitors already in the search results

`Superpower Multi-AI Chat`, `Multi AI Sidebar`, `MultiGPT`, `ChatBrawl`,
`Free Multi AI Chat Tool`, `Chatezzy`. The wedge is not "send one prompt to
many AIs" — that is taken. It is: **it runs in the sessions you already pay
for** (no API keys, no re-login, no middleman server), **nothing leaves your
browser**, and **it measures your waiting**. Nobody else counts the wait.
