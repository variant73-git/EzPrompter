# Canvas — Web Product Design Spec

**Date:** 2026-05-03
**Branch:** `feat/canvas`
**Backup:** `~/Desktop/IA/Uncraft-2.4.0-backup-2026-05-03/` + git tag `backup-pre-monorepo-2026-05-03`

## Overview

Canvas is a parallel SaaS product to the Uncraft Chrome extension. It runs the **same editing tool** (layers, inspector, guides, modes) but inside a logged-in web app at `uncraft.app/canvas` (working domain TBD). Designers add sites, templates, and design.md files as nodes on a free-arrangement canvas, connect them with declarative edges (transplant sections, swap tokens, reskin), and edit any node with the existing editor.

The Mode E pipeline (vision→code rebuild) is **deferred to a future Pro tier**. v1 ships purely on Demarcelizer-style operations (Playwright capture + Sonnet/Gemini-based merge of HTML+design.md).

Billing and marketing landing page are **deferred** — out of scope for this spec.

## Locked Architectural Decisions

1. **Surface:** logged-in web app, separate Next.js product in `packages/web-shell/`.
2. **Node rendering:** `<iframe srcDoc={html}>` per node. 5–10 nodes target. No virtualization, no preview-image fallback. Pan/zoom via `react-zoom-pan-pinch`.
3. **Graph model:** symmetric — every node is equal. Soft "main" convention via visual ring/glow on first added node; mechanically all nodes can be source/target of any edge. Drag-out of any element from any iframe creates a new node.
4. **Ingestion:** server-side capture via Playwright (Browserbase or Vercel `@sparticuz/chromium`). Resolves X-Frame-Options blocker by serving captured HTML through our origin via `srcDoc`.
5. **Transfer types in v1:**
   - `transplant` — DOM swap section X of A → section Y of B. Pure DOM, no LLM.
   - `token-swap` — extract CSS variables (colors/fonts) from A, rewrite in B. Light scripting, no LLM.
   - `reskin` — Demarcelizer pipeline (`EXTRACT_SYSTEM` + `INJECT_SYSTEM` + `RESKIN_SYSTEM` prompts) ported as Vercel routes. Sonnet/Gemini-based, ~$0.10–0.30/call.
6. **Deferred to Pro:** Mode E (vision→code rebuild), conversational chat instructions on edges.
7. **Code sharing:** monorepo workspaces. `packages/editor-core/` is consumed by both `packages/extension-shell/` and `packages/web-shell/`. Single source of truth.
8. **Transport abstraction:** editor-core takes a `UncraftTransport` injected by the shell. Extension provides `ChromeTransport`, web provides `HttpTransport`. Editor never touches `chrome.*` directly.
9. **Superwidget:** lives in editor-core. Both shells consume it. Tools: Add URL, Add Template, Upload .MD, chat (LLM-gated). Same UX in both products.

## Repository Structure (post-refactor)

```
Uncraft/
├── packages/
│   ├── editor-core/             ← all editor logic (~1MB editor.js + supporting modules)
│   │   ├── src/
│   │   │   ├── editor.js
│   │   │   ├── layers.js, inspector.js, guides.js, fill-popup.js, persist.js
│   │   │   ├── modes/ {a-css-live, b-mirror, e-vision, e-classic, e2-fast, s2h}
│   │   │   ├── transport/UncraftTransport.ts (interface)
│   │   │   ├── superwidget.js
│   │   │   └── mountEditor.js (entry: mountEditor({ root, transport, options }))
│   │   ├── package.json
│   │   └── build.config.js
│   ├── extension-shell/         ← Chrome extension
│   │   ├── manifest.json
│   │   ├── background.js (service worker, owns chrome.runtime.onMessage)
│   │   ├── content.js (loads editor-core, wires ChromeTransport)
│   │   ├── transport/ChromeTransport.ts
│   │   ├── popup/ panel/
│   │   └── package.json
│   └── web-shell/               ← Next.js canvas app (current web/ folder, restructured)
│       ├── app/
│       │   ├── (auth)/login, signup
│       │   ├── canvas/[boardId]/page.tsx
│       │   └── api/
│       │       ├── boards/, nodes/, edges/, snapshot/, demarcelize/
│       │       └── auth/
│       ├── components/
│       │   ├── Canvas.tsx (TransformWrapper)
│       │   ├── Node.tsx (iframe srcDoc + drag handle)
│       │   ├── EdgeLayer.tsx (SVG paths between nodes)
│       │   └── Superwidget.tsx (mounts editor-core's superwidget)
│       ├── lib/
│       │   ├── transport/HttpTransport.ts
│       │   ├── auth.js, db.js, redis.js, stripe.js
│       │   └── playwright.ts (Browserbase wrapper)
│       └── package.json
├── package.json (workspaces)
├── docs/
└── research/
```

