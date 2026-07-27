# Task 15 Complete — Task 16 Handoff

**Date:** 2026-07-27

**Repository:** `/Users/adilsonporto/Desktop/IA/Uncraft`

**Branch:** `codex/live-animated-clone-editing`

**Base before Task 15:** `ae53708e feat(motion-editor): add private motion diagnostics`

**Task 15 commit:** the commit containing this handoff

**Status:** Tasks 1–15 complete. Task 16 has not started.

## 1. Approved product decision

After reviewing the Task 15 evidence, the product owner approved:

1. The evidence is insufficient to promote any candidate control to a common,
   global, or universal presentation.
2. Candidate cross-site controls remain classified as custom.
3. A control that exhausts automatic recovery remains visible but disabled.
4. The disabled fallback keeps the exact tooltip
   `This website doesn't support this control.`
5. No universality percentage is hardcoded in implementation.

The approved design specification now records this decision. Any future change
to hide exhausted controls or promote a control requires a separate amendment
with a pre-registered real-clone distribution, semantic thresholds, exhausted
and false-positive limits, and presentation policy.

## 2. Delivered behavior

### Trusted smoke harness

- `npm run smoke:motion-controls` runs deterministic fixtures and the available
  local real-clone corpus through the product's signed runtime-session token,
  gateway bridge injection, strict manifests, protocol-v2 control validation,
  and bounded recovery policy.
- Browser code cannot select smoke origin. Optional Admin persistence requires
  both a trusted owned session ID and its owner ID.
- The runner blocks external requests and uses sandboxed desktop, tablet, and
  mobile viewports at the canonical fixed geometry.
- Every successful control must visibly change the page, restore the exact
  starting state, reapply deterministically, and restore again. Command
  acknowledgement alone cannot pass.
- A site-level promise must cover every declared target and engine.
- Play, pause, and scrub are measured separately and must create zero persistent
  node patches.
- Reports are created exclusively, retain stable fixture/build/runtime/matrix
  fingerprints, and never overwrite earlier evidence.
- Sanitized smoke events use the existing diagnostics schema and remain
  separate from production events. Diagnostic delivery is fail-open.

### Matrix and recovery coverage

The deterministic and real-corpus matrix covers:

- CSS transitions and finite/infinite keyframes;
- WAAPI, GSAP tween/timeline, ScrollTrigger scrub/pin/entrance, and declarative
  runtime evidence when present;
- mixed ownership, matrix/skew/perspective transforms, responsive computed
  values, partially offscreen elements, runtime reload, and stale binding;
- every locally available producer/runtime family.

Recovery reports each bounded step and preserves the existing product fallback.
The presentation policy resolver permits hiding only after an explicit approved
decision with linked evidence run IDs; no hiding decision was approved here.

### Admin evidence state

The private Admin `Smoke tests` view now shows the approved presentation
decision, disabled incidence, and approved manual-review state. It retains the
existing Working Table language and accessibility behavior.

## 3. Reviewed evidence

Reviewed run:

```text
Run: smoke-20260727155312285-1-4d5be78a
Matrix fingerprint:
  sha256:68a02989b6f53016d4614a2dfa2cf63c15a0f54c431b50a345b9af1a430da9bd
Candidate/device cases: 15
Initially supported: 9
Automatically recovered: 3
Exhausted and disabled: 3
Reviewed false-positive rate: 0%
Median time to ready: 307 ms
Median recovery latency: 314 ms
Median exhaustion latency: 299 ms
Persistent patches from play/pause/scrub: 0
```

All required fixture classes and locally available real-clone families were
present. For all 12 supported or recovered cases, the apply screenshot differed
from before and the restore fingerprint exactly matched before. The three
disabled cases were intentionally missing stale bindings and failed with the
expected `target_missing` code.

The observed 20% disabled incidence is intentionally influenced by the required
fault fixture. The two real-clone controls were harness sentinels, not evidence
of a universal semantic control. The result validates the harness, automatic
recovery, and safe disabled fallback; it does not justify a global label.

## 4. Primary implementation files

Created:

- `packages/web-shell/scripts/smoke-motion-controls.mjs`
- `packages/web-shell/lib/motion-editor/smoke-runner.js`
- `packages/web-shell/lib/motion-editor/smoke-runner.test.js`
- `packages/web-shell/docs/motion-control-smoke-matrix.md`

Modified:

- `packages/web-shell/package.json`
- `packages/web-shell/components/admin/MotionDiagnostics.jsx`
- `packages/web-shell/components/admin/MotionDiagnostics.test.jsx`
- `packages/web-shell/components/admin/motion-diagnostics.module.css`
- `packages/web-shell/lib/motion-editor/control-capabilities.js`
- `packages/web-shell/lib/motion-editor/control-capabilities.test.js`
- `packages/web-shell/lib/motion-editor/failure-codes.js`
- `packages/web-shell/lib/motion-editor/failure-codes.test.js`
- `packages/web-shell/lib/motion-editor/recovery-policy.js`
- `packages/web-shell/lib/motion-editor/recovery-policy.test.js`
- `docs/superpowers/specs/2026-07-26-live-animated-clone-editing-design.md`

## 5. Verification at the Task 15 exit gate

```text
Focused Task 15 suite: 5 files, 46 tests passed
Complete web-shell suite: 178 files passed, 1 skipped;
  1293 tests passed, 4 skipped
NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true npm run build:web:
  Next.js 15.5.15 compiled; 41/41 static pages; exit 0
git diff --check: clean
```

The complete suite emits only the known non-blocking invalid
`--localstorage-file` environment warning. The smoke command emits Node's
module-type performance warning because the existing package is not globally
declared as ESM; Task 15 does not broaden package semantics to silence it.

## 6. Deployment boundary

No external schema, production data, or credentials were changed. The reviewed
run retained immutable local evidence under `/tmp/uncraft-task15-reviewed`.

Trusted Admin persistence was not exercised because the local environment still
lacks an owned, migrated native edit session with runtime origin, session
secret, and bundle-store configuration together. Do not fabricate credentials
or claim persisted-native production validation. With a compatible isolated
session, the same command can persist the already-sanitized events by supplying
both trusted diagnostic identifiers.

## 7. Task 16 boundary

Task 16 has not started. When explicitly requested, follow only its plan slice
for integrated browser QA. Preserve the approved Task 15 policy: custom
classification, visible disabled fallback, exact tooltip, no common/global
promotion, and no hardcoded universality threshold.
