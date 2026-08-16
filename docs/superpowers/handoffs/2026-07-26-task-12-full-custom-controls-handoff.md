# Task 12 — Full Custom Controls Implementation Handoff

**Date:** 2026-07-26

**Repository:** `/Users/adilsonporto/Desktop/IA/Uncraft`

**Branch:** `codex/live-animated-clone-editing`

**Base before preparation:** `1ce07517 feat(motion-editor): add responsive property scopes`

**Status:** Tasks 1–11 complete. Product gate resolved. Task 12 core generation/validation has not started.

**Authority:** This handoff overrides the older Task 12 wording that described an explicit `Generate controls` action.

## 1. Product decisions — do not reopen during implementation

1. Keep the complete custom-controls capability in Task 12. The product owner
   first wants to evaluate everything the system can deliver.
2. Custom controls are not a user choice. When an animated live URL is converted,
   controls are discovered/generated automatically and are already present when
   Edit opens.
3. `Clone & Edit` is available only to paid plans. The explicit allowlist is
   `pro`, `ultimate`, and `enterprise`; unknown, missing, free, and trial plans
   fail closed.
4. The `Clone & Edit` button is the single moment of intent. It uses the approved
   holographic state, lightning icon, paid-state marker, and displays
   `275 credits` inside the button.
5. One successful live-reference conversion is one billable logical operation.
   Retries with the same idempotency key do not create a second charge or
   artifact. Reopening Edit, changing controls, Save, Cancel, reload, history,
   or snapshot restore do not charge again. A new explicit clone on a new live
   reference is a new operation.
6. A successful conversion settles the displayed fixed price of 275 credits.
   Failures refund the hold; there is no charge for a conversion that does not
   produce a valid editable result. Changing that price requires a new product
   decision and matching button copy.
7. No `Generate controls`, Retry, Repair, Regenerate, provider, or model choices
   appear in the user UI. One repair pass may run automatically.
8. The future modular custom-controls flag is intentionally deferred. Task 12
   ships the complete layer without implementing the flag.

## 2. Model, cost, privacy, and timeout decision

The paid-model decision gate is resolved as follows:

- Provider/API: OpenAI Responses API.
- Model: `gpt-5.6-terra`.
- Reasoning: `medium`.
- Output: strict Structured Outputs matching a local schema; prose or untyped
  adapter output is rejected.
- Provider persistence: `store: false`.
- Generation-stage provider-cost ceiling: US$0.25 per logical conversion,
  including the single automatic repair pass.
- End-to-end Task 12 budget: 90 seconds. Recommended allocation is 45 seconds
  for the primary proposal, 25 seconds for the repair pass, and the remaining
  time for deterministic validation, persistence, and settlement.
- No silent fallback to another model or provider.
- Send only minimal structural and motion evidence needed to propose bindings.
  Never send cookies, credentials, authorization headers, localStorage,
  unrelated page text, raw form values, or private application state.
- Do not persist raw prompts or raw model responses. Persist only the accepted
  manifest, normalized provider usage/cost, decision codes, and sanitized
  diagnostics.
- Private/authenticated captures require an approved Zero Data Retention setup
  before model evidence may be sent. Until then, fail closed into the lower
  deterministic ladder and `Code Only`; do not silently send private content.

## 3. Preparation already implemented

The preparation commit immediately following `1ce07517` establishes:

- a shared paid-plan entitlement helper;
- a client guard before live-reference reconstruction;
- a server guard on `POST /api/nodes/:id/reconstruct` before DB work or billing;
- the fixed 275-credit `clone.edit` price as a shared constant, separate from
  internal workflow reconstruction pricing;
- the holographic `Clone & Edit` state with lightning icon, credit copy,
  subscriber state, keyboard focus, accessible name, and reduced-motion care;
- normal already-materialized sites now say `Edit`, not `Clone & Edit`;
- free users open Plans and never start the conversion;
- Plans shows the actual current plan instead of always marking Free.

Primary files:

