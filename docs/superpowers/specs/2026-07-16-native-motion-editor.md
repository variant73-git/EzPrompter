# Native Motion Editor

**Status:** first implementation slice

**Branch:** `feat/native-motion-editor`

**Experiment:** new native clone + new editor for animated websites

## Why this is a separate editor

The existing editor serializes and rebuilds mostly static HTML. A native clone
keeps the original DOM, downloaded assets, Webflow runtime, GSAP timelines,
ScrollTrigger, SplitText, Lottie, Lenis, carousels, video, and custom scripts.
Editing that document with the static editor would either freeze its runtime or
destroy relationships the animation code still owns.

The Native Motion Editor therefore has its own engine. It may share Uncraft's
visual language and canvas entry point, but it does not inject or reuse the
legacy editor-core runtime.

## Product model

The native bundle is immutable. User changes are stored as ordered patches and
applied over the bundle:

```text
native bundle + patch manifest = edited animated website
```

This makes reset, undo, version history, export, and visual comparison possible
without repeatedly serializing a live, script-mutated DOM.

## Security boundary

Cloned code is untrusted. It must never share the Uncraft application's origin
or receive direct access to authentication cookies, storage, or the parent DOM.

The runtime is rendered in a sandboxed iframe without `allow-same-origin`. A
small bridge is injected into the served HTML and communicates through a
versioned `postMessage` protocol. The host validates the source window and the
bridge validates that commands came from its parent.

Production will serve each bundle from a dedicated runtime origin. The local
prototype uses the same URL host plus an opaque sandbox origin so the protocol
and trust boundary are already representative.

## First vertical slice

1. Serve an existing offline native bundle through a path-contained asset
   gateway.
2. Inject the isolated runtime bridge without modifying the source bundle.
3. Detect Webflow, GSAP, ScrollTrigger, Lottie, CSS/WAAPI animations, and native
   media.
4. Toggle between Edit and Preview without unloading the runtime.
5. Select real elements inside the animated document.
6. Inspect element identity, typography, color, size, and detected motion.
7. Edit text, image source, color, background, type size, alignment, and
   opacity as patches.
8. Pause, play, restart, and change the speed of discoverable motion.
9. Undo and redo patches from the host.
10. Save the patch manifest locally for the prototype.

## Editor layout

- Compact top bar: return to canvas, document identity, centered device
  switcher, Edit/Preview state, undo/redo, save.
- Dark working surface around the real website viewport.
- Website renders with its own colors untouched.
- One contextual panel with `Properties`, `Motion`, and `Code`.
- Selection is represented inside the runtime by a screen-constant blue
  outline, never by modifying layout.

## Patch contract

Every patch contains:

- stable element identifier;
- operation (`style`, `text`, or `attribute`);
- property when applicable;
- previous value;
- next value;
- creation time.

Stable identifiers prefer source IDs such as `data-w-id`, then fall back to a
deterministic DOM fingerprint. Identifiers are added only at runtime and do not
alter the stored bundle.

## Motion ownership

The inspector distinguishes base properties from values currently owned by an
animation. A first-slice edit is still allowed, but the UI reports the detected
motion engine. Later slices will introduce explicit ownership choices:

- change the base state;
- change the animated state;
- detach that property from the animation;
- create a breakpoint-specific override.

## Runtime adapters

The bridge exposes one normalized protocol while adapters handle engine details:

- CSS Animations and Web Animations API;
- GSAP global timelines;
- ScrollTrigger instances and refresh;
- Webflow IX markers and later IX2 re-initialization;
- SplitText-aware text replacement;
- Lottie instance discovery;
- Lenis, Splide, video, canvas, and WebGL diagnostics.

The first slice detects all of these and controls what can be controlled safely.
Engine-specific timeline editing is a later slice.

## Persistence and compilation

Prototype persistence uses local storage so interaction can be validated before
introducing a database migration. Production persistence will store immutable
bundle versions and patch manifests separately. Export will copy the bundle,
inject a pre-runtime patch bootstrap, then run visual regression at desktop,
tablet, and mobile sizes.

## Next slices

1. Persist manifests per node and bundle version in the Uncraft database.
2. Apply patches before animation initialization during preview/export.
3. Build SplitText, Webflow IX2, GSAP, and ScrollTrigger property adapters.
4. Add a timeline and scroll-trigger visualization.
5. Add structural operations: insert, delete, reorder, and section rebuild.
6. Add multi-breakpoint visual regression and motion checkpoints.
7. Connect native clone creation and storage to a site node on the canvas.

## Acceptance criteria for this slice

- The Farm Minerals offline clone opens inside the new editor from its local
  bundle and continues animating.
- The parent app cannot directly read the iframe DOM.
- Edit mode can select elements without activating links or forms.
- Preview mode restores original interactions.
- Property changes appear immediately and can be undone and redone.
- Motion controls affect both browser animations and discoverable GSAP
  timelines.
- Reloading the editor can restore the saved patch manifest.
- The legacy editor remains unchanged and available on the canvas.
