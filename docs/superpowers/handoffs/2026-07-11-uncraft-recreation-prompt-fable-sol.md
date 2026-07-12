# UNCRAFT — Full Recreation Prompt

> **Purpose of this document.** This is a ground-up recreation brief for a new flagship model
> (Anthropic Fable / GPT 5.6 Sol). It describes the ENTIRE product — intent, concept, and every
> functionality at the most granular level we can specify — so that a fresh model can rebuild
> Uncraft from scratch and we can study how a new generation of models interprets the same intent.
>
> **What is deliberately left to the model:** visual design language (palette, typography, radii,
> surface treatments), code architecture, programming language, frameworks, file layout. Do NOT
> copy our design system; invent your own, but meet the aesthetic bar described in §2 and §13.
>
> **What is deliberately excluded from this brief** (do not build): the legacy "Mode E" rebuild
> pipelines (all variants) — reconstruction is Iter9-only here (§9); and the "sections" grouping
> system with its "Run this flow" executor — chains execute per-target via the chat/agent in this
> brief.
>
> Everything else below is REQUIRED functionality. Where exact values are given (colors, timings,
> thresholds), they are functional spec, not decoration — they encode decisions we paid to learn.

---

## 1. Intent and concept

**Uncraft** is a design tool for the web. Slogan: **"Design without borders."**

The core belief: designers should be able to treat the entire web as editable material. Any site,
any screenshot, any image found while browsing is raw matter that can be captured, cloned,
restyled, recombined, and edited visually — without leaving the browser, without writing code,
and without exporting to another tool.

Three pillars, fused into one product:

1. **A Figma-grade visual editor that operates on real, live websites** — layers panel, inspector,
   spacing guides, in-place text/image editing — running inside the page itself (browser
   extension) or inside a captured copy (canvas app).
2. **An infinite node canvas** where captured sites, images, markdown design-specs, and prompts
   are nodes; connecting them expresses design OPERATIONS (restyle, transplant, compose, extract);
   and an AI agent orchestrates the graph conversationally.
3. **A capture/clone system** that turns any URL or image into clean, editable HTML — including
   heavily animated builder sites (Webflow/Framer/GSAP/Lenis) and bot-protected sites (via an
   extension handoff that captures in the user's own authenticated browser context).

The product ships as multiple shells over one shared editor core:
- **Web-shell**: the canvas app (boards, nodes, chat agent, credits, auth) — the main product.
- **Extension-shell**: a Chrome/Opera extension (Manifest V3) that injects the same editor into
  any live page, plus a floating widget (capture, send-to-canvas, asset collection, handoff).
- A Figma companion plugin exists as a satellite (site → Figma layers); treat it as optional.

The two shells must share ONE editor codebase. Editing behavior must be identical whether the
editor runs directly in a live page (extension) or mounted into a captured page inside a canvas
node (web-shell).

---

## 2. Audience, positioning, and the quality bar

**Audience: designers.** Not developers. Every affordance, label, and flow is for someone who
thinks in layers, spacing, and type — not selectors and props. All user-facing product text is in
English. Plain language everywhere; zero dev jargon in the UI.

**Positioning:** Uncraft is the only tool that edits real websites visually in the browser with
true design-tool controls AND composes them on an AI node canvas. The competitive map that shaped
this positioning:

- **Node-canvas AI tools** (the interaction-quality reference class): **Magnifik, Fuser, Weavy,
  Magic Path, Superdesign, Flora**. These set the bar for what a modern node canvas must FEEL
  like — fluid, tactile, alive. Uncraft must match or beat their fluidity (§6) while doing
  something none of them do: operating on real captured websites.
- **Builders/cloners** (the capability reference class): **Aura.build** (screenshot→HTML with
  multi-model routing hidden behind a decorative model picker), **same.new** (agentic site
  cloning, GPT-based coding agent, conversational chunking), **Orchids.app**, **Lovable**
  (prompt-to-app builders), **html.to.design** (site→Figma, 1.4M users), **Codia**
  (screenshot→Figma/HTML), **ClonewebX** (DOM→builder clipboard formats, no AI in the hot path),
  **CSS Pro / CSS Peeper** (CSS inspection/editing without design-tool controls).
- None of them combine: live visual editing of real sites + design-tool controls + a node canvas
  + high-fidelity cloning. That intersection is the moat.

**The aesthetic mandate.** The tool itself must read as beautiful and avant-garde — a designer's
tool that designers respect on sight. This means: intelligent adherence to UI/UX conventions (not
novelty for its own sake), obsessive micro-interaction polish, motion that is felt rather than
seen, zero jank at any zoom level, and a chrome that never fights the user's content. Performance
IS aesthetics here: a beautiful tool that stutters reads as broken (§6 encodes the fluidity
doctrine as hard requirements).

---

## 3. Business model

- **Charge for the AI, not BYOK.** The experience is seamless: no API keys from users. Target
  gross margin 60–70% over model costs. (BYOK was explicitly rejected.)
- **Credits system** (integer credits, backed by micro-cent metering of every model call):
  - Every AI operation is metered at true provider cost, then priced with per-operation
    multipliers: compose/extract/transplant/edit ≈ 3×; clone/image generation ≈ 4×;
    full animated-site reconstruction ≈ 10× with a price floor (it is the heaviest operation);
    trivial mechanical extractions get a small flat price; **chat and plain capture are free**.
  - Prices round up to friendly steps with a small minimum. One charge per operation.
  - **Atomic hold → settle** accounting with a ledger: a hold is placed before the operation,
    settled at true cost on success, **fully refunded on failure — a failed generation never
    charges the user.**
  - Insufficient balance returns a typed "insufficient credits" error carrying estimate +
    balance; the UI shows a plans/upgrade modal. Cost estimates are shown BEFORE expensive
    operations, and a transient "−N" debit animation plays on the affected node after.
  - **Welcome grant** (e.g. 500 credits) with anti-farm defenses (§12).
  - A credits pill in the canvas toolbar shows live balance with a ledger dropdown; balance
    updates are pushed to the UI the moment an operation settles.
- **Tiers:** Free = visual editing only (the live CSS editor is the free hook; AI is paid from
  day one — the unit economics of quality clones make free AI rebuilds impossible). Paid tiers
  (e.g. Pro ~$12/mo, Ultimate ~$39/mo) unlock AI operations at increasing volume.
- **Transparency about model routing as a brand differentiator.** Aura exposes a 15+ model picker
  that the backend mostly ignores. We do the opposite: route per-subtask honestly and say so —
  "we use the right model for each part of the work, not the most expensive one for everything."
  Never expose more than a small curated model choice to the user.

---

## 4. The canvas — nodes

An infinite, zoomable, pannable board. Users have multiple boards (projects) listed in a sidebar.
Everything on the board is a **node**; nodes connect with **cords** (§5); an AI agent operates
the whole graph (§8).

### 4.1 Node kinds and color coding (functional spec — keep exact)

Every node is classified by ORIGIN, and the origin drives a color used consistently across the
node's frame ring, its ports, and every cord that leaves it. The color IS the type system as far
as the user is concerned — they learn to read the graph by color.

| Origin | What it is | Color |
|---|---|---|
| **site** (URL capture, blank site, cloned site) | a live/generated website | **blue `#2966EA`** |
| **.html upload** | user-provided HTML file | **orange `#f97316`** |
| **.md / design-system** | markdown design spec (design.md) | **ochre `#C2B44A`** |
| **image / asset** (screenshot, upload, generated image) | raster content | **violet `#7951C2`** |
| **prompt** | free-text instruction node | **near-white `#ECEBF1`** |
| **skill** | reusable instruction preset | **pink `#f472b6`** |
| unknown fallback | — | slate `#94a3b8` |

Decisions encoded here: a site cloned FROM an image reads **blue** (it is a generated site, not
an imported .html — never orange). A "blank website" node (an empty composition target the
designer fills via connections) also reads blue — same family as captured sites. Category color
also needs a computed contrast ink (black/white by luminance) for any pill/label rendered on it.

### 4.2 Node content and body behavior

- **Site nodes** render their captured HTML. Default proportion 16:9 hero crop; an **expand
  floater** (bottom-right of the body, hover-revealed) toggles between hero crop and full content
  height. Draggable dash handles on the bottom and right edges resize height/width independently.
- **CRITICAL performance architecture — static by default:** site nodes at rest display a cached
  **snapshot image** of their content at EVERY zoom level. A live iframe mounts ONLY when the
  user enters edit mode or previews an old version. Every content change (edit-done, generation,
  reset) mints a new snapshot and refreshes the image. Consequence: a board of 50 sites weighs
  like a board of 50 images. This decision alone made the canvas fluid; do not regress it.
- **Image/asset nodes**: node aspect ratio auto-syncs to the image's natural dimensions (no
  letterboxing); a dimensions label sits just outside the frame; image fills the frame.
