# Native motion Task 16 fixture contract

The Task 16 runner has two deliberately separate execution levels.

## Local real-clone lab

```bash
npm run e2e:native-motion -- --lab-only
```

This non-persistent level opens `/motion-editor` with the clone configured by
`UNCRAFT_NATIVE_CLONE_ROOT`. It blocks external requests and saves desktop,
tablet, mobile, Preview, accessibility, security, and performance evidence in
an exclusive run directory under `/tmp/uncraft-task16-e2e/` by default.

The current reference corpus uses the unique heading `We found a better way`.
Set `E2E_NATIVE_MOTION_TARGET_TEXT` when an approved replacement fixture has a
different stable heading. The replacement must remain an offline, locally
owned reconstruction; a synthetic page is not evidence for the real-clone
acceptance scenarios.

Lab success is useful evidence, but it does not complete Task 16. It cannot
prove persisted canvas sessions, save/reload/snapshot restore, two-node
isolation, automatic control reuse, fault recovery presentation, or Admin
authorization.

## Persisted `/canvas` gate

The default command is intentionally fail-closed:

```bash
npm run e2e:native-motion
```

Before the persisted mutation pack may run, provision an isolated database and
bundle store with all native-motion and diagnostics migrations applied. The
fixture must be disposable, must not contain customer data, and must provide:

```text
E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1
E2E_NATIVE_MOTION_BOARD_URL=http://127.0.0.1:<port>/canvas/<fixture-board-id>
E2E_NATIVE_MOTION_PRIMARY_NODE_ID=<native-node-id>
E2E_NATIVE_MOTION_SECONDARY_NODE_ID=<second-native-node-id>
E2E_NATIVE_MOTION_SESSION_COOKIE=<fixture-only uncraft_sess value>
```

At this checkpoint, the runner stops after the prerequisite preflight even
when every value above is present. The fixture owner must first review the
concrete mutation pack against the fixture ownership record. Do not weaken the
gate or reinterpret a successful lab run as approval to mutate a board.

The fixture owner must also configure the normal product runtime boundary:

```text
DATABASE_URL
JWT_SECRET
UNCRAFT_RUNTIME_SESSION_SECRET
UNCRAFT_RUNTIME_ORIGIN
the selected native bundle store
```

Both nodes must use immutable native bundles, motion manifest v2, distinct
runtime sessions, and the canonical desktop/tablet/mobile geometry. The
primary node needs one finite motion, one loop, an ambiguous motion owner,
responsive bindings, accepted custom controls, one recoverable fault binding,
one exhausted fault binding, and at least two committed snapshots. The
secondary node exists only for runtime/message/asset isolation.

Use an Admin fixture owner and a separate non-admin fixture user for the
diagnostics authorization assertions. Never supply a production cookie,
customer board, production credentials, or a shared mutable clone. The runner
does not apply migrations, create users, seed nodes, fabricate credentials, or
reinterpret lab evidence as persisted `/canvas` evidence.

The approved Task 15 presentation policy remains fixed throughout the run:
cross-site candidates stay custom, exhausted controls remain visible and
disabled, and their tooltip is exactly
`This website doesn't support this control.`
