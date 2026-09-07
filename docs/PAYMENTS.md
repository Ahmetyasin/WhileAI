# Payments — what is built, and what you have to do

The extension side is finished. What is left is an account, a product, and
two strings pasted into the code.

## Why a merchant of record, and why Polar

Chrome Web Store Payments was shut down in 2021 and nothing replaced it, so
money has to change hands outside the store — which store policy explicitly
allows, provided you say you are the seller and post your terms.

That leaves you paying VAT/sales tax in every country you sell to, unless a
merchant of record does it for you. Two things then narrow the field hard:

- **Stripe does not operate in Türkiye.** You cannot open a Turkish Stripe
  account to accept payments. (Stripe Connect *payouts* to Turkey do work,
  which is why the MoRs below can pay you.)
- **PayPal left Türkiye in 2016 and has not returned**, so any platform whose
  non-US payout route is PayPal-only is unusable.

**Polar** is the recommendation: Türkiye is named in its supported-seller
list, and it generates licence keys natively with a validation endpoint that
needs no secret and is safe to call from the extension. 5% + 50¢, plus 1.5%
on non-US cards — on $3.99 that is roughly $3.30 to you.

**Paddle** is the fallback if Polar's KYC turns you down. Türkiye is not on
its excluded list and it pays by wire or Payoneer. But Paddle Billing has no
licence-key generation, so you would use the signed-token path below instead
— and note its **$100 minimum payout**, about 30 sales before you see money.

Do not start on Lemon Squeezy: Stripe acquired it and is migrating its users
into Stripe Managed Payments. Its Türkiye support could not be confirmed.

## Two ways to issue a licence — pick one

The extension supports both. They are independent; configure whichever you use.

### A. Vendor keys (Polar / Lemon Squeezy) — no server

The vendor generates the key and validates it. You write no backend.

Set in `src/core/licence.ts`:

    export const VENDOR_VALIDATE_URL =
      'https://api.polar.sh/v1/customer-portal/license-keys/validate';

The extension calls it once, when the user pastes their key, then caches the
result. It is never called while sending a prompt, so the extension keeps
working offline and nothing phones home during normal use.

### B. Signed tokens — needs a small function, works fully offline

You sign an Ed25519 token after payment; the extension verifies it against a
bundled public key with no network call at all.

1. Generate a keypair (Node 22+):

    node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('ed25519');console.log('PUBLIC :',publicKey.export({format:'der',type:'spki'}).subarray(12).toString('base64url'));console.log('PRIVATE:',privateKey.export({format:'der',type:'pkcs8'}).toString('base64url'))"

2. Put the PUBLIC key in `LICENCE_PUBLIC_KEY` in `src/core/licence.ts`. Keep
   the private key on the server only — anyone holding it can mint licences.

3. On a payment webhook, sign `base64url(JSON.stringify({sub, iat, exp?,
   email?}))` and give the buyer `<payload>.<signature>`.

The empty key that ships today fails every check, which is the safe direction:
an unset key must not hand out free premium.

## Also change

`UPGRADE_URL` in `src/ui/popup/popup.ts` — currently a placeholder. Point it
at your product's checkout page.

## What the code already guarantees

Worth knowing so you do not re-solve it:

- **Ten free broadcasts, then the gate.** Tracking and the whole dashboard
  stay free forever; only the fan-out is gated.
- **One prompt is one broadcast**, however many AIs it reaches. A prompt held
  back — because an AI was signed out, say — costs nothing.
- **A lapsed licence falls back to the free tier**, rather than locking the
  user out of what they never paid for.
- **An expiry inside the grace window is honoured**, so an outage on the
  vendor's side never punishes someone who has paid.
- **Tampered, foreign-signed, and unsigned tokens all fail.** Not airtight —
  no client-side check is, and a determined user can patch the extension. The
  goal is that paying is easier than not paying.

## Steps for you

1. Create a Polar account and complete KYC (about a week; do this before
   wiring the paywall into a release).
2. Create a one-off $3.99 product, and enable the licence-key benefit on it.
3. Copy the checkout URL into `UPGRADE_URL`.
4. Set `VENDOR_VALIDATE_URL` as above.
5. Buy your own product once, with a real card, and paste the key into the
   popup. That is the only test that proves the whole path.
6. Publish terms of sale and a refund policy, and link them from the listing.
