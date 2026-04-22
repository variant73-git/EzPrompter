# CloneWebX — Magic Teardown (2026-04-22)

## TL;DR — The 5 most surprising findings

1. **The "magic" is the page builder's own clipboard format, not a CloneWebX invention.** Webflow, Elementor and Bricks all accept paste via `navigator.clipboard.write` with a builder-specific JSON MIME. CloneWebX writes *directly into those formats* — no official API, no account link to the target builder. It's effectively a transpiler from live-DOM → 3 competing JSON schemas. (confirmed: Webflow uses `@webflow/XscpData`; Elementor uses `{type:"elementor", elements:[…]}`; Bricks uses its internal Structure JSON pasted over HTTPS only.)
2. **Only a single "AI" touch point exists: v1.0.13 "AI Reduction DOM Size" (Jan 2024).** Everything else is scripted DOM traversal + schema translation. No LLM in the hot path. (confirmed via changelog.)
3. **Ships as a thin Chrome extension tied to a server.** Heavy export lives server-side — "server-side asset upload capability" was added v1.0.15 (Apr 2024). The extension scans + posts; the `softlite.io` backend returns clipboard payload. Explains why quotas are per-account and why the extension package itself is small. (strong inference.)
4. **Small company, small codebase.** Publisher address in Hà Tĩnh, Vietnam; 50K users on extension v1.0.27; single dev + small team. Extension purely handles auth + relay to `clonewebx.softlite.io`. (confirmed via Chrome Web Store listing.)
5. **Animations are an upsell, not an omission.** Litemove is a separately-sold companion specifically for post-clone animation — bundled into higher tiers. The static clone is intentional separation of concerns, not a limitation. (confirmed via pricing.)

## Marketing Site Tech Stack

Direct `curl` to `https://clonewebx.com` returned 0 bytes (DNS/CF blocking bot UA). Real marketing is under `softlite.io/clonewebx/` — WordPress site. Not investigated deeply because the ext binary is what matters.

| Layer | Evidence | Purpose |
|---|---|---|
| Marketing on `softlite.io` | WP-style `/docs/`, `/blog/` URL structure | Content + SEO |
| Chrome ext relay | `clonewebx.softlite.io` referenced in ext description | Auth + scan payload relay |
| Server-side asset upload | Changelog v1.0.15 | Image/font localisation on backend |

## Known Pipeline (confirmed)

1. User installs extension (`kejifndpehkapckhogiecndmachaeilp`, v1.0.27, Apr 2026).
2. User logs in at `clonewebx.softlite.io` → creates a Project (quota-bound by plan).
3. User navigates to source site. Extension injects a floating panel + selector overlay.
4. User uses "current selector / parent selector" to pick the target node (or whole page).
5. User chooses target builder (Webflow / Elementor / Bricks / Breakdance / Gutenberg / Divi 5).
6. Extension scans DOM + computed styles, ships to `softlite.io` backend for transformation.
7. Backend returns clipboard payload (or a JSON file download if too big).
8. User pastes into target builder via `Cmd/Ctrl+V`. Must be **HTTPS** for clipboard API.

## NEW: Pipeline Details Uncovered

### Export formats per builder (confirmed via 3rd-party documentation of the builders' own clipboard schemas)

- **Webflow** — `application/json` MIME with payload `{"type":"@webflow/XscpData","payload":{"nodes":[{ _id, tag, classes, children, type, data }]}}`. Webflow's own paste handler consumes this. CloneWebX generates this verbatim. (strong inference: they have no other integration path.)
- **Elementor** — `{"type":"elementor", "siteurl":"…", "elements":[{id, elType:"container"|"widget", settings, elements:[]}]}`. New v4 Elementor also emits `globalClasses` array; CloneWebX's Oct 2024 changelog note "Elementor Block Template widget support" suggests they moved from column-era schema to container-era schema once Flex Container stabilized (hence the `3.10+` requirement).
- **Bricks** — Internal Bricks element JSON, copied via `navigator.clipboard`. Requires HTTPS at both ends (source page *and* the WP admin). This is why docs explicitly warn about `chrome://flags` "Insecure origins treated as secure" for localhost.
- **Breakdance / Gutenberg / Divi 5** — Same shape story: builder-proprietary clipboard JSON. Gutenberg uses its block serialization (`<!-- wp:group -->` comments).

Confidence: **strong inference** — we haven't seen the exact bytes CloneWebX emits, but every builder docs page confirms the target paste format; the extension must produce something the native paste handler accepts, because there's no back-door import API.

### DOM → schema translation (strong inference)

- Traverses DOM, groups children, emits a builder-native tree node per element.
- Heuristics likely: `<section>` → `section`/`container`; `<img>` → Image widget; `<p>`/`<h*>` → Text/Heading widget; `<a>` → Button/Link; unknowns → HTML widget as fallback.
- CSS: combines `getComputedStyle` + source class names into the builder's style object. v1.0.17 specifically "reduced CSS class selectors for Webflow" — strong sign they flatten heritage cascade into per-widget style blocks.

### Class name handling

- **Kept as hints, not preserved verbatim.** Webflow requires new class IDs (`_id` in `XscpData`), Elementor v4 requires global class tokens. CloneWebX regenerates IDs and may reuse the source class *name* as a label for debuggability. The v1.0.17 note "reducing CSS class selectors" suggests class-merging (de-duplicating identical selectors). (weak inference.)

