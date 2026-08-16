# Live Animated Clone Editing

**Status:** approved
**Date:** 2026-07-26
**Approved by:** Adilson Porto on 2026-07-26
**Scope:** native animated-clone editing inside the Uncraft canvas
**Checkout observed during design:** `/Users/adilsonporto/Desktop/IA/Uncraft`
**Branch observed during design:** `main`

## Approval and implementation boundary

This document specifies the approved product behavior and the conceptual
integration contract. It is not an implementation plan and does not claim that
the canvas integration already exists.

No product implementation may begin from this document until:

1. this specification is explicitly approved;
2. an implementation plan is written and reviewed separately;
3. the active checkout, branch, worktree, and concurrent file owners are
   verified again.

The isolated Native Motion Editor is real and substantial. The canvas
integration, scoped freeze behavior, node persistence, responsive control
variants, automated control repair, and administrative diagnostics described
here remain to be implemented.

## Relationship to existing documents

This specification continues and refines:

- `docs/superpowers/specs/2026-07-16-native-motion-editor.md`;
- `docs/superpowers/specs/2026-07-15-adaptive-canvas-shell.md`;
- `docs/superpowers/handoffs/2026-07-25-edit-animated-clone-brainstorm-continuation-handoff.md`.

The earlier Native Motion Editor specification remains authoritative for the
isolated runtime engine, sandbox, bridge, Motion IR, and immutable native-bundle
model. This document is authoritative for the approved canvas integration and
the editing semantics added after that specification.

Where the earlier documents differ from this one:

- the canvas inspector uses `Properties`, `Motion`, and `Code`;
- `Assets` belongs to the left editing panel with `Layers` and `Sections`;
- edits in `Properties` retarget the final visual state without creating hidden
  keyframes;
- custom controls use the editability ladder and validation contract defined
  here;
- prototype `localStorage` persistence is not a product persistence model;
- the final choice between hiding and disabling unsupported controls remains a
  smoke-test decision.

## Product objective

Allow a user to visually edit a reconstructed animated website while preserving
its live DOM, runtime behavior, scroll choreography, and original animation
logic.

The edited result must remain the same kind of artifact as the source clone:

```text
immutable native bundle + ordered patch manifest = edited live website
```

The editor must not replace the runtime with a visual approximation, flatten
the website into static frames, or silently detach properties from the
animations that own them.

## Product invariants

1. The runtime remains alive.
2. Visual edits survive replay and become intentional animation outcomes.
3. Ordinary property edits never create hidden keyframes.
4. Explicit motion edits remain visible in `Motion`.
5. The editor never claims that an unsafe or ineffective control works.
6. Generated code runs only inside the clone sandbox.
7. Every committed mutation is reversible during the editing session.
8. Desktop, tablet, and mobile remain variants of one website version.
9. Failures are repaired automatically whenever possible.
10. Technical recovery choices are not delegated to the user.
11. The original scroll choreography and runtime fidelity are preserved.
12. The static and iter9 editor path remains available for compatible nodes.

## Non-goals

This specification does not define:

- a replacement for the existing bridge, Motion IR, or timeline;
- a rewrite of `NativeMotionEditor.jsx` as the first integration step;
- a new visual panel injected into the cloned website;
- automatic keyframe creation from `Properties`;
- generated JavaScript running in the Uncraft host;
- a promise that every candidate global control is universal;
- the final threshold for hiding versus disabling unsupported controls;
- database tables, endpoint names, migration files, or implementation order;
- removal of the isolated `/motion-editor` route;
- removal of the legacy editor for static or iter9 snapshots.

## Verified starting point

The current motion editor already provides reusable foundations:

- a versioned bridge protocol;
- runtime detection for GSAP, ScrollTrigger, Lottie, WAAPI, media, and related
  drivers;
- normalized Motion IR;
- `MotionPanel` and `TimelinePanel` exports;
- timeline playback, playhead, scrub, rows, grouping, strips, and explicit
  keyframes;
