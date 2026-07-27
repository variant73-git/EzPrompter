# Task 14 Complete — Task 15 Handoff

**Date:** 2026-07-27

**Repository:** `/Users/adilsonporto/Desktop/IA/Uncraft`

**Branch:** `codex/live-animated-clone-editing`

**Base before Task 14:** `99ea048c feat(motion-editor): add bounded automatic recovery`

**Task 14 commit:** the commit containing this handoff

**Status:** Tasks 1–14 complete. Task 15 has not started.

## 1. Approved decision gate

The product owner approved the following before implementation:

1. `users.role` is the only admin identity source. New and existing users
   default to `member`; administrators must be explicitly marked `admin`.
2. Admin access is never inferred from plan, email, domain, signup order, a JWT
   claim, or client-visible state. Server authorization composes `requireUser`
   and rechecks the current database row on every private request.
3. Linked diagnostic events are hard-deleted after 30 days, or earlier when
   their user, project, node, snapshot, or edit session is deleted. The cleanup
   path targets only diagnostic storage.
4. Only daily groups containing at least ten events may survive unlinking. They
   contain no user, project, node, snapshot, session, control, runtime, bundle,
   stack, or other linkable identifier and expire 12 months after occurrence.
5. Strictly sanitized service-reliability diagnostics do not add a per-project
   opt-in dialog. Before broad production use, the Privacy Policy must disclose
   the purpose and the selected legal basis must be documented with the
   appropriate legitimate-interest balancing if that basis is used.
6. `Open affected node` is limited to the current administrator's own projects
   (including internal fixtures). Customer project content remains metadata-only.
   Any future temporary customer-content access requires a separate explicit
   authorization workflow and is outside Task 14.

Exports are generated on demand and are not retained by Uncraft.

## 2. Delivered behavior

### Automatic ingestion

- Task 13 runtime, binding, and recovery events are batched in groups of at most
  25 and sent automatically from an active native edit session.
- Transport and persistence are fail-open: diagnostic failure cannot change the
  editor, its history, recovery, draft, or immutable snapshot.
- The server derives user, board, node, snapshot, session, runtime fingerprint,
  and bundle hash prefix from the authenticated edit session. It rejects an
  unknown schema, oversized batch, invalid session, or unowned session.
- Browser ingestion is always classified as production. A browser client cannot
  spoof a smoke-test origin; Task 15 may write controlled smoke evidence only
  from a trusted server path.
- Initial and regenerated control validation persists both rejected candidates
  and accepted controls automatically. Diagnostic writes remain best-effort and
  never block reconstruction or control generation.

### Sanitized evidence boundary

The stored event is a fixed allowlist of bounded enums, identifiers, counters,
dimensions, versions, and hash fingerprints. It has no storage column for raw
HTML, page or form text, prompts, selectors, screenshots, full URLs, query
strings, generated source, model responses, cookies, credentials, authorization
headers, storage contents, stack traces, or runtime paths. Secret-like values in
otherwise identifier-shaped fields are dropped.

Raw evidence expires 30 days from the sanitized occurrence time. The daily cron
and an opportunistic ingestion sweep delete expired linked rows, retain only
anonymous groups of at least ten, and delete aggregates after 12 months. Foreign
keys cascade linked deletion without touching snapshots, bundles, manifests, or
edit-session data.

### Private Admin surface

- Explicit admins see `User menu > Admin > Motion diagnostics`; members do not.
- `/admin/motion-diagnostics` redirects signed-out users and returns Not Found
  for signed-in non-admins.
- The server-protected API and page provide `Coverage`, `Failures`, and
  `Smoke tests` views over the same event taxonomy.
- Filters cover time, control, runtime, device, site/test class, application and
  adapter version, validation stage, outcome, and production/smoke origin.
- Coverage shows supported, auto-repaired, and disabled counts and rates.
- Failure groups prefer the sanitized aggregation/stack fingerprint and fall
  back to the normalized failure code.
- Detail exposes automatic steps, attempts, versions, fingerprints, viewport,
  duration, and final outcome without reconstructing customer content.
- CSV and JSON exports use the active filters and contain only the sanitized API
  representation.
- `Open affected node` is emitted only when the event owner is the current admin.
  The destination rechecks board ownership, selects the requested node, and
  frames it even when that board has a saved viewport. Other events remain
  metadata-only.

The interface uses the existing Working Table visual language: calm warm
charcoal surfaces, compact tables, familiar controls, visible focus states,
keyboard-operable tabs, responsive tables, empty/error/loading states, and a
reduced-motion loading fallback.

## 3. Primary implementation files

Created:

- `packages/web-shell/migrations/2026-07-26-motion-diagnostics.sql`
- `packages/web-shell/lib/motion-editor/diagnostics.js`
- `packages/web-shell/lib/motion-editor/diagnostics.test.js`
- `packages/web-shell/lib/admin-auth.js`
- `packages/web-shell/lib/admin-auth.test.js`
- `packages/web-shell/app/api/motion-diagnostics/events/route.js`
- `packages/web-shell/app/api/motion-diagnostics/events/route.test.js`
- `packages/web-shell/app/api/admin/motion-diagnostics/route.js`
- `packages/web-shell/app/api/admin/motion-diagnostics/route.test.js`
- `packages/web-shell/app/api/cron/prune-motion-diagnostics/route.js`
- `packages/web-shell/app/api/cron/prune-motion-diagnostics/route.test.js`
- `packages/web-shell/app/admin/motion-diagnostics/page.jsx`
- `packages/web-shell/app/admin/motion-diagnostics/page.test.jsx`
- `packages/web-shell/components/admin/MotionDiagnostics.jsx`
- `packages/web-shell/components/admin/MotionDiagnostics.test.jsx`
- `packages/web-shell/components/admin/motion-diagnostics.module.css`
- `packages/web-shell/components/UserPill.test.jsx`
- `packages/web-shell/app/canvas/[boardId]/page.test.jsx`

Modified:

- `packages/web-shell/schema.sql`
- `packages/web-shell/vercel.json`
- `packages/web-shell/app/api/auth/login/route.js`
- `packages/web-shell/app/api/auth/login/route.test.js`
- `packages/web-shell/app/api/auth/signup/route.js`
- `packages/web-shell/app/api/auth/validate/route.js`
- `packages/web-shell/app/api/nodes/[id]/motion-controls/generate/route.js`
- `packages/web-shell/app/api/nodes/[id]/motion-controls/generate/route.test.js`
- `packages/web-shell/app/canvas/page.jsx`
- `packages/web-shell/app/canvas/library/[section]/page.jsx`
- `packages/web-shell/app/canvas/[boardId]/page.jsx`
- `packages/web-shell/components/BoardsList.jsx`
- `packages/web-shell/components/CanvasClient.jsx`
- `packages/web-shell/components/CanvasSidebar.jsx`
- `packages/web-shell/components/CreateStudio.jsx`
- `packages/web-shell/components/UserPill.jsx`
- `packages/web-shell/components/motion-editor/NativeMotionEditChrome.jsx`
- `packages/web-shell/lib/deferred-reconstruction.js`
- `packages/web-shell/app/globals.css`

## 4. Verification at the Task 14 exit gate

Run from the repository root:

```text
Task 14 focused ingestion/admin/navigation/control-generation: 8 files,
  37 tests passed
Private page and UI/focus follow-up: 4 files, 13 tests passed
Complete web-shell suite: 177 files passed, 1 skipped;
  1280 tests passed, 4 skipped
NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true npm run build:web:
  Next.js 15.5.15 compiled; 41/41 static pages; exit 0
git diff --check: clean
```

The suite emits only the known non-blocking invalid `--localstorage-file`
environment warning already present before Task 14.

Unit and route tests verify that a controlled bridge failure and a rejected
`no_effect` control become sanitized diagnostic writes, and that the active
Admin views can read the shared taxonomy. They also verify non-admin denial,
owned-node navigation, metadata-only customer events, export shaping, retention
scope, fail-open batching, fingerprint grouping, rate calculation, and removal
of injected secret/page-text fields.

## 5. Deployment and live-smoke boundary

No external schema or credentials were changed. Applying the migration,
explicitly assigning the first admin, configuring `CRON_SECRET`, and completing
the Privacy Policy/legal-basis gate are deployment operations, not hidden side
effects of this implementation.

The integrated persisted-native browser smoke remains blocked by the same local
environment gap recorded after Tasks 12 and 13: the connected database lacks the
native snapshot/session columns, and runtime origin, session secret, and bundle
store are not configured together. Consequently, Task 14 is verified through
real application code, server-route tests, complete regression tests, and a
production build, but no external database was mutated merely to manufacture a
live Admin screenshot or event.

## 6. Task 15 starting point

Task 15 should build the representative trusted smoke harness and use its
sanitized `origin = 'smoke'` evidence to evaluate control universality and the
approved hide-versus-disable decision. Do not let a browser client choose smoke
origin, do not broaden the automatic diagnostic payload, and do not expose
customer project content.

Keep the current provisional disabled-control presentation until Task 15's
explicit evidence gate. Task 15 must define the representative site/runtime/
device distribution and the percentage threshold before changing presentation.
Do not fold Task 16 or Task 17 into that work.
