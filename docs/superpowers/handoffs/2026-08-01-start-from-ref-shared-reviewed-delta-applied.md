# Start from a Ref: reviewed delta applied to the shared catalog

**Date:** 2026-08-01

**Branch:** `codex/start-from-ref`

**Worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Importer implementation commit:** `8e799769` (`feat(refs): add shared-safe reviewed delta importer`)

**Predecessor handoff:** `docs/superpowers/handoffs/2026-08-01-start-from-ref-shared-safe-delta-importer-landed.md`

## Outcome

The exact reviewed reference delta was successfully applied to the shared catalog after two separate user authorization gates: first for a read-only live shared preflight, then for the shared apply of the resulting plan hash.

The applied plan inserted 283 genuinely new canonical sites, 315 reviewed source appearances, and three new aggregators. It preserved all 1,636 pre-existing site rows exactly, assigned the new sites unique append-only ranks from 1,637 through 1,919, and left all protected product-state fingerprints unchanged.

The transaction completed and reconciled at 1,919 sites, 2,019 appearances, six aggregators, and maximum rank 1,919. A fresh read-only post-apply preflight then produced an idempotent zero-write plan: all 305 reviewed candidate sites were preserved, all 315 reviewed appearances were no-ops, and all three reviewed aggregators were preserved.

No rollback was needed or executed.

## Authorization boundary

The user separately authorized:

1. A read-only live preflight against the shared `DATABASE_URL`.
2. The shared apply of exact plan hash `643b981493ffc14d65d069b054da5967cd7c399f8c77cbbc17cedee38112c01f` with the required `reviewed-delta-v1` confirmation.

The apply authorization did not authorize collection, source expansion, destination-site capture, review/preference mutation, Cohort mutation, generation, Demarcelizer execution, node or credit mutation, push, or deployment. None of those occurred.

## Exact reviewed artifact contract

```text
proof seed:               c30074562c6226ef251052f8a8d42ded52b78c7c1d1577322c4225b508b93778
proof report:             b367adb074b83d022eb315a9e7db8947f7917b107cddfaa6a185e58468761f75
increment seed:           b452a369ee2990cf7635b44e0d0ebee377167b4befab9f9bc1345e93fe0664af
increment report:         f9eac7b65aab01d1d86f1668edb15724960d244b8e3a46f21258608e0adadd51
Landbook pilot seed:      c638c7a9714e825261a154ff557c7808987100ab19de4c85c5a0341641b27859
Landbook pilot report:    e3d975304665dac9f0734b0b5df4750ae38eb79a6b6b0760b68906507ce11a70
Landbook pages seed:      418c041a1f5da4b4161ad88b86859b99fe0873531d4e316e38bacee81b888928
Landbook pages report:    be3f68773b52fed0a8cd1432a185dcea6d91f2635b38deb6fdbbab61a1c703c3
```

Reviewed catalog hash:

```text
cc534f118b5c15030df1425e37531a826e2ccefe3939f454fc023b77b3624b11
```

## Authorized live shared preflight

The worktree was clean on `codex/start-from-ref` at `9c9e1d55`. The preflight read the shared target without writes and saved both its target snapshot and promotion plan as ignored local evidence.

```text
captured at:               2026-08-01T23:05:30.463Z
plan hash:                 643b981493ffc14d65d069b054da5967cd7c399f8c77cbbc17cedee38112c01f

target before:
  sites:                   1,636
  appearances:             1,704
  aggregators:                 3
  max rank:                1,636

reviewed plan:
  candidate sites:           305
  site inserts:              283
  existing sites preserved:   22
  reviewed appearances:      315
  appearance inserts:        315
  appearance updates/no-ops:   0 / 0
  aggregator inserts:          3

target after:
  sites:                   1,919
  appearances:             2,019
  aggregators:                 6
  max rank:                1,919
```

The live baseline exactly matched the last landed shared count and rank baseline. Plan construction found no canonical ID/URL conflict. Recomputing the plan offline from the saved snapshot reproduced the same plan hash.

The first worktree-local preflight invocation stopped before database access because the isolated worktree intentionally had no local `DATABASE_URL`. The successful invocation used Next's environment loader with the existing trusted configuration directory from the primary checkout. No database URL or secret was printed, copied, or substituted, and the distinct-target guard remained active.

## Shared apply

The shared apply was invoked with the durable preflight snapshot, exact confirmed plan hash, and explicit shared confirmation value. Before writing, it re-read the live target and would have aborted if the recomputed live plan differed from the authorized plan.

The plan still matched, so the importer executed one serializable transaction under its advisory lock. It wrote only these allowlisted tables:

```text
reference_aggregators
reference_sites
reference_appearances
```

The apply result reconciled successfully:

```text
applied:                   true
plan hash:                 643b981493ffc14d65d069b054da5967cd7c399f8c77cbbc17cedee38112c01f
sites:                     1,919
appearances:               2,019
aggregators:                   6
max rank:                  1,919
```

All 1,636 pre-existing site snapshots matched their post-apply rows exactly. The final 1,919 ranks were globally unique, and the 283 new sites occupied only the append-only range 1,637-1,919.

## Protected state

The preflight captured seven protected table fingerprints. Transaction guards verified them before and after the writes, and the independent post-apply snapshot matched the preflight fingerprints exactly.