- a gateway that injects the bridge and rewrites native-bundle paths;
- ordered patch history as a working prototype concept.

The current integration gaps are:

- the real node snapshot is not served through the motion bridge in canvas Edit;
- canvas selection is not connected to the bridge selection model;
- the canvas inspector does not mount the native `Motion` surface;
- the timeline is not docked beneath the real canvas editing viewport;
- scoped auto-settlement is not implemented;
- isolated patches still use prototype persistence;
- canvas nodes and immutable snapshots do not yet own the motion control
  manifest described here.

The existing global freeze helper is evidence, not the solution. The live clone
requires scoped bridge control so unrelated elements and runtime state are not
forced to a global final frame.

## Core product surface

### Canvas integration

Website Edit uses the adaptive Uncraft shell:

- the live website occupies the central viewport;
- the left editing panel contains `Layers`, `Sections`, and `Assets`;
- the right inspector contains `Properties`, `Motion`, and `Code`;
- the timeline docks beneath the central viewport when motion context requires
  it;
- the contextual top bar retains Cancel, Done, device controls, and undo/redo;
- the website scrolls inside its fixed device viewport while canvas panning is
  suspended for the editing interaction;
- exiting Edit restores the canvas node geometry and canvas interaction model;
- the application chrome never changes the cloned site's own colors;
- selection overlays are clipped to the website viewport;
- application panels do not count as selectable or visible website area.

`Assets` must not become a fourth right-inspector tab. The isolated
`/motion-editor` laboratory may retain its current development layout without
defining the final canvas information architecture.

### Selection synchronization

Selecting an animated element synchronizes:

- the element overlay in the website viewport;
- the active target in `Properties`;
- the active animation or group in `Motion`;
- the corresponding row or rows in the timeline.

Selecting a timeline row may scroll and frame the relevant element. Any visible
part of an element may be clicked, but automatic movement requires meaningful
visibility.

## Editing state machine

### Navigate

Navigate is the live browsing state inside Edit:

- the user scrolls normally;
- scroll-driven animations respond to scroll;
- pointer, media, and runtime interactions remain active when appropriate;
- confirmed edits remain applied;
- scrolling does not discard the current patch manifest.

### Edit: Frozen

The viewport enters Frozen when scrolling settles or an element is selected:

- the current composition freezes under the cursor;
- only the selected element attempts automatic settlement;
- unrelated elements remain on their current frames;
- the selected element's overlay remains screen-constant and viewport-clipped;
- the user may edit properties without the composition moving underneath the
  pointer.

Automatic settlement runs only when at least one of these thresholds is met:

- 25 percent of the element's area is visible;
- at least 32 px of the element is visible.

A one-pixel or two-pixel edge must not cause a viewport jump or automatic
settlement.

### Preview

Preview temporarily removes editing chrome and plays the real runtime:

- selection and editing overlays disappear;
- the current, not-yet-snapshotted manifest remains applied;
- live motion plays through the original runtime;
- returning from Preview restores the same device, scroll position, selection,
  and frozen composition.

### Scrub

Manual scrub remains available in the hybrid model:

- the frame updates continuously while the user drags;
- the viewport freezes again when the drag ends;
- choosing a frame never creates a keyframe by itself;
- scrub does not discard confirmed property or motion changes.

### Finite motion and loops

For finite motion, automatic settlement uses the end of the effective sequence.
When multiple finite animations are chained, the resting state is the final
state of the chain.

Loops have no single resting state:

- selecting a loop freezes the currently visible frame;
- the editor does not jump to the beginning or invent a final frame;
- scrub remains available for choosing another point;
- `Loop` appears beside the timeline row and in the selected Motion header;
- no badge is placed over the element in the canvas;
- edits alter the loop's base state while preserving its relative movement.

## Meaning of an edit

### Properties retargets the visual outcome

When a user moves or styles an animated property, the edited value becomes the
new final visual target.

