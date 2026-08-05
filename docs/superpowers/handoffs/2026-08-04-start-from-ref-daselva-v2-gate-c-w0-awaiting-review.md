# Start from a Ref: DaSelva V2 Gate C at the W0 human taste stop

**Date:** 2026-08-04

**Branch:** `codex/start-from-ref`

**Repository worktree:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref`

**Current HEAD:** `bfb4be68` (`docs(handoff): record shared catalog smoke`)

**V2 output root:** `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2`

**Predecessors:**

- `docs/superpowers/handoffs/2026-08-02-start-from-ref-three-strategy-real-output-experiment.md`
- `docs/superpowers/experiments/2026-08-03-daselva-clone-first-v2/README.md`
- `docs/superpowers/experiments/2026-08-03-daselva-clone-first-v2/GATE-B.md`

## Current outcome

Gate C was explicitly authorized and executed in an isolated output root. The result contains three independent runnable DaSelva sites:

1. **S:** complete single-reference clone-first transformation.
2. **C:** complete primary-chassis clone with two bounded donor scenes.
3. **W0:** complete motion-free static scene synthesis, intentionally stopped before motion for human taste review.

S and C are implementation-complete for the authorized slice. W is not allowed to proceed to a motion storyboard or motion code until the W0 review passes the frozen human gate. This pause is deliberate, not an implementation omission. The user explicitly asked whether the absence of animation was intentional and was told that W0 must prove composition, typography, palette, imagery, and scene coherence without animation first.

No commit, push, deployment, shared product/database/plan/board/node mutation, or V1 mutation was performed. Actual Uncraft/model/image generation spend was zero.

## Exact Gate C authorization

The user supplied the complete required authorization:

```text
START-DASELVA-V2-GATE-C-1B0FCD27F0992769 — aprovo o bundle d724f9071eb4d551f1339f187926e4c64aee99fbc0233b5d13b99b2f73fc6a3f, o teto máximo de 1.425 créditos e a reutilização do media pack e21ee52d96adccd7200d1799622ed460262923dcceacea3ed54386a8f206019f.
```

Frozen inputs:

- Reference bundle SHA-256: `d724f9071eb4d551f1339f187926e4c64aee99fbc0233b5d13b99b2f73fc6a3f`
- Media pack manifest SHA-256: `e21ee52d96adccd7200d1799622ed460262923dcceacea3ed54386a8f206019f`
- Approved credit ceiling: `1.425`
- Actual credits used: `0`
- New image calls: `0`
- All ten media assets are byte-identical across the shared pack and the three strategy outputs.

The durable authorization record is:

`/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2/gate-c-authorization.lock.json`

## Frozen reference allocation

Business category had zero weight and no restaurant, food, hotel, or hospitality reference was selected.

### S

- **Cecilie Bahnsen** — `https://ceciliebahnsen.com`
- Owns the complete page reference: image-led hero, full-page section sequence, relative heights, restrained editorial typography placement, navigation, native scroll, and desktop-to-mobile transformation.

### C

- **Playfight** — `https://letsplayfight.com`
  - Primary chassis and owner of the global page spine, navigation, whitespace rhythm, responsive model, and scroll authority.
- **Order & Chaos** — `https://ordernchaos.aiziza.com`
  - Owns only the numbered rounded-media constellation inside the Banda scene.
- **Built for Archives** — `https://builtforarchives.com`
  - Owns only the oversized identity/information composition inside the origin/archive scene.

Donors do not own global typography, palette, navigation, page spine, responsive system, or scroll authority.

### W

- **Ponder** — `https://ponder.ai`
  - Owns only the dark floating-media opening scene.
- **Bureau Rouge** — `https://bureaurouge.com`
  - Owns only the full-bleed Banda scene with quiet micro-navigation and restrained overlay type.
- **The Red** — `https://333southwabash.com`
  - Owns only the perspective typographic chamber used as the high-risk transition scene.

DaSelva owns all target typography, palette, imagery, copy, identity, routes, content sequence, responsive corrections, accessibility, and commercial truth.

## Runnable previews

Current verified local previews:

- S home: `http://127.0.0.1:4321/`
- S Banda: `http://127.0.0.1:4321/banda-de-tambaqui`
- C home: `http://127.0.0.1:4322/`
- C Banda: `http://127.0.0.1:4322/banda-de-tambaqui`
- W0 home: `http://127.0.0.1:4323/`
- W0 Banda: `http://127.0.0.1:4323/banda-de-tambaqui`

At handoff creation, listeners were:

```text
4311 node PID 97855  # V1 S
4312 node PID 97868  # V1 C
4313 node PID 97870  # V1 W
4321 node PID 65721  # V2 S
4322 node PID 65695  # V2 C
4323 node PID 65728  # V2 W0
```

PIDs are observational and may become stale. On resume, verify listener ownership, HTTP status, and served title before restarting or stopping anything. Never kill an unknown process. The verified V2 titles are:

```text
DaSelva · Culinária pan-amazônica · Clone S
DaSelva · Culinária pan-amazônica · Clone C
DaSelva · W0 estático · Clone W
```

