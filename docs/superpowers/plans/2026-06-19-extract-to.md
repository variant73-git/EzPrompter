# "Extract to ▸" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Extract to ▸" submenu to the canvas cord-drop menu that *creates* a new derived node from a source node (site or asset) — the inverse of compose (which overwrites a target). All 7 combos: site→{Design system .md, Content .md, Screenshot, Style template, Prompt}, asset→{Design tokens .md, Prompt}.

**Architecture:** One server route `POST /api/nodes/[id]/extract { to }` dispatches to a pure-ish `lib/extract.js` `runExtract()` that returns `{ kind, meta, html?, designMd?, dataUrl? }`; the route persists a new node + snapshot + edge (mirroring `extractDesign`). The client adds a second-level submenu to `EmptyDropMenu`, conditioned on source kind, and creates a loading placeholder node that swaps to the real node on completion (mirroring the URL-capture placeholder flow). Generators reuse what exists (`generateDesignMd`, `extractContent`) and add four new ones in `lib/extract.js`.

**Tech Stack:** Next.js route handlers, Postgres (`sql` tagged template), Playwright (`captureSnapshot`/`page.setContent` for HTML→screenshot), Anthropic/Gemini SDKs (text + vision via the `callLLM` pattern in `lib/design-md.js`), React (CanvasClient menu), Vitest.

---

## Background (read once)

- **Existing extract pattern** to mirror for persistence: `lib/agent/tools/extract-design.js` `execute()` — loads node+snapshot, generates, `INSERT INTO nodes`, `INSERT INTO snapshots (node_id, html, design_md, source)`, `UPDATE nodes SET current_snapshot_id`, `INSERT INTO edges (... kind 'generic')`, returns result. Abort BEFORE any DB write if generation fails (no orphan node).
- **Generators that already exist:** `generateDesignMd({ html }) → { md, truncated }` (`lib/design-md.js`); `extractContent({ html }) → string` (`lib/demarcelize.js:178`).
- **Screenshot:** `lib/snapshot.js` uses Playwright; `page.screenshot({ type:'png' })`. We add an HTML→PNG helper.
- **LLM call pattern:** `callLLM({ model, system, user, maxTokens, temperature })` in `lib/design-md.js` (text). Vision needs image parts — see Task 6/8 for the exact multimodal shape.
- **Menu:** `EmptyDropMenu({ x, y, onClose, onPick })` at `components/CanvasClient.jsx:3966`; rendered at ~3632 with `emptyDropMenu = { sourceNodeId, x, y, worldX, worldY }`. The cord-drop currently calls `handleCreateEmptyNode(kind, …)`.
- **Placeholder/progress flow** to mirror: `handleAddUrl` in CanvasClient (`placeholderNode = { …, _loading:true }`, `setNodes([...prev, placeholderNode])`, consume SSE, update `_loadingLabel`, swap to real node on done).
- **`to` values:** `'designmd' | 'content' | 'screenshot' | 'style' | 'prompt' | 'tokens'`. (`tokens` is asset-only; `designmd`/`content`/`screenshot`/`style`/`prompt` from site; `prompt` also from asset.)

---

## File Structure

- **Create** `packages/web-shell/lib/extract.js` — `runExtract({ to, node, model? })` dispatcher + the 4 new generators (`screenshotFromHtml`, `promptFromHtml`, `tokensFromImage`, `promptFromImage`) + `htmlToScreenshotDataUrl(html)`. Returns a normalized `{ kind, meta, html, designMd, dataUrl, truncated }` (unused fields null).
- **Create** `packages/web-shell/lib/extract.test.js` — dispatcher routing + arg-validation tests (generators mocked).
- **Create** `packages/web-shell/app/api/nodes/[id]/extract/route.js` — POST handler: auth, ownership, load node+snapshot, `runExtract`, persist node+snapshot+edge, return `{ node }`.
- **Modify** `packages/web-shell/components/CanvasClient.jsx` — `EmptyDropMenu` gains an "Extract to ▸" submenu (options by source kind); `handleExtractTo(to, opts)` creates a loading placeholder + calls the route + swaps on done; pass `sourceKind` to the menu.
- **Modify** `packages/web-shell/lib/api.js` (or wherever `api.*` helpers live) — add `api.extractNode(id, { to })`. (Verify the file; the existing `api.createNode`/`api.runNode` live there.)