Example:

```text
Before: x from -100 to 0
User moves the final state 40 px to the right
After: x from -100 to 40
```

The source state, duration, easing, and path remain unchanged unless the user
edits them explicitly in `Motion`.

### Motion changes behavior explicitly

`Motion` owns deliberate changes to:

- timing;
- easing and curves;
- playback behavior;
- loop and ping-pong behavior;
- tracks and timeline structure;
- explicit keyframes;
- animation-specific and group-specific controls.

Custom controls that affect movement belong in `Motion`. A control being
generated does not justify a separate `Tweaks` surface.

## Motion ownership and conflicts

### Unambiguous ownership

The bridge identifies every effective contributor to a semantic property such
as position, opacity, rotation, scale, or blur.

When several animations write the same property sequentially, the last writer
that determines the resting value owns the final-state edit.

Example:

```text
Entrance: x from -100 to 0
Follow-up: x from 0 to 40
User changes the resting position to 70

Result:
Entrance remains x from -100 to 0
Follow-up becomes x from 0 to 70
```

Tracks earlier in the sequence remain unchanged.

### Nested timelines

Ownership resolves through scheduling containers to the animation that
actually writes the value. A parent timeline that only schedules child
animations is not treated as the property owner.

### Independent transform components

Position, rotation, and scale remain independent in the interface even when
the runtime serializes them together.

Editing one component must preserve all unedited components. A complex 3D or
procedural transform that cannot be safely decomposed must not masquerade as a
normal position or rotation field. It belongs in `Motion` through a validated
specific control.

### Genuine ambiguity

Some visual outcomes have more than one legitimate interpretation. For
example, an entrance animation and a hover animation may both move the same
button.

When the intended behavior cannot be inferred safely:

- `Properties` shows the calculated visual value;
- the field indicates that multiple motions control it;
- activating the field opens `Motion` with only the contributing tracks
  highlighted;
- labels describe user-visible behaviors such as `Entrance` and `Hover`;
- the user selects the behavior they intend to modify;
- the selection becomes a persisted ownership hint;
- the hint is revalidated when animation structure changes;
- no hidden override track or keyframe is created.

This choice asks for creative intent. It is not a technical recovery decision.

## Editability ladder

Every potential control is evaluated through this ladder:

1. `Direct`: a generic, normalized capability is already available.
2. `Known adapter`: a supported runtime adapter provides the capability.
3. `Declarative tweak`: a CSS property, DOM attribute, or other declarative
   binding provides the capability safely.
4. `Custom runtime adapter`: a sandboxed adapter is generated for the specific
   clone, runtime, animation, or group.
5. `Code only`: no safe binding currently exists.

`Code only` is the last result, not the first classification. It means that the
editor has not established a safe binding, not that the animation can never be
edited.

## Control discovery and generation

### Automatic safe controls

Direct, known, and declarative controls may appear automatically only after they
pass the complete validation contract.

### Custom runtime adapters

When a custom adapter is required:

- the editor detects that custom controls may be possible;
- the user initiates the first generation through `Generate controls`;
- generated code executes and validates only inside the clone sandbox;
- only fully validated controls appear;
- failed candidates do not create user-facing technical reports;
- later compatibility repair and regeneration occur automatically.

The user approves creative generation once. The user does not operate retry,
repair, or regeneration mechanics.

## Control scope

Every control has one explicit scope:

- `Site`: affects the whole website;
- `Group`: coordinates a declared group of animations;
- `Animation`: affects one animation or timeline;
- `Element`: affects motion behavior belonging to an element but not a single
  track.

`Animation` is the default scope for generated motion controls. A control may
not silently broaden its scope. Group and site controls must declare every
target or capability they affect.

Purely visual values remain in `Properties`. Motion behavior remains in
`Motion`, regardless of whether its binding is direct, known, declarative, or
custom.

## Control catalog

The initial control catalog is:

- slider paired with precise numeric entry;
- toggle;
- select with curated options;
- curated color;
- curve using the existing easing editor.

The initial catalog excludes free text, arbitrary color expressions, code,
JSON, arrays, and arbitrary objects.

The agent should choose a small set of useful controls:

- approximately three controls is the default;
- five controls per animation or group is the recommended maximum;
- options and ranges are curated;
- controls that do not produce a meaningful effect are not exposed.

## Control presentation

Every exposed control requires:

- a concise label;
- a one-line explanation;
- a human-readable unit when relevant;
- a safe range and step for numeric input;
- a value read from the runtime;
- the original value for the compatible clone version;
- a `Reset to original` action.

Supported units include familiar forms such as percent, multiplier, pixels,
milliseconds, and degrees. Runtime paths and implementation terminology do not
appear in the primary interface.

`Default` means the original value for the compatible clone version. It does
not mean the latest saved value.

## Conceptual CustomControlManifest

The implementation schema may differ, but every manifest entry must express
the following concepts.

### Identity and presentation

- stable control identifier;
- label and one-line explanation;
- surface (`Properties` or `Motion`);
- scope (`Site`, `Group`, `Animation`, or `Element`);
- control type;
- unit, range, step, options, and original value.

### Target and ownership

- stable semantic target identity;
- animation, group, element, or site scope identity;
- semantic property or command;
- write model: absolute, relative, or additive;
- declared set of affected targets;
- ownership hint when the user has resolved a genuine ambiguity.

### Binding

- binding kind;
- read operation;
- write operation;
- restore operation;
- effect observation method;
- protocol or adapter contract version;
- sandbox requirement.

### Compatibility

- source snapshot identity;
- runtime family and relevant version;
- semantic target fingerprint;
- relevant binding fingerprint;
- compatible snapshot lineage;
- last successful validation identity.

The complete site hash is retained for provenance but is not the only
compatibility gate. An unrelated text or style change must not invalidate a
motion control automatically.

### Capability and state

- readable;
- writable;
- effect verified;
- reversible;
- scope safe;
- responsive behavior;
- enabled or disabled state;
- sanitized diagnostic fingerprint.

## Binding priority

The editor prefers the least custom mechanism that fulfills the complete
contract:

1. CSS custom property.
2. Declarative DOM attribute.
3. Known runtime binding accessed through the bridge.
4. Typed protocol command.
5. Custom sandbox adapter.

This is a safety and stability preference, not a blind mechanical rule. A later
mechanism may be selected when it provides a more faithful, stable, and
reversible semantic binding.

The host must never access arbitrary runtime paths directly or execute generated
code.

## Transactional control behavior

Read and write are separate capabilities.

For every editing gesture:

1. read and capture `before` once;
2. apply live preview values during the gesture;
3. validate the effective result when the gesture ends;
4. record one `after` value;
5. commit one history entry and schedule autosave.

If write, validation, or restore fails:

- restore `before`;
- do not add undo history;
- do not autosave;
- do not mark the control as successfully persisted.

Runtime-originated value changes may update the visible control without
creating history.

A control that cannot reliably read its prior state must not display an
invented slider position. Without a reliable `before`, the editor cannot
represent the current state or guarantee undo.

## Validation contract

Every mutating control, including candidate site-wide motion controls and
custom controls, passes four layers before it is enabled.

### Read and write

- read the current value;
- apply a safe test variation;
- verify the written value through the runtime or bridge.

### Effect

- confirm a meaningful change in the declared target;
- use runtime state, computed style, or localized visual comparison according
  to the capability;
- support canvas, shader, and other visually rendered effects through a
  localized visual oracle when a state value is insufficient.

### Safety

- detect runtime exceptions;
- detect layout breakage;
- detect changes outside the declared scope;
- detect loss of animation or interaction fidelity;
- reject controls whose useful range is not stable.

### Restore

