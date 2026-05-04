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

## Self-Review Notes

- Schema marks `is_main` as soft convention but doesn't enforce uniqueness — intentional, allows zero or many "main" badges per board.
- `current_snapshot_id` is a forward reference (snapshots references nodes references snapshots). PostgreSQL handles via deferred constraint or NULL on creation; fine.
- "Drag-out from cross-origin iframe" risk is the single biggest unknown. May force same-origin policy for all node iframes (serve from `nodes.uncraft.app/{nodeId}` so all are same-origin to canvas). Resolves at implementation.
- No mention of websocket/realtime status for `/api/edges/:id/apply` — long-running reskin (10–30s LLM calls) needs polling or SSE. Decided in Phase 2 implementation.