- `packages/web-shell/lib/clone-edit-access.js`
- `packages/web-shell/lib/clone-edit-access.test.js`
- `packages/web-shell/lib/billing/pricing.js`
- `packages/web-shell/components/CanvasInspector.jsx`
- `packages/web-shell/components/CanvasClient.jsx`
- `packages/web-shell/components/PlansModal.jsx`
- `packages/web-shell/app/api/nodes/[id]/reconstruct/route.js`
- `packages/web-shell/app/globals.css`

The UI guard is explanatory. The route guard is authoritative. Preserve both.

### Preparation verification

The access, UI, and fixed-price tests failed first against the previous behavior.
After implementation:

```text
Focused preparation gate: 8 files, 51 tests passed
Complete web-shell suite: 161 files passed, 1 skipped; 1167 tests passed, 4 skipped
Build with NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true:
Next.js 15.5.15; compiled; 41/41 static pages; exit 0
git diff --check: clean
```

The complete suite emitted only the already-known non-blocking
`--localstorage-file` warning. Integrated visual smoke of this new button still
shares the `/canvas` database blocker documented in section 12; component,
accessibility, plan, billing, and route behavior are covered automatically.

## 4. Task 12 outcome

After a paid user activates `Clone & Edit` on an animated live URL reference:

1. the system claims one idempotent 275-credit hold;
2. reconstruction creates or reuses the immutable native bundle;
3. the deterministic ladder discovers Direct, Known Library, and Declarative
   candidates;
4. only remaining useful editability is sent as minimal evidence to the model;
5. custom proposals are schema-validated;
6. every candidate is tested through reversible protocol-v2 transactions;
7. only accepted controls are persisted against bundle/runtime fingerprints;
8. the native Edit shell opens with validated controls already visible;
9. settlement charges the fixed 275 credits once;
10. a failure restores/refunds and never opens a partially valid editor.

The ladder order is fixed:

1. Direct
2. Known Library
3. Declarative Adapter
4. Custom Adapter
5. Code Only

`Code Only` is the current classification, not a permanent statement about the
animation.

## 5. Ownership and boundaries

### Create

- `packages/web-shell/lib/motion-editor/control-manifest.js`
- `packages/web-shell/lib/motion-editor/control-manifest.test.js`
- `packages/web-shell/lib/motion-editor/control-capabilities.js`
- `packages/web-shell/lib/motion-editor/control-capabilities.test.js`
- `packages/web-shell/lib/motion-editor/control-generation.js`
- `packages/web-shell/lib/motion-editor/control-generation.test.js`
- `packages/web-shell/app/api/nodes/[id]/motion-controls/generate/route.js`
- `packages/web-shell/app/api/nodes/[id]/motion-controls/generate/route.test.js`
- `packages/web-shell/components/motion-editor/CustomControlsSection.jsx`
- `packages/web-shell/components/motion-editor/CustomControlsSection.test.jsx`

The generate route is internal orchestration for the automatic conversion. It
must not imply or expose a user-facing generation button.

### Modify only as required

- `packages/web-shell/lib/motion-editor/motion-ir.js`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.js`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`
- `packages/web-shell/components/motion-editor/NativeMotionInspector.jsx`
- `packages/web-shell/components/motion-editor/useNativeMotionController.js`
- `packages/web-shell/lib/deferred-reconstruction.js`
- `packages/web-shell/app/api/nodes/[id]/reconstruct/route.js`
- billing context/operations only where required to make the whole conversion a
  single idempotent settlement boundary.

### Preserve

- legacy/static/Iter9 editor routing;
- immutable native bundles and existing snapshots;
- protocol-v2 transaction semantics;
- Task 9 hybrid rest/scrub behavior;
- Task 10 ownership-aware retargeting;
- Task 11 responsive scopes;
- automatic non-technical recovery policy;
- already persisted manifests, even when a future flag is later turned off.

Do not begin Task 13 recovery work beyond the one bounded generation repair
explicitly approved here. Stop at the Task 12 exit gate.

## 6. Control manifest contract

Define a strict, versioned, JSON-safe manifest. Each ready control needs at
least:

