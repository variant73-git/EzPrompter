# Node Version-History Floater — Design

**Date:** 2026-06-23
**Branch:** `feat/canvas`
**Status:** Approved design, pre-implementation

## Overview

A floating row of version thumbnails below a selected **site node** on the canvas, letting the user see and roll back to past versions. Edits/generations already happen in place (same node); this surfaces the version history that the snapshot system already records.

## Scope

- **Site nodes only.** Image/asset nodes are explicitly OUT (they have no version history today — `createImage` with `replaceAssetId` overwrites `meta.dataUrl` and discards the old image; building image versioning is a separate future project).
- Reuse the existing `snapshots` table + `current_snapshot_id`. No schema change.

## 1. Version model

- A "version" = one row in `snapshots` for that node.
- **Past versions** = all snapshots of the node **except** the current one (`current_snapshot_id`), ordered newest-first by `created_at`.
- **Restore** = move the `current_snapshot_id` pointer to the chosen snapshot. Non-destructive: no snapshot is deleted; later edits branch from the restored version via the existing `parent_snapshot_id`.
- The current version is the node itself (rendered in the body); the floater shows only PAST versions.

## 2. Thumbnail strategy

Snapshots are inconsistent on screenshots: only `capture`/`handoff`/`manual` snapshots set `screenshot_url`; `edit`/`run-flow`/`replace-content`/`extract` snapshots store HTML only (no image). So most versions in this flow have no screenshot.

- If the snapshot has `screenshot_url` → render it as an `<img>` (light, fast).
- Else → render a **mini-iframe** (`srcDoc` = the version's HTML), scaled down, `pointer-events: none`. The HTML always exists, so this works for every version.
- **Bandwidth discipline** (mirrors the Neon light-query work): the list endpoint returns metadata only — never bulk HTML. A version's HTML is fetched **on demand**, only for the ≤3 thumbnails shown (and lazily for history-menu rows as needed). No "load all versions' HTML" anywhere.

## 3. UI / layout

- Visible **only when the site node is selected** (consistent with the Smart Edit affordance being scoped, but selection-only here to keep a busy canvas clean).
- A floating row anchored below `.cnode-body`:
  - Up to **3 square thumbnails** (rounded corners), the 3 most recent past versions, left→right (newest leftmost).
  - A **grey history-icon button** as a 4th slot, shown **only when there are >3 past versions** (with ≤3, the thumbnails already show everything — no redundant button). *(Open to making it always-present if preferred.)*
  - History button → a menu reusing the existing canvas menu style (`.popup-*` / canvas-context-menu family). Each row: thumbnail left-aligned + date/time right-aligned, newest first, scrollable.

## 4. Preview → restore flow (confirm before switching)

1. User clicks a past-version thumbnail (in the row or the menu).
2. The node body **previews** that version (swaps the rendered content to the version's HTML) — non-persisted.
3. A confirm bar appears: **"Restaurar esta versão" / "Cancelar"**.
   - **Cancelar** → body returns to the current version. Nothing changes.
   - **Restaurar** → `POST restore-version`, moves `current_snapshot_id`, body re-renders the now-current version, floater list refreshes (the previously-current version becomes a past version).

## 5. Endpoints

- `GET /api/nodes/[id]/snapshots` — light list: `[{ id, source, created_at, hasScreenshot, isCurrent }]`, newest-first, ALL snapshots with the current one flagged via `isCurrent` (the client derives "past versions" = `!isCurrent`, used by both the row and the menu). NO `html`. Ownership-checked.
- `GET /api/nodes/[id]/snapshots/[snapId]` — one version's renderable content (`html`, `screenshot_url`) for preview + mini-iframe thumbnail. Ownership-checked. On-demand only.
- `POST /api/nodes/[id]/restore-version` — body `{ snapshotId }`; sets `current_snapshot_id` to that snapshot (must belong to this node + owned). Returns the restored snapshot's content so the client can render immediately. Leaves the existing `reset` route untouched.

## 6. Components

- `NodeVersionFloater.jsx` — the row (≤3 thumbnails + conditional history button). Rendered by `CanvasNode` when node is a site, selected, and has ≥1 past version.
- `VersionHistoryMenu.jsx` — the expanded full list (frosted menu family), thumbnail + date/time rows.
- `VersionThumbnail.jsx` — one square: `<img>` (screenshot) or scaled `srcDoc` mini-iframe.
- Preview state lives in `CanvasNode` (a `previewSnapshotId` + confirm bar); restoring calls into `CanvasClient` to patch the node + refetch.
- CSS: `.cnode-version-row`, `.cnode-version-thumb`, `.cnode-version-history-btn`, version-menu styles, in `globals.css`, following the frosted-glass + rounded-corner design language.

## 7. Testing

- Endpoint unit tests (vitest, mocked `sql`): list returns metadata-only newest-first with ownership 404; single-snapshot fetch ownership; restore-version sets the pointer, rejects a snapshot from another node / another user.
- Component tests (RTL): floater renders ≤3 past versions; history button appears only with >3; clicking a thumbnail enters preview + shows confirm bar; Cancelar reverts; Restaurar calls restore + refreshes.

## Out of scope / deferred

- Image/asset version history (needs new versioning — `replaceAssetId` overwrites today).
- Auto-generating screenshots for edit/run snapshots (mini-iframe covers thumbnails without it).
- Diffing between versions / naming versions.

## Known constraints

- Mini-iframe thumbnails render real HTML; keep them `pointer-events:none` and lazy (only when floater is shown) to bound cost. The site HTML may reference external assets — thumbnails render best-effort (same as the node body iframe).
