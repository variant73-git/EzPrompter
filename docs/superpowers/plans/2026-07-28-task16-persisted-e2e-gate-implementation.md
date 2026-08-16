# Task 16 Persisted `/canvas` E2E Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persisted `/canvas` acceptance path of Task 16 — an idempotent, endpoint-guarded fixture seed (the "mutation pack") plus the real persisted scenarios that currently stop at the `native-motion-editing.spec.js` line-509 placeholder — so `npm run e2e:native-motion` runs green with saved evidence.

**Architecture:** A new seed module builds the fixture directly against the **isolated disposable DB** (Admin + non-admin users, one board, two native nodes carrying real animated bundles + rich motion manifests v2, ≥2 committed snapshots on the primary node, distinct runtime sessions, a signed `uncraft_sess` cookie). The runner's placeholder `runCanvasGate` is widened and its line-509 throw replaced by `runCanvasScenarios`, which reuses `runLab`'s harness (server start, Playwright chromium, external-request blocking, screenshots, timing, `createRecorder`) to drive the persisted scenarios against `/canvas/<board>` **through host panels** (the sandboxed clone iframe has no `allow-same-origin`, so selection/edits go via the Layers list, timeline rows, and inspector fields; assertions read host state attributes). Every scenario pushes a `report.checks[]` entry; evidence is saved under an exclusive run dir.

**Tech Stack:** Next.js 15 (web-shell), Playwright (chromium), Neon Postgres via `lib/db.js` (`sql` tagged-template), Node ESM runner, Vitest for extracted pure helpers.

## Global Constraints

- **Isolated DB only.** All DB writes target the disposable fixture DB (endpoint `ep-orange-frost-acaedcil`, verified empty + schema-applied). NEVER production `DATABASE_URL` (`ep-lingering-shadow-achloaoq`). Seed guards: positive endpoint allowlist + reject endpoint-routing overrides (`options=`) + abort if the target already holds unexpected customer rows.
- **No fabrication beyond the declared fixture.** No production cookie, customer board, production credentials, or shared mutable clone. Fixture users/sessions/bundles are legitimate test fixtures the seed creates, never faked evidence or faked pass results.
- **Seeding is gated.** The seed runs only when `E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1`. The runner NEVER applies schema migrations (schema applied out-of-band already).
- **Both native nodes:** immutable native bundles, motion manifest **v2**, distinct runtime sessions, canonical desktop/tablet/mobile geometry (1280×800 / 768×920 / 390×844, from `spec.js` `DEVICES`).
- **Primary node must contain:** one finite motion, one loop, one ambiguous motion owner, responsive bindings, accepted custom controls, one recoverable fault binding, one exhausted fault binding, ≥2 committed snapshots. **Secondary node** exists only for runtime/message/asset isolation.
- **Admin fixture owner + separate non-admin fixture user** for diagnostics authorization (`users.role`).
- **Task 15 presentation policy is FIXED throughout:** cross-site candidates stay custom; exhausted controls remain visible and disabled; their tooltip is EXACTLY `This website doesn't support this control.`; no universality threshold is introduced.
- **Native iframe sandbox must remain `sandbox="allow-scripts allow-pointer-lock"` — never add `allow-same-origin`.** The clone runs in an opaque origin and cannot read host DOM.
- **Env consumed by the persisted gate:** `E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1`, `E2E_NATIVE_MOTION_BOARD_URL`, `E2E_NATIVE_MOTION_PRIMARY_NODE_ID`, `E2E_NATIVE_MOTION_SECONDARY_NODE_ID`, `E2E_NATIVE_MOTION_SESSION_COOKIE`; runtime boundary `DATABASE_URL` (isolated), `JWT_SECRET`, `UNCRAFT_RUNTIME_SESSION_SECRET`, `UNCRAFT_RUNTIME_ORIGIN`, and `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true` (the runner already sets the last one when it starts the server).
- **`UNCRAFT_NATIVE_BUNDLE_STORE_ROOT` (bundle store) MUST be set and SHARED** by both the seed process and the runner-started Next server child (the server reads bundle assets to serve the runtime iframe). `createConfiguredBundleStore` (`lib/native-clone/bundle-store.js:228`) THROWS without it (`:235`, default `process.env.UNCRAFT_NATIVE_BUNDLE_STORE_ROOT` `:230`). Point both at the same absolute dir (e.g. a scratch dir under `/tmp`). Add it to `.env.local` (already-set: `E2E_ISOLATED_DATABASE_URL`, `JWT_SECRET`, `UNCRAFT_NATIVE_CLONE_ROOT`).
- **Endpoint guard uses `new URL(url).hostname`, never a raw-string regex** — a two-`@` URL (`…@ep-allowed…@ep-prod…/db`) connects to the LAST `@`'s host (production) while a raw regex matches the first. Parse with the same resolver the driver uses.
- **Evidence is mandatory.** Each scenario pushes a `report.checks[]` entry (status `passed`/`failed`); screenshots + `report.json` saved under the exclusive run dir. Task 16 is complete only when every scenario is `passed` with evidence.

---

## File Structure

- **Create** `packages/web-shell/e2e/fixtures/native-motion/fixture-site/` — a small offline animated page used as the native bundle source. `index.html` + inline CSS/JS. Contains: element with a **finite** entrance animation that settles; element with an **infinite loop** animation; an element animated by **two** motions (ambiguous owner); elements that carry candidate controls (one that validates → accepted custom control, one that fails recoverably, one that is exhausted). No external requests.
- **Create** `packages/web-shell/e2e/fixtures/native-motion/build-fixture-manifest.mjs` — pure builder returning a valid motion-manifest-v2 object (responsive bindings, controlManifest with accepted + recoverable-fault + exhausted-fault entries) for the primary node. Unit-tested with Vitest.
- **Create** `packages/web-shell/e2e/fixtures/native-motion/seed.mjs` — the mutation pack. Exports `seedNativeMotionFixture({ sql }) → { boardId, primaryNodeId, secondaryNodeId, sessionCookie, adminUserId, nonAdminUserId, boardPath }`. Idempotent + endpoint/empty guarded.
- **Create** `packages/web-shell/e2e/native-motion/canvas-helpers.mjs` — Playwright helpers for the canvas surface (context with auth cookie + request-block, open a node into native edit, select an element via the Layers list, open an inspector tab, read a Field input by label text, wait for `uncraft:editor-busy` to clear, screenshot).
- **Create** `packages/web-shell/e2e/native-motion/canvas-scenarios.mjs` — `runCanvasScenarios({ browser, baseUrl, evidenceDir, report })` and the per-group scenario functions, each pushing `record('canvas.*', …)`.
- **Modify** `packages/web-shell/e2e/native-motion-editing.spec.js` — export the harness helpers needed by `canvas-scenarios.mjs` (`createRecorder`, `computedTargetState`, `waitForTargetState`, `DEVICES`); widen `runCanvasGate({ report })` → `runCanvasGate({ browser, baseUrl, evidenceDir, report })`; replace the line-509 throw with the seed hook + `runCanvasScenarios(...)`; widen the call site at `:545`.
- **Modify** `packages/web-shell/e2e/fixtures/native-motion/README.md` — document the seed entrypoint, what it creates, and how the four `E2E_NATIVE_MOTION_*` values are produced.

