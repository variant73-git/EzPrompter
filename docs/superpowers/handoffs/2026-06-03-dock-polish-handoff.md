# Handoff — 2026-06-03 — Dock polish + section fix session

Branch: `feat/canvas` (157 commits ahead of origin, **unpushed**)

Latest commits (newest first):

- `61caf37` fix(canvas): section grip translates frame + content together + grip tooltip 3× delay
- `b4211a0` fix(canvas): section grip drag + tooltip inverse-scale + longer activation
- `8f6ce0c` docs(handoff): 2026-06-03 dock polish — resize/snap/multi-pill/connector/edges/sections
- `75dca6c` feat(canvas,chat): dock polish session — resize + multi-pill + glass + connector + edges
- `9e7bcf1` fix(chat-dock): full-height docked + tooltip delay + section tooltip scale + remove legacy chevron + bottom-centre snap

## What shipped this session (4 commits)

### Commit `75dca6c` — dock polish marathon

PromptDock + sections + connectors + edges. All summarised in the original handoff body below. Key items:

- **Chat panel resize by edge** — top when bottom-docked, bottom when floating; `chatPanelHeight` state + CSS var `--chat-panel-max-height`; persisted in `uncraft-chat-panel-height` localStorage. Min 120px, max `vh - 160`.
- **Drag-to-dock snap** — threshold widened to full ghost width (352px). Bottom-centre snap reads WIDGET geometry (cursor + grab offset) instead of cursor Y.
- **Drag preview** — body class `chat-dock-preview` shifts BOTH side toolbars + minimap inward simultaneously (358px) so the user sees the docking reorganization on both sides.
- **Dark frosted glass ghosts** — `.prompt-dock-ghost-left/right` use `rgba(10,10,10,0.55)` + blur 28 + shadow + dashed white border. Active state darkens further.
- **Multi-node context pills** — `activeContext` → `activeContexts` array. Shift-multi-select on canvas renders N pills. Per-pill X drops one node. Scope hint to agent expands `[Active nodes (N): ...]`.
- **Chat ↔ input separator** — 1px frosted hairline, edge-to-edge.
- **Sections frosted glass MUCH more transparent** — bg 0.042 → 0.003 (dark), 0.10 → 0.035 (light); blur 16 → 10.
- **Ports 20% smaller + dark-mode idle + color-coded connected** — `is-connected` class on `.cnode-port-right` with origin-fill (matches hover treatment). Idle = neutral. Light mode uses dark chrome too.
- **Edges 1px thinner** across the board.

### Commit `b4211a0` — section grip drag bug + tooltip scale + longer activation

**Root cause:** `.canvas-section-frame` has `backdrop-filter` (frosted glass) which CREATES a stacking context. Grip + name tag + corner handles lived inside that context at z:3, but the whole context sat at z:0 in the parent. Nodes (z:auto, painted after sections in DOM) covered the chrome regardless of internal z-index. Mousedown on the grip landed on whatever node was visually above it.

**Fix:** Split section render into two passes in `CanvasClient.jsx`:

1. **BG pass** (before nodes): renders just `.canvas-section-frame` — glass background + selected outline. No children.
2. **CHROME pass** (after nodes): renders name tag + grip + corner handles inside `.canvas-section-chrome` wrapper at the same world coords. Wrapper has `pointer-events: none` + `z-index: 5`; chrome elements re-enable pointer-events via their own rules. Lives ABOVE the node layer in paint + hit-test order.

**Tooltips:**
- `.canvas-section-chrome [data-tooltip]` picks up inverse-scale treatment (was only on `.canvas-section-name-tag`). Grip / handles / play btn tooltips now stay at consistent on-screen size at any canvas zoom.
- Activation delay bumped from 150ms (global) to **500ms** on all section chrome tooltips.

### Commit `61caf37` — grip moves frame + content together; grip tooltip 3× delay

**Bug:** Grip drag updated member nodes only. The `sectionFrames[id]` (stored frame coords) stayed pinned, so content slid OUT of the frame — visually "content moves but section doesn't".

**Fix:** In `startSectionMove`, snapshot `startFrame = {left, top, right, bottom}` at mousedown. During `onMove`, apply the same `dx/dy` to `setSectionFrames` in parallel with the member positions. Frame + content travel as one unit.

**Tooltip:** Grip activation delay bumped to **1500ms** (3× the 500ms chrome default). The grip sits in the busy top-centre region above nodes and was firing on every drive-by hover. Longer dwell keeps the canvas quiet during pan/select.

## Files touched

