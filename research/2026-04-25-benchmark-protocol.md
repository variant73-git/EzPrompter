# Mode E Benchmark Protocol

**Owner:** Adilson  ·  **Date:** 2026-04-25  ·  **Branch:** `feat/mode-e-refinement` (head `f1858b3`)  ·  **Ext version:** 2.4.0

Reproducible test set + run protocol for Mode E quality measurement. Read this on the bus. Run it on a desk.

---

## Section 1 — Test sites (6 canonical)

Picked for coverage, not popularity. Each site stresses Mode E in a different axis. URLs are deep links so visual landmarks are stable. **Verify the snapshot freshness anchor** before running — sites change.

### 1.1 gistr.so (animation + graph paper)

- **URL:** `https://gistr.so/`
- **Why:** Hero animation, graph-paper background image, multi-section landing. Established baseline (~3 min on Mode E Vision; 1/7 viewport glitch tolerated). Best site to detect regressions vs the 033 baseline.
- **Builder:** generic / Next.js (verify with `__rbDetectBuilder`)
- **Expected viewports:** ~6-8 (scrollHeight ≈ 5000 px / 800)
- **Known gotchas:**
  - Graph-paper bg-image must survive asset manifest (`data-rb-asset-bg`)
  - Hero copy is animated — freeze.js must hold animations
  - Floater capture should grab top nav as static clone in EL
  - Tab-focus race during refine call observed before — keep tab in foreground
- **Snapshot freshness anchor:** hero headline still mentions "Gistr" wordmark + a primary CTA; sticky nav with brand mark on left.

### 1.2 heartwork (vision-only stress, prompt quality test)

