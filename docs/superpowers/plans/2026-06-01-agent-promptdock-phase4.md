# Agent PromptDock — Phase 4 Implementation Plan (Smart Edit chat dock)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make the existing Smart Edit chat dock (`buildAssetChatDock()` in `editor.js`) work in canvas mode by wiring it to the Phase 1+2+3 agent backend with asset-scoped threads + tool allowlist limited to `createImage` + `getNodeOutput`. The dock already has UI (textarea, model picker, send arrow). Today in canvas it silent-fails because the code path uses `chrome.runtime.sendMessage` which doesn't exist outside the extension.

**Architecture:** New `buildAssetRegistry()` factory in `tools/index.js` registers the 6 safe tools + `createImage`. The route uses it when `threadScope === 'asset'`. The canvas Smart Edit dock's `submit()` detects canvas mode (no `chrome.runtime`) and POSTs to `/api/chat` with `{threadScope: 'asset', assetId, message, tools: ['createImage','getNodeOutput'], systemPromptKey: 'EDIT_IMAGE_SYSTEM'}`. An inline SSE consumer handles `assistant_token` (status text), `tool_call`, `tool_status` (when `createImage` is `done`, get `result.dataUrl` and render in dock), `needs_choice` (auto-confirm if length 1, else show inline picker), `run_status`.

**Tech Stack:** Existing — no new dependencies. Edits in `packages/editor-core/src/editor.js` (compiled to `editor/editor.js` via `bash scripts/build-editor.sh`).

**Out of scope for Phase 4 (deferred):**
- Canvas-side `triggerAnalyze` (vision call on existing image to get prompt+json context) — extension only for now; canvas users get a simpler "describe what you want" textarea without seeded prompt context
- Auto-creating an `assets` row for orphan asset nodes (those without `meta.assetId`) — Phase 4b
- Image-to-image refinement (pass existing image as input to next generation) — Phase 3b
- Cost tracking enforcement — Phase 5c
- History reconstruction — Phase 5b

**Constraints discovered during planning:**
- `chat_threads.asset_id UUID REFERENCES assets(id)` — Smart Edit requires the asset node to have a matching row in `assets` table. Phase 4 MVP only supports Smart Edit on agent-generated asset nodes (i.e. nodes with `meta.assetId` populated). Orphan asset nodes (uploads, manually-created) show "Smart Edit needs an asset record" error. Phase 4b can backfill.
- Canvas detection: `hostDoc !== targetDoc` is true in canvas (host has the editor UI, target is the iframe of the captured site). In extension mode they are the same `document`. `typeof chrome === 'undefined'` also works as a cleaner canvas check inside editor.js (extension sets chrome globally).

**Working directory:** `/Users/adilsonporto/Desktop/IA/Uncraft`. Branch: `feat/canvas`.

**Source-of-truth files:**
- Spec at `docs/superpowers/specs/2026-05-31-agent-promptdock-design.md` §8 (Smart Edit) + §9 (asset-scoped threads)
- Phase 3 plan at `docs/superpowers/plans/2026-06-01-agent-promptdock-phase3.md`
- Phase 4 handoff at `docs/superpowers/handoffs/2026-05-31-agent-phase4-handoff.md` (written end of Phase 3)

---

## Phase 1 — Backend: asset-scoped registry includes createImage

### Task 1.1: buildAssetRegistry() in tools/index.js

**Files:**
- Modify: `packages/web-shell/lib/agent/tools/index.js`
- Modify: `packages/web-shell/lib/agent/tools/index.test.js`

The asset-scoped chat should expose safe tools (so the agent can `queryNodes`, `listAssets`, etc. for context) PLUS `createImage`. It should NOT expose `deleteNode`, `runFlow`, `editSite` — those are graph-level destructive ops that shouldn't happen from an asset-scoped chat.

- [ ] **Step 1: Write failing test**

Append to `packages/web-shell/lib/agent/tools/index.test.js`:

```js
import { buildAssetRegistry } from './index.js';

describe('buildAssetRegistry', () => {
  it('registers 6 safe tools + createImage (7 total)', () => {
    const r = buildAssetRegistry();
    const names = r.all().map((t) => t.name).sort();
    expect(names).toEqual([
      'addEdge', 'createImage', 'createNode',
      'getNodeOutput', 'listAssets', 'queryNodes', 'updateNode',
    ]);
  });

  it('does NOT register destructive graph tools', () => {
    const r = buildAssetRegistry();
    const names = r.all().map((t) => t.name);
    expect(names).not.toContain('deleteNode');
    expect(names).not.toContain('runFlow');
    expect(names).not.toContain('editSite');
  });
});
```