## UncraftTransport Interface

```ts
interface UncraftTransport {
  callLLM(req: LLMRequest): Promise<LLMResponse>
  capture(viewport: ViewportSpec): Promise<{ dataUrl: string; width: number; height: number }>
  storeKey(name: string, value: string): Promise<void>
  readKey(name: string): Promise<string | null>
  injectCSS(target: 'self' | 'iframe', css: string): Promise<void>
  // Optional capabilities — shells may throw NotSupported
  scrapeURL?(url: string): Promise<{ html: string; assets: AssetManifest }>
}
```

Editor-core code never imports `chrome.*` or `fetch` directly. All side effects flow through `transport`.

## Postgres Schema

```sql
CREATE TABLE users (...);                       -- already exists, extends with org_id later

CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INT NOT NULL REFERENCES users(id),
  name VARCHAR(120) NOT NULL DEFAULT 'Untitled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL,                    -- site | template | designmd | chunk
  origin_url TEXT,                              -- when kind=site
  template_slug VARCHAR(120),                   -- when kind=template
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 1280,
  height REAL NOT NULL DEFAULT 800,
  is_main BOOLEAN DEFAULT FALSE,                -- soft convention, not enforced
  current_snapshot_id UUID REFERENCES snapshots(id),
  meta JSONB DEFAULT '{}',                      -- name, color, tags
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  html TEXT NOT NULL,                           -- the actual srcDoc content
  design_md TEXT,                               -- extracted DESIGN.md if available
  screenshot_url TEXT,                          -- blob storage URL
  source VARCHAR(20) NOT NULL,                  -- capture | edit | reskin | transplant | upload
  parent_snapshot_id UUID REFERENCES snapshots(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL,                    -- transplant | token-swap | reskin
  payload JSONB NOT NULL DEFAULT '{}',          -- {sourceSelector, targetSelector} for transplant; {} for token-swap; {} for reskin
  status VARCHAR(20) DEFAULT 'pending',         -- pending | applied | failed
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nodes_board ON nodes(board_id);
CREATE INDEX idx_snapshots_node ON snapshots(node_id, created_at DESC);
CREATE INDEX idx_edges_board ON edges(board_id);
```

## Server Routes (web-shell)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/signup` | POST | email/password signup |
| `/api/auth/login` | POST | session cookie issue |
| `/api/auth/logout` | POST | session destroy |
| `/api/boards` | GET / POST | list / create boards |
| `/api/boards/:id` | GET / PATCH / DELETE | board ops |
| `/api/nodes` | POST | create node (kind, origin_url, etc.) |
| `/api/nodes/:id` | PATCH / DELETE | update position/size, delete |
| `/api/nodes/:id/snapshot` | POST | trigger fresh capture for site nodes |
| `/api/edges` | POST | create edge between nodes |
| `/api/edges/:id` | PATCH / DELETE | update payload, remove |
| `/api/edges/:id/apply` | POST | execute the edge (transplant/token-swap/reskin) → new snapshot on target |
| `/api/snapshot/capture` | POST | server-side Playwright capture for any URL → returns html+screenshot |
| `/api/demarcelize/extract` | POST | EXTRACT_SYSTEM prompt → JSON of structured content |
| `/api/demarcelize/inject` | POST | INJECT_SYSTEM prompt → reference HTML with target content slotted |
| `/api/demarcelize/reskin` | POST | RESKIN_SYSTEM prompt → end-to-end reskin |
| `/api/templates` | GET | list `temas/` catalog |

## Phased Execution

### Phase 1 — Monorepo refactor (~10–15h autonomous)