- restore the exact pre-test state;
- verify that the runtime and visual target returned to that state;
- leave no history or persistent patch from validation.

Sliders are tested at representative points in the proposed safe range. Every
curated select option and preset is tested.

Validation occurs outside visible user interaction whenever possible. A control
is exposed only after the complete contract succeeds.

## Candidate global controls and universality

Reconstruction must anticipate candidate site-level capabilities. It should
instrument, expose, and validate a canonical control surface before the user
enters Edit.

This does not prove that any motion control is universal.

A site-level motion control must satisfy its entire semantic promise. For
example, a control described as stopping site motion cannot leave an unhandled
shader or proprietary animation moving.

The classification remains empirical:

- smoke tests measure availability, auto-repair, and disabled occurrence rates;
- metrics are segmented by control, runtime, device, and site class;
- a control with inconsistent real-world support is treated conceptually as a
  custom control;
- the final choice between hiding and disabling unsupported controls is made
  after representative smoke-test evidence exists;
- no fixed decision threshold is asserted by this specification.

### Task 15 evidence amendment — approved 2026-07-27

The product owner reviewed the Task 15 smoke evidence and approved the
following presentation decision for the current product:

- the available evidence is insufficient to promote any candidate control to
  a common, global, or universal presentation;
- candidate cross-site controls remain classified as custom;
- a control that exhausts automatic recovery remains visible but disabled;
- the disabled control keeps the tooltip
  `This website doesn't support this control.`;
- no universality percentage is hardcoded in implementation.

The reviewed matrix covered 15 candidate/device cases across desktop, tablet,
and mobile. Nine passed initial validation, three recovered automatically, and
three intentionally stale bindings exhausted recovery and were disabled. The
reviewed false-positive rate was zero. Because the required fault fixture
deliberately influences the observed 20% disabled incidence, and the two
real-clone controls were harness sentinels rather than complete semantic
controls, those figures validate the harness and safe fallback but do not
establish real-world universality.

Any future proposal to hide exhausted controls or promote a control beyond
custom requires a separate approved amendment. That proposal must pre-register
the real-clone distribution, semantic success threshold per control and site,
maximum exhausted and false-positive rates, and the resulting presentation
policy before implementation changes.

Non-persistent session commands such as play, pause, and scrub use the same
safety principles, but they are tested as editor commands rather than node
patches.

## Responsive values

Desktop, tablet, and mobile belong to one responsive website version.

Every editable value follows one behavior:

- `Shared`: one value applies across devices;
- `Per device`: an explicit override applies only in the active viewport;
- `Computed`: the website derives the value from its layout or runtime.

Text, colors, easing, and duration commonly begin shared. Geometry, spacing,
scroll ranges, and device-specific motion commonly require device variants.
The binding and reconstruction determine the safe default; the user may create
an explicit exception.

### Inspector behavior

- the inspector shows only controls relevant to the active device;
- mobile-only controls do not appear while editing desktop;
- switching device updates the same fields to the effective values for that
  viewport;
- the device switcher may indicate that overrides exist without mixing their
  fields into the current inspector.

### Link control

Shared properties display a connected-chain icon. It is an interactive control,
not a text tag.

Tooltip:

```text
Applied to all devices
```

Clicking the connected chain pauses editing and opens a centered confirmation.
For desktop, the exact copy is:

```text
This will set this value to desktop-only.

Cancel
Set Desktop-Only
```

Tablet and mobile substitute the appropriate device name.

Confirming creates an override for the current device, initialized from the
effective shared value. The icon becomes a disconnected chain.

Reconnecting is intentionally faster because the connected state is the
default and its meaning has already been learned. Clicking the disconnected
chain immediately applies the currently visible value to all devices and
removes device-specific variations for that property. No confirmation appears.

### Device-specific settlement

The resting state is discovered independently for each device. The editor must
not reuse a desktop resting frame for a mobile layout whose animation path or
responsive structure differs.

### Snapshot model

One immutable snapshot contains:

- shared values;
- desktop overrides;
- tablet overrides;
- mobile overrides;
- control compatibility and validation state for the responsive version.

Switching viewport does not create a new version. `Save version` and version
restore operate on the complete responsive site.

## Persistence and history

Every confirmed edit produces a patch in the node manifest and updates the live
clone immediately.

Persistence behavior:

- autosave runs in the background with debounce;
- one continuous gesture becomes one history entry;
- undo and redo traverse multiple committed actions in chronological order;
- history covers the full current editing session, not only the selected
  control;
- a device-only change undoes only that override;
- Preview uses the current manifest before an immutable snapshot exists;
- a new immutable snapshot is created on exit from Edit, `Save version`, or
  before a significant structural operation;
- leaving Edit ends the session undo stack;
- earlier immutable states are recovered through version history;
- rejected or rolled-back writes never appear as saved.

Production persistence belongs to node manifests and immutable snapshots. It
must not depend on iframe `localStorage`.

## Automatic compatibility migration

When code or a snapshot changes:

1. global candidate capabilities are prepared and validated again;
2. specific controls follow snapshot lineage using stable control identity;
3. semantic targets and relevant runtime capabilities are resolved again;
4. compatible bindings are rebuilt automatically;
5. effect, safety, and restoration validation run again;
6. the persisted value is reapplied only after validation succeeds;
7. the stable control identity is retained when compatibility succeeds;
8. failed compatibility enters automatic repair;
9. only after repair is exhausted may an existing control become disabled.

Compatibility work never creates user undo entries.

## Failure and degradation model

### No technical recovery UI

The primary editor does not expose:

- Retry;
- Repair;
- Regenerate;
- reports of failed control candidates;
- runtime paths or stack traces;
- technical choices required to recover a binding.

Candidate controls that never pass validation never enter the main interface.

### Failed user mutation

If an enabled control fails while being manipulated:

- restore the last valid value immediately;
- keep the website, selection, device, and editing context open;
- run automatic repair and validation;
- exclude the failed attempt from history and persistence;
- disable the control for the current version only if repair is exhausted;
- record the incident in diagnostics.

Transient message:

```text
This change couldn't be applied. The previous value was restored.
```

Current fallback tooltip for a disabled control:

```text
This website doesn't support this control.
```

Task 15 approved the disabled fallback for the current product. Unsupported
controls remain visible but disabled after recovery is exhausted. Hiding them
requires a later evidence-based amendment; diagnostics must be preserved either
way.

### Runtime loss

If a mutation crashes or disconnects the clone runtime:

1. detect loss through the bridge;
2. reopen the clone from the last valid manifest;
3. restore device, scroll position, selection, and frozen frame;
4. reapply only confirmed patches;
5. repair and revalidate the responsible control automatically;
6. disable it if it remains unsafe;
7. record the incident.

Successful recovery message:

```text
The website was recovered. One unsupported control was disabled.
```

If two automatic recovery attempts fail, exit Edit and return to the canvas
node using the last valid immutable snapshot. Do not save a broken version and
do not discard confirmed edits already present in that snapshot.

## Motion diagnostics

Every validation failure, automatic repair, disabled fallback, and runtime
recovery emits a structured diagnostic event. Recovered events are included so
coverage data does not underreport fragility.

### Access

Diagnostics are private administrative tooling:

```text
User menu > Admin > Motion diagnostics
```

The page may also have a direct private route such as
`/admin/motion-diagnostics`. It does not appear in the main product rail and is
not visible to ordinary users.

### Views

- `Coverage`: supported, auto-repaired, and disabled rates by control.
- `Failures`: failures grouped by normalized cause.
- `Smoke tests`: controlled validation runs separated from production events.

### Filters and navigation

The administrative surface supports filtering by:

- time period;
- control;
- runtime;
- device;
- site or test class;
- application and adapter version;
- validation stage;
- final outcome;
- smoke test or production origin.

