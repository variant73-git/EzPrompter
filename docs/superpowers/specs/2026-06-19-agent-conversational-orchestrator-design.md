# Agent operating model — conversational node-chain orchestrator

**Date:** 2026-06-19
**Branch:** `feat/canvas`
**Status:** design approved (pending spec review)

## Problem

The canvas chat agent operates "hardwired" to the literal tool surface instead
of like the AI model the user picked. Observed failures:

1. **Wrong node types.** Asked for "a site fed by an md node," it created a
   site fed by a **prompt** node (md → should map to `design-system`).
2. **Empty scaffolding, no follow-through.** Asked to "create a fintech site,"
   it drops an empty `blank-website` node and stops, instead of actually
   generating the fintech site. The deliverable is non-functional scaffolding.
3. **No content path even if it tried.** `runFlow` composes a site from its
   sources, reading a prompt source's brief from `meta.prompt` (run-flow.js
   :170) and a design source from a `design_md` snapshot. But `createNode`
   only stores a `name` — never a body. So an agent-made prompt node is empty
   and `runFlow` has nothing to compose from. The generation path is broken at
   the tool layer, not just the prompt.
4. **No new-vs-continue logic.** Nothing tells the agent whether a request
   extends a selected chain or starts a fresh one. It guesses.
5. **Not conversational.** The current prompt says "act by default, ask only
   when you can't infer." The user wants the opposite bias for ambiguity:
   suggest, question, negotiate, balance expectations — then execute.

## The model we want

