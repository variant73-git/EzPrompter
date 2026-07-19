# Motion editor — redesign plan + session handoff

**Date:** 2026-07-18 · **Branch:** `feat/native-motion-editor` · **Tests:** 666/666 (run vitest from `packages/web-shell`)
**Read this first.** It carries decisions locked with the user, findings verified by deterministic checks (not opinion), and the plan.

---

## 1. What shipped this session

All in `packages/web-shell/lib/motion-editor/runtime-bridge-source.js` unless noted. Everything TDD'd (RED verified before GREEN) and re-validated live against real GSAP 3.15 on the farmminerals clone.

| # | Change | Why |
|---|---|---|
| 1 | **GSAP mid-tween keyframe capture** — new `gsapEditableTracks()` samples the tween at `progress(0)`/`progress(1)` via `gsap.getProperty()` and emits a real start→end track; `capabilities.keyframes: true` | Before, a GSAP tween was a single `offset:1` end-state. You could not see the shape of the motion. |
| 2 | **GSAP keyframe writeback** — new `applyGsapKeyframe()`: `offset≈1` → `vars[prop]`, `offset≈0` → `vars.startAt[prop]`; intermediate offsets throw (caught → `patch-rejected`) | Backend can now accept keyframe edits for GSAP. **Not reachable from the UI yet** — see §3. |
| 3 | **clearProps destructive-sampling fix** — snapshot/restore `style.cssText` of every element target around sampling; `clearProps` added to `ignored` | **Found by Codex (Sol) adversarial review.** `suppressEvents` silences callbacks, NOT plugin side effects: sampling to `progress(1)` fired CSSPlugin's `clearProps`, wiping inline styles permanently. Merely *inspecting* corrupted the page. |
| 4 | **Playback scoped to selection** — `controlPlayback(action, speed, motionId)` acts only on the selected motion; new `speed` action re-rates without playing | Was global: paused every animation, the GSAP global timeline, **every video**, and **Lenis** (killing smooth scroll). Speed change also force-sent `action:'play'`. |
| 5 | **Bridge single-instance guard** — all listeners hang off one `AbortController`; re-injection tears the previous instance down completely (`window.__uncraftMotionBridge.teardown()`) | Found *because* of a failing test. Re-injecting left the old instance fully alive → every command handled twice, and the stale instance emitted `selection-changed` with ids from its own table. Likely explains part of the user-reported unpredictability. |
| 6 | **GSAP easing actually applies** — resolve via `gsap.parseEase()` and install the function; deliberately **no** `invalidate()` | Verified: `vars.ease` alone does **not** change the curve. See §2. |

Client change: `NativeMotionEditor.jsx` `playback()`/`changeSpeed()` now send `motionId`, and speed sends `action:'speed'`.

---

## 2. Verified findings (deterministic — do not re-litigate)

These were established by running code, not by reasoning. Scripts live in `/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/scripts/`.

