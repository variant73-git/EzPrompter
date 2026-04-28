# Google DESIGN.md Spec — Research Memo
**Date:** 2026-04-22  
**Author:** Research agent  
**Audience:** RepixBridge engineering team  
**Confidence markers:** ✅ confirmed (primary source) / ⚡ strong inference / 💭 weak inference

---

## Part 1 — The Google Spec (What It IS)

### Origin & Status
Published 2026-04-21 by the Google Stitch team (Cassia Xu, blog post). Version: **`alpha`**. Repo: `google-labs-code/design.md` (Apache-2.0). CLI: `@google/design.md` on npm. Toolchain is Node/TypeScript (uses Bun for builds, Turbo for monorepo). ✅

### File Structure
Two mandatory layers in one `.md` file:

1. **YAML front matter** — machine-readable tokens, fenced by `---`. Contains the normative values.
2. **Markdown body** — human-readable prose in `##` sections. Provides rationale for how to apply tokens.

Spec quote: *"The tokens are the normative values; the prose provides context for how to apply them."* ✅

### Required vs Optional Sections
No section is strictly "required" — the spec says sections *"can be omitted if they're not relevant,"* but **those present must appear in canonical order**: ✅

| Order | Section name | Aliases |
|---|---|---|
| 1 | Overview | Brand & Style |
| 2 | Colors | |
| 3 | Typography | |
| 4 | Layout | Layout & Spacing |
| 5 | Elevation & Depth | Elevation |
| 6 | Shapes | |
| 7 | Components | |
| 8 | Do's and Don'ts | |

The linter enforces `section-order` as a **warning** (not error). Duplicate section headings are an **error** that rejects the file.

### Token Schema
YAML front matter fields (all optional except `name`):

```yaml
version: "alpha"           # optional
name: <string>             # the only truly required field
description: <string>      # optional
colors:
  <token-name>: "#hex"     # must start with #, sRGB only
typography:
  <token-name>:
    fontFamily, fontSize, fontWeight, lineHeight,
    letterSpacing, fontFeature, fontVariation
rounded:
  <scale-level>: <Dimension>
spacing:
  <scale-level>: <Dimension | number>
components:
  <component-name>:
    backgroundColor, textColor, typography, rounded,
    padding, size, height, width
```

**Token references** use `{path.to.token}` syntax (W3C Design Token Format). Cross-section refs allowed in `components`. ✅

**No semantic "roles" baked into the schema** — the spec recommends `primary`, `secondary`, `tertiary`, `neutral` as non-normative guidance, but any string key is valid. Role descriptions live in prose, not in machine tokens. ✅

### Components Section — Status
Spec note verbatim: *"Note: The components specification is actively evolving. The current structure provides intentional flexibility for domain-specific component definitions while the spec matures."* So component schema is deliberately loose — only those 8 property names are formalized; everything else accepted with a warning. ✅

### CLI Validator — What It Checks
Language: **TypeScript/Node** (Bun runtime for development). Published as `@google/design.md` on npm. ✅

Four commands:
- `lint` — validates structure + 7 rules (see below), outputs JSON
- `diff` — token-level regression detection between two files
- `export` — converts tokens to `tailwind` theme JSON or W3C `dtcg` tokens.json
- `spec` — prints the spec (useful for injecting into agent prompts)

**Seven linting rules:** ✅

| Rule | Severity | Checks |
|---|---|---|
| `broken-ref` | error | Unresolved `{path.token}` references |
| `missing-primary` | warning | No `colors.primary` defined |
| `contrast-ratio` | warning | Component bg/text pairs below WCAG AA (4.5:1) |
| `orphaned-tokens` | warning | Color tokens unreferenced by any component |
| `token-summary` | info | Count of tokens per section |
| `missing-sections` | info | Optional sections absent when others exist |
| `missing-typography` | warning | Colors defined but no typography tokens |
| `section-order` | warning | Sections out of canonical order |

### Extensibility
Unknown sections are preserved without error — spec says *"Unknown section heading: Preserve; do not error."* So custom sections (`## Source Implementation Cues`, `## Responsive Behavior`, etc.) are valid by spec. Unknown component properties are accepted with a warning. Unknown color or typography token names are accepted if values are valid. This is the spec's extensibility mechanism — no plugin system, just tolerance. ✅

---

## Part 2 — Community Implementations

### Sleek-UI Design Extractor (`luongnv89/sleek-ui`)
A Claude Code skill (SKILL.md-based, ~12KB). Not a DESIGN.md spec implementation — uses its own `design.v1.json` schema (shadcn HSL format, not hex). Inputs: screenshot path or live URL (via a `/browse` sub-skill). Produces two artifacts: a JSON file conforming to `design.v1.json` + a ready-to-paste agent prompt. When run inside the sleek-ui repo, it offers to add the design to a catalog via PR.

Key differences from the Google spec: uses HSL (not hex), uses JSON (not YAML+Markdown), adds `light`/`dark` token pairs, includes `agentInstructions.steps`, references shadcn CSS custom properties. This is a **competing format**, not a compliant implementation. ✅

