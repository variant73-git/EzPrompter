# Section membership consistency + organic node removal

**Date:** 2026-06-20
**Branch:** feat/canvas
**Status:** Design approved, pending spec review

## Problem

A node can belong to a section two different ways, and they don't behave the
same:

- **By connection** (a real edge) — a stable, persistent member.
- **By geometry** (sitting inside the section frame) — membership is recomputed
  from the node's live position every render, so it can silently fall out.

Concrete bug the user hit: a `site` node sat in the middle of a section. It
wasn't a member. When the user connected a `.md` node (to the right of the site)
**from** an image node on the left edge of the section, the section's bounding
geometry grew to enclose the site, so the site was absorbed geometrically. From
then on the site behaved inconsistently: dragging it pushed the section frame
like every other member, **but releasing it dropped it out of the section** —
because geometric membership is re-evaluated from position on drop.

This is confusing and reads as a bug. The rule the user already established is
"everything inside a section's demarcation belongs to the section" — so the site
*should* be a full member. The inconsistency is the defect.

## Goal

1. **One membership model.** Every node inside a section is a real member and
   behaves identically — dragging only stretches/retracts the frame; the node
   never silently leaves.
2. **One deliberate way out**, organic and predictable: an elastic "pull-out"
   gesture, plus an explicit menu action. Both lead to the same clearly-signposted
   "removal armed" state with a cancel path.

## Design

### A. Membership becomes sticky (the root fix)

Membership is **persisted**, never derived from live position:

- **Edge members** are already persistent (the connected-component graph).
- **Drop-into-section** already persists `meta.adoptedInto` (the adopt path in
  `handleNodeMoveEnd`).
- **Passive geometric absorption** (the site case — engulfed because a neighbour
  was connected) is the gap. We **latch** it: after sections are derived, any
  member that is in a section *purely* geometrically (no real edge, no existing
  `meta.adoptedInto`) gets `meta.adoptedInto = section.rootId` written once.

After latching, geometric absorption stops being a *continuous* membership
source and becomes only the *trigger* that sets the persistent marker.
Membership is then `edges ∪ adoptedInto` — both persistent and
position-independent.

The **silent un-adopt-on-drop release path is removed.** A node never leaves a
section just by being dropped somewhere; it leaves only through the explicit
removal flow (B/D below).

Guards:
- The latch effect is skipped while a node is being dragged (`dragFreeze`), so
  nothing is latched mid-gesture.
- Temp (`temp-`) nodes are never latched.
- A dangling `adoptedInto` (anchor deleted) is already ignored by the
  derivation; re-root inheritance is unchanged.

### B. Elastic pull-out gesture

While dragging a member:
- The section frame stretches to follow the node (existing grow-only behaviour) —
  this is the "rubber band".
- The node **tears out** (enters the armed removal state, C) when its **center
  passes beyond the core of the *remaining* members by a margin**
  (`TEAR_MARGIN`, default ~70px world). This reuses the existing
  `sectionCoreRect(remaining)` math.
- Before the threshold: the frame just stretches; the node stays a member.
- At the threshold: the node "detaches", the frame snaps back to fit the
  remaining members, and the armed state turns on.

### C. Armed removal state (visual)

When armed (via gesture B or menu D), the node enters a distinct state:

1. A **red outline** replaces the category color-coded stroke.
2. The **topbar turns red**; its normal buttons are replaced by a single
   **"Cancel"** button.
3. The topbar grip (dot grid) area shows the label **"Drag outside"**.
4. While the armed node is being dragged outside, the **canvas background
   lightens slightly** — never lighter than the section background.

### D. Menu action

In the node `...` menu the order becomes:
`…other items… → [separator] → Remove from this section → Delete`

"Remove from this section" only appears when the node is a section member. It
puts the node into the same armed state (C), and the user drags it outside to
complete.

### E. Commit / cancel / connections

- **Release outside the section** → commit: armed state cleared, node returns to
  its normal appearance, and **all of the node's connections (incoming and
  outgoing) are broken**. The node becomes a free standalone node.
- **Release back inside the section** → cancel: node returns to normal, stays a
  member, connections intact. Same outcome as the "Cancel" button.
- **Cancel button** → cancel: node returns to normal in place.

"Outside / inside" is measured by the node center vs the section frame at
release time.

## Components touched

- `components/CanvasClient.jsx`
  - `sections` useMemo — membership stays as-is for derivation; add the latch
    effect that persists `adoptedInto` for purely-geometric members.
  - Remove the silent un-adopt-on-drop path in `handleNodeMoveEnd`.
  - Drag handlers (`handleNodeMoveStart/Move/End`, `maybeUpdateAdoptPreview`) —
    add tear detection vs remaining-core + `TEAR_MARGIN`; manage armed state.
  - New armed-removal state (which node is armed) + canvas-lighten flag.
  - Handler for menu "remove from this section" → arm.
- `components/CanvasNode.jsx`
  - Armed visual (red outline + red topbar + single Cancel + "Drag outside"
    label).
  - `TopbarContextMenu` — add "Remove from this section" above Delete with a
    separator, shown only for section members.
- `app/globals.css`
  - `.cnode.removing` (red outline/topbar), the "Drag outside" label, the
    canvas-lighten class.
- API: reuse existing `api.deleteEdge` / `api.updateNode` (clear `adoptedInto`,
  delete edges on commit). No new endpoints.

## Tunables (defaults)

- `TEAR_MARGIN` ≈ 70px world (how far past the remaining-core center before tear).
- Canvas lighten ≈ +4% luminance, capped below the section background.

## Testing

- Latch: a node passively engulfed by a neighbour connection gets
  `adoptedInto` and stays a member after being dragged within the frame and
  released (no silent escape).
- No silent release: dragging a member out softly and releasing keeps it a
  member (frame stretched), NOT removed.
- Tear threshold: dragging past `TEAR_MARGIN` arms removal; under it does not.
- Commit: release outside removes the node and deletes all its edges.
- Cancel: release inside, and the Cancel button, both restore the member with
  edges intact.
- Menu: "Remove from this section" shown only for members, ordered above Delete
  with a separator; arms the same state.

## Out of scope

- Changing the section grip (whole-section move) behaviour.
- Multi-node removal (only single-node removal here).
- Re-introducing nested/overlapping sections (still forbidden).