The temporary evidence server on port 4330 was stopped. Do not restart it unless evidence HTML needs to be recaptured.

## Validation state

All three production builds passed. All six home/Banda URLs returned HTTP 200. Browser QA found:

- zero page-level horizontal overflow;
- zero broken local images;
- zero console errors;
- working mobile menus in all three variants;
- every required home anchor: `#banda`, `#cardapio`, `#origem`, `#reservas`;
- exact Banda route H1: `Banda de tambaqui em São Paulo`;
- local target media only, with no external media runtime requests;
- no forbidden `sem espinhas` wording;
- no W motion dependency or `MOTION_STORYBOARD.md`.

Final measured content and scroll values:

| Strategy | Desktop scroll | Mobile scroll | Desktop words | Mobile words | Banda route words |
| --- | ---: | ---: | ---: | ---: | ---: |
| S | 8117 px / 8.117 vh | 8440 px / 10.000 vh | 300 | 300 | 263 |
| C | 9499 px / 9.499 vh | 9414 px / 11.154 vh | 291 | 282 | 264 |
| W0 | 6650 px / 6.650 vh | 8510 px / 10.083 vh | 284 | 281 | 262 |

Frozen targets were 6.5–9.5 desktop viewport heights, 10–15 mobile viewport heights, 280–420 visible home words, and 260–460 Banda-route words. Every result passes.