- **URL:** `https://heart.work/` (verify exact landing — operator confirms before run)
- **Why:** S2H lessons mark this site as the canonical "Aura nailed it, our pipeline missed cores/layout/content". Diagnostic for prompt quality vs DOM access. Good photographic imagery → tests asset placeholder for `<img>`.
- **Builder:** Framer (likely) — confirm via detect
- **Expected viewports:** ~4-6
- **Known gotchas:**
  - Past Mode E run got cores wrong + layout wrong — current default should improve
  - Framer canvas-fixed nav (CLAUDE.md fix #62) — verify rebuild does not duplicate the nav
  - High-res photographic content; verify `<img>` placeholders restore via `restoreAssets`
- **Snapshot freshness anchor:** verify hero crop + visible photo tiles match prior session screenshots.

### 1.3 sanity.io (dense docs / long page / framework override)

- **URL:** `https://www.sanity.io/` (homepage — long, multi-section, dense)
- **Why:** Aura demo target (`research_aura_build.md`). Long page → many viewports → exercises parallelism (`runWithQueue` concurrency=3). Dense typography → font detection.
- **Builder:** Next.js / generic
- **Expected viewports:** 8-10 (clip at the 8-viewport hard limit if exceeded)
- **Known gotchas:**
  - Hits the 8-viewport cap — confirm Mode E truncates gracefully without dropping the rest
  - Framework override risk on inline styles (React rerenders) — not in capture phase but watch the toast for asset-restore mismatches
  - Likely many `<svg>` inline icons — manifest cap at 80, may need tightening for this site
- **Snapshot freshness anchor:** main nav links (Docs / Pricing / Enterprise / etc.) and hero CTA visible above fold.

### 1.4 toolfolio.io (Framer marketing — fixed nav stress)

- **URL:** `https://toolfolio.io/`
- **Why:** Real Framer site. Past sessions hit the canvas-fixed positioning bug; the fix in CLAUDE.md #62 needs to keep working. Replaces "generic Framer marketing site" placeholder in scope decisions.
- **Builder:** Framer (detect should report it)
- **Expected viewports:** ~4-5
- **Known gotchas:**
  - `--framer-canvas-fixed-position:absolute` fix — confirm rebuilt page is not duplicating the nav floating
  - Framer-specific `<style>` block extraction may produce noise in cleanHTML
- **Snapshot freshness anchor:** sticky top nav with brand wordmark + 2-3 nav items.

### 1.5 stripe.com/payments (heavy gradients + brand fidelity)

- **URL:** `https://stripe.com/payments`
- **Why:** Deep page (not root). Gradient meshes, custom fonts, polished typography hierarchy. The "high-stakes brand fidelity" stressor — exactly where Opus tier should pay off if it pays off anywhere.
- **Builder:** generic / custom — detect likely returns "unknown"
- **Expected viewports:** 6-8
- **Known gotchas:**
  - Heavy gradient backgrounds — verify gradient extraction in DESIGN.md vs hand-rolled by LLM
  - Stripe wordmark logo — placeholder match is critical (regenerated Stripe logo will look obviously wrong)
  - Page is paid — no auth wall but detect for region-block edge cases
  - Long forms / dense type — letter-spacing, line-height fidelity matters
- **Snapshot freshness anchor:** "Payments" title above fold + global Stripe nav.

### 1.6 Shopify reference store (e-commerce, framework override hot spot)

- **URL propose:** `https://allbirds.com/` (Shopify-powered, public, well-known) — operator may swap for any live Shopify Dawn-theme storefront
- **Why:** Replaces the "generic Shopify store" placeholder. Allbirds is a real Shopify site with image-heavy hero, product grid, and the Shopify hero framework-override pattern (`project_two_problems_resize_position.md`).
- **Builder:** Shopify (detect should report)
- **Expected viewports:** 6-8
- **Known gotchas:**
  - Hero has framework override — past session noted React/Hydrogen rewriting inline styles. Inline `!important` + ID rule + sticky observer should hold during edit, but rebuild path bypasses that
  - Product grid → many `<img>` → tests asset manifest cap of 80 (may exceed)
  - Currency / language switchers in nav are floaters — should land in EL static-clone
- **Snapshot freshness anchor:** hero shoe photo + "Shop Men / Shop Women" CTAs in nav.

### Sites NOT in the set (and why)

- **Pure SPAs requiring login** — Mode E captures only what's rendered; gated content is out of scope
- **Cloudflare-protected sites** — capture validity gate (Aura's pattern, ours not built) would fail; skip
- **Webflow showcase generic** — `toolfolio.io` covers the no-code-builder slot better

> If operator wants a 7th site, add a **Webflow showcase template** (e.g. `https://relume.io/templates`) to capture Webflow-specific CSS-class soup. Mark as exploratory, not core.

---

## Section 2 — Benchmark protocol

### Configurations (6 per site)

Run order: cheapest/fastest first so a clearly-bad model bails the session early.

| # | Mode | Model | Notes |
|---|---|---|---|
| 1 | **EL** Lean | `gemini-2.5-flash` | DESIGN.md omitted, parallel concurrency=5, floaters cloned static |
| 2 | **E0** Classic | `gemini-3.1-pro-preview` | 033 baseline reference. Sequential. No manifest, no floater. |
| 3 | **E** Vision (current default) | `gemini-3.1-pro-preview` | Parallel concurrency=3, asset manifest, floater handling |
| 4 | **E+** Refined | `gemini-3.1-pro-preview` | E + per-section refine loop |
| 5 | **E** with Sonnet | `claude-sonnet-4-6` | Anthropic key required. Use Anthropic optgroup option in popup. |
| 6 | **E** with Opus | `claude-opus-4-7` | **Requires popup edit:** add `<option value="claude-opus-4-7">Claude Opus 4.7</option>` under Anthropic optgroup in `popup/popup.html` (lines 243-246), or temporarily swap select for text input. Anthropic key required. |

### Pre-flight checklist (every session)

- [ ] Latest pull on `feat/mode-e-refinement`. Confirm head matches `d81081b` or current WIP commit.
- [ ] `chrome://extensions` → reload RepixBridge after any code change
- [ ] Popup → API Keys → Gemini key set, Anthropic key set (if testing 5/6)
- [ ] Popup → model select on `gemini-3.1-pro-preview` for runs 1-4 default
- [ ] Target site loaded **and idle** (animations finished, lazy images settled — wait 5s)
- [ ] DevTools open on the target tab, Console tab pinned, "preserve log" ON
- [ ] Tab pinned to foreground; secondary monitor / no tab switching mid-run
- [ ] Editor activated (Alt+L works), no other widgets open
- [ ] Browser zoom 100%
- [ ] Viewport size **fixed** for the session (recommend 1440×900) — record in metadata

### Metrics captured per run

Pulled from toast + console + stopwatch.

| Metric | Source | Notes |
|---|---|---|
| **Wall time** | Stopwatch start = mode click; stop = "complete" toast | Include floater + capture phases |
| **Viewports captured** | Toast / console step messages | EL hides floaters across all; expect same count as E |
| **Sections rebuilt** | Final toast text | E+ also reports `sectionUpdates` count |
| **Failed viewports** | Console `[Mode E progress]` errors + toast `failedCount` | Should be 0 in green path |
| **Asset preservation rate** | Console: `[Mode E] Asset restore: X/Y placeholders matched, Z unknown id, W assets unused` | Compute X/Y as percent. Baseline ~40% on gistr |
| **Visual fidelity** | Operator eyeball, scale 1-10 (rubric below) | Compare rebuilt page vs original side-by-side |
| **Specific failures** | Free text | Logo wrong / colors off / nav duplicated / animation visible / layout collapsed / text mis-OCR'd |
| **Cost** | TBD instrumentation | Record token counts if logged; else mark "TBD" + provider dashboard ref |

### Visual fidelity rubric (1-10)

- **9-10** — Pixel-near. Hero crop, colors, typography, spacing match. Logo correct (placeholder restored). All sections present in order. Backgrounds (gradients/images) preserved. Could ship as a "respectful inspiration."
- **7-8** — Strong layout match. 1-2 sections compromised (text hierarchy off, gradient simplified, one image swapped to placeholder text). Brand colors right within 5%. No obviously hallucinated content.
- **5-6** — Recognizable but compromised. Logo regenerated as text or wrong icon. Some sections collapsed or missing. Colors drift toward defaults (off-white → pure white, brand blue → generic). Layout reads but eye notices it's "not the same site."
- **3-4** — Vibes only. Content order preserved but most styling wrong. Text accurate via OCR but typography defaulted. Multiple sections missing or duplicated.
- **1-2** — Failed run. Crash, blank page, generic Tailwind starter, or wholesale hallucination.

Cite a specific landmark when scoring (e.g. "7: hero correct, footer collapsed; logo wrong"). One number + one sentence.

### Bail-out criteria

- A configuration scoring ≤4 on first site → skip it for remaining sites and note "bailed at site 1"
- Wall time > 10 min on a single run → cancel via `__rbModeE.cancel()`, mark "timeout"
- 3 consecutive auth/rate-limit errors → swap key or skip provider for the session

---

## Section 3 — Per-site report template

Copy this block per site. Target: <5 min to fill after a run set.

```markdown
## Site: [name]

**URL:** [exact url]
**Date:** YYYY-MM-DD HH:MM
**Browser:** Chrome [version]
**Ext version:** 2.3.0 (commit [short-sha])
**Viewport:** 1440×900
**Scroll height:** ~[N] px → expected [M] viewports
**Builder detected:** [framer | shopify | webflow | generic | unknown]
**Freshness anchor verified:** [yes/no — what landmark]

### Run results

| Cfg | Mode | Model | Wall time | Viewports | Sections | Failed | Asset rate | Fidelity | Cost | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | EL | gemini-2.5-flash | | | | | / | /10 | | |
| 2 | E0 | gemini-3.1-pro-preview | | | | | / | /10 | | |
| 3 | E  | gemini-3.1-pro-preview | | | | | / | /10 | | |
| 4 | E+ | gemini-3.1-pro-preview | | | | | / | /10 | | |
| 5 | E  | claude-sonnet-4-6 | | | | | / | /10 | | |
| 6 | E  | claude-opus-4-7 | | | | | / | /10 | | |

### Free-text observations

- Cfg 1 (EL):
- Cfg 2 (E0):
- Cfg 3 (E):
- Cfg 4 (E+):
- Cfg 5 (E + Sonnet):
- Cfg 6 (E + Opus):

### Specific failures (cross-cfg patterns)

- [e.g. "All Gemini configs missed the gradient mesh; Anthropic configs got it"]

### Conclusion

**Winning config for this site:** [Cfg N — Mode + Model]
**Reason:** [one sentence]
**Premium tier worth it?** [yes/no — Opus delta vs Sonnet]
**Lean acceptable?** [yes/no — would I ship EL on free tier for this site]
```

---

## Section 4 — Aggregation guidance

Run all 6 sites × 6 configs = 36 runs. Tabulate to a master sheet (Notion table, Numbers, whatever — keep it terse).

### Reading the data

**Median fidelity by model (across all sites):**
- The per-model median fidelity score is the headline metric. p50, not mean — outliers from one bad site shouldn't kill a model.
- If `claude-sonnet-4-6` median ≥ `gemini-3.1-pro-preview` median + 1 point → switch default to Sonnet
- If E+ median ≥ E median + 1.5 points → make E+ the default; otherwise E+ stays as opt-in

**p90 wall time by model:**
- 90th percentile, not max. Tells you what users feel on a "bad" site (rare but possible).
- Hard ceiling: any config p90 > 8 min → mark "needs optimization", do not ship as default.

**Cost per run by model:**
- Until token instrumentation lands, infer from provider dashboard after a session. Rough math:
  - Gemini Flash @ ~$0.30/MTok input → EL run ≈ $0.05 for 5 viewports (rough)
  - Gemini 3.1 Pro Preview → ~$0.40 for same workload
  - Sonnet 4.6 → ~$0.60-1.00 for same
  - Opus 4.7 → ~$3-5 for same
- Cost target for $12/mo Pro tier: ≤ $0.50 per clone amortized → favor Sonnet, reserve Opus for premium feature

### Tiered routing decision tree

Following `project_tiered_routing_strategy_2026-04-24.md`:

- **Free tier** (3 rebuilds/mo): Mode EL with Gemini Flash. If EL median ≥ 6 across the test set → ship. Below 6 → swap to E with Flash.
- **Pro tier default** ($12/mo): Mode E with the median-winning Anthropic model (likely Sonnet 4.6). If Gemini 3.1 Pro matches Sonnet within 1 point at ⅓ cost → keep Gemini.
- **Premium feature trigger for Opus 4.7:** only when on-demand "Refine for fidelity" button is clicked on a result the user marks unsatisfactory (a fidelity score <6 signal in the wild). Do not default to Opus — burn rate kills margin.

### When to retire E0 Classic

Retire when **all six** of these hold across **all six** test sites:
1. E (current) fidelity ≥ E0 fidelity, every site
2. E wall time ≤ E0 wall time × 1.2 (small parallelism win expected)
3. E asset preservation ≥ 30% on every site (E0 has none — bar is "not regress")
4. E zero crashes / unhandled rejections across the session
5. E0 not used by operator for any reason in 2 consecutive sessions
6. No open issue requiring rollback to 033 logic

Until then, keep E0 in the dropdown. The cost is one file (16KB).

### When to drop a model from the menu

- Median fidelity < 5 across the set → drop
- p90 wall time > 10 min → drop
- Repeated auth / rate-limit failures unrelated to user action → drop until upstream stable

---

## Open questions for the operator

1. **Heartwork URL:** confirm canonical landing — `heart.work` vs `heartwork.com` vs other. Memory is ambiguous.
2. **Shopify reference store:** Allbirds proposed; if operator has a preferred Shopify reference (own store, theme demo, etc.), swap.
3. **Token instrumentation:** when this lands, replace "TBD" cost column with real numbers. Until then, post-session dashboard scrape.
4. **Opus in popup:** decide between adding the option to `popup.html` (recommended, persistent) or swapping select for text input (faster, fragile). Recommend the option add — one line, ships forever.
5. **Viewport size convention:** 1440×900 is a reasonable default. Lock it into the protocol if operator agrees.

---

*End of protocol. Reproduce a session: pre-flight checklist → 6 sites × 6 configs → fill template per site → aggregate medians/p90s → update tiered routing strategy memo.*