- [ ] **Step 2: Run (FAIL)** — `cd /Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell && npm test -- lib/agent/tools/index.test.js`

- [ ] **Step 3: Add `buildAssetRegistry` to `tools/index.js`**

After `buildFullRegistry`, append:

```js
/**
 * Phase 4 asset-scope chat surface — safe tools + createImage. Use when
 * threadScope === 'asset' so the Smart Edit chat dock has graph context
 * (queryNodes, listAssets) plus the ability to regenerate the image
 * (createImage), but NOT the ability to delete graph nodes, run flows,
 * or edit sites from an image-focused chat.
 */
export function buildAssetRegistry() {
  const r = buildSafeRegistry();
  r.register(createImageTool);
  return r;
}
```

- [ ] **Step 4: Run (PASS)** + **Step 5: Commit**

```bash
npm test -- lib/agent/tools/index.test.js
git add packages/web-shell/lib/agent/tools/index.js packages/web-shell/lib/agent/tools/index.test.js
git commit -m "feat(agent): buildAssetRegistry — safe + createImage (7 tools)"
```

---

### Task 1.2: Route uses buildAssetRegistry for asset-scope

**Files:**
- Modify: `packages/web-shell/app/api/chat/route.js`

- [ ] **Step 1: Find the existing scope check**

```bash
grep -n "buildSafeRegistry\|buildFullRegistry\|threadScope" /Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell/app/api/chat/route.js
```

You'll find a line like:
```js
const registry = threadScope === 'asset' ? buildSafeRegistry() : buildFullRegistry();
```

- [ ] **Step 2: Replace with buildAssetRegistry for asset scope**

```js
import { buildFullRegistry, buildSafeRegistry, buildAssetRegistry } from '../../../lib/agent/tools/index.js';

// later in the handler:
const registry = threadScope === 'asset' ? buildAssetRegistry() : buildFullRegistry();
```

- [ ] **Step 3: Verify suite still passes**

```bash
npm test
```

Expected: 144/144 still passing (146 with the 2 new registry tests from Task 1.1).

- [ ] **Step 4: Commit**

```bash
git add packages/web-shell/app/api/chat/route.js
git commit -m "feat(api): asset-scope chat uses buildAssetRegistry"
```

---

## Phase 2 — editor.js Smart Edit dock canvas-mode wiring

### Task 2.1: Canvas-mode entry + bypass analyze

**Files:**
- Modify: `packages/web-shell/../../packages/editor-core/src/editor.js` (canonical absolute path: `/Users/adilsonporto/Desktop/IA/Uncraft/packages/editor-core/src/editor.js`)