### getdesign.md
A curated gallery of DESIGN.md files for popular brands — 69 files as of 2026-04-22 (Claude, Stripe, Figma, Notion, Vercel, Apple, Airbnb, etc.). Organized into 9 categories: AI/LLM, Developer Tools, Backend/DevOps, Productivity, Design/Creative, Fintech, E-commerce, Media, Automotive. Provides a "Request DESIGN.md" submission flow. This is a **directory + marketplace** for ready-made DESIGN.md files, not tooling. ✅

### designdotmd.directory
Landing page only at time of research — no indexed listings returned from the HTML. Appears to be a very early-stage site or parked domain. Possibly the same project as getdesign.md or a competing directory. ⚡ (could not extract content)

---

## Part 3 — Comparison vs Our `generateDesignMD()`

### Sections We Have vs Spec

| Section | Spec | Our extractor.js | Notes |
|---|---|---|---|
| Overview | ✅ (§1) | ✅ `## Overview` | We auto-generate a "Tone" sentence + layout signals — spec wants holistic brand prose. Close but different emphasis. |
| Colors | ✅ (§2) | ✅ `## Colors` | We emit semantic roles (surface-base, primary-text, accent-N), hex values, and color descriptors ("off-white beige"). Spec uses named tokens + prose per-color. Compatible format but we don't emit YAML front matter. |
| Typography | ✅ (§3) | ✅ `## Typography` | We emit Tailwind class annotations (text-5xl, font-bold). Spec wants px/em/rem Dimension values. Mismatch — Tailwind classes are not valid Dimension tokens. |
| Layout | ✅ (§4, "Layout & Spacing") | ✅ `## Layout & Grid` | Heading alias matches. Our content is more structural (sticky/sidebars/grid-paper). |
| Elevation & Depth | ✅ (§5) | ✅ `## Elevation` | We detect borders vs shadows. Spec wants explicit blur/spread rules. Adequate. |
| Shapes | ✅ (§6) | ✅ `## Graphic Elements & Shapes` | Our name differs. Section order: ours puts Shapes at §8, Spec at §6. `section-order` warning would fire. |
| Components | ✅ (§7) | ✅ `## Components` | We emit TW class strings per variant + hover correlations. Spec wants YAML tokens with `backgroundColor`, `textColor`, etc. Major mismatch — our prose-only output doesn't populate the YAML component tokens. |
| Do's and Don'ts | ✅ (§8) | ✅ `## Do's and Don'ts` | Auto-generated from pattern detection. Good. |
| YAML front matter | ✅ required for token interop | ✗ **MISSING** | We produce only Markdown body. No YAML front matter at all. This is the biggest gap. |
| Source Implementation Cues | ✗ (not in spec, custom) | ✅ `## Source Implementation Cues` | Custom extension. Spec tolerates it. High value for our Mode E prompt. Keep. |
| Responsive Behavior | ✗ (not in spec, custom) | ✅ `## Responsive Behavior` | Custom extension. Keep. |
| CSS Custom Properties | ✗ (not in spec, custom) | ✅ `## CSS Custom Properties` | Custom extension. Keep. |
| Assets | ✗ (not in spec, custom) | ✅ `## Assets` | Custom extension. Keep. |
| Animations & Interactions | ✗ (not in spec, custom) | ✅ `## Animations & Interactions` | Custom extension. Keep. |

### Gaps Summary

1. **No YAML front matter** — Our biggest conformance gap. We produce 0 machine-readable tokens. The spec's YAML block is what enables `lint`, `diff`, `export`, and downstream Stitch interop.
2. **Typography uses Tailwind classes, not Dimension tokens** — `text-5xl` is not parseable by the CLI linter. Should be `48px`.
3. **Section order** — `Graphic Elements & Shapes` (our §8 effectively) should appear before `Components` per spec (§6 Shapes, §7 Components).
4. **Color format in prose** — Our Colors section omits the `role: prose explanation` pattern the spec recommends. We emit hex + descriptor but not the inline semantic narrative.
5. **Components not tokenized** — We emit TW prose, not YAML component tokens with `{colors.primary}` references. This means our output can't be linted for WCAG contrast or token orphans.

### Spec-Required Stuff We're Missing vs Actually Fine

- `missing-primary` warning: we likely emit `primary` in our color semantic roles, so probably fine.
- `broken-ref` errors: we have no YAML so no broken refs — but also no refs at all.
- `contrast-ratio` warnings: not applicable until we emit component tokens.

---

## Part 4 — Strategic Implications

- **Adopt only the YAML layer now, not the whole spec.** The spec is alpha and the components schema is explicitly labeled WIP. Adding a YAML front matter block to our existing Markdown output is low risk and high reward — it unlocks `npx @google/design.md lint` for validation and `export --format tailwind` for Tailwind theme generation. Our custom sections (Source Implementation Cues, Responsive Behavior, CSS Custom Properties, Assets) are preserved by the spec's tolerance rules. Zero Aura-compatibility cost — Aura reads markdown prose, not YAML tokens.

- **Stitch interop is the strategic upside.** Google Stitch (the app behind this spec) reads DESIGN.md to generate UI. If we emit spec-compliant files, a RepixBridge user who exports a DESIGN.md from any live site could feed it directly into Stitch, Cursor, or any other agent that reads `@google/design.md`. This is a real ecosystem distribution channel.