All paths relative to repo root. Tests run from `packages/web-shell` via `npx vitest run`.

---

## Task 1: `runExtract` dispatcher skeleton + the two existing-generator combos

**Files:**
- Create: `packages/web-shell/lib/extract.js`
- Test: `packages/web-shell/lib/extract.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/web-shell/lib/extract.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./design-md.js', () => ({ generateDesignMd: vi.fn(async () => ({ md: '# Design', truncated: false })) }));
vi.mock('./demarcelize.js', () => ({ extractContent: vi.fn(async () => '# Content') }));

const { runExtract } = await import('./extract.js');
const siteNode = { id: 's1', kind: 'site', html: '<html><body>hi</body></html>', meta: { name: 'Acme' } };

describe('runExtract — validation', () => {
  it('rejects an unknown `to`', async () => {
    const r = await runExtract({ to: 'banana', node: siteNode });
    expect(r.error).toBe('invalid_to');
  });
  it('rejects a site-only target on an asset node', async () => {
    const asset = { id: 'a1', kind: 'asset', meta: { dataUrl: 'data:image/png;base64,AAA' } };
    const r = await runExtract({ to: 'content', node: asset });
    expect(r.error).toBe('unsupported_combo');
  });
  it('rejects a site node with no html', async () => {
    const r = await runExtract({ to: 'content', node: { id: 's2', kind: 'site', html: null } });
    expect(r.error).toBe('no_source');
  });
});

describe('runExtract — design system (.md)', () => {
  it('returns a designmd node carrying design_md + html template', async () => {
    const r = await runExtract({ to: 'designmd', node: siteNode });
    expect(r.kind).toBe('designmd');
    expect(r.designMd).toBe('# Design');
    expect(r.html).toBe(siteNode.html);          // keeps HTML chassis for applyDesign
    expect(r.meta.name).toMatch(/Acme/);
  });
});

describe('runExtract — content (.md)', () => {
  it('returns a designmd node whose design_md is the extracted content', async () => {
    const r = await runExtract({ to: 'content', node: siteNode });
    expect(r.kind).toBe('designmd');
    expect(r.designMd).toBe('# Content');
    expect(r.meta.name).toMatch(/content/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: FAIL — `Failed to resolve import "./extract.js"`.

- [ ] **Step 3: Write the dispatcher + the two existing-generator combos**

Create `packages/web-shell/lib/extract.js`:

```js
import { generateDesignMd } from './design-md.js';
import { extractContent } from './demarcelize.js';

// Which `to` targets are valid for which source kind. Keeps the route and
// the UI honest about combos that actually have a generator.
const SITE_TARGETS = new Set(['designmd', 'content', 'screenshot', 'style', 'prompt']);
const ASSET_TARGETS = new Set(['tokens', 'prompt']);

// Normalized result the route persists. Unused fields stay null.
function result({ kind, meta, html = null, designMd = null, dataUrl = null, truncated = false }) {
  return { kind, meta, html, designMd, dataUrl, truncated };
}

/**
 * Produce a derived artifact from a source node. Pure of DB — the caller
 * persists. Returns { error } on bad input (never throws for validation);
 * generator failures reject so the route aborts before any write.
 */
