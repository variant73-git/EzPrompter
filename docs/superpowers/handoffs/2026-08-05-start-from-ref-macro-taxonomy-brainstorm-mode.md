# Handoff — Start from a Ref macro taxonomy + real Brainstorm Mode (2026-08-05)

## Outcome

The review flow now treats human input as lightweight calibration instead of exhaustive annotation:

- `keep / maybe / pass` is sufficient to save a review;
- the 1–5 taste score and detailed dimensions are optional;
- fixed per-reference `chassis / donor` roles are no longer assigned by the reviewer;
- product/site type and style are separate tag axes;
- style is capped at two tags;
- the references supplied on 2026-08-05 have editable tag presets;
- Brainstorm Mode now reaches the agent instead of only changing the composer label;
- the shadow planner uses one contextual scale owner and bounded section sources, not permanent site roles.

The original 38-reference calibration set was already applied to the shared catalog under its separately approved exact-hash gate. The later AgentFlow addition and private-reference schema remain local/code-only at this checkpoint. No generation, deployment, or push was performed.

## Supplied macro design priorities

These are now explicit defaults for sparse landing/brand prompts:

1. Large media with well-anchored text.
2. Controlled asymmetry.
3. Rhythm that alternates density and breathing room.
4. Protagonist typography without dependence on effects.
5. Mandatory mobile stability.

They are weak search and composition priorities, not universal style rules.

## Reference decomposition contract

For Start from a Ref / inspiration, analyze each section as two layers:

- **Reusable structure:** topology and reading order, alignment and anchoring, media-to-copy proportions, scroll axis and pinning, density rhythm, responsive behavior.
- **Replaceable treatment:** colors, decorative overlays, background blocks, copy, imagery, logos, item count, typeface identity, and semantically specific motion.

For one reference, type and media scale may vary by at most 15%. With two or three references, one contextual reference owns page-wide scale and cadence. Identity is art-directed from the brief after the structure is chosen; it is not copied from the bank.

`fancy.design` is the calibration example: its media-backed hero, anchored copy relationship, step-scroll, and horizontal feature sequence are structural candidates. The black block, logo-strip treatment, assets, colors, and item counts are variables.

## Text-block repertoire seeded from the supplied screenshots

1. Centered eyebrow + display title + supporting copy + action.
2. Centered editorial testimonial with display serif + attribution.
3. Viewport-filling display over media + support copy anchored near the viewport base.
4. Offset left conversion block with eyebrow + two-line title + support + dual actions.
5. Section lead + separate action + repeated feature columns.

Exact font size, line height, letter spacing, weight, measure, and offsets must come from live computed values when available. Screenshot appearance alone is not sufficient evidence for an “exact” value.

## Reference families supplied by Adilson

- Soft tech: Biograph, Bynar, Wonder, Reflect, Stripe, Retool, Neverhack, LangChain, Mosa AI, AssetX, Brand.ai, Squarespace, io.net, Paperclip.
- Techier / more animated: Lambda, Sanity, Cantor8.
- Playful: Hartmann Capital, MindMarket (excluding the highly crafted opening), Mammoth Murals.
- Playful + tech/corporate: Litebox.
- Fashion / agency / portfolio: Outfit, Supersolid, Artefakt, Mikki Sindhunata.
- Fashion / portfolio + tech/corporate: Monolog, Studio Dialect.

The presets are starting vocabulary and remain editable. They do not decide selection by themselves.

## User-calibration ingestion rule

Every reference URL supplied directly by Adilson for taste calibration should be added incrementally to the reference bank. This is a continuing small-batch process, not a requirement to classify the whole catalog upfront.

The first shared user-calibration set contains 38 references: the 37 sites supplied earlier on 2026-08-05 plus Ideogram. The local manifest now contains 39 after adding AgentFlow. The completed 38-reference shared import:

- preserved 8 sites that already existed through Landbook, Codrops, Minimal Gallery, or Site of Sites;
- inserted 30 missing sites at ranks 1,920–1,949;
- attached one `user-calibration` provenance appearance to all 38 sites;
- preserved meaningful submitted paths such as Apollo `/pt`, Farm Minerals `/products/croptab`, and Palantir `/platforms/foundry`;
- added Ideogram as `saas + tool`, `soft-tech + minimal`, with `technical + bold + approachable` as editable preset vocabulary.