- **Prompt nodes**: the whole body is a move handle; **double-click** enters text editing; a
  cursor-following hint tag says "Double-click to edit"; the node auto-grows with content up to a
  cap, with manual resize permanently overriding auto-grow once used.
- **Version history**: every content change is a snapshot; a per-node version menu lists
  snapshots with restore (confirmed). Reset-to-original is a distinct, confirmed action.
- **Replace content**: hover overlay on file-origin nodes offers replacing the underlying
  file/content in place.

### 4.3 Node chrome (the furniture around the body)

The node body has NO toolbar. Chrome floats OUTSIDE the frame:

- **Floating tag** (top-left): kind pill + editable title. The tag IS the move handle (grab
  cursor). Its label truncates smartly, preserving the file extension.
- **Floating action cluster** (top-right, appears on selection): a prominent **Edit** button
  (enters edit mode), Done/Cancel while editing. During edit mode the cluster anchors INSIDE the
  frame corner (the edit framing puts the node top at the viewport top).
- **Right-click anywhere on the node** opens the full context menu (duplicate, download, reset,
  delete, version history, etc.).
- **Ports**: one emitter port on the right edge, receiver slots on the left edge. The emitter dot
  **tracks the cursor's Y** along the right edge while hovering the node (cuts the reach needed
  to grab a cord on tall nodes), and hands off cleanly when the cursor enters the port's own hit
  area. Ports have a generous invisible hit halo (~40px). Cords can ONLY be started from the
  port — body drag always means MOVE. Multiple incoming cords fan into evenly spaced left slots.
- **Progress ring**: while a node is generating, an arc in the node's category color fills
  clockwise around the frame from 12 o'clock, driven by an estimate curve that approaches but
  never reaches 100% until the real result lands. The arc's leading tip carries a short
  white gradient head contained inside the stroke (same width, no glow). A large muted
  percentage number sits in the center. No spinners, no text chips.
- **Working indicator (chat-side)**: while the agent works, fake terminal-style code lines type
  and overwrite themselves at fixed width, with a scramble write-head block in the node's
  category color and a slow animated gradient across a pastel 5-color ramp. The lines are 100%
  invented — an explicit test must guarantee no real paths/keys/URLs can ever appear.
