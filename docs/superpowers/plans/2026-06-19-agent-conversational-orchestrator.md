# Agent Conversational Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the canvas chat agent behave like the user-selected AI operating normally (reasoning, generating real content, conversing) with nodes as the delivery medium — instead of dropping empty typed scaffolding. Fix the one tool gap (`createNode` can't carry content) that blocks real generation, then rewrite `BOARD_AGENT` to encode the operating model, correct type vocabulary, follow-through, new-vs-continue, and conversational clarification.

**Architecture:** Two parts. (1) A real tool change: `createNode` gains an optional `content` param that stores a prompt brief in `meta.prompt` and a design-system spec in a `design_md` snapshot — exactly what `run-flow` reads to compose. (2) A `BOARD_AGENT` system-prompt rewrite (prose) encoding the rules. The prompt change has no unit test (it's prose, validated by manual smoke); the tool change is TDD'd.

**Tech Stack:** Postgres (`sql` tagged template), the agent registry/driver, Vitest. Spec: `docs/superpowers/specs/2026-06-19-agent-conversational-orchestrator-design.md`. Guiding principle (memory): the agent IS the selected AI operating normally, nodes are the output medium, hardwired tools are power-ups not a cage.

---

## Background (read once)

- **The gap that blocks generation:** `run-flow.js` composes a site from its sources. A prompt source's brief is read from `s.meta?.prompt || s.meta?.text` (`lib/run-flow.js:171`); a design source from the snapshot's `design_md` (`source_design_md`, line 168). But `createNode` (`lib/agent/tools/create-node.js`) only stores a `name` in meta and seeds a snapshot ONLY for `blank-website` (its `seedHtml`). So an agent-made prompt/design-system node is empty → `runFlow` has nothing to compose → "create a fintech site" produces empty scaffolding.
- **Snapshot-seed pattern** to mirror: `create-node.js` lines 93–100 (blank-website seeds `INSERT INTO snapshots (node_id, html, source)` then `UPDATE nodes SET current_snapshot_id`). For design-system, seed `design_md` instead of `html` (extract-design.js:74 shows `INSERT INTO snapshots (node_id, html, design_md, source)`).
- **`createNode` types** (`NODE_TYPES`): `blank-website`(site), `prompt`, `design-system`(designmd), `asset`, `skill`. Existing tests: `lib/agent/tools/create-node.test.js` (6 cases).
- **Current `BOARD_AGENT`**: `lib/agent/prompts.js` — already has the exploration-tools framing (`viewNode`/`listBoard`/`findNearest`/`getWorkflow`), node kinds, and a Voice section. We keep those and rewrite the operating-model + rules.

---

## File Structure

- **Modify** `packages/web-shell/lib/agent/tools/create-node.js` — add optional `content` param: `prompt`→`meta.prompt`, `design-system`→seed a `design_md` snapshot. Update the tool's `inputSchema` + description.
- **Modify** `packages/web-shell/lib/agent/tools/create-node.test.js` — add tests for the `content` param (both kinds + blank stays blank).
- **Modify** `packages/web-shell/lib/agent/prompts.js` — rewrite `BOARD_AGENT`.
- **Create** `packages/web-shell/docs/.keep`? No — instead **Create** `docs/superpowers/smoke-tests/2026-06-19-agent-orchestrator-smoke.md` — the manual behavioral checklist (the prompt rewrite's only verification).

All paths relative to repo root. Tests run from `packages/web-shell` via `npx vitest run`.

---

## Task 1: `createNode` carries content (prompt brief / design spec)

**Files:**
- Modify: `packages/web-shell/lib/agent/tools/create-node.js`
- Test: `packages/web-shell/lib/agent/tools/create-node.test.js`

- [ ] **Step 1: Write the failing tests**

Read `lib/agent/tools/create-node.test.js` first to match its `sql` mock style (it uses `sql.mockResolvedValueOnce(...)` in sequence). Append these tests inside the existing `describe('createNode tool', …)` block:

```js
  it('stores content as meta.prompt for a prompt node', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);                                  // SELECT board
    sql.mockResolvedValueOnce([]);                                                   // placeStackDown SELECT nodes (auto-place)
    sql.mockResolvedValueOnce([{ id: 'node-9', kind: 'prompt', pos_x: 0, pos_y: 0, width: 600, height: 200, meta: { name: 'prompt', prompt: 'a fintech website' } }]); // INSERT
    const result = await createNodeTool.execute(
      { type: 'prompt', content: 'a fintech website' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.meta.prompt).toBe('a fintech website');
    // the INSERT call must have received meta containing prompt: 'a fintech website'
    const insertCall = sql.mock.calls.find((c) => String(c[0].join('')).includes('INSERT INTO nodes'));
    expect(JSON.stringify(insertCall)).toContain('a fintech website');
  });

  it('seeds a design_md snapshot for a design-system node with content', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);                                  // SELECT board
    sql.mockResolvedValueOnce([]);                                                   // placeStackDown
    sql.mockResolvedValueOnce([{ id: 'node-10', kind: 'designmd', pos_x: 0, pos_y: 0, width: 600, height: 600, meta: { name: 'Untitled.md' } }]); // INSERT node
    sql.mockResolvedValueOnce([{ id: 'snap-1' }]);                                   // INSERT snapshot
    sql.mockResolvedValueOnce([]);                                                   // UPDATE current_snapshot_id
    const result = await createNodeTool.execute(
      { type: 'design-system', content: '# Colors\n- navy #0b1f3a' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.id).toBe('node-10');
    // a snapshot INSERT carrying the design_md content must have run
    const snapCall = sql.mock.calls.find((c) => String(c[0].join('')).includes('INSERT INTO snapshots'));
    expect(snapCall).toBeTruthy();
    expect(JSON.stringify(snapCall)).toContain('navy #0b1f3a');
  });

  it('leaves a design-system node blank when no content given (no snapshot)', async () => {
    sql.mockResolvedValueOnce([{ id: 'board-1' }]);                                  // SELECT board
    sql.mockResolvedValueOnce([]);                                                   // placeStackDown
    sql.mockResolvedValueOnce([{ id: 'node-11', kind: 'designmd', pos_x: 0, pos_y: 0, width: 600, height: 600, meta: { name: 'Untitled.md' } }]); // INSERT node
    const result = await createNodeTool.execute(
      { type: 'design-system' },
      { boardId: 'board-1', userId: 42 },
    );
    expect(result.id).toBe('node-11');
    // no snapshot INSERT happened — only board SELECT, placeStackDown, node INSERT
    const snapCall = sql.mock.calls.find((c) => String(c[0].join('')).includes('INSERT INTO snapshots'));
    expect(snapCall).toBeFalsy();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/web-shell && npx vitest run lib/agent/tools/create-node.test.js`
Expected: FAIL — `content` is ignored; no `meta.prompt`, no design_md snapshot.

- [ ] **Step 3: Implement the `content` param**

In `lib/agent/tools/create-node.js`:

(a) Add `content` to the `inputSchema.properties` (after `name`):

```js
      content: { type: 'string', description: 'Optional body for the node. For a "prompt" node: the brief/instruction text (becomes the prompt the node feeds into a site). For a "design-system" node: the DESIGN.md spec text. Omit to leave the node a blank slot the user fills later.' },
```

(b) In `execute`, destructure `content`:

```js
    const { type, name = null, posX, posY, content = null } = args || {};
```

(c) For a `prompt` node, put the brief in `meta.prompt`. Find where `finalMeta` is built (`const finalMeta = effectiveName ? { ...mapping.meta, name: effectiveName } : mapping.meta;`) and after it add:

```js
    // Prompt nodes carry their brief in meta.prompt — that's what run-flow
    // reads to compose. Without it an agent-made prompt node is inert.
    const metaWithContent = (mapping.kind === 'prompt' && content)
      ? { ...finalMeta, prompt: content }
      : finalMeta;
```

Then use `metaWithContent` in the `INSERT INTO nodes` VALUES instead of `finalMeta`.

(d) For a `design-system` node with content, seed a `design_md` snapshot. Find the existing `if (mapping.seedHtml) { … }` block (blank-website seeding) and add a sibling block AFTER it:

```js
    // Design-system nodes with content get a design_md snapshot, so they
    // work as an md source in run-flow (read as source_design_md) AND via
    // applyDesign. No content → blank slot (no snapshot), per the spec.
    if (mapping.kind === 'designmd' && content) {
      const [snap] = await sql`
        INSERT INTO snapshots (node_id, html, design_md, source)
        VALUES (${node.id}, ${null}, ${content}, 'seed')
        RETURNING id
      `;
      await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${node.id}`;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/web-shell && npx vitest run lib/agent/tools/create-node.test.js`
Expected: PASS — all cases (existing 6 + new 3) green.

- [ ] **Step 5: Run the full suite**

Run: `cd packages/web-shell && npx vitest run`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add packages/web-shell/lib/agent/tools/create-node.js packages/web-shell/lib/agent/tools/create-node.test.js
git commit -m "feat(agent): createNode carries content — prompt brief + design_md seed"
```

---

## Task 2: Rewrite `BOARD_AGENT` to the conversational-orchestrator model

**Files:**
- Modify: `packages/web-shell/lib/agent/prompts.js`

No automated test (it's a prompt). The full replacement text is below — transcribe it exactly. Manual smoke is Task 3.

- [ ] **Step 1: Replace the `BOARD_AGENT` export**

In `lib/agent/prompts.js`, replace the entire `export const BOARD_AGENT = \`…\`;` block (keep the other exports `EDIT_IMAGE_SYSTEM`, `EDIT_SITE_SYSTEM` untouched) with:

```js
export const BOARD_AGENT = `You are the assistant inside Uncraft, a visual canvas. You ARE the capable AI model the user picked — reason, suggest, generate, and converse exactly as you would in your own chat. The only difference: your output medium is NODES on a canvas, and you have extra Uncraft capabilities (build node-chains, run flows, capture sites, extract designs, generate images). Those capabilities are power-ups, never a cage. You are NOT limited to "calling tools" — you do the real creative work and deliver it as nodes.

# Two hats, working together
- Independent reasoner: you answer, generate real content, ask questions, suggest, and negotiate scope like a thoughtful collaborator.
- Node-chain orchestrator: you think in chains — "how does this request become a readable reference → base → result the user can edit?" — and you drive the graph.
The deliverable is the real artifact (a generated site, a styled page, an image), rendered as nodes. Empty typed scaffolding is a failure. Refusing is the last resort: if a request seems outside your direct tools, find the SEQUENCE of tools that gets there before declining.

# Exploration (fetch on demand — you start with almost no context)
Each turn arrives with at most the active selection ids and, when a workflow is selected, its terminal + stored inputs. Everything else you fetch:
- viewNode(id) — full record of one node (kind, meta, assetId, dims).
- listBoard({kind?, nearNodeId?, limit?}) — board topology + counts + positions.
- findNearest(fromNodeId, {kind?, limit?}) — K closest nodes by canvas distance.
- getWorkflow(nodeId) — the chain a node participates in + its terminal.
When the user points vaguely ("that image", "this site"), DON'T ask — call these and default to the nearest match. Their spatial layout is their pointing finger.

# Node kinds + the type vocabulary (BINDING)
- "site / page / landing / website" → a site node (blank-website as a compose target; captureUrl for a live URL).
- "md / .md / design system / design spec / style guide / design tokens" → a design-system node (kind designmd). NEVER a prompt node — this is a common mistake; do not make it.
- "prompt / brief / instruction / direction" → a prompt node.
- "image / photo / asset / illustration" → an asset node.

# Rule 1 — Build the graph the request implies, with the right types
- Bare creative request ("create a fintech site") → a visible mini-chain: a prompt node carrying the brief → a generated site node. The brief stays an editable variable feeding the result.
- Explicitly described graph ("a site fed by an md node") → build exactly that, with the correct node types from the vocabulary above.

# Rule 2 — Generate where the user specified; leave a blank slot where they didn't
- Specification present (a description in the request, or an uploaded file) → generate the REAL content and follow through. Never stop at an empty node when the user described a real artifact.
- No specification for a node → leave it a blank slot they'll fill (e.g. "a site fed by an md node" with no md details → a blank design-system node → a blank site, correct types, wired).

# How you actually generate (follow-through — do not skip this)
- createNode supports a content arg. For a prompt node, pass the brief as content (it becomes meta.prompt). For a design-system node, pass the spec as content (it becomes the .md). Omit content for a blank slot.
- prompt-brief → site: createNode a prompt node WITH its brief as content, createNode a blank-website, addEdge prompt→site, then runFlow the site. That produces a real generated site, with the prompt as a visible variable.
- styled-by-a-design: applyDesign(designNodeId, siteNodeId) makes a new site whose content matches one source and style the other; or runFlow with a design-system source.
- a site's design.md: generate/capture the site, then extractDesign to produce a design-system node, wired site→md.

# Rule 3 — New chain vs. continue an existing one (ALWAYS ask when ambiguous)
- Continue (don't ask): a node/section is selected AND the request is referential or a modification ("make it darker", "add a pricing section", "now restyle it"), OR it names an artifact unambiguously on the board.
- New chain (don't ask): nothing selected + a self-contained creative request, OR explicit new-language ("another", "from scratch", "separate").
- ASK on ambiguity, and bias toward asking. Canonical trap: a build request arrives WHILE something is selected and it's unclear whether it extends that work or is independent (a fintech site is selected, user says "create a pricing page" — part of it, or its own thing?). Ask one plain question: "Add this to the fintech site, or start a new one?" NEVER guess new-vs-continue.

# Rule 4 — Talk when the request is thin
Before building, if the request is too underspecified to execute well, ask the MINIMUM you need (purpose, audience, must-haves, brand/style) rather than inventing a generic result or dumping scaffolding. Suggest and negotiate ("a fintech usually needs trust signals + a clear CTA — want those?"). Interrogate as little as possible, as much as necessary. Once the picture is clear, build COMPLETELY. Talkative at the front, decisive at the back.

# Images
- createImage(...) generates or edits images. In edit mode OMIT aspectRatio (inferred from the base image). Pass replaceAssetId only to update an existing terminal in place; without it a NEW node is created.
- addAssetFromUrl(url) ingests an external image URL. When asset nodes are in context, you can SEE their pixels (multimodal blocks).

# Voice
Talk like a creative collaborator, in the user's language. Don't mention IDs, JSON, schema names, tool names, or storage. Refer to nodes by what they ARE ("the reference", "the prompt you added"). After acting, narrate in past tense in one short sentence — the tool calls aren't visible, your words are the confirmation. No emojis.

Clarify when genuinely unsure (especially new-vs-continue and thin requests). Otherwise, act — and act completely.\`;
```

- [ ] **Step 2: Verify the file parses + suite green**

Run: `cd packages/web-shell && npx vitest run`
Expected: full suite green (the prompt is a string constant — any other test importing prompts.js, e.g. driver/route tests, must still pass). Confirm no syntax error from the template literal (watch for unescaped backticks — there are none in the text above; all code-fence backticks are markdown, not in the string).

- [ ] **Step 3: Commit**

```bash
git add packages/web-shell/lib/agent/prompts.js
git commit -m "feat(agent): BOARD_AGENT rewrite — conversational node-chain orchestrator"
```

---

## Task 3: Manual smoke checklist (the prompt's only verification)

**Files:**
- Create: `docs/superpowers/smoke-tests/2026-06-19-agent-orchestrator-smoke.md`

- [ ] **Step 1: Write the checklist**

Create `docs/superpowers/smoke-tests/2026-06-19-agent-orchestrator-smoke.md`:

```markdown
# Agent conversational-orchestrator — manual smoke (2026-06-19)

Run in the live chat (pick GPT-5.5 or a funded provider in the dropdown). Each
case states the expected board outcome. Generation calls cost credit.

## A. Type vocabulary (the bug)
- [ ] "a site fed by an md node" → builds [blank design-system] → [blank site],
      correct TYPES (design-system, NOT a prompt node), wired. Both blank.

## B. Bare creative request generates real content
- [ ] "create a fintech site" → [prompt: "fintech site"] → [site] where the
      site is ACTUALLY generated (real fintech HTML), not an empty blank node.
      (Confirms the createNode-content + runFlow follow-through.)

## C. Specified content generates; unspecified stays blank
- [ ] "a fintech site styled by this .md" (upload an .md) → design-system node
      holds the real spec; the site is generated using it.
- [ ] "create the site and its .md" → [site generated] → [design-system with
      the site's extracted design.md], wired site→md.

## D. New-vs-continue ALWAYS asks on ambiguity
- [ ] Select a fintech site, type "create a pricing page" → the agent ASKS
      "add to the fintech site, or start a new one?" (does NOT silently guess).
- [ ] Nothing selected, "create a portfolio" → starts a new chain, no question.
- [ ] Site selected, "make it darker" → continues that site, no question.

## E. Conversational clarification on thin prompts
- [ ] "make me a site" (no domain) → the agent asks the minimum (what for /
      audience / style) before building, instead of dumping a generic page.

## F. Behaves like the real model (not a caged bot)
- [ ] A request that needs a sequence (e.g. "take the style of <url> and apply
      it to a new landing page") → the agent chains capture/extract/apply
      rather than refusing. Refusal is the last resort.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/smoke-tests/2026-06-19-agent-orchestrator-smoke.md
git commit -m "docs: manual smoke checklist for the agent orchestrator rewrite"
```

---

## Self-Review notes

- **Spec coverage:** Rule 1 (right graph + type vocabulary) → Task 2 prompt §"Rule 1" + §"type vocabulary"; the md→design-system fix is explicit. Rule 2 (generate-where-specified / blank-where-not) → Task 2 §"Rule 2" + the createNode-content mechanism in Task 1. Follow-through (createNode content → runFlow) → Task 1 (the tool) + Task 2 §"How you actually generate". Rule 3 (new-vs-continue, always-ask) → Task 2 §"Rule 3". Rule 4 (conversational) → Task 2 §"Rule 4". The macro operating-model / big-picture (selected AI operating normally, nodes as medium, tools as power-ups not a cage) → Task 2 opening + §"Two hats". Canonical cases → smoke A–C (Task 3). Verify runFlow reads meta.prompt → confirmed in Background, no code change needed (Task 1 writes meta.prompt to match).
- **Placeholder scan:** Task 1 shows complete code + tests with expected pass/fail; Task 2 ships the full prompt text verbatim; Task 3 is a concrete checklist. No TBD/TODO.
- **Type consistency:** `createNode` `content` param: prompt→`meta.prompt`, design-system→`design_md` snapshot — consistent between Task 1 code, its tests, and the Task 2 prompt's "How you actually generate" description (which tells the agent to pass `content`). `run-flow` reads `meta.prompt` / `source_design_md` — matches what Task 1 writes.
- **Out of scope:** trace-based eval of conversational quality; changing the exploration tools or runFlow/applyDesign/extractDesign engines (they already work); the BOARD_AGENT prompt's image section is carried over, not redesigned.
