# Gate 2 evidence — Start from a Ref isolated route/store acceptance (2026-08-09)

## Scope and authorization

This evidence covers only Gate 2 from
`docs/superpowers/handoffs/2026-08-09-start-from-ref-non-curation-sequence-handoff.md`.

Authorized and executed:

- local test-harness development;
- offline comparison of shared and isolated database target identities;
- creation and removal of uniquely named databases inside the configured E2E isolated target;
- deterministic desktop/mobile capture fixtures;
- real route, authentication, Planner, analyzer, store, and SQL behavior inside the disposable database;
- focused tests, full regression tests, production build, and local evidence preservation.

Not authorized and not executed:

- any connection or mutation against the shared database;
- the shared 1–3 migration;
- a shared or production plan;
- a real public-site capture;
- model generation, billing, credits, board/node creation, commit, push, merge, Vercel changes, or deploy.

## Isolation contract

The runner:

1. loads `DATABASE_URL` and `E2E_ISOLATED_DATABASE_URL` only to compare their normalized identities locally;
2. normalizes pooled/unpooled Neon hostnames and compares protocol, host, port, database, and user;
3. fails before the first connection if the exact URLs or normalized targets match;
4. connects only to `E2E_ISOLATED_DATABASE_URL`;
5. creates a uniquely named `uncraft_gate2_*` database;
6. starts Vitest with a sanitized environment in which `DATABASE_URL` points to that disposable database;
7. removes the disposable database with `DROP DATABASE ... WITH (FORCE)` in `finally`;
8. queries the isolated admin target to confirm that the database no longer exists.

Target fingerprints recorded without credentials:

- shared: `d5ac16247090`;
- isolated: `10068a8b592f`;
- normalized targets distinct: yes.

The final acceptance used `uncraft_gate2_1786280661255_47ee1a09` and reported
`cleaned: true`. A separate final query found zero remaining `uncraft_gate2_%`
databases and zero remaining `uncraft_gate2_%` schemas.

Two earlier attempts tried to isolate with a temporary schema. Neon HTTP retained
`current_schema() = public`, so the test suite failed before fixture insertion.
Both temporary schemas were removed and independently confirmed absent. The
accepted runner uses a disposable database instead of relying on `search_path`.

## Integrated acceptance

The gated integration suite invokes the actual Next route handlers with real
authentication, Planner, analyzer, reference store, and database queries. Only
the external capture boundary and DNS response are deterministic fixtures.

Passed behaviors:

1. Curated preview is zero-write.
2. Four tied Keeps remain eligible and paginate as 3 + 1; different ingestion
   weights do not affect their neutral alphabetical presentation.
3. Maybe and Pass never enter the option set.
4. Missing explicit selection cannot persist; selecting the last-page option
   persists exactly one approved chassis.
5. Direct URL persists for a user with no curated candidates.
6. Changes to guidance, option membership, or the warning-producing brief
   profile make the submitted preview hash stale and fail with `preview_stale`
   and zero plan writes.
7. Shadow and rejected plans cannot be analyzed.
8. The approved plan captures deterministic `1440×1000` and `390×844` evidence,
   persists one hashed Manifest, and returns the same Manifest from cache without
   recapture.
9. Missing authentication and private-network targets fail closed.
10. Boards, nodes, snapshots, usage events, credit ledger, operations, and user
    credit balances remain unchanged after every scenario.

Result: 1 test file and 8 tests passed.

## Regression and build evidence

- Focused Planner/route/store/analyzer suite: 9 files, 30 tests passed.
- Full web-shell suite: 154 files passed, 2 skipped; 1,028 tests passed,
  12 skipped. Eight of the skipped tests are the deliberately opt-in Gate 2
  integration suite.
- Production build: passed; 44 pages generated, including
  `/api/references/plan/preview` and `/api/references/plan/[id]/analyze`.
- Build artifact moved to `/tmp/uncraft-next-gate2-20260809`.
- `git diff --check`: passed.
- Existing local preview remained owned by PID 67653, returned HTTP 307 for the
  authenticated route, and retained `<title>Uncraft</title>`.

## Exit decision

Gate 2 exit conditions are met locally: route/store behavior passed in a fully
disposable database, preview remained zero-write, approval was the only plan
creation path, Manifest persistence/idempotency passed, protected product tables
remained untouched, and all disposable writes were removed with the database.

Gate 3A remains a separate authorization boundary for read-only shared-database
preflight. This evidence does not authorize Gate 3A or any later gate.