- **Viewport switcher** (mobile/tablet/desktop) on site nodes, kept below section-level chrome in
  stacking, never swapping positions across zoom levels.

### 4.4 Canvas interactions

- **Selection**: click selects (category-color ring + white halo readable at far zoom); marquee
  multi-select; shift-click toggles; Escape clears. Selected nodes appear as context pills in the
  chat dock (§8.3) — selection is a deliberate act of pointing.
- **Move**: body drag; **group drag** moves the whole multi-selection rigidly.
- **Duplicate**: right-click menu, or **Alt+drag** (optimistic ghost follows the cursor,
  threshold-gated so a bare alt-click does nothing); multi-selection duplicates the whole group
  WITH its internal cords.
- **Clipboard**: Cmd+C copies the selection (nodes + internal cords) as a payload on the SYSTEM
  clipboard (works across boards; last-copy-wins vs. external content). Cmd+V pastes with
  progressive offset. Cmd+V also accepts external payloads: images, .md, .html files, URLs —
  each materializes as the right node kind. A context-menu "Paste from clipboard" is enabled
  whenever the clipboard holds a supported payload.
- **Ghost placement**: adding content (file drop, "+" menu, URL add, agent-suggested assets)
  spawns a ghost that follows the cursor; the node commits on click. Multi-file drops queue and
  place one at a time with a progress pill. Adding a bare URL defers the capture until the drop.
- **Undo** for structural operations (delete, duplicate, move).
- **Wheel routing rules** (exact): mouse over empty canvas → zoom; Cmd/Ctrl+wheel anywhere over
  the world (nodes included) → canvas zoom; mouse over a site node at rest, no modifier → the
  SITE scrolls natively inside its frame; browser-level zoom (Ctrl/Cmd+wheel reaching the page)
  must be intercepted everywhere so the app UI never scales; Ctrl/Cmd+0 stays free as reset.
- **Minimap** (corner widget) with a frame-toggle: fit-selected vs fit-all.
- **Empty-canvas right-click menu**: add URL / blank website / HTML / .md / screenshot / paste.
- **Bot-challenge amber state**: a capture that hits bot protection turns the placeholder amber
  with a shield icon and opens the handoff flow (§10) — never a spinner that lies.

---

## 5. The canvas — connectors (cords)

Cords are the visible grammar of the graph. Exact functional spec:

- **Path**: a horizontal bezier from source right-port to target left-slot. The curve's bow is
  **world-fixed** (constant world units, ~80) so the cord's SHAPE never changes with zoom.
- **Stroke**: 4px **screen-constant** at every zoom (non-scaling stroke). Cords never thin or
  thicken with zoom.
- **Color — the gradient**: every cord is a **linear gradient in world space from the source
  node's origin color to the target node's origin color**, anchored at the two port points. A
  blue site feeding an ochre design-spec node renders a blue→ochre cord. The gradient is the
  at-a-glance answer to "what flows into what."
- **Two strokes per cord**: a solid gradient underlay for continuity, plus a directional
  **marching-dots overlay** (animated dashes flowing source→target) on the same gradient.
- **Hit model**: an invisible wide hit path (~22px on-screen at any zoom) for select/re-route
  (grab cursor); a **cut hotspot at the bezier midpoint** (~48px on-screen) shows a scissors
  cursor — a plain click severs the cord.
- **Sever animation**: the dying cord retracts INTO its source port (~300ms, ease-in, fade held
  until ~70% so the retraction dominates over the fade), in flat source color.
- **Draft cord**: while dragging from a port, a live cord follows the cursor; snap-to-port has a
  screen-constant reach with a floor so it never "grabs from across the room" at low zoom.
  Moving the origin mid-drag is frozen (no whipping).
- **Creation is optimistic**: the cord appears instantly, reconciles with the server, rolls back
  on failure.
- Cord and port geometry must move in **lockstep** with node chrome during zoom (no re-attach
  jumps): whatever quantization the zoom pipeline uses, the cord layer follows the same steps.

---

## 6. Fluidity doctrine (hard requirements, learned the expensive way)

These are non-negotiable performance criteria. The reference feel is Magnifik/Weavy/Flora.

1. **The gesture hot path is sacred.** During any wheel/pinch/drag gesture: zero framework
   re-renders, zero layout reads, zero compositor-layer promotions/demotions. Zoom applies as a
   pure transform; all React/DOM bookkeeping happens in a trailing settle (~180ms after the
   gesture ends).
2. **Batch input**: wheel deltas accumulate and apply at most one transform per animation frame.
   Drag/resize updates coalesce to ≤1 per frame, with a mandatory flush before the release
   commit.
3. **Counter-scaled chrome is quantized**: any CSS variable driving screen-constant chrome writes
   only on meaningful change (≥1%) with a minimum interval (~90ms), then writes the exact value
   at settle. Zoom-threshold CSS classes flip ONLY together with that quantized write (a
   mismatched frame at a threshold crossing reads as a blink).
4. **Hybrid chrome scaling (user-validated final decision):** the node BODY (frame border,
   padding, radii, port dots) is **world-locked** — fixed pixel values that scale with the world,
   zero per-zoom recalculation. Labels, pills, tooltips, menus, handles, and hit halos are
   **screen-constant**, counter-scaled with a **floor at 40% zoom** (below 40% they stop
   compensating and shrink with the world). Screen-constant chrome must counter-scale via
   TRANSFORM, never via layout properties (layout counter-scaling re-flows content and steps).