Existing site metadata is preserved when a submitted URL already exists. User calibration adds provenance and editable presets; it does not overwrite metadata from prior sources.

## Addendum — private web-builder templates and AgentFlow

AgentFlow (`https://agentflow.framer.ai`) is locally integrated as a calibration reference for digital-product, SaaS, fintech, and HR-tech contexts:

- product types: `landing-page`, `saas`, `tool`;
- styles: `soft-tech`, `corporate`;
- brand attributes: `technical`, `corporate`, `approachable`;
- template platform: `framer`;
- visibility: private by default.

Template provenance from Framer Marketplace, Webflow templates, Aura, and Neuform now defaults to private during central ingestion. An explicit privacy value can override the automatic default. Private references:

- never appear in the ordinary Browse catalog;
- never enter ordinary user planning or expose their exact provenance;
- are visible to an authorized curator in the internal `Curate` view;
- can be reviewed, tagged, assigned `keep / maybe / pass`, and toggled private/public there.

Production curator access is controlled by `REFERENCE_CURATOR_EMAILS`. Local development permits the curator surface for inspection. The additive database fields are `is_private`, `privacy_reason`, and `template_platform`.

## Addendum — brand attributes and componentized ingredients

Brand personality is now a separate axis from business category and visual style. The bounded vocabulary is:

- playful, extroverted, sober, neutral, corporate, authoritative;
- approachable, bold, technical, premium, rebellious, warm.

The Brainstorm Mode must infer these from positioning, audience, price point, voice, cultural cues, and supplied assets. When evidence is insufficient, it asks one high-information question with concrete alternatives. It must never assume that a restaurant is playful or a fintech is sober.

The composition formula is now explicit:

`structure + text composition/alignment + palette + typography + motion`

Each ingredient is selected independently. A reference can contribute one ingredient without controlling the rest of the identity.

## Visual Brainstorm contract

Visual design questions are no longer presented as text-only lists:

- structure and alignment use simple miniature wireframes;
- typography uses compact character specimens;
- palette uses three or four color swatches;
- every option carries two deliberately short lines: what it suits and what it conveys;
- each question offers two or three contrasting choices and the selected card returns a natural-language answer to the conversation;
- non-visual questions such as audience, content, constraints, and approval remain normal chat questions.

The assistant emits a bounded persisted payload inside its message. The renderer accepts only known layout/type enums and valid six-digit hex colors, hides partial payloads during streaming, and never accepts agent-authored HTML or CSS. The cards reappear from chat history. Their grid responds to the panel width: three columns when space permits and one column in a narrow dock, with no horizontal overflow.

Nine additional calibration references were captured:

- Playful consumer identity: Buck's Sauce.
- Sober/neutral with strong layout and measured motion: Quantum Body and Farm Minerals CropTab.
- Tech-corporate: Palantir Foundry, REF Digital, Aptos, and Apollo.
- Cross-industry playfulness: Applace.
- Playfulness applied to fintech infrastructure: Anchor.

Static ingredient presets were recorded only where the screenshot supplied enough evidence. REF Digital returned a uniform loading surface in two timed captures, so its user-supplied product/style/brand calibration was retained but no visual-ingredient preset was invented.

## Changed files

- `packages/web-shell/lib/reference-design-taxonomy.js`
- `packages/web-shell/lib/reference-preferences.js`
- `packages/web-shell/components/ReferenceReviewPanel.jsx`
- `packages/web-shell/lib/reference-planner.js`
- `packages/web-shell/components/ReferencePlanner.jsx`
- `packages/web-shell/lib/design/house-style.js`
- `packages/web-shell/components/PromptDock.jsx`
- `packages/web-shell/components/chat/BrainstormChoiceCards.jsx`
- `packages/web-shell/components/chat/ChatBubble.jsx`
- `packages/web-shell/components/chat/ChatPanel.jsx`
- `packages/web-shell/components/chat/chat.css`
- `packages/web-shell/app/api/chat/route.js`
- `packages/web-shell/lib/agent/prompts.js`
- `packages/web-shell/lib/brainstorm-visuals.js`
- `packages/web-shell/lib/reference-user-calibration.js`
- `packages/web-shell/lib/reference-privacy.js`
- `packages/web-shell/app/api/references/[id]/privacy/route.js`
- `packages/web-shell/app/api/references/route.js`
- `packages/web-shell/app/api/references/plan/route.js`
- `packages/web-shell/app/canvas/library/[section]/page.jsx`
- `packages/web-shell/components/ReferenceLibrary.jsx`
- `packages/web-shell/lib/reference-bank-store.js`
- `packages/web-shell/lib/reference-bank-ingest.js`
- `packages/web-shell/lib/reference-bank-promotion.js`
- `packages/web-shell/scripts/reference-bank/ingest-user-calibration.mjs`
- `packages/web-shell/schema.sql`
- `packages/web-shell/migrations/2026-08-05-reference-plan-v3.sql`
- `packages/web-shell/migrations/2026-08-05-reference-privacy.sql`
- focused tests for all contracts above.

