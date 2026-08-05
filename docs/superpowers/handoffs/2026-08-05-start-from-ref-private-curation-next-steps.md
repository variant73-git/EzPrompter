# Handoff — Start from a Ref private curation after AgentFlow (2026-08-05)

## Start here

- Repository worktree: `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`
- Branch: `codex/start-from-ref`
- Current implementation commit: `861e5be7 feat(refs): add visual curation and private templates`
- Status before creating this handoff: clean
- Main predecessor: `docs/superpowers/handoffs/2026-08-05-start-from-ref-macro-taxonomy-brainstorm-mode.md`
- Separate DaSelva W0 track: `docs/superpowers/handoffs/2026-08-04-start-from-ref-daselva-v2-gate-c-w0-awaiting-review.md`

Read this file completely before changing code, database state, environment variables, or deployment state. This handoff records state and sequence; it does not authorize its next gate.

## Current outcome

The private-reference workflow is implemented, committed, migrated, and populated with AgentFlow:

- web-builder template provenance defaults to private during central ingestion;
- Framer Marketplace, Webflow templates, Aura, and Neuform are recognized through marketplace provenance or explicit template taxonomy;
- an explicit `isPrivate` value can override the automatic default;
- ordinary Browse queries and ordinary user planning exclude private references;
- authorized curators can access an internal `Curate` view containing the full catalog;
- the review panel exposes a private/public switch and the existing editable tags and `keep / maybe / pass` controls;
- AgentFlow is stored as a private Framer template and remains absent from public catalog results.

No push, merge, deployment, production environment change, authenticated Curate smoke, shared preference write, generation, or credit spend was performed.

## Shared database state

The privacy migration and AgentFlow import were separately authorized and completed on 2026-08-05.

Current verified counts:

| Object | Count |
| --- | ---: |
| Reference sites | 1,950 |
| Reference appearances | 2,058 |
| Aggregators | 7 |
| AgentFlow internal matches | 1 |
| AgentFlow public matches | 0 |

AgentFlow record:

- ID: `ref_edc6c8164884dd4b`
- canonical URL: `https://agentflow.framer.ai`
- rank: `1950`
- product types: `landing-page`, `saas`, `tool`
- style tags: `soft-tech`, `corporate`
- additional brand vocabulary: `technical`, `approachable`
- `is_private = true`
- `privacy_reason = webbuilder-template`
- `template_platform = framer`
- provenance listing: `https://www.framer.com/community/marketplace/templates/agentflow/`

Applied AgentFlow evidence:

- catalog SHA-256: `87b4e6f7fb3cb4d2f0675f6a3abe0de549a1f5204df184468a10ef41bb41412b`
- authorized shared plan SHA-256: `a8f3523c9cd85930c93230faa7eeae0b49e4bed9cee5e325541fc47f750ea52c`
- exact delta: 1 site insert, 1 appearance insert, 0 appearance updates, 0 aggregator inserts
- post-apply zero-write plan SHA-256: `092ad0b570e26a1b6bab0cf9f34543d96d531f420ebf2da42dcb17fd9fde7fa0`
- post-apply result: 0 inserts, 0 updates, 39 sites preserved, 39 appearances no-op

The three shared privacy columns exist: `is_private`, `privacy_reason`, and `template_platform`.

## Important schema dependency still pending

The same implementation commit creates contextual reference plans with `schemaVersion: 3` and persists them in `generation_reference_uses`. The shared database currently still enforces:

```text
CHECK ((schema_version = ANY (ARRAY[1, 2])))
```

The additive migration exists at:

`packages/web-shell/migrations/2026-08-05-reference-plan-v3.sql`

It has **not** been applied to the shared database. Deploying the current code before resolving this dependency can make `/api/references/plan` fail when it attempts to persist a v3 shadow plan. The privacy migration is complete; the plan-v3 migration is a distinct shared mutation and requires its own explicit approval.

## Curator access state

Production curator access is fail-closed through the comma-separated `REFERENCE_CURATOR_EMAILS` allowlist.