An occurrence can link to `Open affected node` for an authorized administrator.
Export supports CSV and JSON.

### Diagnostic event contents

Each event records:

- project, node, and snapshot identity;
- device and viewport dimensions;
- stable control identity and scope;
- binding or adapter family;
- failed stage: read, write, effect, safety, restore, or repair;
- normalized error and sanitized stack;
- relevant adapter and runtime versions;
- automatic attempt count and duration;
- whether recovery succeeded;
- final enabled or disabled state;
- aggregation fingerprint.

### Privacy boundary

Automatic reports must not include:

- complete HTML;
- user-entered content;
- form values;
- screenshots;
- credentials or cookies;
- complete source code;
- unredacted private URLs.

Deep capture for debugging is a separate, explicitly authorized administrative
workflow and is outside this specification.

## Accessibility and interaction requirements

- All inspector controls are keyboard reachable.
- Focus is visible and follows the established Uncraft focus treatment.
- Tooltips available on hover are also available on keyboard focus.
- The chain icon has an accessible name describing its current state and
  action.
- The centered device-only confirmation traps focus while open, supports Escape
  as Cancel, and returns focus to the chain control when closed.
- Disabled controls expose their explanation to assistive technology.
- Status is never communicated by color alone.
- Timeline, scrub, and automatic framing respect reduced motion.
- The editing viewport never requires horizontal application scrolling.
- Selection overlays remain legible without altering website layout.

## Security boundary

- The clone remains inside a sandboxed iframe.
- Production serves native bundles from the isolated runtime boundary.
- The bridge communicates through the versioned protocol.
- Host and bridge validate message origin and source window.
- Generated adapters execute only inside the clone sandbox.
- Generated code cannot access Uncraft authentication, storage, or parent DOM.
- Diagnostic data is sanitized before persistence or transport.
- A failed adapter cannot be promoted to an enabled manifest entry.

## Integration boundaries

The future implementation must:

- preserve `/motion-editor` as a development and test laboratory;
- reuse the existing bridge, protocol, Motion IR, `MotionPanel`, and
  `TimelinePanel`;
- avoid duplicating motion detection, playback, grouping, or timeline logic;
- extract a reusable controller or integration contract before restructuring
  the existing editor monolith;
- serve the real node bundle through the motion-aware gateway;
- connect canvas selection and node persistence to the reusable engine;
- mount the right inspector and bottom timeline in the adaptive shell;
- replace prototype local persistence with node manifests and snapshots;
- use scoped bridge settlement instead of the legacy global freeze solution;
- keep the legacy editor available for static and iter9 nodes;
- preserve unrelated user files and existing untracked worktree material.

These boundaries constrain the later implementation plan. They do not authorize
implementation from this specification alone.

## Primary user flows

### Edit the final position of a finite animation

1. Enter Edit on a native animated-clone node.
2. Scroll to the element.
3. Select it while meaningfully visible.
4. The viewport freezes and the element settles to its final state.
5. Move the element in `Properties` or on the canvas.
6. The final animation target updates live.
7. Preview replays the original path into the new final position.
8. Undo restores the prior target as one action.

### Edit a loop

1. Select a looping element.
2. The editor freezes the currently visible loop frame.
3. `Loop` appears in the timeline row and Motion header.
4. Optionally scrub to another point.
5. Change the base visual state.
6. Preview preserves the relative loop around the edited base.

### Generate specific motion controls

1. Select an animation without a safe known binding.
2. Invoke `Generate controls`.
3. The agent proposes a small curated set.
4. Adapters run and validate in the sandbox.
5. Only controls passing read, write, effect, safety, and restore appear.
6. Later snapshot changes trigger automatic compatibility repair.
7. No retry or repair decisions are exposed.

### Resolve a genuine motion conflict

1. Edit a property controlled by multiple visually meaningful motions.
2. `Properties` explains the contributing behaviors in product language.
3. Open the focused Motion context.
4. Choose the intended behavior.
5. The editor changes that contribution and remembers the ownership hint.