export async function runExtract({ to, node, model }) {
  if (!node || !node.id) return { error: 'no_source', message: 'node required' };
  const isSite = node.kind === 'site';
  const isAsset = node.kind === 'asset' || node.kind === 'image';

  const allowed = isSite ? SITE_TARGETS : isAsset ? ASSET_TARGETS : null;
  if (!allowed) return { error: 'unsupported_combo', message: `cannot extract from kind "${node.kind}"` };
  if (!['designmd', 'content', 'screenshot', 'style', 'prompt', 'tokens'].includes(to)) {
    return { error: 'invalid_to', message: `unknown extract target "${to}"` };
  }
  if (!allowed.has(to)) return { error: 'unsupported_combo', message: `cannot extract "${to}" from a ${node.kind}` };

  const name = node.meta?.name || node.kind;

  if (isSite) {
    if (!node.html) return { error: 'no_source', message: 'site has no snapshot html' };
    switch (to) {
      case 'designmd': {
        const gen = await generateDesignMd({ html: node.html, ...(model ? { model } : {}) });
        return result({ kind: 'designmd', html: node.html, designMd: gen.md, truncated: gen.truncated,
          meta: { name: `${name} — design`, source: 'extract', extractTo: 'designmd', sourceNodeId: node.id } });
      }
      case 'content': {
        const md = await extractContent({ html: node.html, ...(model ? { model } : {}) });
        return result({ kind: 'designmd', designMd: md,
          meta: { name: `${name} — content`, source: 'extract', extractTo: 'content', sourceNodeId: node.id } });
      }
      // screenshot / style / prompt land in later tasks.
    }
  }
  // asset targets land in later tasks.
  return { error: 'not_implemented', message: `extract "${to}" not implemented yet` };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/extract.js packages/web-shell/lib/extract.test.js
git commit -m "feat(extract): runExtract dispatcher + site design-system/content combos"
```

---

## Task 2: `style` (HTML chassis, no LLM) + the extract route

**Files:**
- Modify: `packages/web-shell/lib/extract.js`
- Test: `packages/web-shell/lib/extract.test.js`
- Create: `packages/web-shell/app/api/nodes/[id]/extract/route.js`

- [ ] **Step 1: Add the failing test for `style`**

Append to `packages/web-shell/lib/extract.test.js`:

```js
describe('runExtract — style template', () => {
  it('returns a designmd node with the html chassis and no LLM call', async () => {
    const r = await runExtract({ to: 'style', node: siteNode });
    expect(r.kind).toBe('designmd');
    expect(r.html).toBe(siteNode.html);
    expect(r.designMd).toBeNull();
    expect(r.meta.extractTo).toBe('style');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: FAIL — `style` currently falls through to `not_implemented`.

- [ ] **Step 3: Implement `style` in the site switch**

In `packages/web-shell/lib/extract.js`, add this case inside the `if (isSite)` switch (after `content`):

```js
      case 'style': {
        // No LLM — keep the raw HTML as a reusable style chassis (applyDesign
        // reads the html source; run-flow's md bucket is empty here).
        return result({ kind: 'designmd', html: node.html,
          meta: { name: `${name} — style`, source: 'extract', extractTo: 'style', sourceNodeId: node.id } });
      }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: PASS.

- [ ] **Step 5: Write the route**

Create `packages/web-shell/app/api/nodes/[id]/extract/route.js`. Mirror the auth + ownership shape of the sibling `app/api/nodes/[id]/run/route.js` (READ that file first for the exact `requireUser` import + node/snapshot SELECT join). Then:

```js
import { NextResponse } from 'next/server';
import { sql } from '../../../../../lib/db.js';
import { requireUser } from '../../../../../lib/auth.js';
import { runExtract } from '../../../../../lib/extract.js';

// POST /api/nodes/[id]/extract { to }
// Creates a NEW node derived from node [id]. Mirrors extractDesign's persist
// shape: insert node + snapshot + a 'generic' edge from source → new node.
export async function POST(request, { params }) {
  const { user, error } = await requireUser(request);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const to = body?.to;
  if (!to) return NextResponse.json({ error: 'to required' }, { status: 400 });

  // Load the source node (+ current snapshot html/design_md) scoped to the
  // requesting user's board.
  const rows = await sql`
    SELECT n.id, n.board_id, n.kind, n.meta, s.html, s.design_md
      FROM nodes n
      LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
      JOIN boards b ON b.id = n.board_id
     WHERE n.id = ${id} AND b.user_id = ${user.id}
  `;
  if (!rows.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const src = rows[0];

  let out;
  try {
    out = await runExtract({ to, node: { id: src.id, kind: src.kind, html: src.html, meta: src.meta } });
  } catch (e) {
    return NextResponse.json({ error: 'extract_failed', message: String(e?.message || e) }, { status: 502 });
  }
  if (out.error) {
    const status = out.error === 'unsupported_combo' || out.error === 'invalid_to' ? 400 : 409;
    return NextResponse.json(out, { status });
  }

  // Node dims by produced kind (match handleCreateEmptyNode's DIMS).
  const DIMS = { designmd: { width: 600, height: 600 }, asset: { width: 600, height: 600 }, prompt: { width: 600, height: 200 } };
  const { width, height } = DIMS[out.kind] || DIMS.designmd;

  // Place clear of existing nodes (no overlap — same helper the agent uses).
  const { placeStackDown } = await import('../../../../../lib/canvas-layout.js');
  const { x: posX, y: posY } = await placeStackDown(src.board_id, width, height, sql);

  const meta = { ...out.meta };
  const [node] = await sql`
    INSERT INTO nodes (board_id, kind, pos_x, pos_y, width, height, meta)
    VALUES (${src.board_id}, ${out.kind}, ${posX}, ${posY}, ${width}, ${height}, ${JSON.stringify(meta)}::jsonb)
    RETURNING id, board_id, kind, pos_x, pos_y, width, height, meta, created_at
  `;
  const [snap] = await sql`
    INSERT INTO snapshots (node_id, html, design_md, source)
    VALUES (${node.id}, ${out.html}, ${out.designMd}, 'extract')
    RETURNING id
  `;
  await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;
  if (out.dataUrl) {
    await sql`UPDATE nodes SET meta = meta || ${JSON.stringify({ dataUrl: out.dataUrl })}::jsonb WHERE id = ${node.id}`;
    node.meta = { ...node.meta, dataUrl: out.dataUrl };
  }
  try {
    await sql`INSERT INTO edges (board_id, source_node_id, target_node_id, kind)
              VALUES (${src.board_id}, ${src.id}, ${node.id}, 'generic')`;
  } catch (_) { /* dup edge — ignore */ }

  return NextResponse.json({ node, truncated: out.truncated });
}
```

- [ ] **Step 6: Verify the route file parses + suite still green**

Run: `cd packages/web-shell && npx vitest run`
Expected: full suite green (1 pre-existing `caps.test.js` failure may remain depending on env — confirm no NEW failures, and `lib/extract.test.js` passes).

- [ ] **Step 7: Commit**

```bash
git add packages/web-shell/lib/extract.js packages/web-shell/lib/extract.test.js packages/web-shell/app/api/nodes/\[id\]/extract/route.js
git commit -m "feat(extract): style-template combo + POST /api/nodes/[id]/extract route"
```

---

## Task 3: `screenshot` (HTML→PNG)

**Files:**
- Modify: `packages/web-shell/lib/extract.js`
- Test: `packages/web-shell/lib/extract.test.js`

- [ ] **Step 1: Add the failing test (generator mocked)**

Append to `packages/web-shell/lib/extract.test.js` — at the TOP add a mock for the screenshot helper's playwright dependency by mocking the helper itself via a spy export. Simplest: mock `playwright` is heavy; instead test the dispatcher wiring by mocking the internal helper through a module seam. Add:

```js
vi.mock('playwright', () => ({
  chromium: { launch: vi.fn(async () => ({
    newPage: vi.fn(async () => ({
      setContent: vi.fn(async () => {}),
      screenshot: vi.fn(async () => Buffer.from('PNGBYTES')),
    })),
    close: vi.fn(async () => {}),
  })) },
}));

describe('runExtract — screenshot', () => {
  it('returns an asset node with a png data URL', async () => {
    const r = await runExtract({ to: 'screenshot', node: siteNode });
    expect(r.kind).toBe('asset');
    expect(r.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(r.meta.extractTo).toBe('screenshot');
  });
});
```

(Place the `vi.mock('playwright', …)` call beside the other `vi.mock` calls at the top of the file, before the `await import('./extract.js')`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: FAIL — `screenshot` falls through to `not_implemented`.

- [ ] **Step 3: Implement `htmlToScreenshotDataUrl` + the `screenshot` case**

In `packages/web-shell/lib/extract.js`, add the helper near the top (after imports):

```js
// Render a standalone HTML string to a PNG data URL via headless Chromium.
// Used for site→Screenshot extraction (the node's snapshot HTML, not a URL).
export async function htmlToScreenshotDataUrl(html, { width = 1280, height = 800 } = {}) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(html, { waitUntil: 'networkidle' });
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    return `data:image/png;base64,${buf.toString('base64')}`;
  } finally {
    await browser.close();
  }
}
```

Add to the site switch (after `style`):

```js
      case 'screenshot': {
        const dataUrl = await htmlToScreenshotDataUrl(node.html);
        return result({ kind: 'asset', dataUrl,
          meta: { name: `${name} — screenshot`, source: 'extract', extractTo: 'screenshot', sourceNodeId: node.id } });
      }
```

Note: `newPage({ viewport })` — if the installed Playwright version rejects viewport on `newPage`, set it via `page.setViewportSize({ width, height })` after `newPage()`. Verify against `lib/snapshot.js`'s usage.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/extract.js packages/web-shell/lib/extract.test.js
git commit -m "feat(extract): site→screenshot (HTML→PNG via Playwright)"
```

---

## Task 4: `prompt` from a site (text LLM)

**Files:**
- Modify: `packages/web-shell/lib/extract.js`
- Test: `packages/web-shell/lib/extract.test.js`

- [ ] **Step 1: Add the failing test**

Append to `packages/web-shell/lib/extract.test.js` (the `design-md.js` mock already stubs `generateDesignMd`; add a sibling generator there). Update the `./design-md.js` mock at the top to also export a text-LLM seam, OR mock a new small module. Use a new module seam `./extract-llm.js`:

Add a mock at the top:

```js
vi.mock('./extract-llm.js', () => ({
  describeSiteAsPrompt: vi.fn(async () => 'A bold fintech landing page, navy + lime, tight grotesk headlines.'),
  describeImageAsTokens: vi.fn(async () => '# Tokens\n- navy #0b1f3a'),
  describeImageAsPrompt: vi.fn(async () => 'Editorial product shot, soft daylight, muted palette.'),
}));

describe('runExtract — site→prompt', () => {
  it('returns a prompt node whose meta.prompt is the description', async () => {
    const r = await runExtract({ to: 'prompt', node: siteNode });
    expect(r.kind).toBe('prompt');
    expect(r.meta.prompt).toMatch(/fintech/i);
    expect(r.meta.extractTo).toBe('prompt');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: FAIL.

- [ ] **Step 3: Create the LLM seam + wire the case**

Create `packages/web-shell/lib/extract-llm.js` (text + vision generators, isolated so `extract.js` stays testable). Reuse the `callLLM` shape from `lib/design-md.js` (READ it for the exact Anthropic/Gemini client setup) — text variant:

```js
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_HTML = 60000;
function isAnthropic(m) { return /^(claude|opus|sonnet|haiku)/i.test(m); }

async function callText({ model = DEFAULT_MODEL, system, user, maxTokens = 1200 }) {
  if (isAnthropic(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const final = await client.messages.stream({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }).finalMessage();
    return (final.content?.map((b) => b.text || '').join('') || '').trim();
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const ai = new GoogleGenAI({ apiKey });
  const resp = await ai.models.generateContent({ model, contents: [{ role: 'user', parts: [{ text: user }] }], config: { systemInstruction: system, maxOutputTokens: maxTokens } });
  return (resp.text || resp.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '').trim();
}

// Vision: dataUrl → text. Anthropic image block / Gemini inlineData.
async function callVision({ model = DEFAULT_MODEL, system, user, dataUrl, maxTokens = 1200 }) {
  const [, mediaType, b64] = /^data:([^;]+);base64,(.+)$/.exec(dataUrl) || [];
  if (!b64) throw new Error('callVision: dataUrl must be base64');
  if (isAnthropic(model)) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const final = await client.messages.stream({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
      { type: 'text', text: user },
    ] }] }).finalMessage();
    return (final.content?.map((b) => b.text || '').join('') || '').trim();
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const ai = new GoogleGenAI({ apiKey });
  const resp = await ai.models.generateContent({ model, contents: [{ role: 'user', parts: [
    { inlineData: { mimeType: mediaType, data: b64 } }, { text: user },
  ] }], config: { systemInstruction: system, maxOutputTokens: maxTokens } });
  return (resp.text || resp.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '').trim();
}

export async function describeSiteAsPrompt({ html, model }) {
  const system = 'You write concise, reusable image/site GENERATION PROMPTS. Given a website HTML, output ONE paragraph (<= 80 words) capturing its art direction — layout feel, color palette, typography character, mood. No preamble, no markdown, just the prompt text.';
  return callText({ model, system, user: `HTML:\n${String(html).slice(0, MAX_HTML)}` });
}
export async function describeImageAsTokens({ dataUrl, model }) {
  const system = 'You are a design-tokens extractor. Given an image, output a short DESIGN.md (markdown) listing the palette (hex), type character, spacing/shape feel. Be concrete and brief. Markdown only.';
  return callVision({ model, system, user: 'Extract the design tokens from this image.', dataUrl });
}
export async function describeImageAsPrompt({ dataUrl, model }) {
  const system = 'You reverse-engineer a concise image GENERATION PROMPT from an image. Output ONE paragraph (<= 60 words): subject, composition, lighting, palette, style. No preamble, just the prompt.';
  return callVision({ model, system, user: 'Describe this image as a generation prompt.', dataUrl });
}
```

Then in `packages/web-shell/lib/extract.js`, import and wire the site `prompt` case:

```js
import { describeSiteAsPrompt, describeImageAsTokens, describeImageAsPrompt } from './extract-llm.js';
```

Add to the site switch (after `screenshot`):

```js
      case 'prompt': {
        const text = await describeSiteAsPrompt({ html: node.html, ...(model ? { model } : {}) });
        return result({ kind: 'prompt',
          meta: { name: `${name} — prompt`, prompt: text, source: 'extract', extractTo: 'prompt', sourceNodeId: node.id } });
      }
```

Note: the route stores prompt content in `meta.prompt` (matches `run-flow.js` reading `meta.prompt`). No snapshot html/design_md for prompt nodes — the route already passes `out.html`/`out.designMd` as null.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/extract.js packages/web-shell/lib/extract-llm.js packages/web-shell/lib/extract.test.js
git commit -m "feat(extract): site→prompt + extract-llm text/vision seam"
```

---

## Task 5: asset combos — `tokens` and `prompt`

**Files:**
- Modify: `packages/web-shell/lib/extract.js`
- Test: `packages/web-shell/lib/extract.test.js`

- [ ] **Step 1: Add the failing tests**

Append to `packages/web-shell/lib/extract.test.js`:

```js
const assetNode = { id: 'a1', kind: 'asset', meta: { name: 'shot', dataUrl: 'data:image/png;base64,AAA' } };

describe('runExtract — asset→tokens', () => {
  it('returns a designmd node from the image', async () => {
    const r = await runExtract({ to: 'tokens', node: assetNode });
    expect(r.kind).toBe('designmd');
    expect(r.designMd).toMatch(/Tokens/);
    expect(r.meta.extractTo).toBe('tokens');
  });
  it('rejects an asset with no image data', async () => {
    const r = await runExtract({ to: 'tokens', node: { id: 'a2', kind: 'asset', meta: {} } });
    expect(r.error).toBe('no_source');
  });
});

describe('runExtract — asset→prompt', () => {
  it('returns a prompt node from the image', async () => {
    const r = await runExtract({ to: 'prompt', node: assetNode });
    expect(r.kind).toBe('prompt');
    expect(r.meta.prompt).toMatch(/editorial/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: FAIL — asset branch returns `not_implemented`.

- [ ] **Step 3: Implement the asset branch**

In `packages/web-shell/lib/extract.js`, replace the trailing `// asset targets land in later tasks.` + `return { error: 'not_implemented' …}` with:

```js
  if (isAsset) {
    const dataUrl = node.meta?.dataUrl;
    if (!dataUrl) return { error: 'no_source', message: 'asset has no image data' };
    switch (to) {
      case 'tokens': {
        const md = await describeImageAsTokens({ dataUrl, ...(model ? { model } : {}) });
        return result({ kind: 'designmd', designMd: md,
          meta: { name: `${name} — tokens`, source: 'extract', extractTo: 'tokens', sourceNodeId: node.id } });
      }
      case 'prompt': {
        const text = await describeImageAsPrompt({ dataUrl, ...(model ? { model } : {}) });
        return result({ kind: 'prompt',
          meta: { name: `${name} — prompt`, prompt: text, source: 'extract', extractTo: 'prompt', sourceNodeId: node.id } });
      }
    }
  }
  return { error: 'not_implemented', message: `extract "${to}" not implemented yet` };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/web-shell && npx vitest run lib/extract.test.js`
Expected: PASS — all extract tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/lib/extract.js packages/web-shell/lib/extract.test.js
git commit -m "feat(extract): asset→tokens and asset→prompt (vision)"
```

---

## Task 6: client API helper + `handleExtractTo` with loading placeholder

**Files:**
- Modify: `packages/web-shell/lib/api.js` (verify path — where `createNode`/`runNode` live)
- Modify: `packages/web-shell/components/CanvasClient.jsx`

- [ ] **Step 1: Add the API helper**

First confirm the file: `cd packages/web-shell && grep -rln "createNode" lib/ | grep -i api`. In that file, next to `createNode`, add:

```js
  async extractNode(id, { to }) {
    const res = await fetch(`/api/nodes/${id}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ to }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || `extract failed (${res.status})`);
    }
    return res.json();
  },
```

- [ ] **Step 2: Add `handleExtractTo` in CanvasClient**

In `components/CanvasClient.jsx`, next to `handleCreateEmptyNode` (~1329), add. This mirrors the URL-capture placeholder flow: drop a loading placeholder at the cord-drop point, call the route, swap to the real node on success, auto-link is already created server-side (the route inserts the edge), so refetch edges after.

```jsx
  // "Extract to" flow: derive a NEW node from a source node (site/asset).
  // Unlike Connect-to (empty node to fill later), extract runs a generator
  // and lands a populated node. Shows a loading placeholder while the
  // generator runs (LLM / screenshot can take a few seconds).
  async function handleExtractTo(to, { sourceNodeId, worldX, worldY }) {
    const tmpId = `tmp-extract-${sourceNodeId}-${to}`;
    const placeholder = {
      id: tmpId, board_id: board.id, kind: 'designmd',
      pos_x: worldX, pos_y: worldY, width: 600, height: 200,
      meta: { name: `Extracting ${to}…` }, current_html: null, _loading: true,
      _loadingLabel: 'Extracting…',
    };
    setNodes((prev) => [...prev, placeholder]);
    try {
      const { node } = await api.extractNode(sourceNodeId, { to });
      // Swap the temp placeholder for the real node; pull edges so the
      // source→derived cord (inserted server-side) shows.
      setNodes((prev) => prev.map((n) => (n.id === tmpId ? { ...node, current_html: null } : n)));
      const res = await fetch(`/api/boards/${board.id}`, { credentials: 'include' });
      if (res.ok) { const data = await res.json(); if (Array.isArray(data.edges)) setEdges(data.edges); }
      setTimeout(() => zoomToNode(node, 350, 1), 80);
    } catch (e) {
      setNodes((prev) => prev.filter((n) => n.id !== tmpId));
      toast.error(`Could not extract: ${e.message}`);
    }
  }
```

- [ ] **Step 3: Verify suite still green (no behavior tested yet, just no breakage)**

Run: `cd packages/web-shell && npx vitest run`
Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add packages/web-shell/lib/api.js packages/web-shell/components/CanvasClient.jsx
git commit -m "feat(extract): client extractNode helper + handleExtractTo placeholder flow"
```

---

## Task 7: "Extract to ▸" submenu in `EmptyDropMenu`

**Files:**
- Modify: `packages/web-shell/components/CanvasClient.jsx`

- [ ] **Step 1: Pass source kind into the menu + add the extract callback**

In the `EmptyDropMenu` render (~3632), add `sourceKind` and `onExtract`:

```jsx
      {emptyDropMenu && (
        <EmptyDropMenu
          x={emptyDropMenu.x}
          y={emptyDropMenu.y}
          sourceKind={nodes.find((n) => n.id === emptyDropMenu.sourceNodeId)?.kind || null}
          onClose={() => setEmptyDropMenu(null)}
          onPick={async (kind) => {
            const m = emptyDropMenu;
            setEmptyDropMenu(null);
            await handleCreateEmptyNode(kind, { worldX: m.worldX, worldY: m.worldY, linkFromNodeId: m.sourceNodeId });
          }}
          onExtract={async (to) => {
            const m = emptyDropMenu;
            setEmptyDropMenu(null);
            await handleExtractTo(to, { sourceNodeId: m.sourceNodeId, worldX: m.worldX, worldY: m.worldY });
          }}
        />
      )}
```

- [ ] **Step 2: Add the submenu to the `EmptyDropMenu` component**

Find `function EmptyDropMenu({ x, y, onClose, onPick })` (~3966). Read its current body to match its markup/classes. Replace its signature and add the submenu. The options are conditioned on `sourceKind`:

```jsx
const EXTRACT_OPTIONS = {
  site: [
    { to: 'designmd', label: 'Design system (.md)' },
    { to: 'content',  label: 'Content (.md)' },
    { to: 'screenshot', label: 'Screenshot' },
    { to: 'style',    label: 'Style template' },
    { to: 'prompt',   label: 'Prompt' },
  ],
  asset: [
    { to: 'tokens', label: 'Design tokens (.md)' },
    { to: 'prompt', label: 'Prompt' },
  ],
};

function EmptyDropMenu({ x, y, sourceKind, onClose, onPick, onExtract }) {
  const [extractOpen, setExtractOpen] = useState(false);
  const extractOpts = EXTRACT_OPTIONS[sourceKind === 'image' ? 'asset' : sourceKind] || null;
  // ... keep the existing menu chrome (positioning wrapper + the Connect-to
  // option rows rendered via onPick). Append the Extract-to row when
  // extractOpts is non-null:
  // (inside the existing menu container, after the Connect-to options)
  return (
    /* existing wrapper */
    <>
      {/* existing Connect-to rows (unchanged) */}
      {extractOpts && (
        <div className="empty-drop-extract">
          <button
            type="button"
            className="empty-drop-item empty-drop-submenu-trigger"
            onMouseEnter={() => setExtractOpen(true)}
            onClick={() => setExtractOpen((v) => !v)}
          >
            Extract to ▸
          </button>
          {extractOpen && (
            <div className="empty-drop-submenu" onMouseLeave={() => setExtractOpen(false)}>
              {extractOpts.map((o) => (
                <button key={o.to} type="button" className="empty-drop-item"
                  onClick={() => onExtract?.(o.to)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
```

IMPORTANT: read the real `EmptyDropMenu` body first and integrate this submenu into its EXISTING JSX/structure and class names — do not replace its working Connect-to markup. The snippet above shows only the ADDED submenu block and the new props/state.

- [ ] **Step 3: Add minimal submenu CSS**

In `app/globals.css`, near the existing `.empty-drop-menu` rules, add:

```css
.empty-drop-extract { position: relative; }
.empty-drop-submenu {
  position: absolute;
  left: 100%;
  top: 0;
  margin-left: 4px;
  min-width: 180px;
  background: var(--bg-frosted);
  backdrop-filter: blur(var(--blur-chrome)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--blur-chrome)) saturate(140%);
  border: 1px solid var(--border-frosted);
  border-radius: 12px;
  box-shadow: var(--shadow-frost);
  padding: 4px;
  z-index: 10;
}
.empty-drop-submenu-trigger { display: flex; justify-content: space-between; }
```

(Match the exact `.empty-drop-item` look from the existing menu — reuse that class so rows are visually identical.)

- [ ] **Step 4: Manual verification (no automated test — it's interactive UI)**

Run: `cd packages/web-shell && npm run dev`, then in the canvas drag a cord from a **site** node onto empty canvas → the menu shows "Connect to" options AND "Extract to ▸"; hovering it reveals the 5 site options; clicking "Content (.md)" lands a populated `.md` node wired from the source. Repeat from an **asset** node → only "Design tokens (.md)" + "Prompt". Confirm: placeholder shows "Extracting…", swaps to the real node, camera frames it (Task 6), and the source→derived cord appears.

- [ ] **Step 5: Commit**

```bash
git add packages/web-shell/components/CanvasClient.jsx packages/web-shell/app/globals.css
git commit -m "feat(extract): Extract to submenu in the cord-drop menu (by source kind)"
```

---

## Self-Review notes

- **Spec coverage (audit D3 table):** site→Design system ✓ (T1), site→Content ✓ (T1), site→Screenshot ✓ (T3), site→Style template ✓ (T2), site→Prompt ✓ (T4), asset→Design tokens ✓ (T5), asset→Prompt ✓ (T5); route ✓ (T2); submenu by source kind ✓ (T7); extract-creates-a-node mechanic (placeholder + progress, mirrors captureUrl) ✓ (T6); source→derived edge ✓ (route T2). No-overlap placement reused via `placeStackDown` ✓ (T2).
- **Placeholder scan:** every code step shows complete code; the two UI tasks (T7 especially) explicitly require reading the existing `EmptyDropMenu`/`api.js` bodies first and say exactly what to add — flagged, not vague.
- **Type consistency:** `runExtract({ to, node, model })` → `{ kind, meta, html, designMd, dataUrl, truncated }` used identically in `extract.js`, the route, and tests. `to` enum `designmd|content|screenshot|style|prompt|tokens` consistent across dispatcher, route, UI `EXTRACT_OPTIONS`. `extract-llm.js` exports `describeSiteAsPrompt`/`describeImageAsTokens`/`describeImageAsPrompt` — names match the mock and the imports. `api.extractNode(id, { to })` matches `handleExtractTo`'s call.
- **Out of scope (audit items NOT in this plan):** D1 overwrite hardening, D2 single-engine rule, operation chip, legacy kind cleanup. Those are separate plans.