## Evidence and validation

- The first 28 supplied URLs were captured as current static evidence under ignored `.firecrawl/macro-design-2026-08-05/` (markdown, full-page screenshot, and four local contact sheets).
- The nine brand-attribute references were captured under ignored `.firecrawl/brand-ingredients-2026-08-05/`.
- Focused visual-protocol validation: 3 test files, 12 tests passed.
- Full suite at the final checkpoint: 143 test files passed, 1 skipped; 994 tests passed, 4 skipped.
- Browser inspection: three columns at 720px available width; one column at 326px; zero horizontal overflow at both widths; click and selected state confirmed.
- User-calibration import: isolated and shared preflights each planned 30 site inserts + 38 appearances + 1 aggregator; both applies reached 1,949 sites / 2,057 appearances / 7 aggregators.
- User-calibration post-apply preflights were zero-write: 38 sites preserved, 38 appearances no-op, and the aggregator preserved. Shared catalog ranks remain unique through 1,949.
- Frozen catalog hash: `09bb1927fe20db1ff421c5036c7f156c56dd210ece13d51e6ff9fe22f9abf570`; authorized shared plan hash: `2b398ce6026b59d99c91846a6342c952e1956762fb3210b9a2c6ca8804920d84`.
- Catalog smoke query: Ideogram has both `landbook` and `user-calibration` provenance; all 38 submitted references have exactly one user-calibration appearance.
- AgentFlow isolated apply reached 1,950 sites / 2,058 appearances and stored it as private with `webbuilder-template` / `framer` metadata; public lookup returned zero matches and internal lookup returned one.
- AgentFlow isolated preflight planned exactly 1 site insert + 1 appearance insert, with zero updates; catalog hash `87b4e6f7fb3cb4d2f0675f6a3abe0de549a1f5204df184468a10ef41bb41412b`, plan hash `258dd399502263010ad955327a29cd22f1a392200ef6d59c408f048f57eacd86`.
- Privacy/calibration focused validation: 12 test files, 58 tests passed.
- DaSelva's current post-generation validator passed again: `validate-gate-c-w0.mjs`. The older V2 reference-bundle validator is a pre-Gate-C guard and now correctly refuses the existing output root; it is not the current W0 validator.
- Production build: passed (`next build`, 43 static pages generated).

## Hard stops and next gate

1. Do not apply `2026-08-05-reference-plan-v3.sql` or `2026-08-05-reference-privacy.sql` to a shared database without explicit approval. The AgentFlow addition cannot be applied safely until the privacy migration has its own authorization.
2. Do not treat preset tags as ground truth or selection scores.
3. The next useful implementation slice is a deterministic structural analyzer: section map, alignment/anchor map, density, measured typography, responsive persistence, and semantic-motion portability.
4. A later separate calibration pass should use `keep / maybe / pass` for fonts.
5. In the next relevant handoff, ask Adilson for any new macro design patterns. Supplied patterns are listed above; pending patterns remain open-ended.
6. When Adilson supplies another calibration URL, capture bounded metadata, append it to the frozen user-calibration manifest, run isolated preflight/apply plus zero-write proof, then use an exact-hash shared preflight/apply only when the request authorizes adding it to the bank.
7. The next shared sequence for AgentFlow is: explicitly authorized privacy migration, read-only exact-hash preflight, separate exact-hash apply approval, then public/private visibility verification.