- The local shared environment file checked during this session does not define `REFERENCE_CURATOR_EMAILS`.
- The production deployment environment was not inspected.
- Development mode permits the curator surface when a user is authenticated.
- Production hides `Curate` and rejects privacy writes unless the signed-in email is allowlisted.

After deployment and allowlist configuration, the intended user path is:

`/canvas/library/references` → `Curate`

There the curator should be able to browse the complete catalog, see private badges, inspect/edit taxonomy, record `keep / maybe / pass`, and control visibility. Browse must continue to exclude private references.

## Validation already completed

- Full web-shell suite: 143 test files passed, 1 skipped; 994 tests passed, 4 skipped.
- Production build: passed; 43 static pages generated.
- Privacy/calibration focused suite: 12 files, 58 tests passed.
- AgentFlow isolated preflight/apply and shared exact-hash preflight/apply passed.
- Shared post-apply preflight proved zero writes.
- Direct shared query proved `public_matches = 0` and `internal_matches = 1`.
- Worktree remained clean after the shared operations because they made no repository changes.

Authenticated browser QA of the new Curate surface has **not** passed yet. The local browser reached the sign-in boundary; no credentials were created or reused. Treat component tests and build as implementation evidence, not as an authenticated visual acceptance result.

## Ordered next gates

### Gate 0 — Recover and verify without mutation

1. Confirm the worktree, branch, HEAD, and dirty state.
2. Read this handoff and the macro-taxonomy predecessor.
3. Confirm the shared AgentFlow row is still private and public count remains zero.
4. Confirm the shared schema-version constraint before planning any deploy.
5. Do not rerun imports or apply migrations merely to reproduce already recorded success.

Exit condition: current code and shared state match this checkpoint, or drift is documented. No writes.

### Gate 1 — Resolve plan-v3 schema compatibility

Recommended next action: review and separately authorize the bounded shared migration in `2026-08-05-reference-plan-v3.sql`.

The gate must:

1. inspect the live constraint read-only;
2. confirm that only the allowed schema versions change from `[1, 2]` to `[1, 2, 3]`;
3. obtain explicit shared-migration authorization;
4. apply only the authorized constraint change;
5. verify the resulting constraint and unchanged row counts;
6. run the relevant planner/store tests again.

Exit condition: shared storage accepts versions 1, 2, and 3, with no reference, plan, board, node, preference, or credit-ledger data changed.

Hard stop: this handoff is not authorization to apply that migration.

### Gate 2 — Prepare curator distribution

After Gate 1:

1. Adilson supplies or confirms the curator email address(es).
2. Configure `REFERENCE_CURATOR_EMAILS` in the intended deployment environment without exposing the values in logs or documentation.
3. Decide whether `codex/start-from-ref` will be pushed directly, merged, or selectively integrated.
4. Obtain separate approval for push and deployment.
5. Deploy the exact reviewed revision or record the descendant commit used.

Exit condition: deployed revision is known, curator allowlist is configured, and no private reference is exposed publicly.

Hard stop: no environment mutation, push, merge, or deploy is authorized by this handoff.

### Gate 3 — Authenticated read-only catalog acceptance

Run desktop and mobile smoke with a real authorized curator session:

1. Browse does not return AgentFlow.
2. Curate appears only for the allowlisted curator.
3. Curate returns AgentFlow with its Private badge and switch checked.
4. AgentFlow shows the Framer platform and editable taxonomy.
5. A non-allowlisted authenticated user has no Curate entry and receives `403` from the privacy endpoint.
6. Pagination, search, thumbnails, keyboard focus, and mobile layout have no overflow or console errors.
7. Do not toggle privacy or save a review during this read-only gate.

Exit condition: desktop/mobile evidence proves visibility boundaries without shared writes.

### Gate 4 — Isolated curator write acceptance

Use a disposable migrated database to verify the complete curator loop:

1. toggle a fixture reference private and public;
2. save product type, at most two style tags, brand vocabulary, and `keep / maybe / pass`;
3. verify ordinary Browse and planning visibility after each state;
4. verify unauthorized requests fail closed;
5. restore the fixture and prove the test is repeatable.

Exit condition: isolated writes, visibility, and restoration pass. Shared state remains untouched.

### Gate 5 — Optional shared curator write acceptance

Only after a separate explicit approval, save one bounded curator decision in the shared catalog. AgentFlow must remain private throughout this acceptance unless Adilson explicitly decides otherwise.

Record the exact before/after fields and verify that no unrelated site, preference, plan, board, node, or credit record changed.

Exit condition: the real catalog editing loop is proven and the private boundary remains intact.

### Gate 6 — Continue product calibration

After operational acceptance, the recommended implementation priority is the deterministic structural analyzer already identified in the predecessor handoff:

1. section topology and reading order;
2. alignment and anchor map;
3. density and breathing-room rhythm;
4. measured typography, including font size, line height, letter spacing, weight, measure, and offsets;
5. desktop-to-mobile structural persistence;
6. semantic portability of motion rather than visual novelty alone.

Later independent slices:

- visual catalog improvements such as larger previews, provenance inspection, filters, and bulk curation;
- a separate `keep / maybe / pass` calibration flow for fonts;
- continued small-batch ingestion of URLs supplied by Adilson;
- richer Brainstorm Mode choices built from accepted structural and typographic ingredients.

Every new shared ingestion keeps the established sequence: append bounded metadata, prove isolated behavior, run a read-only shared preflight, obtain exact-plan approval, apply once, and prove a zero-write postcheck.

## Calibration rules that remain authoritative

- Human input is lightweight calibration; `keep / maybe / pass` is sufficient.
- Detailed scoring and written critique are optional, not prerequisites.
- No reference has a permanent `chassis`, `donor`, or `either` role.
- Business category is a weak hint, never a selector.
- Product/site type and visual style are different axes.
- At most two style tags may be selected; brand attributes are a separate vocabulary.
- Compose sites as `structure + text composition/alignment + palette + typography + motion`.
- Reuse structural relationships; replace identity, copy, imagery, decorative treatment, and semantically specific motion.
- Private templates can inform internal construction but must not expose their provenance to ordinary users.
- A bare hosted URL such as `*.framer.ai` is not sufficient proof that a site is a marketplace template; preserve explicit marketplace or template taxonomy provenance during ingestion.

## Supplied macro design priorities

Current weak priorities for sparse prompts:

1. large media with well-anchored text;
2. controlled asymmetry;
3. rhythm alternating density and breathing room;
4. protagonist typography without dependence on effects;
5. mobile stability as mandatory.

At the next relevant design handoff, explicitly ask Adilson:

> Você identificou algum novo padrão macro de design que devemos adicionar como prioridade fraca de busca e composição?

New patterns complement these supplied priorities. They must not become rigid selectors or permanent roles.

## Global hard stops

- Do not make AgentFlow public by default.
- Do not expose private template URLs or provenance to ordinary users or ordinary planning output.
- Do not apply the plan-v3 migration without explicit shared-migration approval.
- Do not infer deployment, push, merge, environment changes, or shared curation writes from this handoff.
- Do not trigger generation, spend credits, create boards/nodes/plans, or run Demarcelizer as part of catalog acceptance.
- Do not mix this catalog track with the DaSelva W0 decision. DaSelva motion still requires the separate five-score human taste approval in its own handoff.
- Do not commit ignored `.firecrawl/` evidence or treat temporary `/tmp` plans as durable handoff state.

## Recommended first prompt for the next session

```text
Leia completamente docs/superpowers/handoffs/2026-08-05-start-from-ref-private-curation-next-steps.md. Comece somente pelo Gate 0, confirme o estado atual e me apresente o preflight da migração plan-v3. Não aplique migração, não faça push/deploy e não escreva na base compartilhada sem uma autorização separada.
```
