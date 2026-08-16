# Task 13 Complete — Task 14 Handoff

**Date:** 2026-07-27

**Repository:** `/Users/adilsonporto/Desktop/IA/Uncraft`

**Branch:** `codex/live-animated-clone-editing`

**Base before Task 13:** `369cf7b3 feat(motion-editor): add validated custom controls`

**Status:** Tasks 1–13 complete. Task 14 has not started.

## 1. Delivered behavior

The native motion editor now resolves ordinary control and runtime failures
automatically without asking the user to choose Retry, Repair, or Regenerate.

The recovery path now:

1. classifies failures into bounded transport, binding, fingerprint, mutation,
   validation, capability, and fatal-runtime classes;
2. retries transient bridge failures with exponential backoff and jitter;
3. reinspects before rebinding, rebinds before reloading, and reloads before
   exhausting a compatible custom control;
4. regenerates a changed motion binding only inside the sandbox and validates
   it with two complete apply/restore passes;
5. keeps failed user mutations out of history and persistence until the runtime
   acknowledges the recovered transaction;
6. leaves unrelated controls and the editing session usable when one control is
   exhausted;
7. preserves the ready-only persisted control manifest while tracking temporary
   recovery availability separately;
8. reopens a fresh signed runtime URL, reloads the server draft, reapplies only
   confirmed patches, and restores device, mode, tool, scroll, selection, active
   motion, and the paused frame;
9. retains confirmed history if recovery replay fails and advances to the next
   bounded reopen instead of deleting patches;
10. exits Edit after two failed runtime-recovery attempts so the canvas renders
    the last valid immutable snapshot while the safe server draft remains
    available for later analysis or resumption; and
11. emits sanitized diagnostic events for detected, attempted, successful,
    exhausted, disabled-control, runtime-reopened, and snapshot-restored states.

## 2. User-facing contract

- Failed enabled-control mutation:
  `This change couldn't be applied. The previous value was restored.`
- Exhausted disabled-control tooltip:
  `This website doesn't support this control.`
- Successful runtime recovery with one disabled control:
  `The website was recovered. One unsupported control was disabled.`
- Whole-runtime exhaustion stays non-technical and closes Edit automatically.
- No recovery state renders Retry, Repair, Regenerate, model, provider, selector,
  stack, runtime path, or raw diagnostic details.

The provisional disable presentation remains unchanged for Task 15's smoke-test
decision gate. Disabled availability is not written into the strict ready-only
control manifest.

## 3. Recovery budgets and ordering

- Transient transport retries: three attempts.
- Backoff: 250 ms base, exponential, capped at 2 seconds, with bounded ±20%
  jitter.
- Runtime reopen attempts: two.
- Custom-control regeneration: one within a 30-second control-recovery window.
- Identical failures use stable per-control/per-operation counters and cannot
  loop indefinitely.
- Runtime exceptions raised while a control transaction is in flight are
  attributed to that control; its unacknowledged value is never persisted.
- Recovery work never creates a separate Undo entry.

## 4. Primary implementation files

Created:

- `packages/web-shell/lib/motion-editor/failure-codes.js`
- `packages/web-shell/lib/motion-editor/failure-codes.test.js`
- `packages/web-shell/lib/motion-editor/recovery-policy.js`
- `packages/web-shell/lib/motion-editor/recovery-policy.test.js`

Modified:

- `packages/web-shell/components/motion-editor/useNativeMotionController.js`
- `packages/web-shell/components/motion-editor/useNativeMotionController.test.jsx`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.js`
- `packages/web-shell/lib/motion-editor/runtime-bridge-source.test.js`
- `packages/web-shell/components/motion-editor/CustomControlsSection.jsx`
- `packages/web-shell/components/motion-editor/CustomControlsSection.test.jsx`
- `packages/web-shell/components/motion-editor/NativeEditViewport.jsx`
- `packages/web-shell/components/motion-editor/NativeEditViewport.test.jsx`
- `packages/web-shell/components/motion-editor/native-motion-editor.module.css`

## 5. Verification at the Task 13 exit gate

Run from the repository root:

```text
Task 13 focused recovery/runtime/UI: 6 files, 107 tests passed
Expanded motion/session/runtime boundary: 18 files, 215 tests passed
Complete web-shell suite: 168 files passed, 1 skipped;
  1255 tests passed, 4 skipped
NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true npm run build:web:
  Next.js 15.5.15 compiled; 41/41 static pages; exit 0
git diff --check: clean
```

The complete suite continues to emit only known non-blocking environment and
test-fixture warnings, including the existing invalid `--localstorage-file`
warning.

The integrated persisted-native browser smoke remains blocked by the same local
environment gap recorded after Task 12: the connected database schema lacks the
native snapshot columns, and the runtime origin, session secret, and bundle store
are not configured together. No schema, credentials, or production-like data
were changed to bypass that blocker.

## 6. Task 14 starting point

Task 14 adds sanitized motion-diagnostic persistence and the private Admin
surface. Do not start its schema, routes, authentication changes, page, or
retention behavior until the explicit decision gate approves:

1. who is an admin;
2. how admin authorization is represented;
3. event retention and deletion rules; and
4. whether diagnostics require user or project consent.

Preserve Task 13's sanitized event boundary. Task 14 may persist the approved
event subset, but it must not add raw page text, form values, prompts, selectors,
stack traces, runtime paths, credentials, cookies, storage contents, or model
responses.

Keep the provisional disabled-control UI until Task 15 decides hide versus
disable from representative smoke evidence. Do not fold Task 15, Task 16, or
Task 17 work into Task 14.