5. **No backdrop-filter inside the zoomed world.** Blur belongs only to viewport-fixed chrome.
   In-world translucency uses higher-alpha solid color.
6. **The dot grid is a canvas, not CSS**: world-locked (scales and pans with the world), drawn
   once per frame with integer device-pixel dot centers (fractional centers shimmer), skipped
   below a minimum on-screen spacing.
7. **Never toggle `will-change` around a gesture on a large subtree** — promote/demote is a
   whole-subtree re-raster (a visible flash).
8. **Live iframes are the enemy of fluidity**: see §4.2 static-by-default. Off-screen heavy
   content additionally parks (visibility-hidden, layout preserved) as a fallback.
9. **Micro-animations**: entrances and settles use transform+opacity only, 140–220ms, no
   animation touches layout; keyframes settle onto computed values; all of it gates behind
   `prefers-reduced-motion` and pauses during canvas gestures.
10. **Interaction feedback** must be immediate and physical: optimistic cords, ghost placements,
    instant selection rings, cursor changes that never lie (grab on handles, scissors on cut
    zones, copy on alt-drag, crosshair on ports).

---

## 7. Node-chains — construction logic

Chains are how work is expressed. The construction rules:

- **Edges are operations.** The direction of a connection encodes a design operation inferred
  from the origin pair (this is the Demarcelizer engine surfaced as graph grammar, §11):
  - site → site: transplant (content of target dressed in nothing new yet; with a style source
    attached, restyle),
  - .md → site: restyle the site to the design spec without changing copy,
  - prompt → site: rewrite/compose with the prompt as brief,
  - prompt → .md: mutate the design tokens per the prompt,
  - image → site: style transplant (extract the image's design as a brief first, §11), or full
    clone when the image IS a site shot,
  - site → .md / site → prompt / site → image: EXTRACTIONS (design.md, content, screenshot,
    style, reconstruction prompt) — dragging a cord from a node into empty canvas opens a menu
    whose primary section is **"Extract to ▸"** (creates a derived node) with "Connect to" as
    the secondary path.
- **Derived chains lead with the SOURCE.** A chain derived from existing content starts at that
  content node — never with an invented prompt node. The first move of any derivative work is to
  READ the real content ("never carve from imagination").
- **Generated chains lead with a prompt node** containing the ENHANCED interpretation of the
  user's request (a prompt-engineered brief, editable by the user) — one complete brief per
  distinct deliverable, feeding the result node.
- **Selection = origin.** If the user has a node selected and asks for derivative work, the new
  chain ANCHORS to that node (placed beside it, connected to it) — never an island elsewhere.
- **Chain layout algorithm**: dependency depth maps to horizontal columns (fixed gap);
  same-depth variants stack vertically (fixed gap); single-node columns get a slight vertical
  zigzag for organic rhythm. Before insertion, the TOTAL area of the chain is measured and a
  clear region is reserved so new chains never overlap existing content. Multi-node chains
  assemble in REAL TIME (each node appears as it is created, and the viewport auto-frames the
  growing bounding box).
- **Execution**: a target node with incoming cords can be composed — the engine groups its
  sources by kind (html/md/prompt/asset/skill) and makes one model call that adapts the operation
  to the mix, saving the result as a new version of the target and marking consumed edges as
  applied. Execution shows the per-node progress ring; a visible STOP affordance aborts and
  restores the pre-run state. Overwrite of an existing real result asks once (with
  "don't ask again").

---

## 8. AI orchestration — the agent that plays the canvas

### 8.1 The macro operating model (the single most important principle)

The chat agent **is the user-selected frontier model operating normally — exactly as it would on
its own provider's product — using NODES as the delivery medium.** The canvas tools are
power-ups layered on top, never a cage. "Create a fintech site" must produce an actual generated
site delivered as a node-chain — the same answer the raw model would give in its own chat,
rendered as graph. Refusing, or dropping empty typed scaffolding, is the failure mode. If a
request seems outside the direct tools, the agent looks for a SEQUENCE of tools that gets there
before declining. The agent thinks natively in chains (how does this request become a readable
`reference → base → result` the user can edit?) while conversing naturally (asking when genuinely
ambiguous). Flora is the reference for this feel.

### 8.2 Two model roles — operator vs content (architecture decision)

- **Operator model** orchestrates the graph (which node, which tool, ask-vs-act). Mechanical
  work, not user-facing quality → the CHEAPEST model that passes an eval suite (a Gemini
  Flash-class model won our evals at 82%). This is OUR choice, invisible plumbing. Per-turn cost
  gap vs a frontier model is ~160×; orchestrating on a frontier model is economically infeasible
  at scale.
- **Content model** generates the actual site/image INSIDE a node. Quality matters → the USER
  picks it (a small curated picker in the dock), and the pick flows to every content call
  (compose, edit, image generation). The operator must never silently be overridden by the
  picker in production.
- The "training" of the operator is prompt + harness + eval — never weight fine-tuning — so the
  operator is swappable in one line when a better/cheaper model appears. Maintain a first-move
  eval suite (canonical chains: style transfer, design extraction, build-from-image; traps:
  type vocabulary, ask-when-ambiguous, act-when-selected, read-before-carve).

### 8.3 The chat surface

A **prompt dock** at the bottom of the canvas: free-text input, attachment button (image / .md /
.html; a typed URL auto-routes to capture), curated model picker, and toggle pills. Selected
nodes appear as removable context pills carrying their category color. The dock expands into a
**chat panel**: streaming responses, per-iteration message bubbles, thinking indicator, and
**tool chips** — one chip per tool call showing live status. Chips never truncate text and never
cause horizontal scroll; a chip that wraps becomes a rounded rectangle. The panel auto-collapses
when a run finishes; manual collapse via chevron. While working, the loading text carries an
animated gradient across the colors of the nodes involved.

### 8.4 Tool surface (behavioral contract)

Safe tools: create node (with SEMANTIC types — blank-website / prompt / design-system / asset /
skill — and with CONTENT, so a prompt node is born with its brief and a design-system node with
its spec; an empty node is the bug), add edge, update node, query nodes, get node output (with a
cap large enough for full sites — a starved cap teaches the model that extraction is impossible),
list assets, add asset from URL (fetch external image → asset + optional canvas node),
**create workflow** (a whole chain — nodes + edges + anchor — in one call, laid out by §7 and
assembled in real time).

Destructive tools (require confirmation): delete node, run flow (compose), edit site. Image
generation is choice-classified (provider choice surfaces only when genuinely ambiguous;
single-choice auto-confirms invisibly).

### 8.5 Safety rails on the loop

- **Confirm/skip**: destructive calls pause the run and render an amber chip with
  Confirm/Skip; a skipped tool resolves as skipped, the run continues.
- **Caps**: soft iteration cap (~10) pauses with "Did N actions so far — continue?" showing an
  action breakdown; hard cap (~50) kills; per-tool retry budget (~3); wall-clock timeout
  (~10min). Cancellation propagates immediately from the UI.
- **Ownership checks** on every mutating tool (a run can only touch the requesting user's
  boards).
- All runs persist (threads, messages, runs with token/cost accounting per run).

### 8.6 Behavior rules (each encodes a real failure we fixed)

- **Vision is mandatory**: attached images flow to the model multimodally; a SELECTED SITE NODE
  attaches a rendered screenshot of its current content (the agent must SEE what it operates on,
  not a truncated HTML string).
- **A bare image upload is NOT a build command.** No accompanying text → it's an asset to place
  (ghost placement) + a one-line canned acknowledgment, zero model inference. Zero prompt ≠ poor
  prompt: no text = not a request; thin text = a poor request = ask open questions (no presumed
  answers) AND always offer "…or I can proceed with a proposal — want that?"; on acceptance,
  build COMPLETELY and impressively, never generic.
- **Read before carving**: derivative work starts by reading the actual source content.
- **Never announce intent without acting.** Never build the graph as the goal — the goal is the
  artifact; the graph is how it's delivered.
- Voice: synthesize one clean paragraph; never narrate retries or internal steps.

---

## 9. Capture and clone system (Iter9 doctrine — no legacy rebuild modes)

Three ingestion paths, chosen automatically:

### 9.1 Static capture (the default, free)

For server-rendered / simple sites: a headless browser with a REALISTIC Chrome UA (bot-shaped
UAs get blocked pages), scroll-to-bottom without reset (hydrates lazy content without triggering
exit animations), force-show CSS for scroll-gated elements, external stylesheets inlined (with
credentialed fetch), all viewport units pinned to the capture viewport (vh in an iframe lies),
body background sampled from REAL RENDERED PIXELS (median across points — computed-style
sampling misses image/video backgrounds), scripts stripped (captured copies must be inert), and
URLs absolutized. **Capture is a faithful photocopy** — deterministic, ~seconds, zero AI. Most
"AI slop" complaints historically traced to the restyle step, never to capture: keep capture
deterministic.

### 9.2 Iter9 reconstruction (animated builder sites, priced ~10×)

A cheap detection probe after page settle scores builder-animation signals (Webflow IX3, Framer
Motion density, Lenis, sticky-heavy layouts). Above threshold, capture routes to full
reconstruction — but as a DELIBERATE, user-confirmed choice (a flag + modal), never an automatic
10× charge. The pipeline (this replaced all legacy rebuild modes because it is cheaper,
pixel-perfect, and single-call):

1. **Scroll-stop capture**: snap-scroll the page viewport by viewport (dynamic stride, settle
   after animations), screenshotting each stop.
2. **Asset manifest**: every img/svg/background-image with bbox + per-stop visibility, URLs
   absolutized, placeholder IDs assigned.
3. **Auto-rasterization — the key move**: anything irreproducible (`canvas`, `video`, iframes,
   huge SVGs) is screenshot-clipped into pixel-perfect PNGs and enters the manifest as a raster.
   Custom typography and illustrations survive as images instead of being hallucinated.
4. **Deterministic probes**: colors and typography read from computed styles — ground truth, not
   inference.
5. **Thumbnails** of each manifest asset rendered so the vision model sees what each ID looks
   like.
6. **ONE vision call** to the strongest vision-coding model (GPT-5.5-class; env-overridable)
   with all stops + manifest + probes, emitting HTML with verbatim `data-asset-id` placeholders.
7. **Post-process**: real URLs/inline SVGs/rasters injected, viewport units pinned.
8. **Progress streams** to the client per stage (launching → navigating → capturing →
   thumbnailing → thinking → finalizing) so the 2–3 minute wait shows honest stage labels on the
   node placeholder.

Cost: ~$0.10–0.25/clone. Validated end-to-end on real Webflow/Framer sites.

### 9.3 Bot-challenge → extension handoff (the security-critical path)

Before ANY extraction, a challenge detector recognizes Cloudflare interstitials, hCaptcha,
reCAPTCHA walls, Akamai, PerimeterX — and aborts cleanly (never persist challenge HTML as
content). The flow then:

- pre-creates a placeholder node awaiting handoff and mints a **short-lived (5min) HMAC token
  bound to {user, node, url}**;
- a modal explains the 3-step flow and messages the extension, which stores the pending handoff
  and opens the real site in a normal tab;
- in the user's authenticated context, a content script offers "Send to Uncraft": it serializes
  the DOM, inlines stylesheets via credentialed fetch (CSS behind the wall finally loads),
  absolutizes URLs, strips scripts, pins viewport units, and POSTs the capture with the token;
- the canvas polls and swaps the placeholder for the real node. URL matching canonicalizes
  aggressively (www/slash/query/hash + origin fallback) to survive redirects.
- The extension widget also offers **manual capture** of any current tab into any board (with
  board picker + create-new), and surfaces pending handoffs as its primary action when one
  exists.

### 9.4 Clone-from-image (asset → site, priced ~4×)

Right-click an image node → clone website. Decisions that made it good:

- **The right model matters more than the prompt**: clone runs on the strongest vision-coding
  model (GPT-5.5-class; we lost weeks to a weaker hardwired default). Prompt stacking past a
  point has NEGATIVE returns — the model ignores piled instructions; wins come from model choice
  + deterministic ground truth.
- **Deterministic color ground truth**: the source image is drawn to a real canvas and PIXELS are
  read — background gradient endpoints and a role-labelled palette (background / neutrals /
  accent) with exact per-cluster averages (never quantized bucket keys) — pinned as exact hexes
  in the brief. A silent sampler failure logs loudly (env failure vs model drift must be
  distinguishable).
- **"ISOLATE THE REAL SITE" is checklist item #1**: presentation backdrops (the Dribbble gray,
  the mockup frame) are discarded; only the UI reproduces, full-bleed.