**Interface contract between seed and runner** (so the runner never fabricates env): the seed returns the four values; the runner sets `process.env.E2E_NATIVE_MOTION_BOARD_URL = baseUrl + boardPath`, `…_PRIMARY_NODE_ID`, `…_SECONDARY_NODE_ID`, `…_SESSION_COOKIE` from the return value **before** the preflight's `missingEnvironment` check, but only when `E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1` (seeding approved). If approval is absent, the preflight still fails closed exactly as today.

---

## Phase 1 — Seed foundation (guarded module + minimal native node that loads in `/canvas`)

### Task 1: Endpoint-guarded seed harness + idempotency key

**Files:**
- Create: `packages/web-shell/e2e/fixtures/native-motion/seed.mjs`
- Test: `packages/web-shell/e2e/fixtures/native-motion/seed.guard.test.js`

**Interfaces:**
- Produces: `assertIsolatedTarget(url, { allowlistEndpoint }): void` (throws on production/routing-override), `FIXTURE_TAG = 'e2e-native-motion-fixture'` (stable email/name prefix so re-runs are idempotent).

- [ ] **Step 1: Write the failing test** (`seed.guard.test.js`)

```js
import { describe, it, expect } from 'vitest';
import { assertIsolatedTarget } from './seed.mjs';

const ALLOW = 'ep-orange-frost-acaedcil';
describe('assertIsolatedTarget', () => {
  it('accepts the allowlisted disposable endpoint', () => {
    expect(() => assertIsolatedTarget('postgres://u:p@ep-orange-frost-acaedcil-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require', { allowlistEndpoint: ALLOW })).not.toThrow();
  });
  it('rejects a different (e.g. production) endpoint', () => {
    expect(() => assertIsolatedTarget('postgres://u:p@ep-lingering-shadow-achloaoq-pooler.sa-east-1.aws.neon.tech/neondb', { allowlistEndpoint: ALLOW })).toThrow(/allowlist/);
  });
  it('rejects an endpoint-routing override', () => {
    expect(() => assertIsolatedTarget('postgres://u:p@ep-orange-frost-acaedcil.sa-east-1.aws.neon.tech/neondb?options=endpoint%3Dep-other', { allowlistEndpoint: ALLOW })).toThrow(/options|override/);
  });
  it('rejects an unparseable url', () => {
    expect(() => assertIsolatedTarget('', { allowlistEndpoint: ALLOW })).toThrow();
  });
  it('rejects a two-@ host-confusion url whose REAL host is production', () => {
    // new URL() resolves the host after the LAST @ (production); a naive regex on the
    // raw string matches the FIRST @ (allowlisted) and is fooled. Guard must use new URL().
    expect(() => assertIsolatedTarget('postgres://u:pw@ep-orange-frost-acaedcil.neon.tech@ep-lingering-shadow-achloaoq.neon.tech/neondb', { allowlistEndpoint: ALLOW })).toThrow(/allowlist/);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run e2e/fixtures/native-motion/seed.guard.test.js` → FAIL (module/export missing).

- [ ] **Step 3: Implement `assertIsolatedTarget` + constants in `seed.mjs`**

