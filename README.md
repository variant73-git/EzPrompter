# Uncraft

> Design without borders.

Visual design tool for the web. Edit any site directly in the browser with layers, inspector, guides, and AI rebuild. Two products:

- **Chrome extension** — inject the editor into any tab. Edit live sites with CSS Live or rebuild via AI (Mode E).
- **Web canvas** — node-graph SaaS at `uncraft.app/canvas`. Add multiple sites/templates/design.mds as nodes, connect with declarative edges (transplant, token-swap, reskin), edit each node with the same editor.

Both products consume **`packages/editor-core/`**, the shared editor library. There is one source of truth for layers/inspector/guides/modes; changes ship to both products through a single workspace.

## Repository layout

```
Uncraft/
├── packages/
│   ├── editor-core/       canonical editor sources (~14 JS files, editor.css, transport interface)
│   ├── extension-shell/   Chrome extension — manifest + background + content + panel + ChromeTransport
│   └── web-shell/         Next.js canvas product — pages, API routes, HttpTransport, snapshot/demarcelize libs
├── scripts/
│   └── build-editor.sh    syncs editor-core → both shells (idempotent)
├── docs/superpowers/specs/2026-05-03-canvas-design.md   design spec
└── package.json           workspaces + dev/build scripts
```

## Setup (one-time)

```bash
bun install
bun run build:editor       # syncs editor-core into both shells
```

## Run the Chrome extension

```bash
bun run build:editor       # populates packages/extension-shell/editor/
```

Then in Chrome → `chrome://extensions` → "Load unpacked" → select `packages/extension-shell/`.

The extension is feature-complete (layers, inspector, guides, fill popup, Mode A live CSS, Mode B/E/E2/EL/S2H AI pipelines, persistence, undo/redo). See `CLAUDE.md` for the full feature inventory.

## Run the web canvas (dev)

Required env (in `packages/web-shell/.env.local`):

```
DATABASE_URL=postgresql://USER:PASS@host.tld/dbname    # Neon
JWT_SECRET=long-random-string                          # session signing
ANTHROPIC_API_KEY=sk-ant-...                           # for /api/demarcelize/*
GEMINI_API_KEY=AI...                                   # alternative LLM
BROWSERBASE_API_KEY=bb_...                             # optional, for production capture; local falls back to playwright-core's bundled chromium

# legacy / optional (Stripe + Upstash for billing — out of scope for v1)
STRIPE_SECRET_KEY=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

```bash
# first run only — install local Chromium for capture
bunx --cwd packages/web-shell playwright install chromium

bun run dev:web            # http://localhost:3030
```

Open `/`, create an account, redirected to `/canvas` (boards list), click "+ New board", land in `/canvas/[boardId]`. The bottom dock is the **superwidget**: Add URL captures a snapshot, Upload .md adds a markdown reference. Drag node handles to reposition. Shift-drag from a handle (or click ↗) to draw an edge to another node. Click an edge to set kind (transplant / token-swap / reskin) and apply.

Click "✎ Edit" on any node's handle to inject the editor (layers panel + inspector + guides) inside that node's iframe.

## Build the web canvas

```bash
bun run build:web          # next build under packages/web-shell
bun run start:web          # next start
```

## Design spec

See [`docs/superpowers/specs/2026-05-03-canvas-design.md`](docs/superpowers/specs/2026-05-03-canvas-design.md) for the locked architectural decisions, schema, and phased plan.

## Backup

The pre-monorepo extension snapshot is at `~/Desktop/IA/Uncraft-2.4.0-backup-2026-05-03/` and at git tag `backup-pre-monorepo-2026-05-03`.
