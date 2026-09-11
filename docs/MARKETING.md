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

## 4b. Who actually has this pain

Ranked by how acute the pain is, each grounded in a real post rather than a
persona invented for a slide.

1. **AEO / brand-visibility marketers.** They must run the *same* prompt across
   every engine to see where their brand shows up — the workflow is forced on
   them, daily. Asked for tools that work "across multiple LLMs (not just
   ChatGPT)":
   https://www.reddit.com/r/Brand24Official/comments/1wccwd6/how_do_you_choose_an_ai_visibility_tool_without/
   Most underserved group found. **Hook: broadcast.**
2. **Indie devs and builders paying for two or more chats.** In their own
   words: *"copy-pasting the same prompt three times just to see which answer I
   actually trusted"*
   https://www.reddit.com/r/SideProject/comments/1w6f1nu/built_a_free_extension_that_puts/
   and *"frequently copy-pasting prompts to multiple AI chat bots"*
   https://www.reddit.com/r/ClaudeAI/comments/1hiwok5/native_macos_app_to_send_ai_prompts_to_multiple/
3. **Client-facing writers** — sales engineers, consultants, agents who draft
   the same thing repeatedly. *"Tired of pasting emails into ChatGPT/Gemini 20
   times a day"*
   https://www.reddit.com/r/chrome_extensions/comments/1wda7xu/
   (A second, independent search found **no** lawyer, trader or academic
   threads at all — an earlier vendor-blog claim that 61% of legal AI users run
   two models could not be verified and should not be planned around.)
4. **Deep-research users.** OpenAI states deep research takes 5–30 minutes
   (https://openai.com/index/introducing-deep-research/). This is the **only**
   segment where the wait-time half is the hook: queue the next prompt while
   one model grinds.

**Negative finding, confirmed twice independently: nobody is asking for
wait-time measurement.** Two separate searches looked for it; the second
reported that queries like "time spent waiting", "how long I spend waiting for
AI" and "deep research takes forever" returned nothing on topic for 2025–2026,
and that no competitor advertises it either. Latency appears only as "this one
model is slow", never as something to quantify. A search for organic demand found none — the closest support is
an essay on attention, not a user request. So the measurement is a
*differentiator inside the pitch* and good material for a data post; the thing
people actually want solved is the copy-paste-into-five-tabs tax. Lead with
that.

### Three threads where the question was asked and nobody answered it well
This is the highest-value hour in this whole document. Someone described the
problem, people replied, and every reply missed. A useful comment lands here.

1. **r/chrome** — https://www.reddit.com/r/chrome/comments/1tngxak/ (2026-05-21)
   The title describes this extension. All four replies were useless:
   *"Automa browser extension"*, *"Why don't u ask AI?"*, *"Ask ai for
   extensions, there probably is one."*, *"Mammouth"*.
2. **r/LocalLLaMA** https://www.reddit.com/r/LocalLLaMA/comments/1ro7mge/ and
   the same author's crosspost in **r/automation**
   https://www.reddit.com/r/automation/comments/1ro7vaa/ — the OP explicitly
   wanted to use **his own paid accounts** and got OpenRouter, OpenWebUI and
   two API-based self-promos. Nobody offered a tool that uses existing
   logged-in sessions. That is exactly this product's wedge.
3. **r/ClaudeCode** https://www.reddit.com/r/ClaudeCode/comments/1tiwzuk/ —
   the OP is planning to build it; 13 comments, no shipped answer.

### Threads where a useful comment would land today
- https://www.reddit.com/r/SideProject/comments/1w6f1nu/built_a_free_extension_that_puts/
- https://www.reddit.com/r/SideProject/comments/1po49cx/why_does_using_ai_in_the_browser_feel_harder_than/
- https://news.ycombinator.com/item?id=42784373 (Show HN, multi-LLM chat: 62
  points, 33 comments — HN does care about this problem)

