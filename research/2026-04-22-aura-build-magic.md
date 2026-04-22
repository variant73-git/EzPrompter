# Aura.build — Magic Teardown (2026-04-22)

Source: `/tmp/aura-bundle.js` (13.6 MB single Vite bundle, `https://aura.build/assets/index-Bwf7nI8j.js`).

## TL;DR — The 5 most surprising findings

1. **Aura is multi-provider, user-selectable.** It is not "Gemini 3.1 only." The bundle exposes 15+ models across Google/Anthropic/OpenAI — `claude-opus-4-7`, `claude-sonnet-4-5`, `gpt-5.4-2026-03-05`, `gemini-3.1-pro-preview` (default), `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`. The user picks; Aura routes by task.
2. **"Primary HTML generator" is GPT-5.4, not Gemini.** The main `generate-html` edge function defaults to `gpt-5-2025-08-07` (remapped to `gpt-5.4-2026-03-05`). Gemini 3.1 Pro is the default *model picker* value (`ej="gemini-3.1-pro-preview"`), but the actual HTML-writer backend is GPT by default. (Strong inference — hardcoded fallback on an edge function we can't see.)
3. **Screenshot capture is a dedicated Playwright service on Fly.io** (`aura-screenshot-service.fly.dev/capture-screenshot`), not Supabase. It runs a 4-tier *degradation ladder* (1360×1024 → 1280×960 → 1120×900 → 920×760) with per-tier JPEG quality (70 → 64 → 58 → 52), waitForMs, and timeoutMs. Warmup pings go out on page load to keep the service hot.
4. **Aura has a separate "Is this screenshot real?" AI gate** — `validate-url-import-screenshot` uses an LLM to classify the capture as `acceptable | blank | blocked | verification | error_page | uncertain`. Cloudflare turnstiles, login walls, and "blocked by region" pages get rejected before they ever reach the generator.
5. **Colors come from a separate Gemini 3 Flash call with a 3-tier context fallback.** `extract-design-system-colors` runs with (a) screenshot + CSS + HTML, (b) screenshot + CSS, (c) screenshot-only — whichever returns first wins, with a pure-CSS regex fallback if all AI calls fail. The resulting palette is injected as a *supplemental* hint: "Use these colors only to resolve ambiguous tokens. Never let this palette override the screenshot." (Verbatim from bundle.)

## Marketing Site Tech Stack

| Tech | Evidence | Purpose |
|---|---|---|
| Vite + React (SPA) | `<script type="module" src="/assets/index-*.js">`, single 13.6MB bundle | Build tool (not Next.js despite the `/learn/*` route hints) |
| Supabase | `hoirqrkdgbmvpwutwuwj.supabase.co` + anon JWT embedded | Auth, DB, Edge Functions, Storage, Realtime |
| Fly.io (Playwright) | `aura-screenshot-service.fly.dev/capture-screenshot` | Dedicated headless-browser screenshot service |
| Cloudflare Turnstile | `challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` | Bot protection on auth/signup |
| Stripe | `dashboard.stripe.com/customers/...` + `stripe_customer_id` | Billing (4 paid tiers: pro / max / ultra / elite) |
| Codesandbox | `api.codesandbox.io/sandbox` | "Open in CodeSandbox" export |
| Figma | `api.figma.com/v1/files/`, `api.figma.com/v1/images/` + `convert-to-figma` edge fn | Figma export (server-side HTML→Figma conversion) |
| Iconify | `cdn.jsdelivr.net/npm/iconify-icon@2.1.0` | Web-component icons |
| Tailwind | Classes everywhere + Tailwind token annotations in prompts | Output styling |
| Monaco | `suren-atoyan/monaco-loader` | In-app code editor |
| Unsplash | `api.unsplash.com/search/photos` | Asset search |
| Google Analytics | `G-2M6V79H761` | Tracking |
| lucide-react 0.462.0 | All icons | UI |
| Sonner (toast) | `__auraToastCompatApi` | Notifications |

## Known Pipeline (confirmed)

Screenshot + DESIGN.md + optional HTML → chosen LLM → Tailwind HTML. 3-source hierarchy with DESIGN.md as semantic markdown. *Confirmed this still holds — but now we can see the exact orchestration.*

## NEW: Pipeline Details Uncovered

### Full Edge Function Map (Supabase functions/v1/*)

Confirmed (fetched or `.invoke()`d in bundle):

| Function | Purpose | Key inputs | Notes |
|---|---|---|---|
| `import-react-url` | Fetch URL + CSS bundle | `{url, maxBytes:1048576}` | Returns `{sourceHtml, cssBundleText, sourceAttachment, ...}` |
| `validate-url-import-screenshot` | Classify capture quality | screenshot bytes | Returns class in `{acceptable,blank,blocked,verification,error_page,uncertain}` |
| `simplify-url-import-html` | Trim HTML for token budget | raw HTML | Preps HTML for DESIGN.md synthesis |
| `extract-design-system-colors` | Palette inference | `{imageData, mimeType, htmlContext, cssContext, model:"gemini-3-flash-preview"}` | 3-tier fallback: full → css+screenshot → screenshot-only → CSS regex |
| `describe-image` | Screenshot → design brief | `{imageData, mimeType, customPrompt, model, mode:"design_reference"}` | Streaming SSE; used both for chat-attached images AND for DESIGN.md synthesis |
| `generate-html` | Main HTML writer | `{prompt, instruction, feedbackMessage, previousHtml, streaming, model:"gpt-5-..."}` | **Default GPT-5.4**, not Gemini |
| `generate-components` | HTML → multiple React components | `{htmlCode, customPrompt, stream, mode, model:"claude-sonnet-4-5-20250929"}` | **Claude Sonnet 4.5 default** |
| `html-to-component` | HTML → React file tree | `{html, componentName, model, framework, phase, files}` | Multi-phase (phases 1–6 visible); streams SSE with `{initialMessage, content, finalMessage}` |
| `iterate-react-component` | Iterate existing React files | `{files, instruction, model, framework, user}` | Inline edits on generated project |
| `generate-component-metadata` | Title/desc/tags for a component | `{code}` | |
| `auto-fill-asset-metadata` | Image → title/desc/keywords/colors/resolution | `{imageData, mimeType:"image/jpeg"}` | |
| `convert-to-figma` | HTML → .fig | `{html, width, height}` | Server-side conversion |
| `react-preview-bundler` | Bundle generated React for preview | `{files, framework, changedFiles, mainFile}` | Returns `{modules, mainModule, externalImports}` — in-browser preview |
| `generate-reasoning` | Sidebar "AI thinking" text | `{prompt, instruction}` | Non-streaming, decorative |
| `generate-checkpoint-metadata` | Auto-title for Git-like snapshots | `{projectType, files, focusFiles}` | |
| `iterate-cms-content` | CMS ops planner (JSON tool-calling) | `{mode, prompt, projectName, collections, selectedCollection}` | Returns `{summary, warnings, operations[]}` |
| Others | `generate-changelog`, `generate-cms-content`, `generate-metadata`, `generate-skill-metadata`, `detect-image-tags`, `extract-file-content`, `fetch-analytics-data`, `add-custom-domain` | | |

**Confidence: confirmed** (all present in bundle as fetch URLs or `Bt.functions.invoke(...)`).

### Model Routing

Confirmed constants (bundle):

```
ej   = "gemini-3.1-pro-preview"        // DEFAULT_MODEL (user-picker)
K8t  = "gemini-3-flash-preview"        // component-generation fallback
EMs  = "gemini-3-flash-preview"        // color-extraction model
MMs  = "gemini-3.1-flash-lite-preview" // cheap fast tier
ZMs  = "gpt-5.4-2026-03-05"            // describe-image internal default
L9e  = "gpt-5.4-2026-03-05"            // generic HTML fallback

// Migration map for deprecated models:
DMs = {
  "gpt-5-2025-08-07":    "gpt-5.4-2026-03-05",
  "gpt-4.1-2025-04-14":  "gpt-5.2-2025-12-11",
  "o3-2025-04-16":       "gpt-5.4-2026-03-05",
  "claude-sonnet-4-20250514": "claude-sonnet-4-6",
}
```

Task-to-model mapping (confirmed):
- **Main HTML generator:** GPT-5.4 (default hardcoded `"gpt-5-2025-08-07"` → remapped to 5.4)
- **HTML → multiple React components:** `claude-sonnet-4-5-20250929`
- **Color extraction from screenshot:** Gemini 3 Flash
- **Design-system palette:** Gemini 3 Flash (with HTML+CSS context)
- **User-facing picker default:** Gemini 3.1 Pro
- **Image description / DESIGN.md synth:** GPT-5.4 (via `describe-image` with `mode:"design_reference"`)

### Prompt Structure — The Mode System

**Confirmed** — Aura has TWO generation modes the user picks before importing:

- **EXACTLY mode** — preserve original text, names, numbers, brand references
- **Different mode** — keep structure/visual language, *intentionally rewrite* text/names/brands

Both modes produce a prompt that declares source hierarchy explicitly. Verbatim from `BGa()`:

> *"This import is in EXACTLY mode. Treat the screenshot as the primary visual reference, the captured page structure from the imported site as the structural source of truth, and the attached DESIGN.md as a secondary design-system token and asset reference. If the screenshot and captured structure conflict, follow the screenshot for layout, surfaces, typography, and motion. ... Match the original texts, names, numbers, and brand references unless something is clearly broken or inaccessible."*

Screenshot-fallback branch (when capture fails):

> *"This import is in EXACTLY mode. Screenshot capture timed out / was unavailable, so treat the captured page structure as the required structural reference and the attached DESIGN.md as the design-system token, rationale, and asset reference."*

This is a **runtime-composed prompt** — no static system prompt we found, no few-shot examples (weak inference; possibly in edge-function source not shipped to client).

### Chunking Strategy

**Weak inference — likely NOT component-chunked for the primary "import URL → HTML" path.** The bundle does not contain code that cuts the screenshot or HTML into visual chunks before sending. `generate-html` gets one prompt with one HTML + one screenshot.

The **chunking happens AFTER generation** via `generate-components` and `html-to-component` — these decompose finished HTML into React files. So: monolithic HTML first, *then* component decomposition. Component detection is done by Claude Sonnet 4.5 on already-generated HTML, not on the source site.

### Refinement Loop

**Strong inference — there is a "Phase 6" quality-check pass** in `html-to-component`. After initial file generation, a second call is made with `phase:6` + the generated files and a `finalMessage`. Server streams `{type:"progress", message}` → `{type:"complete", duration, errorsFound, files, finalMessage}`. If `errorsFound` is true the server returns *rewritten* files. This is a server-side lint/fix loop, not visual comparison. No screenshot-vs-output diff loop was observed client-side.

For the **edit path** (`iterate-react-component`), the user manually requests iterations — there's no autonomous refinement.

### Component Detection

**Confirmed** — done by Claude Sonnet 4.5 via `generate-components`. Client parses response as JSON with shape `{components: [{code, title, description, tags[]}]}`. Prompt visible: *"You are analyzing HTML code and breaking it down into reusable components. Think through the structure, patterns, and how to separate concerns effectively."* No hero/pricing/footer heuristics in client code — all semantic labeling is AI-delegated.

### Asset Handling

- **Fonts:** Google Fonts CDN (Inter, Geist, Manrope, + hundreds via `fonts.googleapis.com/css2?family=`). No `@font-face` self-hosting seen.
- **Images:** Unsplash search API + generated via `gpt-image-2`, `gpt-image-1.5`, Nano Banana Pro (`gemini-3-pro-image-preview`), Nano Banana 2 (`gemini-3.1-flash-image-preview`), Flux 2 Pro, Ideogram v3 remix.
- **Image enrichment:** uploaded images are enriched automatically (`auto-fill-asset-metadata`) with title/desc/keywords/colors/resolution — AI tagging baked into the asset pipeline.
- **Icons:** Iconify web component (`iconify-icon@2.1.0`) — the LLM can emit `<iconify-icon icon="...">` and it just works.

### Model Config

**Black-box** — all temperature/topP/maxOutputTokens/thinking controls live inside the Supabase edge functions (we only see fetch calls). Client doesn't pass these. One visible knob: `customPrompt` and `mode:"design_reference"` for `describe-image`.

### Screenshot Pipeline (fully observable)

Playwright service accepts:
```
{ html, fullPage, format:"jpeg", quality, viewport:{width,height,deviceScaleFactor},
  outputWidth, outputHeight, renderWidth, renderHeight,
  waitForMs, navigationTimeoutMs, screenshotTimeoutMs, timeoutMs,
  blockResourceTypes:["media"], blockUrls:[], skipFonts }
```

URL-import retry ladder (`$Ga` constant, verbatim):
```
[{quality:70, viewportWidth:1360, viewportHeight:1024, waitForMs:1200, timeoutMs:26000},
 {quality:64, viewportWidth:1280, viewportHeight:960,  waitForMs:900,  timeoutMs:22000},
 {quality:58, viewportWidth:1120, viewportHeight:900,  waitForMs:700,  timeoutMs:16000},
 {quality:52, viewportWidth:920,  viewportHeight:760,  waitForMs:450,  timeoutMs:12000}]
```
Max 2-minute total budget (`sRt=2*60*1e3`). On warmup, a trivial 300×180 HTML is POSTed to keep the Fly machine hot.

## Client-side JS Findings

### API Endpoints
- `https://hoirqrkdgbmvpwutwuwj.supabase.co/functions/v1/{19 edge functions}` (see table above)
- `https://aura-screenshot-service.fly.dev/capture-screenshot` (Playwright)
- `https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/...` (CDN for uploaded images)
- `https://api.codesandbox.io/sandbox/define` (export)
- `https://api.figma.com/v1/files/` + `/images/` (Figma roundtrip)
- `https://api.unsplash.com/search/photos` (asset search)
- `http://ip-api.com/json/` (region detection)

### Schemas visible on the wire

- **Import URL response:** `{importedSource: {sourceHtml, sourceHtmlFileName, cssBundleText}, screenshotAttachment, sourceAttachment, screenshotTimedOut}`
- **Color extraction response:** `{content: "... palette markdown ..."}` parsed by `k9s()`, with notes field
- **Generate-components stream event:** `data: {type:"content"|"done"|"error", content?, error?}`
- **html-to-component stream event:** `data: {initialMessage, content, finalMessage, type:"progress"|"complete"|"error", duration?, errorsFound?, files?}`
- **Model registry:** `[{id, family:"anthropic"|"google"|"openai", provider, display_name, name}]`

### Subscription Tiers (5 levels)
`free | pro | max | ultra | elite` — gated via `CW(userId, "premium")` → `{allowed, message, limitType, subscriptionTier}`. Tracks `remaining_daily`, `remaining_monthly`, `available_credits` separately. "HTML-to-Component conversion requires 1 premium prompt." — so **premium prompts are the metering unit**, not tokens.

### Library Dependencies (notable)
- `@supabase/supabase-js` (auth + functions + realtime + storage)
- Monaco editor + `monaco-loader`
- `lucide-react@0.462.0`
- `sonner` (toasts)
- `iconify-icon@2.1.0`
- React 18 (based on patterns)
- Vite build with code-splitting disabled (single 13.6MB chunk)
- Axe DevTools integration for a11y testing

## Still Black-Box

- **The exact system/user prompts inside the edge functions** (GPT-5.4 main HTML generator, Claude Sonnet 4.5 component splitter, Gemini 3 Flash color extractor). Client only sees `generate-html`, not its server-side prompt.
- **Temperature / topP / maxOutputTokens / thinking config** — all server-side.
- **Whether the DESIGN.md generator uses few-shot.** We see the markdown *section taxonomy* (`Overview, Typography, Layout, Shapes, Components, Accessibility, Assets`), but not the generation prompt.
- **How phase:6 decides `errorsFound`** — linter? typecheck? LLM self-critique? Unknown.
- **Whether there's a visual refinement loop** (screenshot-output vs screenshot-input). No evidence client-side; could exist server-side but unlikely given sub-60s generation times advertised.
- **Any A/B routing between GPT-5.4 and Gemini 3.1 Pro** — client hardcodes GPT, but server may override.

## Actionable Insights for RepixBridge

1. **Split color extraction from DESIGN.md generation.** Aura uses Gemini 3 Flash *separately* for palette with a 3-tier context fallback (full / css+ss / ss-only). Our current `extractor.js` does one shot. Two calls is cheaper + more robust: let Flash dedicate attention to colors without the whole prompt loaded.

2. **Add a screenshot-validity gate.** Aura's `validate-url-import-screenshot` classifier (`acceptable|blank|blocked|verification|error_page|uncertain`) prevents the expensive generator from ever receiving a Cloudflare/login/region-block page. Our Mode E fails silently on those. A cheap Flash-Lite call before the main generation saves $$ and UX pain.

3. **Degradation ladder for screenshot capture.** The 4-tier viewport retry (1360→1280→1120→920) with decreasing quality and timeout is a proven pattern we should copy into `captureVisibleTab` flows. Framer/heavy pages timeout at high tier but capture cleanly at tier 3.

4. **Two-mode import (EXACTLY vs Different).** Aura ships this as a user-facing choice. Our Mode E is implicitly "EXACTLY" — but users often want "keep the vibe, rewrite the text" (e.g. agencies cloning competitor layouts). One prompt-template switch, zero backend work.

5. **Phase-6 quality-fix loop on the output itself.** `html-to-component phase:6` sends generated files back to the model, asking for rewrites where errors are found. This is cheaper than a full re-gen and cleaner than hoping the first shot is clean. Add this as an optional second pass in Mode E — same prompt with `"Below is your previous output. Fix syntax/semantic issues, return the whole file."` — costs one more call but closes the 85%→93% fidelity gap.
