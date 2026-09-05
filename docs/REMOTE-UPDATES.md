# Fixing a broken adapter without shipping a new extension

Chat sites change their markup without warning. A Chrome Web Store review takes
days. So selectors are **data, not code**: they live in a JSON file the
extension fetches and validates at runtime.

MV3 forbids remote *code*, and we do not attempt it. Only strings — CSS
selectors and URL patterns — are ever fetched. That is what keeps this
store-legal.

## How it works

1. `config/selectors.json` is served from the repo's `main` branch
   (`REMOTE_CONFIG_URL` in `src/core/constants.ts`).
2. Every install fetches it **on browser start** and **every 6 hours**.
3. A failing adapter fetches it **immediately** (see below) rather than waiting.
4. The file is validated before use. Anything malformed is ignored and the
   extension keeps running on the selectors it already has.

## The self-healing loop

`src/core/adapterHealth.ts`:

- Content scripts report whether their selectors still match the page.
- One failure is ignored — chat SPAs render late and a single miss means nothing.
- **Two consecutive failures** are treated as "the site changed" and force an
  immediate config re-fetch (at most one per 30 minutes, so a provider outage
  cannot turn into a request flood).
- If the fresh config fixes it, the user never notices.
- If it does not, the provider is marked **broken** and the dashboard says so.
  A silent failure is the one outcome we do not accept.

## Shipping a selector fix

```bash
# 1. See what is actually broken, on the live sites, in a signed-in browser
npm run session          # leave open, sign in
node scripts/probe.mjs   # reports which selectors matched

# 2. Edit the EMBEDDED config (src/core/config.ts) — the single source of truth
#    and BUMP `version`. A config that is not newer is refused.

# 3. Regenerate the served file and confirm the two cannot drift
npm run sync:selectors
npm test                 # a test fails if embedded and served disagree

# 4. Commit and push to main. Installs pick it up within 6 hours,
#    immediately for anyone whose adapter is already failing.
```

No store submission, no review wait, no version bump of the extension itself.

## Safety rules enforced in code

`refreshRemoteConfig()` refuses a config that would make an install worse:

| Refused | Why |
|---|---|
| Malformed / unparseable | Would disable every adapter at once |
| `version` lower than current | Blocks replay or accidental rollback of a fix |
| Missing a platform the build knows | Would silently disable that provider |
| Uncompilable regex in `endpointPatterns` | Would throw on every request |

The embedded config in `src/core/config.ts` is the floor: a fresh install works
with no network at all, and a hostile or broken remote file cannot take it below
that.

## Verifying in production

The dashboard footer shows the selector set version, whether it came from the
remote file or the bundled fallback, how long ago it refreshed, and any
provider currently believed broken.