### Create a device-only variation

1. Edit the website in the target device viewport.
2. Click the connected-chain icon beside a shared property.
3. Confirm `Set Desktop-Only`, `Set Tablet-Only`, or `Set Mobile-Only` in the
   centered confirmation.
4. Edit the newly independent value.
5. Undo affects only that device override.
6. Click the disconnected chain to apply the visible value to all devices
   immediately.

### Recover from a control failure

1. A committed control attempt fails validation or disconnects the runtime.
2. The editor restores the last valid state automatically.
3. Repair and revalidation run without user decisions.
4. The control remains enabled if recovery succeeds.
5. Otherwise it uses the provisional disabled fallback.
6. The event appears in private Motion diagnostics.

## Acceptance criteria

### Runtime fidelity

- The edited clone retains live GSAP, ScrollTrigger, Lottie, WAAPI, video,
  pointer, canvas, shader, and custom runtime behavior when present.
- Website scroll remains inside the fixed device viewport and does not pan the
  canvas during editing.
- Exiting Edit restores the node's canvas geometry and interaction behavior.
- Preview uses the real runtime and the current patch manifest.
- The global legacy freeze helper is not the complete freeze solution.
- Unrelated elements remain visually stable while the selected element settles.

### Editing semantics

- A normal property edit retargets the final state without hidden keyframes.
- Loops freeze at the visible frame and preserve relative movement.
- Manual scrub never implies keyframe creation.
- Independent transform components survive edits to their siblings.
- An unambiguous final owner is selected automatically.
- Genuine ambiguity requires a user choice expressed in visual behavior terms.

### Controls

- No control appears before full validation.
- Custom generated code remains inside the sandbox.
- Controls use the approved initial catalog and curated ranges.
- The primary interface contains no retry, repair, or regeneration actions.
- A failed mutation cannot enter history or persistence.
- A continuous gesture creates one history entry.

### Responsive behavior

- The inspector shows only the active device's relevant fields.
- Shared values use the connected-chain control.
- Creating a device override uses the exact centered confirmation copy.
- Reconnecting applies the current value to all devices without confirmation.
- Auto-settlement runs independently for each device.
- One snapshot stores all responsive variants.

### Failure recovery

- A failed write restores the previous valid value.
- Automatic repair events are recorded even when recovery succeeds.
- Runtime loss restores context or exits safely to the last valid snapshot.
- No broken version is saved.
- Unsupported-control presentation remains measurable for the later hide versus
  disable decision.

### Diagnostics

- Authorized administrators can access `Motion diagnostics` from the user menu.
- Coverage distinguishes supported, auto-repaired, and disabled outcomes.
- Smoke tests and production events can be filtered separately.
- Logs are sanitized and grouped by normalized fingerprint.
- Coverage data can support the future universality decision per control,
  runtime, and device.

### Compatibility and coexistence

- The isolated `/motion-editor` route continues working.
- Existing motion engine modules are reused rather than duplicated.
- Static and iter9 nodes retain their existing editor path.
- Node manifests and snapshots replace `localStorage` as product persistence.
- Existing unrelated untracked worktree files are not modified or included.

## Explicitly deferred decisions

The Task 15 evidence amendment resolves the current common/global and
hide-versus-disable presentation questions: no candidate is promoted, and
exhausted controls remain disabled. The following decisions still require
evidence or later implementation design and are not silently resolved by this
specification:

1. The exact catalog of candidate site-level appearance and motion controls.
2. The evidence design for any future proposal to promote or hide controls.
3. The physical storage schema and API shape for manifests and diagnostics.
4. Telemetry retention, access-control implementation, and production consent
   policy.
5. The implementation sequence, ownership map, migrations, and rollout plan.

## Specification approval gate

Approval of this document authorizes creation of a separate implementation
plan. It does not authorize product implementation by itself.