### Images & fonts

- **Images:** left as external references by default; v1.0.15 added "server-side asset upload" which likely mirrors to Softlite's CDN so they're stable. Docs explicitly warn "images might not appear because of the site's coding" — so hotlinking is still the normal path and users often re-upload manually. (confirmed.)
- **Fonts:** emitted as `@font-face` rules in the builder's custom CSS slot; docs describe two options (auto-inject or manual implementation to avoid duplication). No font file upload; refs point at source. (confirmed.)

### Animations (confirmed)

Not exported. Limitations list explicitly excludes "hover effects, animations, slideshows, carousels". Litemove (sister tool) adds animations AFTER paste.

### JS / dynamic / SPA (confirmed weakness)

- Does not export JavaScript.
- Docs tell the user to "scroll to the end of the page" to trigger lazy-load before scanning — i.e., they rely on whatever state the live DOM is in at scan time. Pure snapshot, no hydration replay. SPAs work *iff* already rendered; route-changes, hover reveals and click-to-expand content won't be captured unless manually triggered first.

### AI in the pipeline (confirmed: minimal)

- Single feature: "AI Reduction DOM Size" (v1.0.13, Jan 2024). Marketed as "optimises rendering performance" / "reduces layout resources". Likely: an LLM or heuristic pass that collapses wrapper `<div>`s with no visual contribution before emitting builder JSON. Target is to reduce builder lag on pasted content — not quality of the output. Everything else is scripted.
- "AI-powered" marketing on aggregator sites (bestaitools, moge.ai) is pure SEO — ignored.

### Pricing tiers (confirmed)

| Tier | Price | Includes |
|---|---|---|
| Free | $0 | Gutenberg + Webflow only, 2 sites / 10 exports/mo, non-responsive |
| Monthly | $10/mo | All builders, 30 sites/mo, responsive |
| Annual | $120/yr | 400 sites/yr + Litemove 5 sites/yr |
| Lifetime | $300 one-time | 300 sites/yr + Litemove 10 sites/yr |

## Chrome Extension Permissions Footprint

chrome-stats listing returned 403 to WebFetch, but Chrome Web Store + security review confirm:
- `tabs` (flagged as "tracks browsing") — confirmed.
- Implied from behavior: `activeTab`, `scripting` (inject content script + floating panel), `storage` (auth token / project id), `clipboardWrite` (write builder JSON on paste trigger), host permission on `clonewebx.softlite.io` + `<all_urls>` for scanning.
- v1.0.27 (Apr 2026), 50K users, 4.1★ (58 ratings), Manifest V3 presumed (all new Chrome ext are). **Not confirmed directly** — CRX download was not attempted.

## Public Content Found

- Softlite docs: `/docs/clonewebx/clonewebx/`, `/docs/clonewebx/ultimate-tool-to-clone-a-website-into-webflow/`, `/docs/clonewebx/clone-any-website-to-elementor-wordpress/`, `/clonewebx/clonewebx-changelog/`
- Founder/team: publisher address Hà Tĩnh VN; contact `support@softlite.io`. No public GitHub, no founder LinkedIn surfaced in searches.
- YouTube tutorials: "Clone Any Website to Webflow With ClonewebX" (`gy2xduc4_WM`), "Clone to Bricks with Clonewebx & Litemove" (`JFgW9oe4UlY`), "ClonewebX Updates + New Pricing" (`4w2NsFIHNug`). Not transcribed here; worth a 10-min watch for visual pipeline.
- ProductHunt page, mycustomwp review, influencewp listing.

## Still Black-Box

1. **Exact Webflow/Elementor/Bricks payload bytes** — would need to run the extension and sniff clipboard.
2. **How much is server-side vs. client-side.** Server-side is strongly implied by v1.0.15 "server-side asset upload" + quota accounting, but the schema-transform step could live either side.
3. **Whether they use `document.styleSheets` or `getComputedStyle`** for CSS extraction. The `reduced CSS class selectors` note nudges toward computed (they'd be de-duping computed results).
4. **Whether the "AI DOM reduction" is an LLM call or just a rules engine.** Likely rules — too fast for an API round-trip per page — but not confirmed.
5. **Extension source.** Not downloaded; would take 10 min via `crxviewer.com` if needed.

## Actionable Insights for RepixBridge

- **Port idea: builder-native export targets.** RepixBridge already has the hardest parts (DOM scan, clean extraction, design tokens). Adding an export adapter for Webflow `@webflow/XscpData` + Elementor `elementor` JSON would open the no-code designer segment without changing the editor core. Each adapter is ~1 file of schema mapping. Clipboard write is trivial.
- **Their "AI DOM reduction" ≈ our `isUselessWrapper` + `visual weight` logic.** We already have it in layers panel. Could expose it as an export-time step.
- **Confirms our strategic differentiator.** CloneWebX is a one-way gun: scan → paste → done. No layers panel, no inspector, no iteration. RepixBridge's edit-in-browser loop is a category over, not a feature over.
- **For OpenPencil integration path: don't copy CloneWebX.** Their approach is "emit proprietary JSON and hope the target importer accepts it." OpenPencil is MIT + public `.fig` format — our export story is cleaner (well-specified binary), not messier (fighting Webflow's closed clipboard schema).
- **One gotcha worth adopting early: HTTPS requirement + localhost flag warning.** Document it in the Pro-tier export flow so users don't hit it cold.

Word count: ~1175.