One model wearing two hats at once, cooperating, not bolted together
(the user's reference point: Flora):

- **Independent reasoner** — the real selected LLM. It suggests, asks
  questions, negotiates scope, balances expectations, and generates real
  content. It behaves like a normal capable chat model.
- **Node-chain orchestrator** — its output medium is the canvas. It thinks in
  node-chains ("how does this request become a readable
  `reference → base → result` the user can edit?") and drives the graph.

The two coordinate: it converses to understand the task, then orchestrates
nodes to deliver it.

## Operating rules

### Rule 1 — Build the graph the request implies, with correct types

- **Bare creative request** ("create a fintech site") → a visible mini-chain:
  a **prompt node** carrying the brief → a generated **site node**. The brief
  stays an editable variable feeding the result.
- **Explicitly described graph** ("a site fed by an md node") → build exactly
  that, with the **right node types**.

**Type vocabulary (binding):**
- "md", ".md", "design system", "design spec", "style guide", "design tokens"
  → `design-system` node (kind `designmd`). NEVER a prompt node.
- "prompt", "brief", "instruction", "direction" → `prompt` node.
- "site", "page", "landing", "website" → `site` (or `blank-website` as the
  compose target).
- "image", "photo", "asset", "illustration" → `asset`.

### Rule 2 — Generate where specified; blank slot where not

For each node in the chain:
- **Specification present** (a description in the request, or an uploaded
  file) → generate the **real content** and follow through. Never stop at an
  empty node when the user described a real artifact.
- **No specification for that node** → leave it a **blank slot** the user will
  fill. (Per user: "if the request is just about creating the .md feeding a
  site without any specification of what this .md is, leave it blank.")

**Follow-through mechanics** (what "generate" means in tools):
- prompt-brief → site: create prompt node *with its brief stored*, create
  blank-website, wire prompt→site, call `runFlow` on the site.
- styled-by-md: create/ingest the design node *with real spec*, create site,
  wire, `applyDesign` (or `runFlow` with the md source).
- site → its .md: generate the site, then `extractDesign` to produce a
  `design-system` node holding that site's design.md, wired site→md.

### Canonical cases

| User says | Board result |
|---|---|
| "create a fintech site" | `[prompt: "fintech site"]` → `[site: generated fintech HTML]` |
| "a site fed by an md node" (no md details) | `[blank design-system]` → `[blank site]` — correct types, wired, both empty slots |
| "a fintech site styled by this .md" (uploaded/described) | `[design-system: real spec]` → `[site: generated, styled by it]` |
| "create the site and its .md" | `[site: generated]` → `[design-system: extracted design.md]` |

### Rule 3 — New chain vs. continue an existing one

The turn already carries the active selection ids (and, when a workflow is
selected, its terminal + stored inputs). Use that:

- **Continue (don't ask)** when the target is clear: a node/section is
  **selected** AND the prompt is referential or a modification ("make it
  darker", "add a pricing section", "now restyle it"), OR the prompt names an
  artifact unambiguously present on the board.
- **New chain (don't ask)** when the start is clearly fresh: **nothing
  selected** + a self-contained creative request, OR explicit new-language
  ("another", "from scratch", "separate", "new").
- **ASK on ambiguity, and bias toward asking.** Canonical trap: a build
  request arrives *while something is selected* and it's unclear whether it
  extends that work or is independent (fintech site selected, user says
  "create a pricing page" — part of it, or its own thing?). The agent asks one
  plain question: *"Add this to the fintech site, or start a new one?"* It
  **never guesses** new-vs-continue.

### Rule 4 — Conversational clarification

Before building, if the request is too thin to execute well, the agent asks
the **minimum** it needs (purpose, audience, must-haves, brand/style) rather
than inventing or dumping a generic result. It interrogates as little as
possible but as much as necessary. It may suggest and negotiate ("a fintech
usually needs trust signals + a clear CTA — want those?"). Once the picture is
clear, it builds **completely** (real content, no half-scaffolding).

**Balance:** talkative at the front (clarify, suggest, negotiate), decisive at
the back (execute fully).

## Implementation surface

This is mostly a **system-prompt rewrite** plus **one tool change** that
unblocks real generation.

### 1. `lib/agent/prompts.js` — rewrite `BOARD_AGENT`

Encode: the dual-hat operating model; Rules 1–4; the binding type vocabulary;
the follow-through mechanics (always reach a generated artifact when specs
exist); the new-vs-continue decision with always-ask-on-ambiguity; the
conversational bias. Keep the existing exploration-tools framing and the Voice
section (plain language, narrate in past tense, no tool names/IDs).

### 2. `lib/agent/tools/create-node.js` — carry content

Add an optional `content` (string) param:
- `prompt` type → store as `meta.prompt` (what `runFlow` reads).
- `design-system` type → seed a `design_md` snapshot with `content` (and set
  `current_snapshot_id`), mirroring how `blank-website` seeds its HTML. With no
  `content`, the node stays a blank slot (current behavior).
- Other types ignore `content` (or store to `meta` where meaningful) for now.

Update the tool description so the agent knows: pass the brief/spec as
`content` when generating; omit it for a blank slot.

### 3. Verify, don't rebuild

- `runFlow` already reads `meta.prompt` / `design_md` — confirmed, no change.
- Selection/section context already arrives in the turn — Rule 3 is prompt
  behavior, no new plumbing.

## Out of scope

- A new "generate site from scratch" mega-tool. The compose path
  (prompt→site via `runFlow`) already produces real sites; we just feed it a
  real brief.
- Automated evaluation of agent conversational quality (trace-based evals are
  a separate effort). This change is validated by real conversation traces.
- Changing the direct (non-chat) add-URL / capture flows.

## Testing

- **Unit:** `create-node.js` stores `content` → `meta.prompt` for prompt type;
  seeds a `design_md` snapshot for design-system type; stays blank when
  `content` omitted. `run-flow` composes from a prompt node whose brief lives
  in `meta.prompt` (extend existing run-flow test).
- **Behavioral (manual):** run the four canonical cases in the real chat and
  confirm: correct node types, real generated content where specified, blank
  slots where not, an ASK on the ambiguous new-vs-continue case, and a
  clarifying question on a too-thin request.