- **Crop-and-embed**: clean, fully bounded images inside the source shot are cropped from its
  pixels and embedded as real images (conservative: skip bleeding heroes, oversized regions,
  frames).
- Adaptive interpretation: a full site screenshot → reconstruction brief; a fragment or non-UI
  image → precise style interpretation instead.

### 9.5 Live edit needs no rebuild

The extension editor operates directly on the real DOM (§12) — framework-override defenses make
edits stick on React/Framer/Hydrogen sites. Cloning is for ingestion into the canvas, not a
prerequisite for editing.

---

## 10. Generation quality — the anti-slop system

Two layers, wired into every generation seam (compose, restyle, edit):

- **Layer A — house style (always on).** A distilled craft ruleset injected into generation:
  motion restraint, hierarchy discipline, anti-centering bias, no AI-tell typefaces (Inter,
  Bricolage, anything JetBrains — hard ban), no gratuitous italics, eyebrows sparingly and never
  with wide tracking, tabular-nums instead of monospace for figures, and an explicit ban on the
  decorative metallic keyline tracing rounded containers. A guardrails-only subset applies to
  edits (touch only what changes).
- **Layer B — style extraction from images (image inputs only).** Before composing, a dedicated
  vision call ISOLATES the actual UI from its presentation backdrop and returns a design brief
  with tokens BY ROLE (surface/neutrals/accent), structural facts (outer-vs-inner spacing,
  container states, WHERE each gradient lives, heading↔subheading relationships), so the backdrop
  physically cannot leak into the output. The compose step receives the brief AND the image
  (vision) together. Modes: `layout` (real UI → reproduce) vs `inspiration` (non-UI → abstract
  the style, invent the UI).