```text
table                              rows  fingerprint
boards                               14  d765994acd0fec02d1bd039cb3b764bb
credit_ledger                        22  c6517e1874771ff1ce6b1ae4a0496843
generation_reference_uses             0  d41d8cd98f00b204e9800998ecf8427e
nodes                                57  37c0db5c9ee60e1479dbddb32e8bb041
reference_preferences                 0  d41d8cd98f00b204e9800998ecf8427e
reference_review_cohort_members      24  7b9145262e52d9fc83ebb076f1f5caaf
reference_review_cohorts              1  ae3bbcf5e0f8b559d237a445dfab427e
```

## Final shared source reconciliation

```text
source            appearances  canonical sites
codrops                   847              847
landbook                  152              152
minimalgallery             92               92
pafolios                   816              763
siteinspire                 41               40
siteofsites                 71               71
```

These appearance counts total 2,019 and match the reviewed consolidated evidence.

## Post-apply idempotency proof

A fresh shared preflight after the committed transaction produced this deterministic no-write state:

```text
post-apply plan hash:       da5293985f8460870ff4c7b5c9c8b53e223e3b722365c769e0ba5be2c2a2c441
candidate sites:                                                   305
site inserts / preserves:                                       0 / 305
appearance inserts / updates / no-ops:                       0 / 0 / 315
aggregator inserts / preserves:                                  0 / 3
target before and after:                   1,919 sites / 2,019 appearances
```

Recomputing this post-apply plan offline from the saved snapshot reproduced the same hash.

## Rollback artifact

The authorized preflight plan contains a complete reverse-order rollback description:

1. Delete the 315 inserted appearances.
2. Restore updated appearances; this set is empty.
3. Delete the 283 inserted sites.
4. Delete the three inserted aggregators.

The rollback was not executed because the apply and post-apply reconciliation passed.

## Durable local evidence

The database snapshots and plans contain row-level evidence and therefore remain under ignored `.firecrawl/` paths rather than Git history.

```text
.firecrawl/reference-reviewed-delta-shared-preflight-2026-08-01/shared-target-snapshot.json
  file sha256: 71957be828d2ec2439aacb434ceb5a334c42897411819fcbc1559c4e1b85ff83

.firecrawl/reference-reviewed-delta-shared-preflight-2026-08-01/shared-promotion-plan.json
  file sha256: 83a056e782de09e11b19cded10b2d9e09e32bcb6fbdbead184c0ec83f1bb76d3

.firecrawl/reference-reviewed-delta-shared-postapply-2026-08-01/shared-target-snapshot.json
  file sha256: 56f22d71cf3ef62643ef59930f06ef744a4de2b7448d717b5d52b1beea8aefcc

.firecrawl/reference-reviewed-delta-shared-postapply-2026-08-01/shared-promotion-plan.json
  file sha256: 219664239f42168882d8acb6ebf6689af8defc35e2b2ac2b185a27fcac0e11aa
```

All four files parse as JSON and remain covered by the repository `.firecrawl/` ignore rule.

## Verification notes

- The shared apply's pre-write and post-write catalog guards passed inside the transaction.
- Protected fingerprints matched before and after.
- The read-only post-apply preflight confirmed exact target totals and zero remaining writes.
- The post-apply plan hash was reproduced offline.
- Shared source totals matched the reviewed consolidated catalog.
- `git diff --check` passed and the worktree remained clean apart from this handoff before its documentation commit.
- No code tests or production build were rerun because this session did not modify implementation code; the predecessor handoff records the passing 33-test focused suite, 964-test full suite, and 43-page production build for the exact importer implementation.
- The existing Node module-type warning remained non-blocking and was not expanded into an unrelated package-mode change.

## Not done

- No rollback.
- No new collection or source expansion.
- No destination-site capture.
- No preference, Cohort, shadow-plan, board, node, credit, or generation-state mutation.
- No update to any pre-existing aggregator rating; only the three exact reviewed aggregator rows were inserted.
- No real-generation or Demarcelizer integration.
- No browser/product smoke against the newly populated shared catalog.
- No push or deployment.

## Next approval gate

The next recommended bounded task is a read-only authenticated product smoke of the shared reference catalog:

1. Verify the listener and served application identity before opening the catalog.
2. Confirm the six source filters, search, pagination, thumbnails, and outbound links against the shared catalog.
3. Check representative new records from Landbook, Minimal Gallery, and Site of Sites on desktop and mobile.
4. Record browser console/network evidence and stop without mutating reviews, plans, nodes, credits, or generation state.

After that smoke passes, manual taste calibration is a separate mutation gate. Real-generation integration remains a later isolated implementation-and-acceptance gate: an approved shadow plan should map one chassis plus bounded donors into the existing creation flow without silently spending credits or enabling shared generation.

## Hard stops

- Do not rerun the shared apply: the post-apply plan is already idempotent and contains zero writes.
- Do not execute the rollback unless a separately authorized incident response identifies a concrete need.
- Do not mutate preferences, Cohorts, plans, nodes, credits, or generation state during the catalog smoke.
- Do not fetch destination sites, connect generation, call Demarcelizer, expand sources, push, or deploy without a separate explicit gate.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
```

Read this handoff first. The shared reviewed delta is complete; resume at the read-only product-smoke gate rather than rerunning preflight or apply.