1. Set up workspaces (`package.json` workspaces, build configs)
2. Create `packages/editor-core/`, `packages/extension-shell/`, `packages/web-shell/`
3. Move `editor/*`, `overlay/*`, `panel/*` → `packages/editor-core/src/`
4. Move `manifest.json`, `background.js`, `content.js`, `popup/` → `packages/extension-shell/`
5. Move existing `web/*` → `packages/web-shell/`
6. Define `UncraftTransport` interface in `editor-core/src/transport/`
7. Implement `ChromeTransport` in `extension-shell/transport/` — wraps all `chrome.runtime/storage/tabs/scripting` calls
8. Implement `HttpTransport` stub in `web-shell/lib/transport/`
9. Refactor editor-core code: replace `chrome.runtime.sendMessage(...)` etc. with `transport.callLLM/capture/storeKey/readKey/injectCSS`
10. Wire extension-shell bootstrap to call `mountEditor({ root: document, transport: new ChromeTransport(), options: {...} })`
11. Build extension-shell to produce a loadable Chrome extension dir
12. Smoke-test: extension still loads, opens widget, activates editor on a real site, layers panel renders, inspector edits work, undo/redo works

**Phase 1 commit cadence:**
- After workspace scaffold
- After editor-core file move
- After transport interface
- After ChromeTransport
- After extension-shell rewire
- After smoke-test passes

### Phase 2 — Canvas v1 (~25–35h autonomous)

1. Postgres schema migrations (`packages/web-shell/migrations/`)
2. Auth: signup/login/logout API routes + middleware (extends existing `lib/auth.js`)
3. `/api/snapshot/capture` route — Browserbase or `@sparticuz/chromium` integration
4. `/api/demarcelize/*` routes — port `Demarcelizer 2.0/server.ts` prompts to Vercel
5. `/api/templates` — read `temas/` (copy or symlink subset for v1)
6. Canvas surface UI — `Canvas.tsx` with `react-zoom-pan-pinch`
7. `Node.tsx` — iframe srcDoc, drag/select/resize handles
8. `EdgeLayer.tsx` — SVG paths between nodes, edge editor popup
9. `Superwidget.tsx` — mounts editor-core's superwidget, wired with `HttpTransport`
10. Wire editor-core into iframe of focused node — same `mountEditor()` call, transport-aware
11. Drag-out: detect drag from inside iframe → cross-boundary handoff → create node with chunk HTML
12. End-to-end: signup → create board → Add URL → see node → connect edge → apply transplant → see updated node

**Phase 2 commit cadence:** after each numbered item.

## Out of Scope (v1)

- Billing per board
- Marketing landing page
- Mode E (vision→code rebuild)
- Conversational chat instructions on edges
- Real-time collaboration (multi-user same board)
- Sharing boards via public link
- Library tab (saved sections persistent across boards)
- Component Library / saved chunks across boards (memory `feature_component_library.md`)
- Mobile responsiveness of the canvas itself

## Known Risks

1. **Visual verification without human eyes.** Smoke tests can confirm code paths, not UX correctness. Final eval requires manual run by user.
2. **Browserbase/Playwright on Vercel cold start.** Mitigation: try `@sparticuz/chromium` first (no third-party dep); fall back to Browserbase if function size limits hit.
3. **Editor-core refactor regression on extension.** Mitigation: aggressive grep for `chrome.*` calls before declaring transport extraction complete; smoke-test extension after each large move.
4. **iframe srcDoc with cross-origin assets.** Captured HTML may reference images/fonts from origin domains with CORS limits. Server should rewrite asset URLs to absolute or proxy through our origin.
5. **Drag-out from cross-origin iframe.** Browser blocks DataTransfer access across origins. Workaround: postMessage protocol between iframe (editor-core) and parent canvas — extension-shell already uses similar pattern for popup ↔ background.

## Phase 3 — Editor.js host/target refactor (handoff for new session)

**Why:** Web canvas v1 (Phase 2) shipped a small React placeholder editor
(CanvasEditor + EditorOverlay + EditorLayers + EditorInspector under
`packages/web-shell/components/editor/`). User confirmed the architecture
(panels portaled to document.body, viewport-pinned, frosted glass), but
needs **1:1 feature parity with the extension's editor.js** — that's not
realistic to rewrite in React (~1MB of mature code). Right approach: port
editor.js to support two documents (host = where panels live, target =
where edited content lives) so the SAME code drives both products.