- **Style absorption rule**: when a style source is present, the output ABSORBS every
  characteristic of the source; the model fills in nothing from its own priors.
- **Deterministic ground truth beats prompt text — the standing doctrine**: wherever a fact can
  be MEASURED (pixel colors, font-style counts, elevation/shadow usage, computed typography),
  measure it and pass it as absolute truth. Hallucinated italics and invented shadows died only
  when real DOM/pixel counts entered the prompt. Never fix a bad output by stacking instructions.
- A three-way proof held: right-palette-without-craft is still slop; craft-without-palette is
  off-brand; both layers together are clean. Keep them separable and additive.

---

## 11. The Demarcelizer (restyle/transplant engine inside the tool)

Origin: a sister tool that takes `(source, reference, voice)` and returns the source's CONTENT
dressed in the reference's VISUAL SYSTEM. Inside Uncraft it is the engine behind the edge
grammar (§7) and the extraction tools:

- **Extract**: from any URL or captured site, produce a rich **design.md** — a semantic markdown
  design spec (overview/tone, role-labelled palette, typography with real family names and exact
  metrics, elevation, components inventory, do's/don'ts, assets) of Stitch-grade fidelity
  (verbatim font names, exact letter-spacing values, color-space nuances, scroll rhythm).
  Renders the reference with real font loading before probing; screenshot + computed-style
  chunks feed the extraction.
- **Reskin**: apply a design.md to a site without touching its copy.
- **Inject/transplant**: reference chassis + extracted target content → final HTML (content
  extraction is a structured model call; injection is a battle-tested system prompt — when
  porting, port prompts verbatim, do not rewrite them).
- On the canvas these are not a wizard — they are cords: `.md → site` is a reskin, `site → site`
  a transplant, `site → .md` an extraction. The design.md itself is a first-class ochre node the
  designer can read, edit, and reuse.
- House style (Layer A) applies on top of every Demarcelizer operation.

---

## 12. Models, cost, and security decisions

