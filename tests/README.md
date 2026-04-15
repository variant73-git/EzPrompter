# RepixBridge E2E Smoke Tests

Playwright-based smoke test suite that exercises the RepixBridge extension against a curated list of real websites. Built to answer one metric:

> **How many sites can a user edit with full fluidity, without breaking anything?**

## Quick start

```bash
cd tests
npm install
npx playwright install chromium
```

Then from the `tests/` directory:

```bash
# Dry-run: all tests EXCEPT Mode E API calls (free)
npm run smoke

# Full: includes Mode E generateDesignMDFromImage (costs API tokens)
npm run smoke:full

# Single site:
node e2e/smoke.mjs --site "https://stripe.com"

# First 5 sites only:
node e2e/smoke.mjs --limit 5

# Verbose output (test details):
node e2e/smoke.mjs --verbose
```

Results land in `tests/e2e/reports/`:

- `{timestamp}-summary.md` — markdown summary with pass rates and failure details
- `{timestamp}-detail.json` — full per-test data for programmatic analysis
- `{timestamp}-{site-slug}.png` — final viewport screenshot per site

## What the tests cover

Each site goes through 8 tests in sequence. A failed prerequisite (like injection) skips the rest.

| # | Test | What it checks | Dry-run | Full |
|---|---|---|---|---|
| 0 | `pageLoad` | Site loads without throwing | ✓ | ✓ |
| 1 | `inject` | Extension globals (`__rbModeE`, `__rbExtractor`, `__rbPersist`) are defined | ✓ | ✓ |
| 2 | `extractSections` | `extractSections()` returns ≥1 section with valid bounds | ✓ | ✓ |
| 3 | `extractResponsive` | `extractResponsiveBehavior()` parses `@media` rules from stylesheets | ✓ | ✓ |
| 4 | `generateDesignMD` | DESIGN.md generated has all expected sections (Overview, Colors, Typography, Tone) | ✓ | ✓ |
| 5 | `persistInit` | IndexedDB via `persist.js` is initialized and queryable | ✓ | ✓ |
| 6 | `clickSelectHeading` | Simulated click on an `<h1>` produces a `.rb-sel-box` selection | ✓ | ✓ |
| 7 | `modeEImageRoundtrip` | End-to-end `generateDesignMDFromImage` with real Gemini call | — | ✓ |

Priority is editing fluidity over Mode E fidelity. Tests 5-6 validate the core Mode A user loop (the common path). Tests 2-4 validate the extractor that feeds Mode E. Test 7 is an expensive integration test that should only run before a release.

## Auto-activation (how the test harness gets past injection)

**Resolved via URL hash fragment.** The test harness navigates to each site with `#rb-qa-activate` appended to the URL. The extension's `content.js` detects this hash and automatically dispatches `toggleEditor` after the page loads, which injects the editor chain (`extractor.js`, `persist.js`, `mode-e.js`, `editor.js`).

This bridge is **gated by dev mode**: `content.js` only honors the hash when `chrome.runtime.getManifest().update_url` is absent, which is true only for extensions loaded unpacked via `chrome://extensions` "Load unpacked". Extensions published to the Chrome Web Store have an `update_url` and the bridge becomes a no-op — there is no security surface for real users.

So for the smoke test to work, the extension must be loaded **unpacked** (which Playwright already does via `--load-extension`). No manual activation needed.

If you ever want to disable this bridge, remove the `#rb-qa-activate` block in `content.js`.

## Curated site list

`e2e/sites.json` — 30 sites across categories:

- **landing-saas**: Stripe, Linear, Vercel, Supabase, PostHog, Cal, Resend, PlanetScale
- **landing-product**: Figma, Notion, Framer
- **landing-fintech**: Wise
- **docs**: Tailwind, React.dev
- **blog**: Overreacted, Paul Graham
- **editorial**: NYTimes, The Verge
- **saas-dashboard**: GitHub
- **ecommerce**: Apple, Shopify
- **marketplace**: Airbnb
- **social**: Pinterest
- **creative**: Dribbble, Awwwards
- **brutalist-typography**: Obys Agency, blvd.co
- **minimal**: example.com, motherfuckingwebsite.com

Each site has a `complexity` rating 1-5 to help interpret results:

- **Complexity 1** (minimal): should always pass. Failure = critical bug.
- **Complexity 5** (heavy JS/animations): failure is informational, indicates the limit of the current approach.

Edit `sites.json` to add, remove, or reweight entries. Run `npm run smoke -- --site <url>` to test a single site during development.

## Costs (approximate, full mode)

- Dry-run: 0 API calls. ~5-8 minutes total.
- Full mode: 1 Mode E API call per site × 30 sites = 30 calls. At ~$0.05-0.15 per call with Gemini 3.1 Pro Preview, expect **$1.50-4.50 per full run**.

The Mode E test in full mode uses a tiny 1×1 PNG as input, not a real screenshot — it exercises the call chain and validator, not the quality of generation. For quality testing, use individual sites with real screenshots via `runFromImage`.

## Interpreting results

**Fully passing (green):** site loaded, all tests passed. Aim for this to be 80%+ at category 1-3 sites.

**Partial pass (yellow):** some tests passed, some failed. The `inject` test will fail for now (see limitation above); sites with only `inject` failing are fine.

**Fully failing (red):** site broke the extension or the extension broke the site. These are the cases to investigate first.

Look at `summary.md` for the failure details section — it lists exactly which tests failed and why, grouped by site.

## Extending the suite

To add a new test:

1. Add an entry to the `tests` object in `smoke.mjs`. It should return `{pass, reason?, details?, warning?}`.
2. Add its name to `testOrder` at the top of `runSite`.
3. (Optional) If it has a prerequisite, return `{pass: false, details: {skipRemaining: true}}` on failure to abort the remaining tests for that site.

To add a new site:

1. Edit `sites.json`.
2. Include `url`, `category`, `complexity` (1-5), and `notes`.

## Why Playwright instead of Puppeteer or Cypress

- Playwright has first-class Chrome extension support via `launchPersistentContext`
- The `page.evaluate()` API is clean for running code in the site's context
- Built-in screenshots, console capture, and network interception
- Cross-browser if we ever need it later

## Known issues

- The `inject` test requires manual activation (see above).
- Sites behind Cloudflare anti-bot challenges may fail on `pageLoad`. Currently: Pinterest, sometimes Airbnb. These are flagged with high complexity in `sites.json`.
- Sites requiring auth are not tested. Logged-out landing pages of github.com / figma.com are used instead.
- Extension service worker can take 1-2 seconds to boot after Chromium launch; the runner sleeps 2s before starting. If tests fail consistently on the first site, bump this sleep.