- **CLI validator is a free QA gate for our extractor.** Running `npx @google/design.md lint` in the Mode E pipeline (before using the DESIGN.md in prompts) would catch broken refs and missing contrast — objective quality signal we don't have today. Near-zero implementation cost.

- **Nobody else is emitting spec-compliant DESIGN.md from live sites.** getdesign.md has 69 hand-curated files; sleek-ui uses a different JSON format; Aura's internal format predates the spec. RepixBridge is positioned to be the first automated spec-compliant extractor. This is a competitive differentiation angle if executed fast (the ecosystem is days old).

- **Tailwind export closes the Mode E2 gap.** Mode E2 uses Tailwind CDN. If we emit YAML tokens and run `export --format tailwind`, we get a `tailwind.theme.json` for free that can be injected into Mode E2 prompts — stronger type/color fidelity than the current Tailwind annotation strings.

---

## Part 5 — Concrete Incorporation Paths (Ranked by Effort × Value)

### Path A — Add YAML Front Matter to `generateDesignMD()` (HIGH value, LOW effort)
**File:** `overlay/extractor.js`, function `generateDesignMD()` (line ~903)  
**LOC:** ~80–100 lines added at top of the function  
**What to do:** Before the Markdown body, emit a `---` YAML block with:
- `version: "alpha"`, `name` (derived from `document.title` or hostname)
- `colors` map (reuse existing classified hex tokens, use semantic names as keys)
- `typography` map (convert our Tailwind-annotated values back to px Dimension format — we already have the raw `px` values before the `fontSizeToTw()` call)
- `rounded` map (from our radius extraction)
- `spacing` map (from our section padding / gap values)
- `components` map (minimal: button-primary from our most-common button detection)
**Impact:** Enables `lint`, `diff`, `export` CLI commands. Unlocks Stitch interop. Fixes `missing-typography`, `missing-primary` linter warnings.  
**Risk:** Low. Existing Markdown body is unchanged. Our custom sections remain. The `---` delimiter must appear before any prose — restructure the md array to prepend the YAML block.

### Path B — Fix Section Order (HIGH value, TRIVIAL effort)
**File:** `overlay/extractor.js`, `generateDesignMD()` section push order  
**LOC:** ~5 lines (reorder push calls)  
**What to do:** Move `## Graphic Elements & Shapes` push to before `## Components` push. Verify: Overview → Colors → Typography → Layout → Elevation → Shapes → Components → Do's and Don'ts.  
**Impact:** Eliminates `section-order` linter warning.  
**Risk:** None.

### Path C — Fix Typography Token Format (MEDIUM value, LOW effort)
**File:** `overlay/extractor.js`, typography extraction section (~line 1080)  
**LOC:** ~20 lines  
**What to do:** In the YAML front matter block (from Path A), emit `fontSize: 48px` (Dimension format) not `text-5xl` (Tailwind class). The raw px value is already computed before `fontSizeToTw()` — just use it directly in the YAML. Keep Tailwind annotations in the Markdown prose body for the LLM.  
**Impact:** Fixes linter's typography token parsing. Enables `export --format tailwind` to produce correct sizes.  
**Risk:** Low — YAML and prose serve different consumers.

### Path D — Run `npx @google/design.md lint` in Mode E Pipeline (MEDIUM value, MEDIUM effort)
**File:** `editor/mode-e.js` and/or `background.js`  
**LOC:** ~30 lines  
**What to do:** After `generateDesignMD()` call, invoke the lint CLI via a fetch to a small relay endpoint in `web/` (can't run Node subprocess from a Chrome extension), OR inject the lint as a validation step in the extractor itself (reimplement the 7 rules in JS — broken-ref detection is ~20 lines).  
**Impact:** Objective quality gate for each generated DESIGN.md before it enters the LLM prompt.  
**Risk:** Medium — the relay approach requires a web/ endpoint. The in-extension JS reimplementation avoids the dependency but requires maintenance.

### Path E — Add DESIGN.md Export Button to Inspector UI (MEDIUM value, MEDIUM effort)
**File:** `editor/editor.js`, Logo dropdown menu section  
**LOC:** ~30 lines  
**What to do:** Add "Export DESIGN.md" to the Logo dropdown. On click: call `window.__rbExtractor.generateDesignMD()`, create a Blob, trigger download. Users can feed the file to Stitch, Cursor, or the CLI linter.  
**Impact:** Creates a distribution moment — RepixBridge as the spec's reference extractor. Users share these files.  
**Risk:** Low. Uses existing extractor function. No new dependencies.

---

## Appendix — Raw Source Links

- Spec repo: https://github.com/google-labs-code/design.md
- Full spec: https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md
- Example (Atmospheric Glass): https://raw.githubusercontent.com/google-labs-code/design.md/main/examples/atmospheric-glass/DESIGN.md
- Blog: https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/
- Gallery: https://getdesign.md/
- Sleek-UI skill: https://github.com/luongnv89/sleek-ui/tree/main/.agents/skills/design-extractor