### 12.1 Model routing per seam (cost-driven, transparent)

| Seam | Model class | Why |
|---|---|---|
| Agent operator | cheapest passing eval (Flash-class) | mechanical; ~160× cheaper than frontier; eval-gated swap |
| Content compose / edit | user's picker choice | quality is the user's call; they pay for it |
| Clone / transplant vision | strongest vision-coder (GPT-5.5-class) | measured: weaker models ignore layout instructions |
| Iter9 reconstruction | strongest vision-coder, ONE call | single-call architecture beats N calls on cost AND fidelity |
| Style extraction (Layer B) | strong vision, cheap tier acceptable | structured token output |
| Image generation | per-provider adapters (Imagen-class fast + gpt-image-class), choice surfaced only when ambiguous | |
| Any image present in a compose | force a vision-capable model | text-only models silently drop the image |

Principles: benchmark before locking (our history: a mid-tier vision model beat both cheaper
tiers on quality and pricier tiers on cost/latency — cheap tiers were visually inadequate, one
tier up bought nothing); every lock is reversible with instrumentation in place; keep provider
adapters uniform in shape so routing is one line; stream long generations (SDKs cap
non-streaming); retry transient provider errors (429/503) with exponential backoff; provider
failover for the operator.

### 12.2 Security and abuse decisions

- **Challenge pages are never content** (§9.3) — detect and abort before extraction.
- **Handoff tokens**: HMAC, 5-minute TTL, bound to user+node+url; capture endpoint validates the
  token, cookie auth for manual capture; extension↔web-app messaging via origin-scoped
  postMessage + extension storage, never open channels.
- **Captured copies are inert**: scripts stripped in static captures; generated HTML sandboxed in
  iframes; editor UI namespaced and CSS-isolated in both directions (site CSS must never restyle
  the editor; editor cascades must never leak into editor chrome).
- **Ownership enforced at every mutating endpoint and agent tool** (user→board→node joins).
- **Anti-farm on welcome credits**: normalized email dedup, IP/device window (~30d), disposable
  email domains blocked, global monthly grant budget.