The consolidated validator passed:

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2
node validate-gate-c-w0.mjs
# Gate C W0 validation: pass
```

Structured evidence:

- `qa-results.json`
- `gate-c-cost.json`
- `gate-c-authorization.lock.json`
- each strategy's `method/BASELINE_FIDELITY.md`
- each strategy's `method/ASSET_SWAP_LEDGER.md`
- each strategy's `method/REFERENCE_INFLUENCE_LEDGER.md`
- each strategy's `method/DIVERGENCE_LOG.md`
- C's `method/OWNERSHIP_MAP.md`
- W's `method/SCENE_COMPATIBILITY.md`

## W0 review surfaces

The authoritative review document is:

`/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2/w-scene-clone-synthesis/W0-REVIEW.md`

Review images:

- Desktop full scroll strip, exact `1440 × 6650`:
  - `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2/w-scene-clone-synthesis/boards/w0-desktop-full.png`
- Mobile full scroll strip, exact `390 × 8510`:
  - `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2/w-scene-clone-synthesis/boards/w0-mobile-full.png`
- Native Banda detail, `1440 × 1000`:
  - `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2/w-scene-clone-synthesis/boards/w0-banda-detail-1440x1000.png`
- Native transition detail, `1440 × 1000`:
  - `/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2/w-scene-clone-synthesis/boards/w0-transition-detail-1440x1000.png`

The full strips were built from exact viewport captures with only the final overlapping pixels cropped. Their pixel heights equal the measured pages. They are not AI-generated visual summaries.

## The only valid next decision: W0 human taste review

The product owner must explicitly score all five frozen dimensions:

1. Compositional confidence.
2. Typographic discipline.
3. Palette and image integration.
4. Cross-scene coherence.
5. Specificity and absence of generic AI patterns.

Every score must be at least 4 out of 5 and the average must be at least 4.2. The response must explicitly approve or reject W0. A casual positive comment is useful feedback but does not cross the gate unless it addresses the frozen dimensions and approval decision.

## Ordered next steps

### Step 0: recover state without mutation

1. Read this handoff completely.
2. Check repository branch, HEAD, and dirty state.
3. Check V1 and V2 listeners, HTTP status, and served titles.
4. Re-run `node validate-gate-c-w0.mjs` before changing W.
5. Inspect `W0-REVIEW.md` and the four review surfaces.

**Exit:** current evidence is confirmed or a concrete drift is documented. No implementation change.

### Step 1: obtain and record the W0 decision

Do not change the page while waiting. Ask for the five scores and explicit approval/rejection if they have not been supplied.

#### If W0 is rejected

1. Record the scores and rejection in `W0-REVIEW.md`.
2. Preserve the existing W0 source, evidence, boards, metrics, and live preview as the V2 result.
3. Do not add motion to hide or polish static weaknesses.
4. Do not borrow C's visual system or tune W after comparing outputs.
5. A new static W board must be a separately labeled round and needs new explicit authorization before mutation.

**Exit:** rejected W0 preserved; stop and request direction.

#### If W0 is approved

1. Record the exact five scores, average, approval language, and date in `W0-REVIEW.md`.
2. Only then create `w-scene-clone-synthesis/MOTION_STORYBOARD.md`.
3. The storyboard must map desktop/mobile/reduced-motion states before code:
   - Ponder-derived floating-media opening cadence;
   - Bureau Rouge-derived full-bleed Banda scene behavior;
   - The Red-derived perspective transition;
   - entry, active, transition, exit, scroll allocation, animated-property ownership, mobile compensation, and reduced-motion fallback.
4. Run compatibility checks before implementation:
   - one global scroll owner;
   - no nested or competing pins;
   - no element animated by multiple systems;
   - no competing transforms on the same element;
   - no motion that repairs a weak static hierarchy;
   - no unsupported mobile or reduced-motion state;
   - no new reference, asset, font, copy, or design-system leakage.
5. Implement motion only inside `w-scene-clone-synthesis`. Preserve S and C byte-for-byte unless a separately labeled comparison round is approved.
6. Keep the approved media pack byte-identical and make no new image calls.
7. Rebuild W and run desktop/mobile browser QA, including full-scroll recordings because motion is now material.
8. Validate home and Banda routes, reduced motion, console logs, broken assets, external runtime requests, horizontal overflow, scroll ownership, and mobile menu behavior.
9. Update W's Influence Ledger, divergence log, QA JSON, cost JSON, and validator with the motion implementation and measured evidence.

**Exit:** W motion implementation and evidence pass. Gate C can then be documented as complete, but Gate D remains unauthorized.

### Step 2: Gate C closeout

After approved W motion passes:

1. Record exact build hashes, runtime status, motion recordings, limitations, and actual cost.
2. Preserve S, C, and final W as independent runnable outputs.
3. Confirm V1 remains untouched.
4. Create a Gate C closeout handoff.
5. Stop and request explicit authorization for Gate D.

Do not perform cross-strategy ranking or post-hoc tuning in this step.

### Step 3: Gate D, only after separate explicit authorization

Gate D performs the comparative visual, motion, provenance, transformation-distance, originality, performance, and copycat audit. It may rank the three outputs or report an inconclusive result.

Gate D does not authorize deployment, product integration, shared writes, or production enablement.

### Step 4: Gate E, only after Gate D and separate product-owner decision

Choose the product direction:

1. ship/improve the single-reference path first;
2. add contextual chassis/donor as a bounded internal strategy;
3. keep scene synthesis as an R&D track;
4. run another frozen brief because the comparison was inconclusive.

## Hard stops

- No W motion storyboard or motion code before explicit W0 approval.
- No attempt to use animation to rescue a rejected W0.
- No mutation of the approved W0 after reviewing S or C unless a new labeled round is authorized.
- No S or C tuning after seeing the comparison unless a new labeled comparison round is authorized.
- No new image generation; the approved media pack remains authoritative.
- No business-category filter or permanent per-reference role.
- No source code, identity, assets, runtime, fonts, or copy from the seven references.
- No change to V1 output, evidence, or listeners.
- No shared product, database, plan, board, node, preference, cohort, or assessment writes.
- No commit, staging, push, deployment, or production enablement without separate explicit approval.
- Do not use `git add -A` in this dirty worktree.
- Do not restart or kill a familiar port until its current owner, HTTP response, and title have been checked.
- Gate D and Gate E remain unauthorized.

## Repository state at handoff creation

The repository intentionally remains dirty. Pre-existing user-owned/experiment-owned changes must be preserved:

```text
M  package.json
M  packages/web-shell/components/ReferenceLibrary.jsx
M  packages/web-shell/components/ReferenceLibrary.test.jsx
?? docs/superpowers/experiments/
?? docs/superpowers/handoffs/2026-08-02-start-from-ref-gate-1-passed-gate-2-ready.md
?? docs/superpowers/handoffs/2026-08-02-start-from-ref-three-strategy-real-output-experiment.md
?? docs/superpowers/handoffs/2026-08-04-start-from-ref-daselva-v2-gate-c-w0-awaiting-review.md
?? scripts/start-from-ref/
```

The V2 runnable output root is outside the repository worktree and is not committed. Do not assume that the untracked experiment directory or scripts are disposable.

## Fast resume

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref
git status --short --branch
git log -5 --oneline --decorate
git diff --check
sed -n '1,360p' docs/superpowers/handoffs/2026-08-04-start-from-ref-daselva-v2-gate-c-w0-awaiting-review.md

V2_ROOT=/Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2
cd "$V2_ROOT"
node validate-gate-c-w0.mjs

for port in 4311 4312 4313 4321 4322 4323; do
  lsof -nP -iTCP:$port -sTCP:LISTEN
done

for url in \
  http://127.0.0.1:4321/ \
  http://127.0.0.1:4321/banda-de-tambaqui \
  http://127.0.0.1:4322/ \
  http://127.0.0.1:4322/banda-de-tambaqui \
  http://127.0.0.1:4323/ \
  http://127.0.0.1:4323/banda-de-tambaqui; do
  curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' "$url"
done
```

If a V2 preview is genuinely stopped, open a separate terminal for its known directory and port only after confirming the port is free:

```bash
cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2/s-single-reference-clone
npm run preview -- --host 127.0.0.1 --port 4321

cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2/c-chassis-donors-clone
npm run preview -- --host 127.0.0.1 --port 4322

cd /Users/adilsonporto/Desktop/IA/Uncraft-start-from-ref-experiments/daselva-pan-amazonian-clone-first-v2/w-scene-clone-synthesis
npm run preview -- --host 127.0.0.1 --port 4323
```

The next executable mutation is not motion. The immediate next action is to obtain and record the explicit W0 human taste decision.