**Contract (mountEditor signature evolves):**

```js
mountEditor({
  hostDoc,        // where to create panels + listen for keyboard. Defaults to document.
  hostWin,        // window for hostDoc. Defaults to window.
  targetDoc,      // where the edited content lives. Defaults to hostDoc.
  targetWin,      // window for targetDoc. Defaults to hostWin. Used for getComputedStyle.
  transport,      // existing UncraftTransport
  options
});
```

Extension call site: `mountEditor({ transport: ChromeTransport })` —
omits doc/win, defaults make host === target === document. Behaviour
unchanged. Web canvas call site:
`mountEditor({ hostDoc: parent.document, hostWin: parent.window,
targetDoc: iframe.contentDocument, targetWin: iframe.contentWindow,
transport: HttpTransport })`.

**Files to touch (canonical sources in packages/editor-core/src/):**

| File | Refactor needed |
|---|---|
| `editor.js` (~1MB main file) | Replace `document.*`, `window.*` references. Selection/hover/computed-style → target. Panel creation, keyboard listeners → host. |
| `mountEditor.js` | Accept new options, stash in `__rb*` globals editor.js can read. |
| `fill-popup.js` | Color picker canvas, popup positioning → host. Element style writes → target. |
| `persist.js` | LocalStorage namespacing if both products run on same origin. |
| `freeze.js` | Animation freeze applies to target. |
| `extractor.js` | Reads target DOM for clean HTML / DESIGN.md. |
| `mode-*.js` | Each mode (E, B, S2H, etc.) creates UI in host, manipulates target. |
| `rebuild.js` | Replaces target's body. |
| `detect.js` | Detects builder of target page. |

**Refactor pattern (apply consistently):**

- Replace `document.X` → either `__rbHost.doc.X` (UI) or `__rbTarget.doc.X` (content). Set `window.__rbHost = { doc, win }` and `window.__rbTarget = { doc, win }` in mountEditor before injecting.
- Replace `getComputedStyle(...)` → `__rbTarget.win.getComputedStyle(...)`.
- Replace `window.addEventListener('keydown', ...)` → `__rbHost.win.addEventListener('keydown', ...)`.
- Replace `document.addEventListener('click', ...)` for selection → `__rbTarget.doc.addEventListener('click', ...)`.
- Replace `document.addEventListener('keydown', ...)` for shortcuts → `__rbHost.doc.addEventListener('keydown', ...)`.
- For coordinate math (overlay position, drag tracking): if target ≠ host, screen coords need to compose `iframe.getBoundingClientRect() + el.getBoundingClientRect() * effectiveScale`. EditorOverlay.jsx already does this — port pattern.

**Critical defenses to preserve (from CLAUDE.md / memory — verify each survives the refactor):**