- stable ID and manifest version;
- ladder classification and scope (`animation` by default; group/site only
  after complete target declaration and validation);
- concise label and one-line explanation;
- control type: slider+numeric, toggle, curated select, curated color, or the
  existing easing curve;
- familiar unit, safe range/step/options where relevant;
- current runtime value;
- original compatible-clone value used by `Reset to original`;
- semantic target identity and exact declared mutation surface;
- binding descriptor without executable host code;
- bundle ID, runtime fingerprint, and compatible lineage evidence;
- validation stages/outcomes and sanitized provenance;
- teardown requirements and bounded execution limits.

Reject free text, arbitrary CSS color expressions, raw code fields, JSON
editors, arrays, arbitrary objects, undeclared selectors/properties, unsafe
keys, non-finite values, and non-JSON values from the primary catalog.

Host UI code must never evaluate generated adapter source. A custom adapter can
execute only inside the already sandboxed runtime through a narrow capability
registry.

## 7. Candidate and validator pipeline

For every candidate, record and enforce separate stages:

1. schema and capability inspection;
2. reliable read of the original `before` value;
3. reversible application to declared targets only;
4. observable-effect measurement;
5. complete restore;
6. repeated application for determinism;
7. final restore;
8. teardown/leak check;
9. fingerprint/lineage check;
10. promotion from pending to ready.

Reject silently from the normal UI when a candidate:

- cannot read a truthful `before` value;
- produces no visible or measurable effect;
- throws or exceeds time/mutation limits;
- writes outside declared targets;
- causes unexpected global effects or layout breakage;
- leaks listeners, timers, observers, or network access;
- is non-deterministic;
- cannot restore completely;
- uses an unstable range/option;
- mismatches the runtime fingerprint.

Use a localized visual oracle only for canvas, shader, or similar rendered
effects whose useful change cannot be established by runtime/computed state.
Sliders validate representative range points; every curated option validates.

## 8. Billing and idempotency contract

This is one logical operation, not a chain of separately user-visible charges.

- Generate the idempotency key client-side once when `Clone & Edit` is
  activated and reuse it through reconstruction, custom generation, validation,
  repair, persistence, and settlement.
- Claim a 275-credit hold before paid provider work.
- A concurrent duplicate returns `in_progress`; a settled duplicate replays the
  accepted response and does not produce a second clone or charge.
- Settle only after an editable bundle and accepted manifest are durable.
- Failure, timeout, provider ceiling, invalid output, or persistence failure
  marks the operation failed and refunds the full hold.
- Track actual provider usage separately from customer credits. Provider cost in
  dollars is not numerically equivalent to the 275 customer-credit price.
- Never let provider usage exceed US$0.25 for the custom-generation stage.
- Never settle above 275 credits in this version.
- No charge occurs simply because controls are displayed, reopened, rebound to
  a compatible descendant, restored, or automatically revalidated.

Add explicit tests for lost-response retries, concurrent double-clicks,
automatic repair, failure after model success but before persistence, and
failure during settlement.

## 9. API contract

The internal motion-control generation boundary must require:

- authenticated owner;
- paid-plan entitlement checked server-side;
- owned node/current native snapshot/active edit-session consistency;
- non-empty idempotency key tied to the parent conversion;
- exact bundle/runtime fingerprint;
- minimal, size-limited evidence;
- a server-side deadline and AbortSignal;
- strict structured response parsing;
- sanitized stable error codes.

Never return raw model output or adapter source to the host UI. Return accepted
ready manifest entries and non-sensitive status/usage metadata only.

## 10. Tests-first order

Write failing tests in this order:

1. strict manifest parser/serializer and unsafe-input rejection;
2. deterministic Direct/Known/Declarative classification;
3. no generation call when the deterministic ladder is sufficient;
4. automatic generation inside conversion when useful gaps remain;
5. Structured Outputs schema and model-call budget/deadline;
6. privacy redaction/minimal evidence;
7. protocol-v2 reversible validator and side-effect/restore rejection;
8. sandbox capability restrictions and host no-eval boundary;
9. stable IDs, persistence, reload, compatible lineage and revalidation;
10. single repair pass and no user repair/generate controls;
11. paid-plan route access and fail-closed unknown plans;
12. one 275-credit hold, at-most-once settlement, refund, and replay;
13. inspector presentation of only ready controls and `Reset to original`;
14. regression tests for Tasks 1–11 and legacy/Iter9 routing.

