# Task 12 Complete — Task 13 Handoff

**Date:** 2026-07-26

**Repository:** `/Users/adilsonporto/Desktop/IA/Uncraft`

**Branch:** `codex/live-animated-clone-editing`

**Base before Task 12:** `dfa5f7ff feat(canvas): gate Clone & Edit to paid plans`

**Status:** Tasks 1–12 complete. Task 13 has not started.

## 1. Delivered behavior

`Clone & Edit` now completes native reconstruction and automatic custom-control
discovery inside the existing idempotent paid operation. The user does not
choose a model and never sees Generate, Retry, Repair, or Regenerate controls.

The conversion now:

1. claims the existing fixed 275-credit `clone.edit` hold;
2. materializes and registers the immutable native bundle;
3. discovers candidates in the Direct, Known Library, Declarative Adapter,
   Custom Adapter, and Code Only ladder;
4. uses OpenAI only for remaining useful gaps and only when privacy permits;
5. validates every candidate with two complete apply/restore passes;
6. persists only ready controls anchored to the bundle and runtime fingerprint;
7. durably writes the native snapshot and manifest before billing settles;
8. routes the reconstructed node directly into the native editor; and
9. exposes only the accepted controls in the Motion inspector.

Any failure before durable persistence causes the existing billing boundary to
refund the full hold. Idempotent replay does not create another artifact or
charge.

## 2. Model, privacy, and cost contract

- API: OpenAI Responses API.
- Model: `gpt-5.6-terra` with `reasoning.effort: medium`.
- Structured output: strict local JSON schema through `text.format`.
- Provider storage: `store: false`.
- One automatic repair pass for invalid structured output.
- Provider-cost ceiling: US$0.25 cumulatively across both attempts.
- End-to-end conversion deadline: 90 seconds.
- Evidence is reduced to bounded engine, motion, target, property, and
  declarative-surface identifiers; raw page text, form values, credentials,
  cookies, local storage, prompts, and raw model responses are not persisted.
- Private/authenticated capture evidence reaches the provider only when
  `OPENAI_ZERO_DATA_RETENTION_APPROVED=true`. Otherwise the result stays on the
  deterministic ladder and Code Only.
- Provider usage is recorded separately from the fixed customer-credit price.

Runtime configuration used by the implementation:

- `OPENAI_API_KEY` when custom generation is required;
- `OPENAI_ZERO_DATA_RETENTION_APPROVED=true` only after an approved ZDR setup;
- `UNCRAFT_MOTION_CONTROL_VALIDATOR_URL` and
  `UNCRAFT_MOTION_CONTROL_VALIDATOR_SECRET` for the internal sandbox validator
  route when validation is not supplied directly by reconstruction.

There is no model or provider fallback.

## 3. Manifest and runtime boundary

The new control manifest is strict, versioned, JSON-only, and ready-only. It
enforces stable IDs, scope, declared targets, binding kind, curated domain,
original/current values, lineage, validation evidence, teardown requirements,
bounded mutations/execution, no network, bundle UUID, and SHA-256 runtime
fingerprint.

Supported controls are slider plus numeric input, toggle, curated select,
curated color, and curated easing. Free text, selectors, arbitrary code, unsafe
keys, raw output, arbitrary objects, and unregistered capabilities are rejected.

Every UI change is sent as a protocol-v2 `control` patch. The sandbox runtime
rechecks the manifest, exact target, bundle, fingerprint, range, step, and
curated options before dispatching the validated binding. Generated source is
never evaluated by the host. Custom behavior is available only through the
instrumented `window.__uncraftMotionControlCapabilities` registry with typed
`read` and `apply` methods.

Undo, redo, Reset to original, autosave, Save, reload, and history all preserve
the current control values without another charge. Existing legacy, static,
Iter9, responsive-scope, and native-motion flows remain routed as before.

## 4. Primary implementation files

Created:

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

Integrated through:

- `packages/web-shell/lib/deferred-reconstruction.js`
- `packages/web-shell/app/api/nodes/[id]/reconstruct/route.js`
- `packages/web-shell/app/api/nodes/[id]/run/route.js`
- `packages/web-shell/components/CanvasClient.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionInspector.jsx`
- `packages/web-shell/components/motion-editor/useNativeMotionController.js`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.js`
- `packages/web-shell/lib/motion-editor/manifest.js`
- `packages/web-shell/lib/motion-editor/native-edit-api.js`
- `packages/web-shell/lib/motion-editor/protocol.js`
- `packages/web-shell/lib/node-editor-kind.js`
- billing usage/cost tests and the corresponding focused test files.

## 5. Verification at the Task 12 exit gate

Run from the repository root:

```text
Focused final integration: 11 files, 153 tests passed
Post-review control/runtime hardening: 2 files, 71 tests passed
Complete web-shell suite: 166 files passed, 1 skipped;
  1227 tests passed, 4 skipped
NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true npm run build:web:
  Next.js 15.5.15 compiled; 41/41 static pages; exit 0
git diff --check: clean
```

The suite emits only the already-known non-blocking `--localstorage-file`
warning.

Integrated browser smoke of a persisted native canvas node remains blocked by
the configured database/runtime environment: the connected schema does not yet
contain the native snapshot columns such as `native_bundle_id`, and a live
runtime origin, session secret, and bundle store are not configured together.
No external credentials, schema, or production-like data were changed to work
around that blocker. Component, route, persistence, runtime-bridge, billing,
and build coverage are green.

## 6. Task 13 starting point

Start Task 13 from this branch after confirming its scope. Do not reopen the
Task 12 product decisions or add user-facing generation/recovery choices.
Preserve the single automatic repair already bounded inside Task 12 and keep
all further recovery automatic and non-technical unless Task 13 explicitly
changes that contract.

Before any integrated browser smoke, provision a compatible local database
schema plus the isolated runtime origin/session secret and native bundle store.
Treat that environment work as separate from the completed Task 12 changeset.
