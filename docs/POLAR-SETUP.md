# Polar — what to put in each field

Everything on the Account Review checklist, with the text to paste. All of it
can be edited later, so nothing here is a one-way door.

## Preferences (Settings → Preferences)

| Field | Value |
|---|---|
| Organization Name | `whileAI` |
| Organization Slug | `whileai` — appears in your checkout URL, so leave it |
| Country | Turkey |
| Website | `https://github.com/Ahmetyasin/WhileAI` until there is a real page |
| Support Email | a real address you will read |

The repo works as a website because its README is now a product page rather
than build notes. It has to stay public regardless: the extension fetches
`config/selectors.json` from it, which is what lets a fix for a broken site
reach every install without a store release.

## Verify your identity

Five minutes with a photo ID. Do this first — it unlocks payouts and nothing
else depends on it.

## Connect a payout account

Your bank details. Polar pays Turkey through Stripe Connect, which is why this
works even though Stripe Payments does not operate there.

## Create your first product

| Field | Value |
|---|---|
| Name | `whileAI — Unlimited` |
| Pricing | One-time purchase |
| Price | see PAYMENTS.md; decide before creating it |
| Benefit | **License Keys — this is the one that matters** |

Without the License Keys benefit Polar issues no key, and the extension has
nothing to validate. It is the step most easily missed.

Description to paste:

> Unlimited prompt broadcasting in the whileAI browser extension.
>
> Type once in any AI you are signed into — ChatGPT, Claude, Perplexity,
> Gemini, DeepSeek — and the same prompt goes to the others you picked.
>
> Includes 12 months of updates. The extension keeps working after that; only
> new versions require a renewal. Response timing and the full dashboard are
> free for everyone, forever, with or without this licence.

That last paragraph is not decoration. The maintenance cost here is real and
open-ended — five AI sites change their markup on their own schedule — so a
perpetual promise would be an unbounded commitment. Saying "12 months of
updates" up front is the honest version, and it is the retroactive
restrictions that generate backlash, not the stated ones.

## Set up checkout

Appears once the product exists. Copy the checkout link — it goes into
`UPGRADE_URL` in `src/ui/popup/popup.ts`.

## Add social links (optional)

Polar says a public profile speeds up review, and the GitHub account is
already public. Worth the thirty seconds.

## Submit for review

Polar's own wording is "we will get back to you shortly" with no committed
time. Do not schedule a launch against it.

## After approval — two strings

1. `UPGRADE_URL` in `src/ui/popup/popup.ts` — the checkout link
2. `VENDOR_VALIDATE_URL` in `src/core/licence.ts` —
   `https://api.polar.sh/v1/customer-portal/license-keys/validate`

Then buy your own product once, with a real card, and paste the key into the
popup. That single test exercises checkout, key generation, validation and
storage together; nothing short of it proves the path works.