1. **Sticky writes** (MutationObserver-based defense against React/Framer rewriting our inline styles). The observer attaches to TARGET nodes. Make sure observer is created via `__rbTarget.doc`'s MutationObserver constructor (or just `new MutationObserver(...)` is global; ensure observed node is in target).
2. **ID rule fallback** (`#id` selector with `!important` when className is volatile). The `<style>` tag with the rule lives in TARGET head (so the rule applies in target's CSS context). Currently it's `document.head.appendChild(styleEl)` — change to `__rbTarget.doc.head`.
3. **Smart text cascade** for split-text wrappers — pure DOM walk on target, no doc references beyond the cascade root. Should survive untouched.
4. **Framework override anti-loop** (5-rewrites-in-2s disable). Pure logic, no doc refs. Survives.
5. **Position promotion** (`ensurePositionable` writes `position:relative` when static). Touches target. Already uses element ref, no doc lookup.
6. **applyStyle excludes editor UI** (`#rb-editor-root`, `#rb-editor-inspector`, `#rb-ed-banner`). When host ≠ target, the editor UI lives in host; cascade through target won't accidentally find these. But: defensive — keep the exclusion in case host === target.
7. **Popup viewport clamping** (`clampPopupToViewport`). Reads `window.innerWidth/Height`. Should use `__rbHost.win` since popups live in host.
8. **Custom swatches localStorage** (`rb-custom-swatches` key). Use host's localStorage so canvas user's swatches persist per-canvas, not per-iframe-snapshot.
9. **Frosted glass / dark mode CSS isolation** (`font-family !important` in editor.css). CSS injected to host head. Should use `__rbHost.doc.head`.
10. **Mode E pipeline** (currently chrome.runtime.sendMessage). Already routed via `transport.callLLM` (Phase 1.2 scaffolding). Keep that path; just make sure target doc is what gets captured/rebuilt.

**Smoke tests after refactor — must all pass:**

A. **Extension still works (host === target case).**
   - Load `packages/extension-shell/` in Chrome (after `bun run build:editor`).
   - Activate editor on a real site.
   - Verify: layers panel renders, click element selects it, inspector edits propagate, sticky writes survive React rewrite (test on a Framer site like toolfolio.io), Mode A undo/redo, Mode B/E2/EL all activate without throwing, fill popup color picker works.

B. **Web canvas works (host ≠ target case).**
   - `bun run dev:web` → http://localhost:3030
   - Add URL → enter Edit on the node.
   - Verify: layers panel appears in PARENT document (not in iframe), click element in iframe selects it, inspector edits the iframe element, fill popup mounts to parent body, color changes propagate to iframe element.
   - Save → reload → changes persist.

C. **Build + parse:**
   - `bunx next build` (in packages/web-shell) — clean.
   - All editor-core JS files parse with `node -c`.

**Rollback strategy:**

Each commit during the refactor must keep the extension working. After
each chunk, smoke-test (A) before moving on. If broken: `git revert HEAD`
and rethink that chunk. Backup branch protection: tag
`backup-pre-host-target-refactor-2026-05-DD` before starting; if the
refactor goes sideways, `git reset --hard <tag>`.

**Suggested commit cadence (small, reversible):**

1. `refactor(editor-core): mountEditor accepts hostDoc/hostWin/targetDoc/targetWin (defaults to document/window)`
2. `refactor(editor-core): editor.js — replace document refs with __rbHost/__rbTarget (panels, listeners)`
3. `refactor(editor-core): replace getComputedStyle and getBoundingClientRect math for target awareness`
4. `refactor(editor-core): fill-popup.js + persist.js + freeze.js — host/target awareness`
5. `refactor(editor-core): mode-*.js — host/target awareness`
6. `feat(web-shell): replace placeholder React editor with mountEditor() pointing at iframe`
7. `chore(web-shell): delete components/editor/{CanvasEditor,EditorLayers,EditorInspector,EditorOverlay}.jsx (superseded)`

**State at handoff (HEAD of feat/canvas):**

- 11 commits on feat/canvas (from `backup-pre-monorepo-2026-05-03` baseline).
- Extension at `packages/extension-shell/` works after `bun run build:editor`.
- Web canvas at http://localhost:3030 (when dev server running). Functional flows: signup, board create, Add URL → node, drag → empty drop menu (URL/HTML/MD), edge create + apply (transplant works without LLM; reskin needs Anthropic key), placeholder editor on Edit (to be replaced).
- Backup at `~/Desktop/IA/Uncraft-2.4.0-backup-2026-05-03/` + git tag `backup-pre-monorepo-2026-05-03`.

**For the next session — exact prompt to give Claude:**

> Read `docs/superpowers/specs/2026-05-03-canvas-design.md` (especially Phase 3) and `CLAUDE.md`. Then execute the editor.js host/target refactor as specified. Smoke-test the extension after each chunk; do not move on if it breaks. Commit small. Do not modify the React placeholder editor in `packages/web-shell/components/editor/` until the editor-core refactor is done — that's the last step.

## Self-Review Notes

- Schema marks `is_main` as soft convention but doesn't enforce uniqueness — intentional, allows zero or many "main" badges per board.
- `current_snapshot_id` is a forward reference (snapshots references nodes references snapshots). PostgreSQL handles via deferred constraint or NULL on creation; fine.
- "Drag-out from cross-origin iframe" risk is the single biggest unknown. May force same-origin policy for all node iframes (serve from `nodes.uncraft.app/{nodeId}` so all are same-origin to canvas). Resolves at implementation.
- No mention of websocket/realtime status for `/api/edges/:id/apply` — long-running reskin (10–30s LLM calls) needs polling or SSE. Decided in Phase 2 implementation.