```js
export const FIXTURE_TAG = 'e2e-native-motion-fixture';

export function assertIsolatedTarget(url, { allowlistEndpoint }) {
  if (!url) throw new Error('seed: DATABASE_URL empty');
  let host;
  try { host = new URL(url).hostname; } // resolves the REAL host (after the LAST @), like the driver
  catch { throw new Error('seed: DATABASE_URL is not a valid URL'); }
  const m = host.match(/^(ep-[a-z0-9-]+?)(?:-pooler)?\./); // anchored to the resolved hostname
  const ep = m ? m[1] : null;
  if (!ep) throw new Error('seed: endpoint not parseable from host');
  if (/[?&]options=/i.test(url)) throw new Error('seed: endpoint-routing override (options=) not allowed');
  if (ep !== allowlistEndpoint) throw new Error(`seed: endpoint ${ep} != allowlist ${allowlistEndpoint} — refusing to write`);
}
```

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run e2e/fixtures/native-motion/seed.guard.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add e2e/fixtures/native-motion/seed.mjs e2e/fixtures/native-motion/seed.guard.test.js && git commit -m "test(e2e): endpoint-guarded native-motion seed harness"`

### Task 2: Seed users + session cookie

**Files:**
- Modify: `packages/web-shell/e2e/fixtures/native-motion/seed.mjs`
- Test: `packages/web-shell/e2e/fixtures/native-motion/seed.integration.test.js` (gated on `E2E_ISOLATED_DATABASE_URL`, skipped otherwise)

**Interfaces:**
- Consumes: `createToken(user)` from `lib/auth.js:16`, `hashPassword` from `lib/auth.js:8`, `sql` (passed in).
- Produces: `seedUsers({ sql }) → { adminUserId, nonAdminUserId, sessionCookie }` where `sessionCookie` is the raw `uncraft_sess` JWT for the non-admin user (board owner), signed with `JWT_SECRET`.

**Design notes (from exploration):** users insert path `app/api/auth/signup/route.js:40`; `role` column `schema.sql:10` (`'member'|'admin'`); the Admin user needs `role='admin'` set explicitly. Cookie = `createToken({ id, email, plan })` (`lib/auth.js:16`, payload `{ userId, email, plan }`, `expiresIn:'30d'`). Idempotent via `ON CONFLICT (email) DO UPDATE ... RETURNING id`. The board owner is the non-admin user so a normal user can edit; the Admin user is only for the diagnostics-authz scenario.

- [ ] **Step 1: Write the failing integration test** (skips when the isolated DB env is absent)

```js
import { describe, it, expect, beforeAll } from 'vitest';
const HAS_DB = !!process.env.E2E_ISOLATED_DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;
d('seedUsers (isolated DB)', () => {
  let sql, seedUsers, jwt;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_ISOLATED_DATABASE_URL;
    ({ sql } = await import('../../../lib/db.js'));
    ({ seedUsers } = await import('./seed.mjs'));
    jwt = (await import('jsonwebtoken')).default;
  });
  it('creates an admin + non-admin and a valid cookie', async () => {
    const r = await seedUsers({ sql });
    expect(typeof r.adminUserId).toBe('number');
    expect(typeof r.nonAdminUserId).toBe('number');
    const decoded = jwt.verify(r.sessionCookie, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(r.nonAdminUserId);
    const [admin] = await sql`SELECT role FROM users WHERE id = ${r.adminUserId}`;
    expect(admin.role).toBe('admin');
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `E2E_ISOLATED_DATABASE_URL=$(grep ^E2E_ISOLATED_DATABASE_URL= .env.local | cut -d= -f2-) JWT_SECRET=$(grep ^JWT_SECRET= .env.local | cut -d= -f2-) npx vitest run e2e/fixtures/native-motion/seed.integration.test.js` → FAIL (`seedUsers` not exported).

- [ ] **Step 3: Implement `seedUsers`**

```js
import { createToken, hashPassword } from '../../../lib/auth.js';
export async function seedUsers({ sql }) {
  const pw = await hashPassword('fixture-password-not-a-secret');
  const [nonAdmin] = await sql`
    INSERT INTO users (email, password_hash, name, plan, role)
    VALUES (${FIXTURE_TAG + '-owner@example.test'}, ${pw}, 'Fixture Owner', 'free', 'member')
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, email, plan`;
  const [admin] = await sql`
    INSERT INTO users (email, password_hash, name, plan, role)
    VALUES (${FIXTURE_TAG + '-admin@example.test'}, ${pw}, 'Fixture Admin', 'free', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin'
    RETURNING id`;
  const sessionCookie = createToken({ id: nonAdmin.id, email: nonAdmin.email, plan: nonAdmin.plan });
  return { adminUserId: admin.id, nonAdminUserId: nonAdmin.id, sessionCookie };
}
```

- [ ] **Step 4: Run, verify pass** (same command) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(e2e): seed fixture admin/non-admin users + session cookie"`

### Task 3: Build + register the animated fixture bundle

**Files:**
- Create: `packages/web-shell/e2e/fixtures/native-motion/fixture-site/index.html`
- Modify: `packages/web-shell/e2e/fixtures/native-motion/seed.mjs`
- Test: extend `seed.integration.test.js`

**Interfaces:**
- Consumes: `registerNativeBundle(producerOutput, { store })` (`lib/native-clone/register-bundle.js:174`), `persistNativeBundleDescriptor({ sql, descriptor })` (`lib/motion-editor/edit-session-store.js:75`), `createDevelopmentFilesystemBundleStore` (`lib/native-clone/bundle-store.js:100`) or `createConfiguredBundleStore` (`:228` — THROWS at `:235` without `UNCRAFT_NATIVE_BUNDLE_STORE_ROOT`; the seed AND the runner-started server must share the same root so the runtime iframe can fetch the bundle assets).
- Produces: `seedBundle({ sql, store }) → descriptor` (a parsed native-bundle descriptor with `bundleId`, `runtimeFingerprint`, `entryPath`).

**Design notes:** `fixture-site/index.html` is a self-contained animated page (no external requests — inline `<style>`/`<script>`). It MUST produce, when loaded by the runtime bridge: (a) a **finite** motion — e.g. a hero element with a CSS `@keyframes` entrance that runs once (`animation: rise .8s ease forwards`); (b) an **infinite loop** — e.g. a badge with `animation: spin 2s linear infinite`; (c) an **ambiguous owner** — one element targeted by two separate animations (two classes each animating `transform`), so the bridge reports ambiguous ownership; (d) 2–3 elements with distinct `id`s to carry custom controls. The `producerOutput.assets` is `[{ path: 'index.html', body: <html string>, contentType: 'text/html' }]`, `entryPath: 'index.html'`, `runtimeFingerprint: 'sha256:'+<hash>`, `reconstructionCapabilities: { detectedEngines: ['css'], candidateControls: [...] }`. Use the memory or filesystem store per `UNCRAFT_RUNTIME_*`/bundle-store env. Register once; idempotent via content hash (`ON CONFLICT DO NOTHING` in `persistNativeBundleDescriptor`).

- [ ] **Step 1: Write the finite/loop/ambiguous fixture page** (`fixture-site/index.html`) — hand-write the HTML with the three animation kinds above and stable element ids (`#hero`, `#badge`, `#ambiguous`, `#ctl-ok`, `#ctl-recover`, `#ctl-exhausted`).
- [ ] **Step 2: Write the failing test** — assert `seedBundle` returns a descriptor whose `bundleId` is a UUID and that a `native_bundles` row exists with matching `content_hash`.
- [ ] **Step 3: Run, verify fail.**
- [ ] **Step 4: Implement `seedBundle`** (read `index.html`, `registerNativeBundle`, `persistNativeBundleDescriptor`).
- [ ] **Step 5: Run, verify pass.**
- [ ] **Step 6: Commit** — `feat(e2e): animated fixture site + native bundle registration`.

### Task 4: Seed the board + two native nodes with an initial snapshot

**Files:**
- Modify: `packages/web-shell/e2e/fixtures/native-motion/seed.mjs`
- Test: extend `seed.integration.test.js`

**Interfaces:**
- Consumes: `createEmptyMotionManifest({ baseBundleId, runtimeFingerprint })` (`lib/motion-editor/manifest.js:282`), raw `snapshots` insert mirroring `lib/deferred-reconstruction.js:71-88`.
- Produces: `seedBoardAndNodes({ sql, ownerUserId, descriptor, primaryManifest }) → { boardId, primaryNodeId, secondaryNodeId, boardPath }` where `boardPath = '/canvas/' + boardId`.

**Design notes:** board insert `app/api/boards/route.js:52`; node insert `app/api/nodes/route.js:20` with `kind='site'`, `width=1280,height=800`. Native-ness comes from the snapshot, not the kind (`lib/node-editor-kind.js:46-56`). Each node gets a native snapshot: `INSERT INTO snapshots (node_id, source, native_bundle_id, motion_manifest, motion_manifest_version) VALUES (…, 'native-bundle', descriptor.bundleId, <manifest jsonb>, 2)` then `UPDATE nodes SET current_snapshot_id`. Manifest MUST satisfy the `snapshots_native_manifest_shape` CHECK (`schema.sql:80-89`): `schemaVersion:2`, `baseBundleId === native_bundle_id`. Primary node uses `primaryManifest` (rich, Task 5); secondary uses `createEmptyMotionManifest(...)`. Idempotent: look up an existing fixture board by owner + name `FIXTURE_TAG` first; reuse if present.

- [ ] **Step 1: Failing test** — `seedBoardAndNodes` returns two UUID node ids + a board id; both nodes' `current_snapshot_id` is set and their snapshot has `native_bundle_id`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `seedBoardAndNodes`** (board, 2 nodes, 2 native snapshots, advance `current_snapshot_id`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(e2e): seed board + two native nodes with initial snapshots`.

### Task 5: Compose `seedNativeMotionFixture` orchestrator + smoke it loads in `/canvas`

**Files:**
- Modify: `packages/web-shell/e2e/fixtures/native-motion/seed.mjs`
- Test: extend `seed.integration.test.js`

**Interfaces:**
- Produces: `seedNativeMotionFixture({ sql }) → { boardId, primaryNodeId, secondaryNodeId, sessionCookie, adminUserId, nonAdminUserId, boardPath }`. Guards `DATABASE_URL` via `assertIsolatedTarget` before any write. Idempotent (safe to re-run).

- [ ] **Step 1: Failing test** — calling `seedNativeMotionFixture({ sql })` returns all seven fields; `resolveNodeEditorKind(node, snapshot, { nativeMotionCanvasEdit: true })` (`lib/node-editor-kind.js:46`) returns `NATIVE` for the primary node's row.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement the orchestrator** (guard → users → bundle → primaryManifest (Task 5 builder) → board+nodes → return).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Manual smoke** — start the server with the isolated DB + the seed's board, confirm `/canvas/<boardId>` renders the node with the `Ready to edit` resting state and `Clone & Edit`/`Edit` button. Save a screenshot to the plan's scratch (not committed).
- [ ] **Step 6: Commit** — `feat(e2e): seedNativeMotionFixture orchestrator`.

---

## Phase 2 — Rich fixture manifest (fixture-contract characteristics)

> **AUDIT CORRECTION (Claude review #1/#3):** the motion manifest can encode **only `status:'ready'` accepted controls** — `control-manifest.js` `parseReadyControl` requires `status==='ready'` (`:350`) and `exactKeys(...)` (`:347`) REJECTS any unknown field. There is **no** "recoverable/exhausted/disabled/recovery-state" field. The disabled/recovering/exhausted presentation is a **pure runtime overlay** built in `useNativeMotionController.js:1990-2000` from the `controlAvailability` map, which starts empty (`useState({})` `:254`) and is mutated ONLY by real runtime faults via `setControlRecoveryStatus` (`:323-327`). **Therefore the seed CANNOT encode fault controls.** Task 6 builds ONLY the accepted control + responsive bindings; the two fault scenarios are handled in Task 14 via a runtime **fault-injection seam** (see Task 14 + the Phase-2 spike), not the manifest.

### Task 6a: [SPIKE] Nail the strict accepted-control shape + the fault-injection mechanism

**Files:** none (investigation → notes appended to this plan).

- [ ] **Step 1: Read `lib/motion-editor/control-manifest.js` fully** (esp. `parseReadyControl` `:340-360`, `CONTROL_KEYS`, the 8-stage `validation` object `:245-259`, `compatibleLineage` `:239`, `limits.targetCount===targets.length` `:323`, id regex `^control-[0-9a-f]{24}$`) and `lib/motion-editor/responsive-manifest.js`. Write down the EXACT object that survives `parseMotionManifest` for one accepted control + one per-device responsive binding.
- [ ] **Step 2: Read the fault path** — `lib/motion-editor/recovery-policy.js` (recover vs exhaust: `exhausted = action===DISABLE_CONTROL` `:147`; runtime exhaustion at `runtimeFailures >= limits.runtimeRecoveryAttempts` `:165`), the bridge control-binding + `control-recovery-result`/`recover-control` messages in `runtime-bridge-source.js`, and `controlAvailability`/`setControlRecoveryStatus` in `useNativeMotionController.js:254/323`. Identify a **deterministic** way to make the runtime emit (a) a transient-then-recovered fault and (b) an exhausted fault — e.g. a fixture control whose target selector never binds, or a bridge fault-injection hook honoring a fixture flag/query param. If no such seam exists, the spike's deliverable is the minimal seam to ADD (a fixture-only, dev-gated hook), specified as its own follow-up task.
- [ ] **Step 3: Append the findings** (exact accepted-control object; exact fault-injection mechanism) to this plan under "Spike findings". This unblocks Tasks 6b and 14.

### Task 6b: `build-fixture-manifest.mjs` — one strict accepted control + responsive bindings

**Files:**
- Create: `packages/web-shell/e2e/fixtures/native-motion/build-fixture-manifest.mjs`
- Test: `packages/web-shell/e2e/fixtures/native-motion/build-fixture-manifest.test.js`

**Interfaces:**
- Consumes: `createEmptyMotionManifest`, `parseMotionManifest` (`lib/motion-editor/manifest.js:255/282`), the strict validators in `lib/motion-editor/control-manifest.js` + `lib/motion-editor/responsive-manifest.js` (per Task 6a spike).
- Produces: `buildFixtureManifest({ baseBundleId, runtimeFingerprint }) → manifest` — a valid v2 manifest with `responsiveManifest` binding ≥1 property per device (desktop/tablet/mobile) and `controlManifest` with exactly ONE fully-valid `status:'ready'` accepted control (all 8 validation stages `'passed'` + `validatedAt`, `compatibleLineage` including the exact `baseBundleId`+`runtimeFingerprint`, `limits.targetCount===targets.length`, `network:false`, id `^control-[0-9a-f]{24}$`). **Proven** by a `parseMotionManifest(manifest, { expectedBundleId, runtimeFingerprint })` round-trip.

- [ ] **Step 1: Failing test** — `parseMotionManifest(buildFixtureManifest(...), {...})` succeeds; the returned manifest has ≥1 responsive binding per device and exactly one ready control.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `buildFixtureManifest`** from the Task 6a spike findings (strict control + responsive).
- [ ] **Step 4: Run, verify pass** (the round-trip proves it survives runtime re-validation, since `openOrResumeEditSession:50-53` re-parses on load).
- [ ] **Step 5: Wire it into `seedNativeMotionFixture`** (primary node uses this manifest). Re-run `seed.integration.test.js`.
- [ ] **Step 6: Commit** — `feat(e2e): strict accepted control + responsive bindings in fixture manifest`.

### Task 7: Two committed snapshots on the primary node (session history)

**Files:**
- Modify: `packages/web-shell/e2e/fixtures/native-motion/seed.mjs`
- Test: extend `seed.integration.test.js`

**Interfaces:**
- Consumes: `openOrResumeEditSession` (`lib/motion-editor/edit-session-store.js:107`), `updateEditSessionDraft` (`:238`), `commitEditSession` (`:274`).
- Produces: `seedSnapshotHistory({ sql, ownerUserId, primaryNodeId }) → { committedSnapshotIds: [id1, id2] }`.

**Design notes:** drive the real session helpers to create ≥2 committed snapshots (`source='native-edit'`), each advancing `current_snapshot_id`. Respect the one-active-session-per-node partial unique index (`schema.sql:112`) — commit/close between iterations. This gives the snapshot-restore scenario (Task 15 scenario) real history to restore from.

- [ ] **Step 1: Failing test** — after seeding, the primary node has ≥2 `snapshots` rows with `source='native-edit'` besides the initial `native-bundle` one.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `seedSnapshotHistory`** using open→update→commit twice.
- [ ] **Step 4: Run, verify pass.** Wire into the orchestrator.
- [ ] **Step 5: Commit** — `feat(e2e): seed ≥2 committed snapshots on the primary node`.

---

## Phase 3 — Runner integration (seed hook + widen `runCanvasGate`)

### Task 8: Export harness helpers + widen `runCanvasGate` signature

**Files:**
- Modify: `packages/web-shell/e2e/native-motion-editing.spec.js`
- Test: `packages/web-shell/e2e/native-motion-editing.harness.test.js`

**Interfaces:**
- Produces (exports): `createRecorder`, `computedTargetState`, `waitForTargetState`, `DEVICES`, and a new `runCanvasScenarios` import seam. Change `runCanvasGate({ report })` (`:497`) → `runCanvasGate({ browser, baseUrl, evidenceDir, report })`; change the call site `:545` `await runCanvasGate({ report })` → `await runCanvasGate({ browser, baseUrl, evidenceDir, report })`.

**Design notes:** keep the fail-closed preflight (`:498-508`) exactly. Only after `if (problems.length) {…throw}` do we hand off to scenarios (replacing `:509`). Because `native-motion-editing.spec.js` is executed directly (`node …spec.js`) AND will be imported by tests, guard the `main()` auto-run with `if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(...)` so importing it for tests doesn't start a server.

- [ ] **Step 1: Failing test** — import `{ createRecorder, DEVICES }` from the spec; assert `createRecorder({checks:[]})` returns a function and `DEVICES` has 3 entries. (Fails today because the file runs `main()` on import and nothing is exported.)
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Add `export` to the helpers; guard `main()` auto-run; widen `runCanvasGate` signature + call site.**
- [ ] **Step 4: Run, verify pass;** also run `--canvas-only` without approval to confirm it still reports `blocked` unchanged.
- [ ] **Step 5: Commit** — `refactor(e2e): export harness helpers + widen canvas gate signature`.

### Task 9: Seed hook — populate env from the seed when mutations are approved

**Files:**
- Modify: `packages/web-shell/e2e/native-motion-editing.spec.js`
- Test: extend `native-motion-editing.harness.test.js`

**Interfaces:**
- Consumes: `seedNativeMotionFixture` from `./fixtures/native-motion/seed.mjs`, `sql`/`db` from `lib/db.js`.
- Produces: `ensureFixtureEnv({ baseUrl }) → void` — when `E2E_NATIVE_MOTION_ALLOW_MUTATIONS === '1'` and the four env vars are absent, runs the seed against `DATABASE_URL` and sets `process.env.E2E_NATIVE_MOTION_BOARD_URL = baseUrl + boardPath`, `…_PRIMARY_NODE_ID`, `…_SECONDARY_NODE_ID`, `…_SESSION_COOKIE`. Called in `main()` after `loadLocalEnv()` and after the server is up, BEFORE `runCanvasGate`. No-op if approval is off (preserves fail-closed).

**Design notes:** honor the constraint "the runner does not create users/seed nodes" *unless explicitly approved* — the approval flag `E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1` IS the fixture-owner's authorization, and the endpoint allowlist in the seed guards the target. Do NOT weaken the preflight: if approval is off, `ensureFixtureEnv` does nothing and the gate stays blocked.

- [ ] **Step 1: Failing test** — with a stubbed seed (dependency-injected) and `ALLOW_MUTATIONS=1`, `ensureFixtureEnv` sets the four env vars; with approval off it leaves them unset.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `ensureFixtureEnv`;** call it in `main()`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(e2e): seed hook populates canvas env under mutation approval`.

---

## Phase 4 — Persisted `/canvas` scenarios

All scenarios live in `canvas-scenarios.mjs` and run inside `runCanvasScenarios({ browser, baseUrl, evidenceDir, report })`, which mirrors `runLab`: create `const record = createRecorder(report)`; `const context = await browser.newContext({ viewport: DEVICES[0], colorScheme: 'dark' })`; `await context.addCookies([{ name: 'uncraft_sess', value: process.env.E2E_NATIVE_MOTION_SESSION_COOKIE, url: baseUrl }])`; apply the same `context.route('**/*', …)` external-block and collect `externalRequests` + console errors; `try { …scenarios… } finally { await context.close() }`.

**Shared helpers** (`canvas-helpers.mjs`): `gotoBoard(page)` → `page.goto(process.env.E2E_NATIVE_MOTION_BOARD_URL)`; `openNativeEdit(page, nodeId)` → click the node's `Edit`/`Clone & Edit` button and wait for `[aria-label="Native website editing viewport"]`; `selectLayer(page, text)` → click the Layers row button whose `aria-label` starts with `text`; `openInspectorTab(page, name)` → click `#native-motion-inspector-tab-<name>`; `transformField(page, label)` → within the Transform section, the `input` inside the `label` containing text `label`; `waitIdle(page)` → wait until no `uncraft:editor-busy {busy:true}` is pending (listen via `page.evaluate` on a window flag the helper installs).

### Task 10: Framing, scroll isolation, partial selection, finite settlement + loop indicator

**Files:** Create `packages/web-shell/e2e/native-motion/canvas-scenarios.mjs`, `canvas-helpers.mjs`.

**Checks pushed:** `canvas.fixed-viewport-framing`, `canvas.scroll-pan-disabled`, `canvas.partial-selection`, `canvas.finite-settlement-and-loop-indicator`.

- [ ] **Step 1** — Implement `canvas.fixed-viewport-framing`: open the primary node into edit; assert the viewport wrapper `[aria-label="Native website editing viewport"]` is present with `[data-viewport-width="1280"]`; assert `document.scrollingElement.scrollWidth <= innerWidth` (no host horizontal overflow); screenshot `canvas-desktop-edit.png`.
- [ ] **Step 2** — `canvas.scroll-pan-disabled`: scroll the clone region; assert canvas pan didn't translate the board (compare a board transform attribute before/after).
- [ ] **Step 3** — `canvas.partial-selection`: select a layer whose element is only partially in view via `selectLayer`; assert the inspector header `<strong>` shows its label (not `Nothing selected`) and `[data-layer-strip][data-selected="true"]` appears.
- [ ] **Step 4** — `canvas.finite-settlement-and-loop-indicator`: select the loop element; open the Motion tab; assert `[data-motion-loop="true"]` is visible; select the finite element; assert the timeline shows a finite duration readout and no loop badge on that row. Record `metrics.firstSelectableMs`, `metrics.selectionSettlementMs` (reuse `computedTargetState`).
- [ ] **Step 5** — Run `--canvas-only` end-to-end (seeded) and confirm these four checks are `passed` in `report.json`.
- [ ] **Step 6: Commit** — `feat(e2e): canvas framing/scroll/selection/settlement scenarios`.

### Task 11: Direct retarget, independent transform components, single Undo

**Checks:** `canvas.direct-retarget`, `canvas.independent-transform-components`, `canvas.single-undo-disables`.

- [ ] **Step 1** — `canvas.direct-retarget`: select an element, open Properties, set `transformField(page,'X')` to `18px`, `waitIdle`; assert (via `computedTargetState` on the selected element's host proxy OR via the inspector reading back) the applied final value is 18 and the motion still exists (retarget, not override). *Note:* the clone iframe is opaque; assert on the manifest/inspector state exposed to the host, not on iframe DOM.
- [ ] **Step 2** — `canvas.independent-transform-components`: after setting X=18, set `Rotate` to `7deg`; assert BOTH compose (the known browser-QA regression fixed in the 2026-07-27 handoff — the second edit must retain the 18px translation). Assert via the inspector's transform readback showing X≈18 and Rotate≈7.
- [ ] **Step 3** — `canvas.single-undo-disables`: click `[aria-label="Undo"]` once; assert the last transaction reverted and the Undo button becomes `disabled`.
- [ ] **Step 4** — Run, confirm passed.
- [ ] **Step 5: Commit** — `feat(e2e): retarget + transform-component + undo scenarios`.

### Task 12: Ambiguous owner, unlink cancel/confirm, reconnect

**Checks:** `canvas.ambiguous-owner-resolution`, `canvas.unlink-cancel-then-confirm`, `canvas.reconnect-matches-device-values`.

- [ ] **Step 1** — `canvas.ambiguous-owner-resolution`: select `#ambiguous`; editing a property raises the ownership chooser (`MotionOwnershipChoice`); pick an owner; assert the edit applies to that motion.
- [ ] **Step 2** — `canvas.unlink-cancel-then-confirm`: in the timeline, a shared-animation row shows `[aria-label^="Unchain"]`; click it → a confirm dialog; **Cancel**; reopen; **Confirm**; assert the row no longer shares (chain icon gone).
- [ ] **Step 3** — `canvas.reconnect-matches-device-values`: reconnect the property (no dialog on reconnect per the plan); switch device via the canvas viewport buttons (`aria-label="Tablet editing viewport"`) and assert the device values match across desktop/tablet.
- [ ] **Step 4** — Run, confirm passed.
- [ ] **Step 5: Commit** — `feat(e2e): ambiguous-owner + unlink/reconnect scenarios`.

### Task 13: Preview enter/leave + custom-control generate/validate/save/reload/reuse

**Checks:** `canvas.preview-restoration`, `canvas.custom-control-generate-save-reload-reuse`.

- [ ] **Step 1** — `canvas.preview-restoration`: click `[aria-label="Preview website"]`; assert the chrome collapses to `[aria-label="Back to Edit"]` and `body.native-motion-previewing` (or `[data-previewing]` on the viewport); click `Back to Edit`; assert edit chrome returns and playback/scroll restore. Record `metrics.previewSwitchMs`.
- [ ] **Step 2** — `canvas.custom-control-generate-save-reload-reuse`: in Motion tab `CustomControlsSection`, generate a control once, validate, save (commit), reload the page (`page.reload()` + re-auth cookie persists), reopen edit, assert the saved control is present and reused **without** regenerating.
- [ ] **Step 3** — Run, confirm passed.
- [ ] **Step 4: Commit** — `feat(e2e): preview restoration + custom-control persistence scenarios`.

### Task 14: Fault presentation — recoverable (no user decision) + exhausted (visible/disabled policy)

> **DECISION LOCKED — path A (build the fault-injection seam).** Fault state is a RUNTIME overlay (`controlAvailability`/`recoveryStatus` in `useNativeMotionController.js`), NOT a manifest field. These scenarios drive the runtime **fault-injection seam** identified (or added, fixture-only + dev-gated) in Task 6a to make the bridge emit a transient-then-recovered fault and an exhausted fault, then assert the resulting host overlay. The persisted gate covers faults live (matches the exit-gate "fault-inject" wording).

**Checks:** `canvas.recoverable-fault-no-user-decision`, `canvas.exhausted-fault-visible-disabled-tooltip`.

- [ ] **Step 1** — `canvas.recoverable-fault-no-user-decision`: via the fault-injection seam, make one control's binding fail transiently; assert it recovers automatically with NO user-facing decision prompt (no dialog; the control returns to enabled; `recoveryStatus` clears).
- [ ] **Step 2** — `canvas.exhausted-fault-visible-disabled-tooltip`: via the seam, exhaust one control's recovery attempts (`runtimeFailures >= limits.runtimeRecoveryAttempts`, `recovery-policy.js:165`); assert the control is **visible and disabled** and its tooltip is EXACTLY `This website doesn't support this control.` (the string is defined at `CustomControlsSection.jsx:6`; assert verbatim; reach the tooltip by keyboard/focus, not hover-only).
- [ ] **Step 3** — Run, confirm passed.
- [ ] **Step 4: Commit** — `feat(e2e): recoverable + exhausted fault presentation scenarios`.

### Task 15: Commit/reload + restore an older snapshot; compare behavior

**Checks:** `canvas.commit-reload-restore-older-snapshot`.

- [ ] **Step 1** — Make an edit, `Done` (commit) → new snapshot; `page.reload()`; open the version history and restore an older committed snapshot (seeded in Task 7); assert the restored visual/motion state differs from the latest and matches the older snapshot (screenshot compare `canvas-restored.png` vs `canvas-latest.png`, byte-diff tolerance or dimension/marker assertion).
- [ ] **Step 2** — Run, confirm passed.
- [ ] **Step 3: Commit** — `feat(e2e): snapshot commit/reload/restore scenario`.

### Task 16: Two-node runtime/message/asset isolation

**Checks:** `canvas.two-node-runtime-isolation`, `canvas.two-node-message-isolation`, `canvas.two-node-asset-isolation`.

- [ ] **Step 1** — Open the primary node into edit; open the secondary node into edit (two runtime sessions); assert each iframe has a **distinct** runtime session id (from the `runtime-session` responses) and that a postMessage from one runtime is rejected by the other's controller (the `matchesRuntimeContext` guard — assert no cross-node `selection-changed` leaks). Assert bundle assets resolve only through each node's own signed `/api/runtime/<token>/…`.
- [ ] **Step 2** — Run, confirm passed.
- [ ] **Step 3: Commit** — `feat(e2e): two-node runtime/message/asset isolation scenario`.

### Task 17: Diagnostics authorization (admin vs non-admin) + gateway/token fuzz + sandbox security

**Checks:** `canvas.diagnostics-admin-only`, `canvas.gateway-token-fuzz`, `canvas.sandbox-flags-and-dom-isolation`.

- [ ] **Step 1** — `canvas.diagnostics-admin-only`: with the non-admin cookie, `GET /api/admin/motion-diagnostics` → 401/403; with the admin cookie (mint a second context via `createToken` for `adminUserId`) → 200. (Reuses `app/api/admin/motion-diagnostics/route.js:98` admin gate.)
- [ ] **Step 2** — `canvas.gateway-token-fuzz`: request `/api/runtime/<garbage-token>/index.html` and a valid-shaped-but-wrong token → rejected (4xx), no bundle bytes served; assert diagnostics contain no secrets/raw page content.
- [ ] **Step 3** — `canvas.sandbox-flags-and-dom-isolation`: assert the native iframe `sandbox` attribute is exactly `allow-scripts allow-pointer-lock` (NO `allow-same-origin`); assert the clone cannot read host DOM / navigate top frame (attempt via a benign injected probe message and confirm rejection); assert `externalRequests` empty.
- [ ] **Step 4** — Run, confirm passed.
- [ ] **Step 5: Commit** — `feat(e2e): diagnostics-authz + token-fuzz + sandbox-isolation scenarios`.

### Task 18: Accessibility, reduced-motion, performance budgets, visual QA

**Checks:** `canvas.a11y-keyboard-and-focus`, `canvas.reduced-motion-host-only`, `canvas.performance-metrics`, `canvas.canonical-device-visuals`.

- [ ] **Step 1** — `canvas.a11y-keyboard-and-focus`: keyboard-only path — Tab to the sidebar tabs, timeline, Undo/Redo, Preview, Done/Cancel; assert visible focus + logical focus restoration after entering/leaving Preview; assert no unnamed controls (audit like `runLab:404-415`); assert status is not color-only.
- [ ] **Step 2** — `canvas.reduced-motion-host-only`: set `context` `reducedMotion: 'reduce'`; assert editor chrome transitions respect it while clone-authored motion semantics are unchanged (the loop still loops).
- [ ] **Step 3** — `canvas.performance-metrics`: attach `report.metrics` (runtimeReady, firstSelectable, selectionSettlement, patchCommit, previewSwitch, and add snapshotRestore + recovery). Define budgets from the measured baseline (record values; do not hard-fail unless > 3× baseline, per the plan's "budgets from measured baseline").
- [ ] **Step 4** — `canvas.canonical-device-visuals`: loop over `DEVICES`, resize via the canvas viewport buttons, screenshot `canvas-<device>-edit.png` each; assert no host horizontal overflow at any device or common zoom.
- [ ] **Step 5** — Run, confirm passed.
- [ ] **Step 6: Commit** — `feat(e2e): a11y + reduced-motion + performance + visual scenarios`.

---

## Phase 5 — Green gate, evidence, docs

### Task 19: Full green run + evidence capture

- [ ] **Step 1** — Export the isolated env and run the persisted acceptance with **`--canvas-only`** (so greenness isn't hostage to the `runLab` clone fixture — `verdict:'passed'` requires ALL checks incl. `lab.*`, which need `UNCRAFT_NATIVE_CLONE_ROOT`):
  ```bash
  cd packages/web-shell
  DATABASE_URL=<isolated> E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1 \
    UNCRAFT_RUNTIME_SESSION_SECRET=<test> UNCRAFT_RUNTIME_ORIGIN=<baseUrl> \
    UNCRAFT_NATIVE_BUNDLE_STORE_ROOT=<shared /tmp dir> \
    npm run e2e:native-motion -- --canvas-only
  ```
  Expected: `Verdict: passed`; every `canvas.*` check `passed`; evidence dir populated with screenshots + `report.json`. (The default `all` mode additionally runs `runLab` and requires `UNCRAFT_NATIVE_CLONE_ROOT` in `.env.local` — document this; it is already present locally.)
- [ ] **Step 2** — Run the Task 15 smoke command (`npm run smoke:motion-controls`) and confirm its decision/summary contract is unchanged (0% false-positive, exhausted tooltip verbatim).
- [ ] **Step 3** — Run the full focused test suite + build:
  ```bash
  npm test
  NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT=true NEXT_DIST_DIR=.next-task16-build npm run build
  ```
  Both green; remove the build cache after.
- [ ] **Step 4** — `git add` only the new/modified E2E files + fixtures; commit `test(e2e): persisted /canvas gate green with saved evidence`.

### Task 20: Document the seed + env production in the fixture README

**Files:** Modify `packages/web-shell/e2e/fixtures/native-motion/README.md`.

- [ ] **Step 1** — Add a "Seed" section: the entrypoint `seedNativeMotionFixture`, that it runs only under `E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1` against the isolated allowlisted endpoint, what it creates, and that the four `E2E_NATIVE_MOTION_*` values are produced by the seed (not hand-set). Keep the fail-closed language.
- [ ] **Step 2** — Commit `docs(e2e): document the native-motion fixture seed + env production`.

---

## Self-Review notes (author)

- **Spec coverage:** every Task 16 plan checklist item (framing, scroll, partial selection, finite/loop, retarget, ambiguous owner, transform components, undo, unlink cancel/confirm, reconnect, preview, custom controls, recoverable+exhausted faults, snapshot restore, two-node isolation, diagnostics authz + all security/a11y/perf/visual checks) maps to a Task 10–18 scenario. The fixture-contract characteristics (finite/loop/ambiguous/responsive/controls/faults/≥2 snapshots) map to Tasks 3–7.
- **Highest-risk / most-uncertain tasks** (flag for the Sol audit + extra verification): Task 6 (exact `controlManifest`/`responsiveManifest`/fault shapes — needs a close read of `manifest.js` + the recovery flow), Task 3 (the animated fixture page must make the runtime bridge emit finite/loop/ambiguous motions — verify by running, not by assumption), and Tasks 11/14 (asserting on host-exposed state since the clone iframe is opaque).
- **Not covered on purpose (YAGNI):** no new product features; no changes to the runtime bridge, the editor UI, or the schema; the runner only gains the canvas scenario path. Task 17 is untouched.

## Audit outcome (2026-07-28 — Codex/Sol + independent Claude reviewer)

Both models reviewed this plan. **Confirmed correct:** ~40 concrete references (helper signatures, schema constraints, selectors, tooltip string, line numbers) verified against the repo; Phases 1, 3, 5 and most of Phase 4 are solid. **Fixes applied inline:**
- **Endpoint guard hardened** (Codex): a two-`@` URL fooled the raw-string regex (host resolves to the LAST `@` = production). Now uses `new URL(url).hostname`; a two-`@` test case was added (Task 1).
- **Fault slice corrected** (Claude #1/#2/#3): the manifest CANNOT encode fault controls (`control-manifest.js` rejects non-`ready` controls); fault state is a runtime overlay. Task 6 was split into **6a (spike: strict accepted-control shape + fault-injection mechanism)** and **6b (build one strict accepted control + responsive bindings, proven by a `parseMotionManifest` round-trip)**; Task 14 rewritten to drive a runtime fault-injection seam.
- **Bundle-store root** added to the env contract + Task 19 (`UNCRAFT_NATIVE_BUNDLE_STORE_ROOT`, shared by seed + server).
- **Acceptance run gated on `--canvas-only`** (Task 19) so canvas greenness isn't hostage to the `runLab` clone fixture.
- Minor: corrected the `bundle-store.js` line labels and the tooltip source (`CustomControlsSection.jsx:6`).

**DECISION (owner, 2026-07-28): path A** — build the fault-injection seam so the persisted gate covers recoverable + exhausted faults live. The Task 6a spike first checks whether a deterministic seam already exists in the bridge/recovery-policy; if not, it adds a minimal fixture-only, dev-gated hook. Tasks 6a and 14 are locked to this path.

---

## Spike findings (Task 6a — 2026-07-28, Claude + Codex adversarial review, each claim verified against the code)

### A. Exact accepted-control shape (verified by `parseMotionManifest` round-trip + idempotent re-parse)
A `status:'ready'` control that survives `parseControlManifest` (`control-manifest.js`) and the motion-manifest wrapper (`manifest.js:255`) needs EXACTLY these keys (`CONTROL_KEYS`): `id` (`^control-[0-9a-f]{24}$`, produced by `createStableControlId`), `ladder` (in `CONTROL_LADDER_VALUES`, NOT `code-only`), all 12 `PROPOSAL_KEYS` (`scope,label,description,controlType,unit,currentValue,originalValue,targets,binding,domain,teardown,limits`), `bundleId` (UUID = manifest bundle), `runtimeFingerprint` (`sha256:` = manifest fingerprint), `compatibleLineage` (1–20 `{bundleId,runtimeFingerprint}` entries; MUST include the exact pair), `validation` (all 8 `VALIDATION_STAGES` = `'passed'` + ISO `validatedAt`; optional `visualOracle`), `provenance` (`{source∈{runtime,reconstruction,model,migration}, engine, decisionCode}`), `status:'ready'`. Hard constraints: `limits.targetCount === targets.length`, `limits.network === false`, animation-scope targets require `motionId`. The wrapper's `controlManifest` object itself must be `{schemaVersion:1, bundleId, runtimeFingerprint, controls:[…]}` (exact keys; control-manifest schema is **1**, distinct from motion-manifest **2**).

**Corrected binding/type (audit):** controls are string-valued **`color`** controls bound to `css-custom-property`. The bridge reads a css-custom-property with `getPropertyValue` → a **STRING** (`runtime-bridge-source.js:2874`); a `slider-number` control expects a **number** (`control-manifest.js:214`) → type-incompatible. Each target is a **selectable** `<div>` (the bridge `SELECTABLE` set at `:50` excludes `<span>`) carrying an explicit **`data-uncraft-id`** matching the manifest `elementId` — `findElement` (`:179`) resolves ONLY by `data-uncraft-id`, and `ensureElementId` (`:164`) rewrites an authored `id` to `el-<hash>`, so a plain `id` never resolves. The custom property is inline-initialized + CSS-consumed so the control has a real readable value and a visible effect.

### B. Responsive binding shape (verified)
Motion-level `responsiveManifest` = `{schemaVersion:1, properties:{ '<elementId>:<prop>': {mode, sharedValue, overrides, provenance, [binding], [devices]} }}` (`responsive-manifest.js:137`). One per-device property (`mode:'per-device'`, `overrides:{desktop,tablet,mobile}`, `binding:{elementId:'hero', kind:'style', property:'opacity'}`, `provenance:'author'`) yields a runtime patch per device (`responsiveRuntimePatches`). The bound `elementId` also needs `data-uncraft-id` on the fixture element.

### C. Fault-injection seam — NO deterministic seam exists today (grep-confirmed); path A must ADD one
- **Chokepoint:** `controlForPatch(patch)` (`runtime-bridge-source.js:2817`) — the single resolver BOTH the initial control write (`applyControlPatch:2889`) AND every recovery reinspect/rebind read (`readControlPatchValue:2872`, via `recoverControl`) pass through. A guard here covers both. Placing it only in `applyControlPatch` would let recovery reads succeed → the exhaust case would recover instead.
- **Phase-awareness (Codex):** a v2 transaction calls `controlForPatch` THREE times per apply — pre-read (`:3107`), write (`:3108`), post-read (`:3109`). So `recover` mode must fail the first **write** (`applyControlPatch`), NOT the pre-read (else it proves read-recovery, not write-recovery). `exhaust` mode fails **both** the write and every recovery read.
- **Failure code is load-bearing:** the seam MUST `throw bridgeError('write_failed', …)` **with `.code` set**. `write_failed` classifies as `REJECTED_MUTATION` whose sequence is `[REINSPECT, REBIND, DISABLE_CONTROL]` (`recovery-policy.js`) → disable on the 3rd failure. A code-less throw on the recovery-read path is reclassified `validation_failed` → `[REINSPECT, REGENERATE_CONTROL, DISABLE_CONTROL]` (different middle step + diagnostics). `runtimeRecoveryAttempts=2` governs the SESSION path only, not this control-scoped path.
- **Directive channel (reuse):** the bridge reads `runtimeConfig` from a `[data-uncraft-runtime-config]` node (`:16-20`), written host-side by `app/api/runtime/[token]/[...path]/route.js:226-232` via `injectRuntimeBridge` (`native-clone-gateway.js`, serializes the whole object, no allowlist). Add a `faultInjection` field `{ [controlId]: 'recover'|'exhaust' }`. Window-flag injection is NOT viable (sandboxed opaque origin + `matchesRuntimeContext` guard at `useNativeMotionController.js:959`).
- **⭐ Dev-gating MUST be server-only + fail-closed (both models agree; this is the one blocking prod-safety item).** `NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT` is a **rollout flag that ships `'true'` in production** — NOT a prod-off signal, and it doesn't even gate the runtime route. Gate the seam on ALL of: `process.env.NODE_ENV !== 'production'` AND a **server-only** `E2E_NATIVE_MOTION_FAULT_INJECTION === '1'` (never `NEXT_PUBLIC_*`) AND exact fixture-node/bundle scoping. Strictly parse the control id + mode; omit `faultInjection` entirely otherwise. Add a route test proving a prod request with the query param + flag injects nothing.

### D. Control-count decision → seed THREE `status:'ready'` controls
The presentation overlay `customControls` (`useNativeMotionController.js:1990`) lists ONLY `controlManifest.controls` filtered to `status==='ready'`; the seam never ADDS a control. Both Task-14 scenarios need their own control, so seed **THREE**: `ctl-ok` (never faults), `ctl-recover` (seam `recover`), `ctl-exhausted` (seam `exhaust`), distinct identities (else `createStableControlId` collides → duplicate-id fail). Manifest allows it (≤5 per scoped-target-key). (Codex nuance: exhaustion is per-controller-session, not literally permanent — `resetSession` clears `controlAvailability` — but three independent controls are far less fragile for E2E than sequential reuse.)

### E. E2E assertion guidance for Task 13/14 (from the audit)
- Keep the fixture `transactions: []` — a replayed control patch on load would consume the seam's "first call" and route through the replay/session-reload branch, not control recovery.
- `recover` and `exhaust` both render `disabled:true` with the SAME tooltip `This website doesn't support this control.` — distinguish them by **final state** (recover → re-enabled; exhaust → stays disabled), not tooltip text.
- Recover shows a passive `patchError` toast (~4.5s auto-clear): assert "no user **decision/dialog**", not "no user-visible message".
- Assert the **final steady state**, not the exact recovery-step diagnostic sequence (an 1800 ms recovery watchdog can reorder intermediate steps under slow replies).
- **Residual (Codex):** runtime application of a control (that a patch actually reaches `controlForPatch` and commits) CANNOT be proven by parser round-trips — Task 13/14 MUST assert it live against the real bridge in the browser.

### Plan corrections folded in
- Phase-2 note "controlManifest with exactly ONE ready control" → **THREE** ready controls (ctl-ok + ctl-recover + ctl-exhausted); Task 6b shipped this (`build-fixture-manifest.mjs`, `fixture-site/index.html`).
- Task 14 seam: gate on server-only `E2E_NATIVE_MOTION_FAULT_INJECTION=1` + `NODE_ENV!=='production'` + fixture-node scoping (NOT `NEXT_PUBLIC_*`); `throw bridgeError('write_failed', …)` with code; phase-aware (fail the write for recover, write+reads for exhaust); add a route test proving prod inertness.