- **`vars.ease` + `invalidate()` does not change a GSAP curve.** Probe (`probe-gsap-ease.mjs`, GSAP 3.15): `ease:'none'` at progress 0.5 → x=50. After `vars.ease='power4.in'` + invalidate → 51.56 (`power4.in` from the re-based start should be ~53.1 — the curve did **not** change; the value moved only because invalidate re-based the start). With `gsap.parseEase()` installed → 53.08 ≈ correct. **Fix uses parseEase.**
- **`invalidate()` re-bases a tween's start onto the currently rendered value.** This is a real side effect. Avoid calling it on edits that don't need re-recording (that is why the ease path no longer calls it). ⚠️ The keyframe writeback still calls `invalidate()` — see §5 risk.
- **Sampling renders the tween.** `suppressEvents` (2nd arg of `progress()`) suppresses callbacks only. Any completion-time plugin effect (clearProps and friends) fires. The cssText snapshot/restore is what makes inspection safe.
- **The UI gates keyframe editing on `editability === 'direct'`** ([NativeMotionEditor.jsx:1030](../../../packages/web-shell/components/motion-editor/NativeMotionEditor.jsx#L1030)), and the timeline renders adapter tracks read-only ([:757](../../../packages/web-shell/components/motion-editor/NativeMotionEditor.jsx#L757)). GSAP is `adapter` → **the writeback from §1.2 is currently unreachable from the UI.**
- **Gating is inconsistent across controls:** Repeat delay / Yoyo are **adapter-only** (`:509`, `:511`); keyframes are **direct-only**. Same screen, opposite rules, no signalling. This is the mechanical cause of "sometimes it works, sometimes it doesn't".
- **The motion list has no grouping/sorting/dedup** (built flat at `:894-905`, rendered at `:465-485`). SplitText emits one tween per character → a headline becomes ~200 entries.
- **Video is a blind spot.** The bridge treats `<video>` only as an inventory asset (`:502-507`) and (formerly) a global playback target. **No motion clip is ever produced for video.** The IR already declares a `media` driver (`MOTION_DRIVERS.MEDIA`) that nothing emits.

---

## 3. Decisions locked with the user

1. **Scroll is the clock.** The timeline's X axis is **scroll distance**, not time. The page's scroll height *is* the master timeline (farmminerals = 20942px). ScrollTrigger already declares `start`/`end`/`scrub` in scroll space → this is **extraction, not inference**, which is where this project consistently wins.
2. **Two clocks, explicitly.** Time-driven motion (loops, hover, on-load entrance, Lottie, video) does not live on the scroll ruler. It needs a separate lane or a drill-in local timeline in seconds. This is the one accepted complexity.
3. **`media` is a first-class driver, not a special case.** A scroll-scrubbed video is the *cleanest* case of the model: one track whose value is `currentTime`, driven by scroll. Wire the existing `MOTION_DRIVERS.MEDIA` slot.
4. **The IR is a superset, not a Framer mirror.** Framer-mappable core (exports cleanly) + timeline extensions (scroll keyframes). Export maps the core and degrades the rest **with a report**.
5. **Framer export target = React + Framer Motion code.** Do **not** attempt a native `.framer` project (undocumented format, high risk). **Validate the import path with a spike before building the exporter.**
6. **Export need not be automatic.** It is an internal tool; a human finishes the last mile in Framer. The fidelity cliff (pin+scrub multi-stage, SplitText stagger, Lottie) becomes a *translation report*, not a failure.
7. **Kill the global transport.** Scroll scrubber is the primary playhead; a per-animation preview exists only for time-driven clips. (Step 4 above already scoped it; the UI still shows the old buttons.)
8. **The site's own scroll IS the play control.** There is no transport to "play" a scroll-driven page — scrolling the site *is* playing it. A play button may exist at the bottom, next to the timeline, for the time-driven lane only. This supersedes the old global rewind/pause/play, which the user reports never made sense to them (and which the code shows acted on the whole document, every video and Lenis).
9. **The timeline shows only what is framed in the current viewport.** ⭐ Rather than listing every animation on the page, list the animations whose elements are inside the visible area right now. Scrolling the site changes what the timeline shows. This is a *scoping* answer to the "hundreds of animations" problem and it is far cheaper than grouping — it cuts the list to the handful on screen. **It composes with grouping rather than replacing it:** viewport-scoping cuts *across* elements (only what you can see), grouping cuts *within* an element (200 per-character tweens → one "text reveal" row). Both are needed; viewport-scoping lands first because it is cheap and immediately legible.
10. **Every row is identified by element, not by animation object.** Element name on the left of the strip, with a type icon (image / text / SVG / video / container). The user must recognise the row as *a thing on their page*, never as an engine object.
11. **Timeline and the Framer direction do not conflict** — timeline is the editing surface, IR is the data model, Framer is an export target.

---

## 3b. Timeline model — SETTLED (supersedes the two-lane idea)

**The strip is the control, and it is ONE control regardless of driver.** The user's framing, which is simpler and better than the earlier "two lanes" proposal:

> What matters to the user is *how the animation looks and how fast it happens*. On a scroll-scrubbed clip, shortening the strip makes it animate faster — i.e. **less scrolling is needed to play it through**, so it reads as more scroll-sensitive. Same gesture, same meaning, same control as time.

So:
- **Strip length = how much it takes to play through.** Seconds for time-driven, scroll pixels for scroll-scrubbed. The unit is a *readout*, not a different UI.
- **Dragging the strip edge is the primary edit** for both: it changes `duration` (time) or the ScrollTrigger `start`/`end` range (scrubbed).
- **Do NOT surface "triggered vs scrubbed" as a user concept.** It is an implementation fact. The only place it legitimately shows up is the transport (a scroll clip has no play button — the site's scroll is its playhead) and a separate **"smoothing"** control for `scrub: <number>`, which is a catch-up lag, *not* a length.
- ⚠️ **Ruler consequence:** with one lane, the master ruler should be the **page scroll**, with time-driven clips placed at the scroll point where they trigger. Do not mix two rulers on one canvas (the current build does, and it is the bug below).

**The convention that must hold:** the strip's length is the extent over which the thing happens, and dragging changes it. A read-only strip is decoration and the user will (correctly) reject it. **Making the strip draggable is the highest-priority UI work** — it matters more than which axis is chosen.

## 3c. Semantic controls, not raw keyframes

For a text reveal (the case the user raised), exposing 200 per-character keyframe tracks is useless. Collapse to **one row** ("text reveal") whose panel exposes the knobs that change how it *feels*:

1. **Unit** — character / word / line (the biggest expressive lever)
2. **Motion** — slide (Y), fade, blur, scale, rotate, mask/clip
3. **Distance** — how far it travels (100% of line height, 24px, …)
4. **Stagger** — delay between units + order (start / center / end / random)
5. **Curve + extent** — ease, plus duration or scroll range
6. **Trigger** — where it starts relative to the viewport

Generalise this into **named presets** matching the user's taxonomy: carousel, slider, rotation, transition, path, mask, glow. *Unverified:* the farmminerals reveal looks like SplitText-lines + `overflow:hidden` mask + Y translate + stagger, read from a frame — a probe to confirm it kept losing the page context (the clone navigates mid-run). **Confirm before building a preset detector.**

## 4. The plan

**Phase 0 — trust (partially done).** ✅ items 3,4,5,6 above. ⬜ **Remaining: capability legibility.** The editability badge only styles, it does not explain (`:481`); disabled controls must look disabled and say why. *Deliberately deferred* — Phase 2 replaces this UI, so doing it twice is waste. If Phase 2 slips, do it standalone.

**Phase 1a — viewport-scoped, element-named rows (do this FIRST).** Cheapest path to a legible timeline, and it is what the user asked for:
- list only animations whose target is inside the current viewport (recompute on scroll, debounced);
- one row per **element**, labelled with the element's name + a type icon (image / text / SVG / video / container);
- the site's scroll drives the playhead; remove the global transport (a play button may stay for the time-driven lane only).
This alone takes the list from hundreds to a handful without any grouping logic.

**Phase 1b — semantic grouping (the real unlock).** Collapse the flat list into meaningful rows *before* any visual work:
- group SplitText character tweens into one "text reveal" row (detect shared parent + `data-uncraft-needsMotionRebind`/split markers);
- group staggered siblings into one row with a stagger control;
- collapse a ScrollTrigger timeline's children under their parent.
Without this, thumbnails just give you hundreds of thumbnails. **This is the highest-value work in the whole redesign and it is invisible in a mockup.**

**Phase 2 — scroll-ruler timeline.** Strips per element with a thumbnail on the left; X axis = scroll position; each animation drawn where it starts/ends in scroll. Second lane (or drill-in) for time-driven clips. Reuse the existing `CubicBezierEditor` (`:105-209`, `:792-799`) for curves — it already exists.

**Phase 3 — adapter tracks become editable.** Unlock keyframe editing for `adapter` (GSAP) and route to the `applyGsapKeyframe` writeback already built. This is what makes §1.1/§1.2 user-visible.

**Phase 4 — `media` driver.** Emit motion clips for scroll-scrubbed video (`currentTime` track) and detect the three shapes: GSAP-driven scrub (likely already captured — **verify**), hand-rolled scroll listener (needs heuristic), canvas image-sequence (probably `code` tier, preserve as-is).

**Phase 5 — Framer-shaped IR + exporter.** Align the core IR with Framer concepts; build the React + Framer Motion emitter; emit a translation report for what could not be mapped. **Spike the import path first.**

**Phase 6 (maybe never) — vector/path controls.** Deferred deliberately: real sites don't author motion paths as vectors, so this is inference, and inference is where this project has historically lost.

---

## 4b. Where this session actually stopped (start here)

Shipped in the UI, verified (motion-editor 47/47, full suite green, page HTTP 200, zero compile errors):
- The separate "on screen" panel is **gone**. There is **one** timeline.
- `TimelinePanel` now takes `rows` (viewport-scoped elements) + `selectedElementId` + `onSelectElement`.
- Left column lists **elements** (type icon + name), populated by `viewport-motion-changed` and re-scoped as the user scrolls the site.
- Clip names come from the element, not `Animation 105` (bridge, both engines).
- Transport is gone for scroll clips (shows "scroll to play"); it survives only for time clips and is scoped to the selection.

**🔴 Known broken — fix this first:**
1. **Canvas rows do not nest under their element.** The label column renders `element → its property tracks` per group; the canvas renders *all* element strips, then the property rows. Two different orders ⇒ **strips do not line up with their labels and keyframes appear displaced**. Fix: extract the property-track JSX and render it inside each element group in the canvas, mirroring `timelineLayerGroup`.
2. **Two scales on one canvas.** Element strips use a shared max-envelope scale; property keyframes still use the active motion's `duration` math. Resolve by adopting the single page-scroll ruler from §3b.
3. **Strips are read-only.** Per §3b this is the thing that makes the tool feel real. Do it before any further axis work.

## 5. Open risks / gotchas

- ⚠️ **`applyGsapKeyframe` still calls `invalidate()`**, which re-bases the start onto the currently rendered value (see §2). For a scroll tween parked mid-scroll this can shift the from-value. Consider restoring `progress(0)` before invalidate, or capturing start explicitly. **Not yet addressed.**
- **Re-sampling runs on every inspection** (hover + select + every `patch-applied` → `describe`). Synchronous, so no visible flicker, but it drives each GSAP tween 0→1→restore. On heavy pages consider caching samples per `motionId` until `vars` changes.
- **Multi-target tweens** (stagger): the track reflects only the first element target; writeback applies to `vars`, i.e. all targets.
- **Intermediate GSAP keyframes are rejected** by design (a simple tween has no middle). Supporting them means converting to GSAP's `keyframes` syntax.
- The bridge teardown does not cancel every timer, only the timeline rAF + all listeners. Good enough today; revisit if new loops are added.

---

## 6. How to run things

```bash
# tests (MUST run from packages/web-shell)
cd packages/web-shell && npx vitest run

# live validation against real GSAP on the farmminerals clone
cd /Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1
node scripts/validate-gsap-editor.mjs   # PASS = GSAP tracks expose start@0 + end@1
node scripts/probe-gsap-ease.mjs        # the ease/parseEase probe

# the motion editor itself
# point UNCRAFT_NATIVE_CLONE_ROOT at a clone bundle, then open /motion-editor
```

The farmminerals clone at `/Users/adilsonporto/Desktop/IA/Unspirit-Clone-1to1/site` is a **drop-in fixture** for `UNCRAFT_NATIVE_CLONE_ROOT` — self-contained, offline, real GSAP/ScrollTrigger/video.

## 6b. Session 2 (2026-07-18, later) — Phase 1 SHIPPED: semantic grouping

All TDD'd (RED verified), 683/683 tests, live-validated on the farmminerals clone.

**What shipped:**
1. **Bridge emits `group` metadata per clip** — new `clipGroupMeta()` in `runtime-bridge-source.js`: `{targetId, parentId, splitRootId, splitRootLabel, timelineId, timelineLabel, timelineScroll, targetCount}`. Read-only (only stamps `data-uncraft-id`, same as `describe()` already did), every lookup wrapped in try/catch so metadata can never kill selection. Timeline ids are **seeded from the authored timeline id** (`tl:<vars.id>`) so they survive bridge re-injection; sequence fallback only when unauthored.
2. **New pure module `lib/motion-editor/motion-groups.js`** — `groupMotionClips(clips)` collapses the flat list into rows: split-text roots → one *text reveal* row; shared GSAP parent timeline → one *timeline* row; ≥3 same-shaped time-driven siblings of one parent → one *stagger* row (median delta as the stagger value). Scroll-driven clips are **excluded** from the stagger heuristic (independent scroll reveals are not a stagger). Groups of 1 degrade to singles; dedup by id. `applyStaggerDelays(members, ms)` re-spaces from the earliest member.
3. **`normalizeMotionClip` preserves `group`** (motion-ir.js).
4. **MotionPanel renders grouped rows** — count badge, expand chevron revealing members, click selects the representative (lowest delay). **Stagger field** re-spaces the whole group as ONE undo group (`applyStagger` → `timing.delay` patches via `applyNewPatches`).

**New verified finding (probe `probe-gsap-timeline-delay.mjs`, real GSAP 3.15 — do not re-litigate):**
- `tween.delay(v)` **repositions root-level tweens** (globalTimeline, smoothChildTiming=true) — startTime moves. It does **NOT** reposition a timeline child: the reported `delay()` changes but `startTime()` and the render never move — a silent no-op that would read back as success. Therefore the Stagger field is **gated**: hidden when any member is a timeline child (`group.timelineId`) or the group rides scroll. Same trap applies to the pre-existing Timing→Delay field for timeline children (NOT yet gated there — candidate for Phase 0 legibility work).
- The blur-commit trap: the displayed stagger is a *median*, not an identity — the field only commits when the value actually changed.

**Adversarial review (cross-model, synthesized):** Claude agent full pass (6 findings) + Codex/Sol effort-max on a scoped bundle (5 findings; NB the whole-tree `--mode diff` run failed at 53MB input cap — untracked `Clone/`, `.firecrawl/` etc. — always bundle-scope reviews in this repo, and the 600s default timeout needed `--timeout 1500`). Fixed from the synthesis, all TDD-covered: (a) stagger control gated off timeline children + scroll groups [both models, probe-confirmed]; (b) untouched-blur must not commit [Claude]; (c) scroll-driven clips excluded from the stagger heuristic [both]; (d) `staggerOf` returns **null** for non-uniform delays instead of fabricating a median (field renders empty) [Codex]; (e) repeated `targetId` disqualifies a stagger bucket (two animations on one element ≠ stagger) [Codex]; (f) `clipGroupMeta` fully try/catch'd [both]; (g) timeline group ids seeded from authored id [Claude]. Refuted with evidence: Codex's "Field defaultValue goes stale" (the input `key` includes the defaultValue — remounts). Known-and-accepted residuals: **motion id seed collision** (`el:keyframeName` without index; pre-existing, fix belongs to an id-scheme pass), narrow double-commit undo race shared by every inspector field, split-root grouping merges entrance+exit on the same text root into one row (coarse but honest — members visible on expand).

**Live validation:** `validate-motion-groups.mjs` — on farmminerals, a `gsap_split_word` target's 3 flat clips (all timeline-linked) collapse to 1 scroll-driven timeline row. Note: real Webflow split text carries class `gsap_split_word`, NOT `.char`/`.word` — the split-root path didn't fire there; the timeline path is the robust catch-all. Consider adding Webflow's `gsap_split_*` classes to SPLIT_TOKEN in a follow-up. Timeline row label shows the machine id (`st_t-3928c…`) — ugly; Phase 2 UI should prettify (type label already says "Timeline").

## 6c. Session 2 addendum — gateway fix: fixture loaded blank (690/690)

User test hit "site is blank in the canvas". Root cause (systematic, verified by screenshots + console capture): **the farmminerals fixture references `/vendor/` (jQuery/Lenis/Splide) and `/media/` root-absolutely, but `rewriteRuntimePaths` only translated `/assets/`** — the libs escaped to the Next origin, got ORB-blocked, the boot script threw (`$ is not defined`) and every reveal stayed at opacity 0. (`Clone/dist` — the unspirit experiment in `.env.local` — only uses `/assets/`, which is why port 3032 looked fine.) Three fixes, all TDD'd:
1. `rewriteRuntimePaths(source, prefixes)` — prefixes now come from the **actual top-level directories of the bundle** (route does `readdir`, cached per root). No guessing.
2. **On-disk URL-encoded names**: clone savers keep `%20` verbatim in filenames; requests arrive decoded → route retries the re-encoded spellings before 404ing (new `route.test.js`).
3. **CSP `connect-src 'none'` → `'self'`** (meta + header): Lottie fetches its JSON at runtime; 'none' blanked every Lottie-backed background. 'self' pins fetch to the gateway origin; external hosts stay blocked. Residual accepted: clone JS could probe other same-origin API paths — sandboxed opaque origin sends no cookies, so authed routes 401; revisit if the editor ever runs against prod bundles.
Verified end-to-end: port 3030 + Unspirit fixture renders fully (hero, green gradient, 3D frame animation).

## 6d. Session 3 (2026-07-19) — 🔴 list closed: one scroll ruler, draggable strips, fragment collapse (705/705)

All TDD'd, live-validated on the Unspirit fixture (screenshots in session scratchpad). The §4b known-broken list is DONE:

1. **Canvas nests under labels** — property tracks render inside each element's canvas group (`timelineCanvasGroup` mirrors `timelineLayerGroup`); `data-element-row`/`data-track-row` attrs anchor the layout tests.
2. **ONE page-scroll ruler (§3b shipped)** — bridge emits `page {scrollY, viewportHeight, scrollHeight, maxScroll}` + per-row `scrollStart/scrollEnd` (live ScrollTrigger px = ground truth; time rows = reveal point, `scrollEnd:null` → nominal 1.4% strip). Ruler ticks in px; playhead = page scroll; **scrubber drives the site** (new `scroll-to` command; optimistic host update, bridge confirms via debounced emit). Ruler stays alive in dead zones (gated on `page`, NOT on rows — vanishing scrubber trap). Fallback: without page metrics the old time ruler runs (tests, boot).
3. **Strips are draggable (§3b's highest-priority item)** — edge handles on the active scroll strip; drag preview local; release → `scroll.start`/`scroll.end` motion patches. **Writeback probe-verified** (`probe-scrolltrigger-range.mjs`, real GSAP 3.15: numeric `st.vars.start/end` + `refresh()` retargets exactly — progress 0.5 at midpoint). Live instance required; config-only triggers throw → `patch-rejected`.
4. **Viewport rows collapse split fragments** — `splitFragmentHost()` attributes animated fragments to their text root structurally (split-classed, child-of-split-classed, or short-text-among-short-siblings; ≤8 climbs; `childElementCount>8` never serialized). Real Webflow shapes covered: `gsap_split_word*` masks AND completely unnamed letter divs (farmminerals has 345). **Live: hundreds of per-letter rows → ~5 legible text-block rows.** `elementLabel` falls back to first meaningful class before bare tag.

**Cross-model review synthesized** (Claude agent full pass — 6 findings; Codex/Sol effort-max on scoped bundle — 5 findings, strong overlap). Fixed, all TDD'd: (a) HIGH [both] — fragment climb now STOPS at text roots even when `[text-split]` sits ON the heading (was fusing title+subtitle into one row); also fixes nav `<a>`/`<li>` merging (TEXT_BLOCK check); (b) [both, "critical" for Codex] strip-edit undo `before` comes from the ACTIVE motion's own resolved range via pure `buildStripEditPatches()` (row envelope ≠ active tween when an element has several scroll tweens); (c) [Claude] host now handles `patch-rejected`: phantom patch removed from history (`removeRejectedPatch`) + visible error toast (was silent loss + failing replay on reload); (d) [Claude] offscreen selection no longer plots time-math keyframes on the pixel ruler (standalone fallback gated to time-ruler mode); (e) [both] viewport inspection rewritten as ONE pass over both engines (`buildMotionSummaryIndex`) — was O(members × tweens) ≈ 10⁵ tween visits per 120ms emit on farmminerals; (f) [Codex] visibility is now decided by the HOST, not the fragment (offscreen letters of a visible headline stay counted); (g) [Codex] `scrollEditable` flag — horizontal/custom-scroller triggers are shown but never strip-editable (their pixels live on another axis). **Refuted with evidence:** Codex's "writeback never calls refresh" — the shared trailing `record.scrollTrigger?.refresh?.()` covers every GSAP patch (asserted by the bridge test, and the live probe validated the retarget end-to-end; the review bundle had cut that line off).

**Known residuals (documented, deliberate):**
- Time-driven clips on the scroll axis get a 1.4% nominal strip → their keyframe editing is impractical there; §3b's drill-in local timeline (or a dedicated lane) is the real answer — Phase 2 work.
- Tiny standalone texts (an animated counter "0", an accent word "a") are legitimately their own rows but the label lacks context; consider parent-context labels later.
- `count` counts one entry per member×tween sweep (a 30-target stagger tween reads as 30); label/kind degrade if a merged host has >24 direct children (`directText` cap).
- Multi-scroll-tween elements: the strip envelope spans ALL the element's tweens while edits target the active one; after edit the strip redraws from runtime truth (`inspect-viewport`), which can look like a snap — a per-motion strip (not per-element) is the eventual fix.
- `motionSummaryFor` is O(members × tweens) per debounced scroll emit; fine on farmminerals, index it single-pass if a heavy page stutters.

## 6e. Session 3 (cont.) — Phases 3, 4, 0 and 5 SHIPPED (721/721)

**Phase 3 — adapter tracks editable.**
- §5's open `invalidate()` risk is CLOSED, probe-first: `probe-invalidate-rebase.mjs` (GSAP 3.15) proved `gsap.to` parked mid-tween re-records its implicit start from the PARKED value (10→55) on vars-edit + invalidate; `fromTo` is immune (explicit from). Fix: `invalidatePreservingStart()` renders `progress(0,true)` before invalidating, restores after. **Adjudication probe** (`probe-progress-repeat.mjs`) settled a Claude-vs-Codex disagreement with real execution: repeat/yoyo tweens and exact cycle boundaries survive the dance exactly (totalTime/progress preserved, render correct) — Codex's "cycle corruption" claim refuted.
- Adapter (GSAP) keyframes are now selectable + value-editable (new **Keyframe value** field in the timeline header, both engines) + easing via the Easing section. Move/duplicate/delete stay blocked WITH explanations (delete was a probe-understood no-op: removing `startAt` re-records the same value; a `to()` tween's end deletion is undefined). `gsap.from()` tweens are keyframe-READ-ONLY (`capabilities.keyframes:false` + writeback throws) — vars hold the FROM, an "end" edit would retarget the start.

**Phase 4 — media driver.** A scroll-SCRUBBED `<video>` (ScrollTrigger + `currentTime` in vars) classifies as `driver: media`; a plain `currentTime` tween stays `time` (it is a timed seek). Media clips get scroll-clip UI semantics: no transport (scroll hint instead), draggable range strip, Media option in the Trigger select. Hand-rolled scroll-listener scrub detection remains future work (needs a heuristic); canvas image-sequences stay code-tier by construction.

**Phase 0 — capability legibility.** Editability badges carry full explanations (`EDITABILITY_EXPLAINED`); every blocked keyframe control says WHY in its title.

**Phase 5 — Framer exporter (import spike pending — needs the Framer app).** New pure `lib/motion-editor/framer-export.js`: `buildFramerExport({label, tag, clips})` → `{code, report}` — a self-contained React + Framer Motion component with the **TRANSLATION REPORT as its header comment**. Time clips → `initial/animate/transition` (multi-keyframe → value arrays + times); scroll clips → `useScroll` + `useTransform` over the resolved trigger pixels; media clips → `currentTime` bound via `useMotionValueEvent` + sibling tracks as style bindings. Deterministic ease/property maps; `xPercent/yPercent` keep their unit (`x: '-50%'`, never px); units survive (`'50%'` stays a string); pin/snap/repeatDelay/reverse/frame-easing/collisions all produce report entries, never silence. Hardened after cross-model review: unique const names (x+xPercent collision was a SyntaxError), identifiers never start with digits, custom-property keys quoted, report block injection-proof (`*/` neutralized). **Export button** in the topbar (selection-gated) downloads the `.jsx`. ⚠️ Per decision §3.5 the Framer import path still needs the human spike — paste the exported component into a Framer code component and see what sticks.

**Cross-model review (Claude 10 findings, Codex 5, synthesized):** fixed everything actionable above plus media gating downstream and timed-seek misclassification [both models]; refuted with probes/evidence: Codex's repeat-corruption (probe) and Claude's already-covered items. Residuals accepted & documented: MotionPanel's top transport is not driver-gated (pre-existing), multi-clip shared transition remains a report-level degradation (per-property transitions = future emitter work), keyframe-value field keeps typed value if the bridge rejects (patchError toast covers it).

## 7. Working agreement

- **Adversarial review is on.** `codex-adversary` recruits Codex/GPT-5.6 Sol automatically on substantive review passes. Keep Codex at `--effort max` (user's precaution); when the budget hook shows **Sol** low, remind the user they can downgrade. See memory `feedback_codex_effort_downgrade`.
- Sol caught the clearProps bug that a Claude-only review missed — **run the cross-model pass on anything touching the live page**.
- Correlated-model caveat: two LLMs agreeing is not verification. Every finding here was confirmed by running code. Keep that bar.
- **Route wide repo reading to `--mode scout`** when the Claude budget is tight; it reads the file and returns a compressed map for a fraction of the tokens.