In canvas mode (no `chrome.runtime`), Smart Edit should skip the `triggerAnalyze` step (which depends on extension's `describeImage` background handler) and go straight to the "ready" phase where the chat textarea is available. The user types instructions without seeded prompt context.

- [ ] **Step 1: Find the Smart Edit dock entry**

```bash
grep -n "triggerAnalyze\|assetEditState.phase = 'idle'\|function renderSmartSection" /Users/adilsonporto/Desktop/IA/Uncraft/packages/editor-core/src/editor.js
```

Locate the `idle` phase render block in `renderSmartSection()` (around line 3337). The "Smart edit" button calls `triggerAnalyze` on click.

- [ ] **Step 2: Add canvas detection helper**

Above `triggerAnalyze`, add:

```js
function isCanvasMode() {
  // Canvas mounts the editor with hostDoc !== targetDoc (host owns the React
  // tree, target is the snapshot iframe). Extension injects into a single
  // doc and has chrome.runtime available.
  return typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage;
}
```

- [ ] **Step 3: Update `triggerAnalyze` to handle canvas mode**

Replace:

```js
function triggerAnalyze() {
  if (!assetEditTarget) return;
  var url = assetEditTarget.source_url || assetEditTarget.thumb_url;
  if (!url) {
    assetEditState.phase = 'error';
    assetEditState.err = 'No image URL to analyze.';
    renderSmartSection();
    return;
  }
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    assetEditState.phase = 'error';
    assetEditState.err = 'Smart Edit needs the extension context.';
    renderSmartSection();
    return;
  }
  // ...
}
```

with:

```js
function triggerAnalyze() {
  if (!assetEditTarget) return;
  if (isCanvasMode()) {
    // Canvas mode skips the vision pre-analysis (no extension's describeImage
    // handler). Go straight to the chat-ready phase — user types instructions
    // directly. The agent has graph context via queryNodes/listAssets if it
    // wants to read the asset's existing meta.
    assetEditState.phase = 'ready';
    assetEditState.prompt = '';
    assetEditState.json = { canvasAssetId: assetEditTarget.id || null, source: 'canvas' };
    renderSmartSection();
    return;
  }
  var url = assetEditTarget.source_url || assetEditTarget.thumb_url;
  if (!url) {
    assetEditState.phase = 'error';
    assetEditState.err = 'No image URL to analyze.';
    renderSmartSection();
    return;
  }
  assetEditState.phase = 'analyzing';
  renderSmartSection();
  try { chrome.runtime.sendMessage({ action: 'describeImage', imageUrl: url }); } catch (e) {}
}
```

(Keep the rest of the function unchanged — this only changes the early-exit guard.)

- [ ] **Step 4: Run the build script** to sync `editor/editor.js` (only if you have other changes; otherwise wait until end of Phase 2)

```bash
bash /Users/adilsonporto/Desktop/IA/Uncraft/scripts/build-editor.sh
```

Verify the script exists; if not, skip and note in report.

- [ ] **Step 5: Commit**

```bash
git add packages/editor-core/src/editor.js editor/editor.js
git commit -m "feat(editor): Smart Edit canvas-mode bypasses extension analyze step"
```

---

### Task 2.2: Canvas-mode submit() — POST /api/chat + SSE consumer

**Files:**
- Modify: `packages/editor-core/src/editor.js`

The current `submit()` inside `buildAssetChatDock()` checks `typeof chrome === 'undefined' || !chrome.runtime` and silent-returns. Replace that bail with a canvas-mode path that POSTs to /api/chat and consumes SSE.

- [ ] **Step 1: Find the submit function**

```bash
grep -n "function submit" /Users/adilsonporto/Desktop/IA/Uncraft/packages/editor-core/src/editor.js
```

There's likely more than one `submit`. The one inside `buildAssetChatDock` is around line 3576.

- [ ] **Step 2: Replace `submit()` body**

Replace the current implementation:

```js
function submit() {
  var msg = ta.value.trim();
  if (!msg) return;
  if (!assetEditState || !assetEditState.json) return;
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
  var combined = (assetEditState.prompt || '') + '\n\n' +
                 JSON.stringify(assetEditState.json, null, 2) +
                 '\n\nUser instruction: ' + msg;
  ta.value = '';
  ta.style.height = 'auto';
  assetEditState.phase = 'generating';
  renderSmartSection();
  try {
    chrome.runtime.sendMessage({
      action: 'generateImage',
      prompt: combined,
      imageProvider: assetEditState.provider || 'gemini'
    });
  } catch (e) {}
}
```

with:

```js
function submit() {
  var msg = ta.value.trim();
  if (!msg) return;
  if (!assetEditState) return;
  ta.value = '';
  ta.style.height = 'auto';

  if (isCanvasMode()) {
    submitCanvas(msg);
  } else {
    submitExtension(msg);
  }
}

function submitExtension(msg) {
  if (!assetEditState.json) return;
  var combined = (assetEditState.prompt || '') + '\n\n' +
                 JSON.stringify(assetEditState.json, null, 2) +
                 '\n\nUser instruction: ' + msg;
  assetEditState.phase = 'generating';
  renderSmartSection();
  try {
    chrome.runtime.sendMessage({
      action: 'generateImage',
      prompt: combined,
      imageProvider: assetEditState.provider || 'gemini'
    });
  } catch (e) {}
}

function submitCanvas(msg) {
  // Resolve boardId from mount options + assetId from the canvas asset row.
  var hostWin = hostDoc.defaultView;
  var opt = hostWin && hostWin.__uncraftMountOptions;
  var boardId = (opt && opt.boardId) || null;
  // assetEditTarget is the asset row from /api/assets. Its id is the assets-table UUID.
  var assetId = assetEditTarget && assetEditTarget.id;
  if (!boardId || !assetId) {
    assetEditState.phase = 'gen-error';
    assetEditState.err = 'Smart Edit needs an asset record (only works on AI-generated images for now).';
    renderSmartSection();
    return;
  }
  assetEditState.phase = 'generating';
  assetEditState.err = null;
  renderSmartSection();

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      boardId,
      threadScope: 'asset',
      assetId,
      message: msg,
      tools: ['createImage', 'getNodeOutput'],
      systemPromptKey: 'EDIT_IMAGE_SYSTEM',
    }),
  }).then(consumeAssetEditSse).catch(function(err) {
    assetEditState.phase = 'gen-error';
    assetEditState.err = String(err && err.message || err);
    renderSmartSection();
  });
}
```

- [ ] **Step 3: Add the SSE consumer + auto-confirm helpers**

Above `submitCanvas`, add:

```js
function consumeAssetEditSse(res) {
  if (!res.ok) {
    return res.text().then(function(t) {
      assetEditState.phase = 'gen-error';
      assetEditState.err = 'HTTP ' + res.status + ': ' + (t || 'request failed');
      renderSmartSection();
    });
  }
  var reader = res.body.getReader();
  var dec = new TextDecoder();
  var buf = '';
  var currentRunId = null;
  function pump() {
    return reader.read().then(function(r) {
      if (r.done) return;
      buf += dec.decode(r.value);
      var idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        var block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        var lines = block.split('\n');
        var ev = lines.find(function(l) { return l.indexOf('event:') === 0; });
        var dt = lines.find(function(l) { return l.indexOf('data:') === 0; });
        if (!ev || !dt) continue;
        var name = ev.slice(6).trim();
        var payload;
        try { payload = JSON.parse(dt.slice(5).trim()); } catch (e) { continue; }
        handleAssetEditSse(name, payload, function(rid) { currentRunId = rid; });
      }
      return pump();
    });
  }
  return pump();
}

function handleAssetEditSse(name, payload, setRunId) {
  switch (name) {
    case 'run_id':
      setRunId(payload.runId);
      break;
    case 'needs_choice':
      // Single-choice → auto-confirm. Multi-choice → render inline picker
      // inside the dock (not implemented in Phase 4 MVP — falls through to
      // auto-confirm with the first choice as a temporary degradation when
      // conversation model is Claude. Phase 4b can add the picker UI here.).
      if (Array.isArray(payload.choices) && payload.choices.length > 0) {
        var choice = payload.choices[0].id;
        // POST confirm — uses fresh runId from setRunId closure
        fetch('/api/chat/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            runId: assetEditRunIdRef.current,
            toolCallId: payload.id,
            action: 'confirm',
            choice: choice,
          }),
        });
      }
      break;
    case 'tool_status':
      if (payload.status === 'done' && payload.result && payload.result.dataUrl) {
        // Image was generated — render in dock as the result.
        assetEditState.phase = 'done';
        assetEditState.result = {
          dataUrl: payload.result.dataUrl,
          assetId: payload.result.assetId,
        };
        renderSmartSection();
      } else if (payload.status === 'error') {
        assetEditState.phase = 'gen-error';
        assetEditState.err = payload.error || 'tool error';
        renderSmartSection();
      }
      break;
    case 'run_status':
      if (payload.status === 'failed' || payload.status === 'hard_limited') {
        if (assetEditState.phase !== 'done') {
          assetEditState.phase = 'gen-error';
          assetEditState.err = payload.err || 'agent run ' + payload.status;
          renderSmartSection();
        }
      } else if (payload.status === 'completed' && assetEditState.phase === 'generating') {
        // Run completed but no createImage done event — agent might have just
        // talked without calling the tool. Show a soft error.
        assetEditState.phase = 'gen-error';
        assetEditState.err = 'Agent did not generate an image. Try a more specific instruction.';
        renderSmartSection();
      }
      break;
  }
}
```

Above `handleAssetEditSse`, add a module-scope ref for the runId so the `needs_choice` POST has access to it (the `setRunId` closure works for one run, but the ref is cleaner for retries):

```js
var assetEditRunIdRef = { current: null };
```

And in the `run_id` case, set both: `setRunId(payload.runId); assetEditRunIdRef.current = payload.runId;`.

- [ ] **Step 4: Build editor**

```bash
bash /Users/adilsonporto/Desktop/IA/Uncraft/scripts/build-editor.sh
```

- [ ] **Step 5: Commit**

```bash
git add packages/editor-core/src/editor.js editor/editor.js
git commit -m "feat(editor): Smart Edit canvas-mode submits via /api/chat + SSE consumer"
```

---

### Task 2.3: Render generated image in dock (done phase)

**Files:**
- Modify: `packages/editor-core/src/editor.js`

The 'done' phase needs to display the generated image. Currently `assetEditState.result` is consumed in extension mode by a different code path. For canvas, render an `<img>` inline.

- [ ] **Step 1: Find the 'done' phase render block**

```bash
grep -n "phase === 'done'" /Users/adilsonporto/Desktop/IA/Uncraft/packages/editor-core/src/editor.js
```

- [ ] **Step 2: Augment the 'done' block**

Inside `renderSmartSection()`, find the phase 'done' branch and ensure when `assetEditState.result.dataUrl` is set (canvas case), render:

```js
if (assetEditState.result && assetEditState.result.dataUrl) {
  var imgWrap = mk('div', 'rb-ed-asset-smart-result');
  var img = mk('img', 'rb-ed-asset-smart-result-img');
  img.src = assetEditState.result.dataUrl;
  imgWrap.appendChild(img);

  var actions = mk('div', 'rb-ed-asset-smart-result-actions');
  var againBtn = mk('button', 'rb-ed-asset-smart-result-btn');
  againBtn.type = 'button';
  againBtn.textContent = 'Generate another';
  againBtn.addEventListener('mousedown', function(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    assetEditState.phase = 'ready';
    assetEditState.result = null;
    renderSmartSection();
  }, { capture: true });
  actions.appendChild(againBtn);
  imgWrap.appendChild(actions);

  c.appendChild(imgWrap);
}
```

(Place this inside the existing `phase === 'done'` block, so the chat dock can re-render after.)

- [ ] **Step 3: Add minimal CSS to `editor/editor.css`** (or wherever the asset-edit styles live)

Find styles like `.rb-ed-asset-smart-result` if they exist. If not, add:

```css
.rb-ed-asset-smart-result {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rb-ed-asset-smart-result-img {
  width: 100%;
  border-radius: 8px;
  display: block;
}
.rb-ed-asset-smart-result-actions {
  display: flex;
  gap: 6px;
}
.rb-ed-asset-smart-result-btn {
  font-family: inherit;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
  cursor: pointer;
}
.rb-ed-asset-smart-result-btn:hover { background: rgba(255, 255, 255, 0.10); }
```

- [ ] **Step 4: Build editor**

```bash
bash /Users/adilsonporto/Desktop/IA/Uncraft/scripts/build-editor.sh
```

- [ ] **Step 5: Commit**

```bash
git add packages/editor-core/src/editor.js editor/editor.js editor/editor.css
git commit -m "feat(editor): Smart Edit dock renders generated image inline (canvas mode)"
```

---

## Phase 3 — Docs + handoff

### Task 3.1: CLAUDE.md item 131 + checkpoint + Phase 5 handoff

**Files:**
- Modify: `CLAUDE.md`
- Create: `~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/checkpoint_2026-05-31_049.md`
- Modify: `~/.claude/projects/-Users-adilsonporto-Desktop-IA-Uncraft/memory/MEMORY.md`
- Create: `docs/superpowers/handoffs/2026-05-31-agent-phase5-handoff.md`

- [ ] **Step 1: Append item 131 to CLAUDE.md**

After item 130:

```markdown
131. ✅ **Agent PromptDock chat — Phase 4** (sessão 2026-05-31 continuação, branch `feat/canvas`). Smart Edit dock no canvas wired pra agent backend. `buildAssetRegistry()` em tools/index.js: 6 safe + createImage (NÃO inclui delete/runFlow/editSite — image-focused chat não deve mexer no grafo). Route usa `buildAssetRegistry` quando `threadScope === 'asset'`. editor.js: `isCanvasMode()` helper (`typeof chrome === 'undefined'`), `triggerAnalyze` em canvas pula análise (sem extension's describeImage handler) e vai direto pra `phase='ready'` com chat textarea, `submit()` separa `submitExtension` (chrome.runtime path) de `submitCanvas` (POST /api/chat com asset scope, SSE consumer inline). SSE handler: `run_id` armazena runId via ref, `needs_choice` auto-confirma single-choice (Claude+auto → primeira choice como fallback Phase 4b adiciona picker), `tool_status done` extrai `result.dataUrl` → renderiza img inline com botão "Generate another", `run_status completed` sem createImage done = "agent didn't generate" error. **Constraint Phase 4 MVP**: só funciona em asset nodes com `meta.assetId` populado (gerados pelo Phase 3 createImage com attachToBoard). Orphan asset nodes (uploads/createNode type='asset') mostram "Smart Edit needs an asset record". Phase 4b backfill auto. Memo: [[checkpoint_2026-05-31_049]]. Plan: `docs/superpowers/plans/2026-06-01-agent-promptdock-phase4.md`.
```

- [ ] **Step 2: Create mem0 checkpoint**

```markdown
---
name: checkpoint-2026-05-31-049
description: Phase 4 of agent feature — Smart Edit dock wired to agent backend in canvas mode with asset-scoped threads
metadata:
  type: project
---

Phase 4 shipped same session. Smart Edit chat dock works in canvas (was extension-only).

**What's new vs Phase 3:**
- `buildAssetRegistry()` — 7 tools (safe + createImage), NOT destructive graph tools
- Route routes asset-scope to asset registry (was buildSafeRegistry)
- editor.js canvas-mode path replaces chrome.runtime.sendMessage with fetch+SSE
- Dock renders generated image inline with "Generate another" CTA

**Key decisions:**
- canvas detection via `typeof chrome === 'undefined'` (cleaner than hostDoc check)
- Canvas skips analyze (no extension describeImage handler) — phase goes idle→ready directly
- Asset-scope threads MUST have asset_id matching assets table row; Phase 4 MVP requires meta.assetId on canvas asset nodes (only agent-generated images qualify); Phase 4b can backfill
- needs_choice in dock: auto-confirm first choice if Claude+auto (no picker UI in Phase 4; defer to 4b)
- runId tracked via module-scope ref to avoid stale closure (lesson from Phase 3 PromptDock fix)

**Why:** Closes the spec's Smart Edit deliverable. Users can now regenerate AI-created images in canvas without switching to extension.

**Smoke tests pending in browser:**
1. Canvas: agent-generate image with attachToBoard → click Smart Edit on result → type "make it blue" → image regenerates
2. Canvas: try Smart Edit on uploaded asset node → see "needs asset record" error
3. Canvas: Claude conversation model + Smart Edit → verify needs_choice fallback (auto-picks first)
4. Extension: Smart Edit still works via chrome.runtime path (no regression)

Related: [[checkpoint_2026-05-31_048]] (Phase 3). Handoff: `docs/superpowers/handoffs/2026-05-31-agent-phase5-handoff.md`.
```

- [ ] **Step 3: Update MEMORY.md**

Add as new top entry:

```markdown
- [checkpoint_2026-05-31_049.md](./checkpoint_2026-05-31_049.md) — ACTIVE: Agent PromptDock Phase 4 — Smart Edit dock wired to agent backend (canvas mode), buildAssetRegistry (7 tools), asset-scoped threads, SSE consumer in editor.js, inline image render. Requires meta.assetId (Phase 4b backfills orphans).
```

- [ ] **Step 4: Write Phase 5 handoff**

`docs/superpowers/handoffs/2026-05-31-agent-phase5-handoff.md`:

Capture state, smoke tests pending, next phases (5b history reconstruction, 5c cost tracking + credits, 4b orphan-asset backfill, 3b image-to-image).

- [ ] **Step 5: Commit**

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft && git add CLAUDE.md docs/superpowers/handoffs/2026-05-31-agent-phase5-handoff.md
git commit -m "$(cat <<'EOF'
docs: Phase 4 handoff + CLAUDE.md item 131

Smart Edit canvas mode wired to /api/chat + asset-scope registry.
Phase 4 MVP requires meta.assetId; Phase 4b backfills orphans.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

**Spec coverage (§8 Smart Edit):**
- ✅ Existing dock UI preserved
- ✅ Replace chrome.runtime.sendMessage with POST /api/chat
- ✅ asset-scope threads (limited to assets with meta.assetId for MVP)
- ✅ tools: ['createImage', 'getNodeOutput'] allowlist
- ✅ systemPromptKey: 'EDIT_IMAGE_SYSTEM'
- ✅ buildAssetRegistry exposes createImage (resolves Phase 3 handoff TODO)

**Placeholder scan:** None — all code blocks runnable, all commands exact.

**Type consistency:** Registry function naming matches Phase 2 pattern (`buildSafeRegistry`, `buildFullRegistry`, now `buildAssetRegistry`). SSE event names match Phase 2/3 (`run_id`, `needs_choice`, `tool_status`, `run_status`).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-01-agent-promptdock-phase4.md`. Execute via subagent-driven-development continuing on branch `feat/canvas`.

Expected: ~6 commits, ~2 new tests, total suite stays around 146/146 (editor.js changes don't add unit tests — validated by browser smoke).