- `packages/web-shell/components/PromptDock.jsx` (resize, snap, multi-pills, drag preview, separator)
- `packages/web-shell/components/CanvasClient.jsx` (activeContexts array, two-pass section render, grip translates frame)
- `packages/web-shell/components/CanvasNode.jsx` (`is-connected` class on right port)
- `packages/web-shell/components/EdgeLayer.jsx` (`SLOT_SIZE`/`SLOT_GAP` updated 24→19, 8→6)
- `packages/web-shell/components/chat/chat.css` (`--chat-panel-max-height` var)
- `packages/web-shell/app/globals.css` (sections glass, ports dark-mode + connected fill, edges thinner, context pills, dock chrome, chrome wrapper, tooltip rules)

## How to verify in browser

```
cd packages/web-shell && bun run dev
```

1. **Section grip drag**: hover grip (6×2 dot grid at top-centre of section). Should show grab cursor. Mousedown + drag → entire section (frame + all member nodes) translates together. Tooltip "Drag to move workflow" surfaces only after ~1.5s dwell.
2. **Section name tag**: tooltip at scaled size (consistent on screen), 500ms delay.
3. **Section corner handles**: 4 invisible 28px hit areas at corners. Diagonal cursors. Drag resizes the frame only — members never move.
4. **Resize chat**: docked at bottom, hover top edge of chat → ns-resize cursor. Drag up → chat grows. Floating, hover bottom edge → same.
5. **Drag-to-dock**: drag chat handle. Cursor enters lateral 352px → ghost lights up (dark frosted) + dock turns ghostly + both canvas toolbars shift inward. Release → docks.
6. **Bottom snap**: drag chat handle. Position widget so its BOTTOM hits viewport bottom-centre → bottom snap bar lights. Release → returns to docked.
7. **Multi-pills**: click node A → 1 pill. Shift-click B → 2. Shift-click C → 3. Each X drops one. Workflow pill (select section) replaces all node pills.
8. **Connected ports**: connect A → B. A's right port flips to solid origin colour + white inner dot. Disconnect → returns to neutral.

## State NOT touched

- **Tests**: 136 pass / 48 fail (pre-existing in this branch; chat-route + run-map tests, unrelated to UI work). Verified earlier with `git stash` baseline. Don't use the pass count as a regression signal.
- **Diagnostic agent logs from style-transfer debug** (item 135 in CLAUDE.md). Still in place. Original style-transfer handoff said "remove next session" — that session was this one, **I did not remove them**. Worth grep + clean early next session:
  ```
  grep -rn "\[agent\] EXEC\|\[agent\] DONE\|\[createImage\]" packages/web-shell/
  ```
- **No push to origin.** 157 commits unpushed on `feat/canvas`. User may want to open PR.

## Known follow-ups (small)

- **Section grip drag** persists to API only for member nodes (`api.updateNode(posX, posY)` per node). The `sectionFrames` translation is local state + localStorage only. If the user wants the section frame override to survive across boards/devices, would need a DB schema for section frame overrides per board. Currently board reload re-derives sections from members' positions (auto-bbox), so the visual result is preserved as long as members moved with the frame (which they do).
- **`:has(...)` selector** on `.prompt-dock-context-pills:has(.prompt-dock-context-pill[data-kind="node"])` — Safari 15.4+ / Firefox 121+ / Chrome 105+. Should be fine.
- **Section chrome wrapper** has `z-index: 5`. Edges (drawn by EdgeLayer SVG) sit ABOVE the chrome z-wise? The EdgeLayer SVG element has `pointer-events: none` on the parent + `pointer-events: stroke` on the lines. Need to verify edge clicks don't get blocked by the chrome wrapper. Quick test in browser will tell. If issues surface, raise edge z-index above 5 or lower chrome below.
- **Bottom resize** in floating mode: `fromBottom` clamps at 8 once the widget bottom hits the viewport bottom. Past that, dragging further down still grows the chat panel but the widget visually anchors. Minor UX nit.

## Architecture notes

- **Section chrome separation** (`b4211a0`) is the right pattern for any future "thing painted underneath nodes that needs interactive controls on top". If you need to add e.g. a workflow timeline or a section-level overlay button, render it in the chrome pass.
- **Frame translation** (`61caf37`) — the `sectionFrames` override + `Math.min/max` clamp pattern means any drag that moves member nodes WITHOUT also translating the frame override will produce the "content slides out" bug. Worth noting for any future section manipulation (e.g. grouping/ungrouping, splitting).
- **Multi-context array** (`75dca6c`) — `activeContexts` is the canonical shape now. Don't reintroduce singleton `activeContext` unless you also handle multi-selection collapse in CanvasClient.

## Greeting from outgoing session

User explicitly thanked me earlier and is ending the session warmly. Next session tone can match — no need to over-explain past work, just continue.