Required fixture coverage:

- GSAP;
- ScrollTrigger;
- CSS keyframes;
- WAAPI;
- unknown custom runtime;
- invalid generated bindings;
- no-effect binding;
- cross-target/global mutation;
- incomplete restore;
- non-deterministic adapter;
- fingerprint mismatch.

## 11. Implementation sequence

1. Lock the manifest schema and unsafe-input tests.
2. Implement deterministic capability discovery and ladder classification.
3. Implement the isolated validator using protocol v2.
4. Add the strict provider wrapper with injected client, clock, and budget for
   tests.
5. Connect proposal → parser → validator → accepted manifest.
6. Unify the parent conversion billing/idempotency boundary.
7. Connect automatic generation to native reconstruction before Edit opens.
8. Render only ready controls in Motion; keep visual properties in Properties.
9. Persist accepted manifests and prove reload/restore without another model
   call.
10. Run focal, expanded, complete, build, diff, and browser smokes.
11. Stop and hand off before Task 13.

Do not start with the provider route. The manifest and validator are the safety
contract the provider output must satisfy.

## 12. Verification and exit gate

Minimum automated gate:

```text
focal Task 12 suites: all pass
expanded motion-editor suites: all pass
complete web-shell suite: no regressions
NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true npm run build: exit 0
git diff --check: clean
```

Required real-browser smoke when the environment is available:

- paid plan sees the holographic `Clone & Edit` button with lightning and
  `275 credits`;
- free plan opens Plans and creates no reconstruction/provider/billing event;
- paid conversion opens Edit with deterministic and custom ready controls;
- a rejected candidate never appears;
- `Reset to original`, Undo, Redo, responsive scope, Save, reload, and restore
  remain correct;
- one lost-response retry produces one operation, artifact, and charge;
- network log shows no credentials/private evidence sent to the provider;
- legacy/static/Iter9 nodes still open the legacy editor.

The local `/canvas` smoke was blocked after Task 11 because the configured DB
does not contain `native_bundle_id`. Do not mutate external credentials or data
silently. Configure or apply the approved native schema and runtime store/origin
in an isolated environment before claiming the integrated browser flow passed.

**Exit gate:** a paid-plan `Clone & Edit` automatically produces useful,
reversible, fingerprinted controls that were invisible until validation, costs
at most one 275-credit settlement, and does not regress legacy editing.

## 13. Future modular flag — recorded, not implemented

Later, add a server-owned flag such as
`UNCRAFT_NATIVE_MOTION_CUSTOM_CONTROLS_ENABLED` that disables only model-generated
Custom Adapter generation and execution. When off it must:

- preserve Direct, Known Library, and Declarative controls;
- retain the accepted-manifest reader and keep persisted custom manifests
  readable and preserved;
- avoid deleting or rewriting manifests or snapshots;
- avoid surfacing a Generate, Retry, or Repair choice;
- allow safe rollback by entitlement/presentation policy rather than DOM
  serialization.

This flag is deliberately out of scope for Task 12.

## 14. Rollback

Rollback Task 12 by disabling automatic custom generation at the server
orchestration boundary and returning to the validated deterministic ladder.
Preserve accepted manifests, bundles, sessions, snapshots, stable IDs, and
diagnostics. Do not serialize the mutated native DOM into Iter9 HTML, delete
manifests, or weaken the paid-plan server gate. The existing immutable snapshot
remains the safe recovery point.

## 15. Start and stop instruction for the next session

Start from this handoff, verify branch/status, read the full Task 12 section in
the implementation plan, and begin with failing manifest tests. Implement Task
12 completely, verify it, commit only owned files, then stop at the checkpoint
before Task 13 and generate a continuation handoff.
