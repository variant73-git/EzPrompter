# Motion control smoke matrix

Task 15 evaluates custom motion controls through the same signed runtime token,
gateway bridge injection, protocol-v2 transactions, control validator, and
bounded recovery policy used by the product. It does not promote any control to
common/global presentation and does not change the approved disabled fallback.

## Run the matrix

From `packages/web-shell`:

```bash
npm run smoke:motion-controls
```

The command discovers the default local clone corpus, runs every entry at the
three canonical devices, blocks external requests, and writes a new report plus
before/apply/restore images under `.motion-smoke/<run-id>/`. Report files use
exclusive creation and are never overwritten.

Useful options:

```text
--corpus <dist-dir>       Add a local reconstructed clone
--no-default-corpus       Run deterministic fixtures only
--output <dir>            Select the evidence directory
--manual-review <json>    Apply explicit confirmed/false-positive reviews
--diagnostic-session <id> Persist sanitized events to an owned edit session
--diagnostic-user <id>    Owner of that trusted edit session
```

Smoke origin is assigned only inside this server-owned command. Browser events
cannot select `origin = smoke`. Without both diagnostic IDs, the command keeps
evidence in its immutable local report and does not touch an external database.

## Distribution

Every fixture runs at fixed geometry:

| Device | Viewport |
|---|---:|
| Desktop | 1280 × 800 |
| Tablet | 768 × 920 |
| Mobile | 390 × 844 |

The matrix requires these fixture classes before it marks distribution coverage
representative:

| Area | Required coverage |
|---|---|
| Browser-native | Plain CSS transition; finite and infinite CSS keyframes; WAAPI |
| Library runtime | GSAP tween and timeline; ScrollTrigger scrub, pin, and entrance |
| Declarative runtime | Lottie or another declarative adapter when present in the corpus |
| Ownership | Mixed-engine ownership on one element |
| Geometry | Matrix, skew, perspective; responsive computed values; partially offscreen target |
| Recovery | Runtime fingerprint reload; stale binding exhaustion |
| Real clones | At least one clone for every producer/runtime family currently available |

The controlled ScrollTrigger pin and the real-clone visual sentinel are harness
fixtures. They verify the real runtime boundary without claiming that their
control is universal. Cross-site candidates remain classified as custom for the
entire run.

## Success contract

A candidate is not successful because a command was acknowledged. For every
representative validation value, the runner requires:

1. a readable pre-change value;
2. an atomic protocol-v2 apply through the runtime bridge;
3. a changed screenshot or computed-state fingerprint;
4. restoration to the exact pre-change value with restore evidence;
5. a deterministic reapply and second exact restore;
6. no target escape, network access, layout breakage, or teardown leak;
7. complete target and engine coverage for a site-level semantic promise.

Play, pause, and scrub are measured separately as session commands. The runner
verifies that each produces zero persistent node patches.

## Metrics

The report records:

- candidates discovered and controls rendered automatically;
- initial validation, apply, visible-effect, and restore success;
- automatic repair success and recovery latency;
- exhausted failures and disabled-control incidence;
- per-site incidence of at least one disabled candidate;
- explicit manual-review result and false-positive rate;
- time to ready;
- aggregate tables by engine, property, adapter kind, and site.

The report keys comparisons by stable fixture, build, runtime, and matrix
fingerprints. Repeating an unchanged matrix creates a new run with the same
comparison fingerprint and preserves the older evidence.

## Reviewed evidence, 2026-07-27

Run `smoke-20260727155312285-1-4d5be78a` used matrix fingerprint
`sha256:68a02989b6f53016d4614a2dfa2cf63c15a0f54c431b50a345b9af1a430da9bd`.

Coverage included all required fixture classes, all three devices, and one real
clone from each of the two locally available producer/runtime families:

- localized clone with GSAP, ScrollTrigger, and declarative runtime evidence;
- Unspirit transplant with the browser-native runtime.

No external request was permitted. Before/apply/restore images were reviewed
for every supported or recovered case. Their before and restore fingerprints
matched, while their apply fingerprints differed. The three intentionally
missing stale-binding targets were correctly disabled and were not false
positives.

| Metric | Result |
|---|---:|
| Candidate/device cases | 15 |
| Initially validated | 9 |
| Auto-recovered | 3 |
| Exhausted and disabled | 3 |
| Apply, visible effect, and restore success | 12 |
| Disabled-control incidence | 20% |
| Sites with a disabled candidate | 20% |
| Reviewed false-positive rate | 0% |
| Median time to ready | 307 ms |
| Median recovery latency | 314 ms |
| Median exhaustion latency | 299 ms |
| Persistent patches from play/pause/scrub | 0 |

The 20% disabled rate is deliberately influenced by the required stale-binding
fault fixture. The two real-clone sentinel controls succeeded on all three
devices, but sentinels are not semantic evidence that a real product control is
universal. This run validates the harness and failure policy; it does not justify
a common/global label for any candidate.

Admin persistence was not configured for this local run because the connected
environment does not provide an owned, migrated native edit session. This is the
existing deployment gap, not a browser-selected fallback. When an isolated
compatible session is provided, the trusted command writes the same sanitized
events to the Admin `Smoke tests` view.

## Approved owner checkpoint

On 2026-07-27, the product owner reviewed the evidence and approved:

- cross-site candidates are custom;
- exhausted controls remain visible but disabled with the approved tooltip;
- no universality percentage is hardcoded in implementation.

The evidence is insufficient for a presentation change. The current custom plus
disabled behavior remains in force, and no candidate is promoted to
common/global.

A future presentation change requires a separately approved design amendment
that pre-registers all of the following before the change ships:

- the minimum number and distribution of real clones per producer/runtime family;
- the required semantic success percentage per control and per site;
- the maximum exhausted and false-positive percentages;
- whether exhausted controls are hidden or disabled at that evidence level.

Reliability alone is never enough. A candidate must keep the same semantic
promise across every declared target, engine, site class, and device.