Demand is real but thin and scattered: those threads have single-digit upvotes.
There is no one hot thread to ride.

## 4c. Where posting is actually allowed

Verified by reading the rules:

- **r/chrome_extensions** — has **no** self-promotion rule; posts must be about
  extensions (Rule 3), no spam (Rule 4). Green. Note the tension: a dev with a
  100k-user extension says this sub is *"only other developers"*, so expect
  permission but a low-yield audience.
- **Show HN** — requires *"something you've made that other people can play
  with … without barriers such as signups or emails"*
  (https://news.ycombinator.com/showhn.html). A free, no-account extension fits
  the rule exactly, and there is no karma gate.
- **community.openai.com** — invites *"Share the cool things you have built"*
  while warning against repetitive promotion.
  https://community.openai.com/guidelines

### Subreddit rules, read one by one (2026-09-12)

| Sub | Members | Verdict | The rule that decides it |
|---|---|---|---|
| r/SideProject | 836k | 🟢 | no structured rules at all; format `[Name] - [description]` |
| r/chrome_extensions | 50k | 🟢 | no promo rule; announcements explicitly welcome |
| r/EntrepreneurRideAlong | 727k | 🟢 | three rules, none about promo. Text posts only |
| r/PromptEngineering | 414k | 🟢 | no published rules; text posts only |
| r/ChatGPTPro | 611k | 🟢 | self-promo ≤10% of your contributions; must add something ChatGPT can't do |
| r/Bard (Gemini) | 151k | 🟢 | promo must be Gemini-related — this is. Flair required |
| r/DeepSeek | 137k | 🟢 | 1/10 rule; text post, flair "Resource" not "News" |
| r/ClaudeAI | 1.13M | 🟢 **gate** | showcases encouraged and must be free to try — but **posts require 100+ karma** |
| r/OpenAI | 2.86M | 🟡 | **link posts to your own project are banned** — text post only, participate first |
| r/ChatGPT | 11.6M | 🟡 | other-LLM promotion goes to the pinned weekly self-promo megathread |
| r/artificial | 1.34M | 🟡 | 10% ratio and **your first post/comment cannot contain promo** |
| r/ArtificialInteligence | 1.92M | 🟡 | post must survive without its link, or it is deleted; flair within 30 min |
| r/LocalLLaMA | 822k | 🟡 | 1/10 rule; a browser extension is a weak topical fit |
| r/perplexity_ai | 204k | 🔴 | "no advertising or solicitation", self-promo included; needs mod approval |
| r/singularity | 3.97M | 🔴 | "self-promotion will not be tolerated" |
| r/productivity | 4.25M | 🔴 | "not allowed here in any form, even if asked for recommendations" |
| r/SaaS | 803k | 🔴 | max 1 mention / 3 links per 60 days; ban + URL blacklist |
| r/LLMDevs | 169k | 🔴 | commercial promo removed without warning unless FOSS-licensed |

**Every one of these can also have an invisible AutoMod gate** — karma floors,
account age, domain blacklists — that the rules endpoint does not expose.
r/ClaudeAI is the only one that publishes its number. So check every post in an
incognito window afterwards: silent removal looks exactly like being ignored.

Order to work through: SideProject → chrome_extensions →
EntrepreneurRideAlong → PromptEngineering → ChatGPTPro → Bard → DeepSeek.
Earn the 100 karma, then r/ClaudeAI (best fit of the large subs). Build a
comment history before touching r/OpenAI, r/artificial, r/LocalLLaMA. Skip the
red ones.

**Discords** (OpenAI ~852k members, Anthropic, Perplexity) have the right
density, but their self-promo rules cannot be read without joining. Join, read
the pinned rules, find the showcase channel, and be a member before being a
seller.

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

## 7. Competitors, with install counts

| Tool | Installs | How it works |
|---|---|---|
| Sider | 5,000,000+ | its own account and credits |
| ChatHub | 200,000 | free tier = 2 bots, then $14.99–24.99/mo |
| ChatALL | 16.5k GitHub stars | desktop app |
| CompareAI | 2,000 | your API keys / credits |
| **Ask Every AI** | 1,000 (4.8★) | your own tabs |
| Multi-AI-Prompt | 581 | your own tabs |

Also in store search: Superpower Multi-AI Chat, Multi AI Sidebar, MultiGPT,
ChatBrawl, Chatezzy.

Shipping the *same* zero-API idea (user's own logged-in sessions), all small
and all on Reddit right now: **Qorpus** (100 users in one post, 150 a month
later — https://www.reddit.com/r/HereIsWhatIBuilt/comments/1w2r9yx/),
**PluriHub** (https://www.reddit.com/r/chrome_extensions/comments/1taxdn9/),
multillm.pro, Nova Search AI, and **Synode** ("council of AI models", 50
upvotes / 49 comments —
https://www.reddit.com/r/ClaudeAI/comments/1rl2ygn/). None of them is
entrenched; the category is contested but not won.

"Send one prompt to many AIs" is taken. The wedge is what people complain
about in the incumbents: ChatHub caps its free tier at two bots and meters
credits, and everything above 2,000 installs routes your prompts through
*their* API — they monetize the prompt. So the honest pitch is: **unlimited and
free, runs in the sessions you already pay for, no API key, no account, never
reads the answers, nothing leaves the browser.**

### ⚠️ Name collision — worth a decision
An unrelated extension is literally called **"Ask Every AI"** (1,000 installs,
4.8★), and this listing's title is *"WhileAI — Ask Every AI, Track Your
Wait"*. Since store ranking mixes title relevance with downloads-vs-uninstalls
(https://developer.chrome.com/docs/webstore/discovery), the title competes
head-on for its own keyword against an incumbent with 1,000 installs and a
rating — a fight it cannot win today. Changing the title means a new package
and a new review (CLAUDE.md §16), so this is a decision, not a quick fix.

## 8. What a retrospective says failed

A developer who reached 1,300 installs in five weeks lists AI directories,
cold influencer DMs and launch blog posts under *what was a waste of time*;
what worked was leading with the problem — "the tab-switching tax" — inside
niche communities.
https://www.indiehackers.com/post/we-hit-1-3k-chrome-extension-installs-in-5-weeks-heres-what-actually-moved-the-needle-and-what-was-a-complete-waste-of-time-cebd3e4a5a

Read §5 in that light: the free directory sweep is an hour for backlinks, not
a growth channel.

## 9. Cold email: not to users, and not only for taste

- **To end users: no.** Marketing email to consumers in the EU/UK needs prior
  consent under ePrivacy; "legitimate interest" is a B2B argument only. In the
  US, CAN-SPAM allows it but requires a **physical postal address** in every
  message and a 10-day opt-out, with penalties up to $53,088 per email
  (https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).
  Note the irony: complying would mean publishing the home address that was
  just removed from the store listing. Scraping addresses is off the table.
- **To ~20–30 curators and creators, hand-written: yes.** Average cold reply
  rates run ~3.4%, ~13% for PR-style outreach, so expect one to three useful
  replies. That is an afternoon, not a campaign. Free newsletter intake worth
  using: **Launch Llama** (https://tools.launchllama.co/submit, free, 55k+
  subscribers) — the best effort-to-reach ratio found.

## 10. The order to do it in

1. Get the listing indexed (§2). Nothing else matters while it is invisible.
2. Comment — don't post — in the threads in §4b where people describe the
   problem in their own words.
3. Show HN, leading with the measured waiting data and letting the extension
   be the artifact people can play with.
4. r/chrome_extensions (rules allow it), then the big AI subs only after
   reading each one's rules.
5. Free directory sweep in one sitting; Edge Add-ons listing.
6. ~25 personal messages to curators and mid-size creators.
7. Ask every early user for a rating, by hand.
