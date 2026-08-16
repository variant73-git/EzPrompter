# Start from a Ref — Gate 5 started, target approval pending

Date: 2026-08-09
Worktree: `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`
Branch: `codex/start-from-ref`
Starting HEAD: `60dd8ffb100fac68f8693222a583f0144e7d3f2b`

## Authorization received

The user explicitly said to keep the Gate 4 result and start Gate 5.

Authorized slice:

- preserve the approved Gate 4 plan and frozen Chassis Manifest;
- add target-authority selection and a reviewable transplant ledger;
- expose PRESERVE / ADAPT / REPLACE, media bindings, text capacity, motion portability, Worth borrowing, Avoid, and honest gaps;
- bind approval to the exact Manifest + target contract hashes;
- keep generation, credit spend, and canvas mutation locked.

Not authorized:

- choosing a real target authority on the user's behalf;
- generation or `transplantChassis`;
- model calls or credit reservation;
- board, node, snapshot, or shared-output mutation;
- commit, push, PR, deployment, or Gate 6.

## Gate 4 state preserved

- Plan id: `2c743581-36e5-4e07-81ed-695795111ee0`
- Mode/status: `shadow` / `approved`
- Manifest hash: `3fb15637add3b707330f0174762e6a7f722e5a9f55abaad8f2a32d5f4ad29f28`
- Shared `chassisTargetContract`: absent
- Shared generation-mode plans: `0`

The Gate 5 work did not alter this record. The shared contract remains absent until the user selects and attests the target inputs.

## Implemented

### Contract model

`packages/web-shell/lib/chassis-target-contract.js`

- supports an owned existing project, a target URL, or labeled provided sources;
- normalizes the semantic authority and creates the blueprint through `createTransplantBlueprint()`;
- records section text capacities, target media bindings, and motion portability;
- carries curator Worth borrowing / Avoid guidance;
- blocks approval for missing content, design-system, replacement-media, or Manifest evidence;
- hashes the Manifest, authority, readiness, notes, blueprint, ledger, guidance, gaps, and locks;
- reconstructs the contract server-side before approval;
- keeps `generationAuthorized`, `creditSpendAuthorized`, and `canvasMutationAuthorized` false.

### Persistence and routes

- `POST /api/references/plan/[id]/contract/preview` is zero-write.
- `POST /api/references/plan/[id]/contract` rebuilds and approves only the exact current hash.
- Project authority is ownership-checked.
- Persistence is atomic and conditional on the current Manifest hash.
- The latest approved plan with a Manifest is loaded into the Plan tab on the server.
- A saved approval is not revived if its Manifest or owned-project authority changed.

### UI

`packages/web-shell/components/ChassisTargetReview.jsx`

- inline Working Table below the Gate 4 recipe and Manifest;
- authority selector, target brand, authority note, and three readiness attestations;
- honest blocker state before approval;
- 9-row-compatible ledger with text, media, and motion details;
- exact truncated hash and explicit execution locks;
- approval invalidates immediately when any local hashed input changes;
- persisted approval reloads only when its Manifest and authority are still current.

## Validation evidence

### Full local suite

- `158` test files passed;
- `3` suites skipped by existing environment guards;
- `1038` tests passed;
- `15` tests skipped;
- production build passed;
- both Gate 5 API routes are present in the production route table.

### Disposable database proof

Command:

`REFERENCE_ENV_DIR=/Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell bun run refs:gate5:prove:isolated`

Evidence:

- shared target fingerprint: `d5ac16247090`;
- isolated target fingerprint: `10068a8b592f`;
- canonical targets were distinct;
- blocker preview was zero-write;
- exact ready contract persisted with all execution locks false;
- changed target input produced `target_contract_stale` and no approval;
- protected board/node/snapshot/usage/ledger/operation/credit counts were unchanged inside the proof;
- disposable database `uncraft_gate5_1786284742911_c8726fa1` was dropped and confirmed cleaned.

### Browser proof

A second disposable database and authenticated local preview were used only for visual QA.

Verified in the browser:

- approved Gate 4 recipe and Manifest load before Gate 5;
- three missing readiness inputs produce three visible blockers;
- approval is disabled while blocked;
- all 9 ledger rows expose measured capacities, media bindings, and motion portability;
- a complete synthetic target produced hash prefix `e23cfbddc51f`;
- synthetic approval persisted across reload;
- `Contract approved` and `Generation remains locked` appeared together;
- the disposable browser database was removed after QA.

### Local preview

- URL: `http://127.0.0.1:3035/canvas/library/references`
- listener: Node PID `91483`
- checkout: `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref/packages/web-shell`
- unauthenticated page response: `307` as expected;
- new Gate 5 preview route responds and enforces authentication (`401` without a session).

## Shared-state drift observed and preserved

The current shared protected snapshot is:

- boards `14`
- nodes `57`
- snapshots `67`
- usage events `25`
- credit ledger rows `22`
- operations `2`
- credits cents `2365`
- generation plans `0`

These counts differ from the predecessor handoff snapshot. They were observed after Gate 5 implementation, are unrelated to the still-absent shared Gate 5 contract, and were not reverted or modified. Treat them as parallel/shared-state ownership.

## Exact next approval needed

To finish Gate 5 on plan `2c743581-36e5-4e07-81ed-695795111ee0`, obtain from the user:

1. target authority type: existing project, target URL, or provided sources;
2. exact project/name, URL, or provided-source label;
3. target brand/product name;
4. optional authority note;
5. explicit readiness for:
   - copy/content;
   - design-system tokens;
   - replacement media or explicit slot waivers.

Then preview the contract, show its blockers or exact hash, and persist only after explicit approval. Stop again after shared Gate 5 approval. Gate 6 remains unauthorized.

## Repository hygiene

- no staging;
- no commit;
- no push;
- no deployment;
- no broad cleanup;
- unrelated dirty and untracked files preserved.
