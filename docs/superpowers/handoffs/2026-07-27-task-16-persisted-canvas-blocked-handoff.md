# Task 16 Checkpoint — Persisted Canvas Blocked

**Date:** 2026-07-27

**Repository:** `/Users/adilsonporto/Desktop/IA/Uncraft`

**Branch:** `codex/live-animated-clone-editing`

**Base before Task 16:** `af2b3704 feat(motion-editor): add trusted control smoke matrix`

**Task 16 checkpoint commit:** the commit containing this handoff

**Status:** Task 16 is not complete. The local real-clone lab passes, but the
persisted `/canvas` exit gate is blocked by missing isolated infrastructure.
Task 17 has not started.

## 1. Delivered checkpoint

- Added `npm run e2e:native-motion` with separate `--lab-only` and fail-closed
  persisted-canvas modes.
- Added an immutable evidence runner covering the real local clone at canonical
  desktop, tablet, and mobile geometry, scroll/selection, direct retargeting,
  independent transform components, Undo, Preview restoration, iframe
  isolation, blocked external requests, accessibility, reduced-motion
  semantics, console errors, and measured interaction timings.
- Added a fixture contract that requires a disposable migrated database,
  immutable bundles, two isolated native nodes, fixture-only authentication,
  recovery cases, snapshots, and separate Admin/non-admin users.
- Preserved the approved Task 15 policy: cross-site candidates remain custom;
  exhausted controls remain visible and disabled; the tooltip stays exactly
  `This website doesn't support this control.`; no universality threshold was
  introduced.

The persisted runner deliberately stops after preflight until the concrete
mutation pack is reviewed against the fixture ownership record. It does not
apply migrations, seed nodes, create users, fabricate credentials, or mutate a
customer board.

## 2. Browser-found regression and fix

Integrated browser QA found a real sequential-transform defect. Setting X to
`18px` and then setting rotation to `7deg` replaced the translation instead of
composing both components.

Protocol-v2 transaction acknowledgements now include the affected selected
element description. The controller therefore updates its confirmed runtime
selection before constructing the next transform transaction. The regression
test verifies that the second patch starts from a matrix retaining the 18px
translation and adds the 7-degree rotation.

The in-app browser then confirmed a computed matrix retaining translation X=18
and rotation approximately 7 degrees. Browser console errors were empty.

## 3. Passing evidence

### Real-clone lab

```text
Run: task16-20260727182604465-76886cb0
Verdict: passed
Evidence: /tmp/uncraft-task16-e2e/task16-20260727182604465-76886cb0
Screenshots: desktop edit, tablet edit, mobile edit, desktop Preview
```

The screenshots were reviewed manually. The host had no horizontal overflow;
the clone remained inside canonical fixed-device geometry. The sandbox omitted
`allow-same-origin`, the clone had a null origin and could not read host DOM,
and no external request escaped the local origin.

### Default complete gate

```text
Run: task16-20260727182709937-aac58647
Verdict: blocked
Checks before the persisted gate: 12 passed, 0 failed
Evidence: /tmp/uncraft-task16-e2e/task16-20260727182709937-aac58647
runtime-ready: 13885 ms
first selectable: 303 ms
selection settlement: 247 ms
patch commit: 124 ms
Preview switch: 428 ms
```

The connected database preflight found only `native_bundles`; the snapshot
native columns, `native_motion_edit_sessions`, and `motion_diagnostic_events`
are absent. Required fixture-only board/node/session values and explicit
mutation approval are also absent.

### Automated validation

```text
Focused regression suite: 3 files, 86 tests passed
Complete web-shell suite: 178 files passed, 1 skipped;
  1294 tests passed, 4 skipped
NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true NEXT_DIST_DIR=.next-task16-build npm run build:
  Next.js 15.5.15 compiled; 41/41 static pages; exit 0
git diff --check: clean
```

The build retried once after a transient `socket hang up` and then passed. The
test suite emitted only the known non-blocking local-storage environment
warning.

### Task 15 motion-control smoke

```text
Run: smoke-20260727182827989-1-7b81ad74
Exit: 0
Evidence: /tmp/uncraft-task16-motion-smoke/
Candidates: 15
Initially supported: 9
Automatically recovered: 3
Exhausted and disabled: 3
Visible changes and exact restoration: 12/12
Universality threshold: null
```

This new smoke run was not manually reviewed, so the reviewed Task 15 matrix
remains the source for the accepted 0% false-positive result.

## 4. Remaining Task 16 acceptance work

The lab does not replace these persisted `/canvas` scenarios:

- real-board framing with canvas pan disabled, loop indication, and ambiguous
  motion-owner resolution;
- unlink cancel/confirm and reconnect across device values;
- custom-control generation, validation, save, reload, and reuse;
- recoverable and exhausted fault presentation in the actual canvas;
- commit/reload and restoration of an older snapshot;
- runtime, message, and asset isolation across two native nodes;
- live gateway/token fuzzing and Admin/non-admin diagnostics authorization;
- keyboard/focus/tooltip coverage for the integrated dialogs and canvas chrome;
- saved/reloaded/restored visual comparisons, host zoom review, and a mostly
  static persisted page.

## 5. Exact unblock requirements

Before continuing Task 16, provision an isolated, disposable environment with:

1. all native-session, snapshot, bundle, and diagnostic migrations applied;
2. runtime origin, runtime session secret, JWT secret, and selected bundle store;
3. a fixture board containing two eligible native nodes and the cases specified
   in `packages/web-shell/e2e/fixtures/native-motion/README.md`;
4. fixture-only Admin and non-admin sessions;
5. `E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1` plus the documented board, node, and
   session values;
6. fixture-owner review and implementation of the concrete mutation pack.

Then run the default `npm run e2e:native-motion`, attach the saved evidence,
and close every remaining acceptance scenario. Only after that may Task 16 be
marked complete. Do not start Task 17 from this checkpoint.

No external schema, production data, customer board, or credentials were
changed during this work. Generated Task 16 build caches were removed; evidence
under `/tmp` was retained.