- **Rate limits** shaped to agent reality: per-minute chat cap counted by DISTINCT operation (an
  agent's N tool iterations are ONE message), daily light-turn cap, per-minute ops cap.
- **Billing safety**: holds are atomic; failure always refunds; capture is free so nobody is
  surprise-billed for a paste; the expensive reconstruction path requires explicit user choice.
- **Secrets hygiene** in the codebase (secret scanning as a merge gate at launch), per-provider
  API keys server-side only; users never handle keys.

---

## 13. The visual editor (both shells — the deepest surface)

One editor core, two mounts: injected into the live page (extension) or mounted against a
captured document inside a canvas node (web-shell, entered via the node's Edit button). All
behavior below is required in BOTH; where the canvas mount differs, the difference is noted.

### 13.1 Selection & navigation

- Click-depth selection: first click picks the visually meaningful element; repeated clicks
  drill into nested children. What the user HOVERED is what a click selects (hover and click
  must resolve identically). Escape climbs one level. A breadcrumb shows the ancestor path.
- Visual-weight filtering: purely structural wrappers with no visual contribution are skipped in
  selection and layers; the page-level wrapper is recognized and named "Page".
- Contextual layer naming from semantics/ARIA/classes/heuristics; double-click renames.
- A find overlay searches elements and cycles matches.

### 13.2 Layers panel (left)

Lazy DOM tree with bidirectional hover sync (hover a row highlights the element and vice versa);
eye toggles visibility; a tab of page sections with drag-to-reorder thumbnails; an assets tab
(images / inline icons / backgrounds).

### 13.3 Inspector (right)

Sections: Link, Container (X/Y/W/H), Typography, Appearance, Fill, Stroke, Effects.
- Every numeric value supports BOTH drag-to-adjust (with axis letters as inert prefixes) and
  click-to-type; empty/invalid input restores the previous value (fields can never be blanked).
- All fields share one exact control height (uniform rhythm — this was a standing user rule).
- Empty sections collapse to a "+" and auto-expand when content exists.
- X/Y on statically-positioned elements auto-promote the element to positionable on first write,
  and read back from the correct coordinate context.
- Typography: family combobox with search-as-you-type; size presets; weight; line-height and
  letter-spacing with draggable icons; alignment (H+V); case; decoration; bold/italic toggles.
  Text colors live in Fill.
- Fill widget: solid color (custom canvas picker — HSB box + hue + alpha, no external deps),
  gradient editor (linear/radial, draggable stops on a preview bar, click-to-add, reverse),
  image fill, and an animated CSS effects gallery — all applicable to text via background-clip
  when targeting text. Per-row visibility eye + remove. Format dropdown (HEX/RGB/HSL/HSB/CSS).
  A color library holds custom swatches plus colors harvested from the site's own stylesheets,
  with an eyedropper.
- A compact "Selection colors" row summarizes >4 distinct colors with swatches + "+N".
- Link section: recognize an element that IS a link (strict detection), wrap/unwrap, edit href.
- A link/unlink chain icon scopes any edit to the single element (default) or its CSS class.

### 13.4 Direct manipulation on the page

- **Spacing guides**: pink draggable guides for margin/padding/gap with: modifier keys (mirror
  opposite side / uniform all sides / snap-to-grid), arrow-key nudging with modifiers, a global
  guides toggle key, double-click inline value input (accepting units and +/- deltas), live
  delta preview while dragging, and 4 corner handles that adjust two sides at once. Guides never
  swallow clicks meant for the page (drag threshold; a plain click passes through and selects).
- **Resize handles** on the selection with correct west/north compensation (the dragged edge
  follows the mouse) and a small threshold so a bare click never resizes.
- **Text editing**: double-click for in-place editing (inline children preserved); typography
  edits during an active text selection scope to the selected RANGE (wrapping it, reusing the
  wrapper on consecutive edits).
- **Smart text cascade**: wrappers around split/nested text are detected; a style applied to the
  wrapper cascades to the text leaves; consolidated reads show "Mixed" when leaves diverge.
- **Image/video handling**: replace via upload/URL; images inserted as real elements, not
  backgrounds.
- **Minidocks** (small floating action bars near the selection): image dock (copy / replace /
  download / smart-edit / close), text dock (font / size / weight / letter-spacing / line-height
  — each value draggable AND click-to-type, with permanent icons), both with link buttons and a
  shared font picker. On the canvas mount the text dock auto-dismisses after significant
  pan/scroll.
- **Undo/redo** across every operation type (style, cascade, text, structure, link, coordinate
  changes — coordinate undo restores the position mode too), plus cut/copy/paste of elements and
  keyboard shortcuts that defer to native behavior while typing in any field.
- **Persistence**: continuous local auto-save with a versions history panel and restore;
  in edit mode on the canvas, Done captures the cleaned document (all editor artifacts stripped)
  as a new version; Cancel offers discard/save; reset-to-original always available.

### 13.5 Making edits stick (live sites — extension mount)

Framework-rendered sites (React/Framer/Hydrogen) rewrite inline styles and classes on their next
render. Defense in depth, applied automatically per edited element: important-flagged inline
writes → an ID-scoped rule when the framework rewrites classes → a mutation observer that
re-asserts the write when the framework rewrites style (with loop protection and
disable-after-repeated-failure). Undo must disarm the observer before restoring. Site animations
can be frozen (GSAP/Lenis/Webflow interactions) for stable editing, and 8 major builders are
detected to tune behavior.

### 13.6 Canvas-mount specifics

- Entering edit **frames the node** width-fit (max zoom where the node's width fills the
  viewport) with the node top at the viewport top; a frame-back control returns to the pre-edit
  view.
- Wheel while editing: bare wheel pans the canvas vertically (horizontal damped for trackpads);
  modifier zooms; the site's own internal scroll is disabled during edit.
- Every drag interaction must listen on BOTH documents (host and embedded) and convert
  coordinates between them, scale-aware — an embedded-page mousemove does not bubble to the
  host, and its coordinates are in embedded-viewport space. (This is the single most recurring
  class of canvas-editor bug; design for it from day one.)
- Overlay boxes (hover/selection/guides) must re-anchor on canvas zoom/pan, not only on
  mousemove.
- Editor popups/menus anchored inside scrollable panels must escape clipping (fixed positioning,
  re-anchored on every show, cleaned up on rebuild).

### 13.7 Cross-cutting editing invariants

- Editor buttons must win over the page's own capture-phase handlers.
- Editor CSS self-injects and is defensively protected against site selectors.
- Keyboard shortcuts are guarded when focus is in any form field.
- Never let a cascade (e.g. recoloring all text) touch the editor's own UI.

---

## 14. Widgets inventory (quick map)

- **Prompt dock** + **chat panel** (§8.3) — bottom of canvas.
- **Boards sidebar** — projects list, user pill (account menu).
- **Credits pill** (§3) — toolbar.
- **Minimap** with fit-selected/fit-all toggle.
- **Zoom controls** with percentage indicator and fit-to-view (selection-aware: frames the
  editing node in edit mode, else the selection, else everything).
- **Node chrome set** (§4.3): floating tag, Edit cluster, right-click menu, expand floater,
  ports, progress ring, version menu, viewport switcher, replace-content overlay.
- **Modals**: bot-challenge (3-step handoff explainer), reset/cancel-edit confirms, plans/
  upgrade, unsaved-work guard. All confirm dialogs support Esc/Enter and click-outside rules.
- **Toasts** — single global slot, info/error, auto-dismiss.
- **Extension widget** (toolbar-invoked floating panel on any page): editor entry, capture &
  send-to-canvas view (board picker + create-new + auto origin discovery), pending-handoff
  callout, settings (per-provider keys for dev), and **Collect Assets**: hover-highlight any
  element with a type pill, click-to-collect (persistent outline on collected items,
  bidirectional hover mirroring between page and widget list), marquee multi-pick,
  right-click depth-stack popup (Photoshop-style, with synthetic "Background" and "Whole
  section" options), grouping of multiple picks preserving their spacing context, font capture
  (matching @font-face, downloading and inlining the file), destination picker (global library /
  project / new), and an unsaved-items guard. The cursor never changes during collection.
- **Editor panels** (§13): layers, inspector, minidocks, fill popup, find overlay, versions
  panel.

---

## 15. Final notes for the rebuilding model

- Build for the designer's hand first: every interaction above exists because a designer
  expected it. When in doubt, choose the behavior a Figma-native user would predict.
- Honor the doctrine hierarchy: deterministic ground truth > model choice > prompt text.
  Fluidity rules (§6) outrank feature completeness — a smaller tool that never stutters beats a
  complete one that does.
- Wrap/truncate rule (standing): never horizontal scroll, never clipped text; a pill that must
  wrap becomes a rounded rectangle.
- Failures are honest: failed generations refund and say so; placeholders show real stages;
  challenge walls get their own state. The tool never pretends.
