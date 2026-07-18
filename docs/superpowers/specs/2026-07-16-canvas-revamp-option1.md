# Uncraft Canvas Revamp and Three-Mode Product Studio

**Status:** implementation specification  
**Date:** 2026-07-16  
**Branch:** `feat/canvas-revamp-option1`  
**Audience:** product design, frontend, editor-core, agent/runtime, and QA  
**Product direction:** one product, one account, one project model, one canvas, and three guided entry modes: Builder, Clone/Recreate, and Style Transplant

## 1. Executive summary

Uncraft should not ask a new user to understand a node graph before they can experience its strongest outcomes. The product must offer a guided studio that makes three high-value jobs immediately legible:

1. **Builder:** turn a description and optional references into a website.
2. **Clone/Recreate:** turn a URL or screenshot into an editable website recreation.
3. **Style Transplant:** apply the visual language of one reference to another website while preserving the chosen structure and content.

Every guided flow ends in a real project and offers `Open in Canvas`. The canvas is not a separate product or an advanced-mode dead end. It is the spatial workspace where the generated result, its references, prompts, design system, assets, versions, and transformations remain visible and editable.

The canvas itself becomes an adaptive shell:

- a static left rail owns `New node`, Assets, and workflow templates;
- the top bar owns project state and selection-specific actions;
- the right inspector only appears when it has meaningful context;
- selecting a website exposes a prominent edit path and `Open in Browser`;
- edit mode uses the existing mature editor-core, restyled to match the Uncraft shell;
- node navigation stays in the minimap instead of consuming a permanent rail destination.

This document specifies the complete target and divides implementation into release-safe increments. The first implementation may mock generation time and AI output, but navigation, state transitions, validation, mode switching, project creation, and canvas handoff must be real and testable.

## 2. Design brief

> We are designing a desktop-first creative product studio and infinite canvas for designers and visually fluent founders. It helps them transform any part of the web into a proprietary website without first learning a graph tool. It should feel precise, quiet, tactile, and inevitable. The user's job is to move from reference or intent to a credible editable result with minimal ambiguity. The main objection is that a powerful canvas will be too complex, too technical, or require excessive setup before producing value. Users should remember that the whole web can become their working material. Constraints: preserve the existing functional canvas and editor-core, use the Uncraft dark Working Table system, keep visible copy in plain English, and never tint website content with the shell theme.

### Physical scene

A designer is working on a 27-inch display in a dim studio, moving between browser references and live website concepts for several hours. The dark warm-charcoal shell reduces glare and keeps the referenced websites, images, and design systems visually dominant.

### Product hook

**The whole web is a template.**

The interface proves this through behavior: URLs, screenshots, images, videos, prompts, code, shaders, and design specifications can be collected, connected, transformed, and opened as editable websites.

## 3. Research summary

The research fallback used Firecrawl because the Refero MCP tools were not available in the session.

- **Queries:** 11
- **Search results reviewed:** 60+
- **Pages deeply extracted:** 15
- **Research focus:** multimode launchers, prompt-first builders, URL cloning, redesign/style transfer, project hubs, and handoff to visual editors

### Observed patterns

1. [v0](https://v0.app/) starts with the concrete question `What do you want to create?`, supports file attachments in the same entry surface, and shows templates without forcing template selection.
2. [Figma Make](https://www.figma.com/make/) frames the journey as `Prototype. Polish. Ship.`, offers prompt starters such as onboarding flows and dashboards, and emphasizes moving between design context and code instead of presenting AI as a separate utility.
3. [UX Pilot Website Cloner](https://uxpilot.ai/website-cloner) presents two source methods at the decision point, `Paste a URL` and `Upload image`, then promises an editable structured result instead of a screenshot-only copy.
4. [Shuffle AI Website Redesign](https://shuffle.dev/ai-website-redesign) combines a URL with a description of the desired direction, compares outputs side-by-side, and makes selection/refinement a distinct step before entering the editor.
5. [Framer AI](https://www.framer.com/ai/) keeps AI generation adjacent to a familiar editor containing Pages, Layers, Assets, viewport controls, and publishing actions. Generation is a route into the editing environment, not a replacement for it.
6. Clone products consistently reduce initial input to a URL or image, while builder products benefit from starter prompts and reference attachments. Combining both in one undifferentiated textarea hides intent and makes validation unclear.

### Steal list

| Source | Tactic | Why it works | Uncraft adaptation |
|---|---|---|---|
| v0 | One direct creation question plus optional templates | Users can start from intent without browsing a library | Builder opens with a large brief field and quiet prompt starters below it |
| Figma Make | Prompt starters are examples, not a blocking category picker | Teaches prompt quality while preserving agency | Each mode gets three mode-specific starters that populate editable input |
| UX Pilot | URL and screenshot are peer source methods | Matches how references actually arrive | Clone uses a visible URL/upload source switch with identical output expectations |
| Shuffle | Compare before committing to an editor | Reduces fear that generation replaces the original | Result state offers Original/Result comparison and a clear `Open in Canvas` handoff |
| Framer | AI sits next to familiar layers/assets/editor concepts | Preserves professional trust after the magic moment | Canvas handoff includes source, result, prompt, design system, and assets as visible nodes |
| Uncraft | Provenance color is repeated through graph furniture | Makes complex chains readable without jargon | Guided mode accent appears only in status and handoff mapping; node colors remain provenance-based |

### What Uncraft should do differently

Most tools end at a generated page or code editor. Uncraft should make the transformation legible. The handoff canvas shows not only the result, but where its layout, style, assets, prompts, and code came from. This is the memorable proof of `the whole web is a template`.

## 4. Product architecture

### 4.1 One product, four surfaces

1. **Home/Projects:** resume work, start a guided creation, browse examples, see credits and account state.
2. **Create Studio:** choose Builder, Clone/Recreate, or Style Transplant; provide inputs; review a mock or generated result.
3. **Canvas:** inspect the lineage, combine pieces, run workflows, collect assets, and enter editors.
4. **Website editor:** edit the selected site with layers, sections, assets, properties, and code.

These surfaces share the same project, user, credits, assets, and history. They must never read as separate products.

### 4.2 Route map

| Route | Purpose |
|---|---|
| `/` | Authentication and account creation |
| `/canvas` | Authenticated Home/Projects hub |
| `/create` | Guided studio, defaults to Builder |
| `/create?mode=builder` | Builder entry |
| `/create?mode=clone` | Clone/Recreate entry |
| `/create?mode=style` | Style Transplant entry |
| `/canvas/:boardId` | Infinite canvas project |
| `/preview/:nodeId` | Clean authenticated website preview |

Assets and workflow templates begin as drawers inside the canvas. They should not require route changes during normal insertion.

### 4.3 Object language

- **Project:** a saved workspace listed on Home/Projects.
- **Canvas:** the spatial surface inside a project.
- **Node:** one source, intermediate artifact, instruction, or result.
- **Website:** a site node with editable HTML or React output.
- **Workflow:** a reusable graph pattern inserted into a canvas.
- **Asset:** a reusable image, video, code, shader, prompt, or design system item.

User-facing copy should prefer `Project`, `Website`, `Image`, `Prompt`, and `Workflow`. `Board` may remain an internal database name during migration but should disappear from visible UI.

## 5. Home/Projects

### 5.1 Layout

The authenticated hub uses a compact left navigation and a content region. It is not a card dashboard.

Left navigation:

- Uncraft mark
- Projects
- Assets (future route or library view)
- Workflows (future route or library view)
- credits/account at the bottom

Main content order:

1. header with `Projects`, search, credits, and account actions;
2. guided creation strip with the three modes;
3. recent projects;
4. workflow templates and community examples when available.

### 5.2 Primary actions

- `Create website` opens `/create?mode=builder`.
- Mode shortcuts can open Clone or Style Transplant directly.
- `New project` creates a blank project and opens its canvas.
- Existing project cards open the saved canvas.

The three modes should be selectable functions within one creation surface, not three product brands or unrelated marketing cards.

### 5.3 First-time state

When no project exists:

- the guided creation strip becomes the dominant content;
- the first recommended action is Builder;
- Clone and Style Transplant remain fully visible;
- a quiet `Start with a blank canvas` action stays available;
- examples explain inputs through real nouns, not feature claims.

## 6. Create Studio

### 6.1 Shared shell

The studio is a full-height product surface using the Working Table palette.

Header:

- logo back to Home/Projects;
- editable draft/project title;
- credits balance;
- `Save draft` state when persistence exists;
- user/account control.

Mode switcher:

- Builder
- Clone/Recreate
- Style Transplant

Switching modes preserves compatible inputs and warns before discarding incompatible completed steps. In the first mock, switching is immediate and deterministic.

Main area:

- left or central input workspace;
- right `What will happen` evidence panel before generation;
- result comparison after generation;
- persistent step indicator using plain labels, not generic numbered circles.

### 6.2 Shared lifecycle

1. **Choose mode**
2. **Add material**
3. **Set intent**
4. **Build preview**
5. **Review result**
6. **Open in Canvas**

The mock implementation must support every transition and back action. A page refresh may reset the mock draft initially, but real projects created during canvas handoff must persist.

### 6.3 Builder

#### Inputs

- required brief: what the website is, for whom, and desired outcome;
- optional website references;
- optional screenshots/images;
- optional brand assets or design.md;
- output preference: `Website` by default, with HTML/React represented later in the canvas rather than exposed as a technical first-step choice.

#### Prompt starters

- `A portfolio for an independent type designer`
- `A launch site for a new spatial audio product`
- `A research archive with editorial navigation`

#### Evidence panel

Before generation, show the exact material map:

- brief present/missing;
- references count;
- brand direction inferred or explicitly supplied;
- expected output: one website project plus editable sources in canvas.

#### Mock result

The result preview should be mode-specific and believable, not a generic skeleton. It includes a website frame, a short rationale, source mapping, and actions:

- `Refine brief`
- `Try another direction`
- `Open in Canvas`

### 6.4 Clone/Recreate

#### Source methods

- URL
- Screenshot/image

The source switch is visible at the point of entry. URL validation is inline. Upload state shows filename, size, and replace/remove actions.

#### Controls

- fidelity: `Exact`, `Editable`, `Inspired`
- scope: current page by default, with multi-page deferred
- preserve behavior toggle when a URL is used
- optional instruction such as `Keep the structure, simplify the navigation`

#### Evidence panel

- source method and value;
- capture route;
- fidelity intent;
- expected editable result;
- a copyright/responsible-use note written as product guidance, not legal alarm.

#### Mock result

Show original and recreation in a comparison surface. `Open in Canvas` maps the reference and recreated website into separate nodes with provenance intact.

### 6.5 Style Transplant

Style Transplant has two explicit roles:

- **Target:** the website whose content/structure is being transformed.
- **Style source:** the website, screenshot, image, or design.md whose visual language is applied.

#### Required inputs

- target URL or target screenshot;
- style source URL, image, or design.md;
- preservation choice:
  - `Keep content and structure`
  - `Keep content, allow layout changes`
  - `Use as loose direction`

#### Optional controls

- color influence;
- typography influence;
- spacing/radius influence;
- image treatment influence;
- instruction field for exceptions.

The first mock represents these as clear low-density controls. Advanced weights belong in the contextual canvas inspector after a real workflow exists.

#### Mock result

Show a three-part comparison:

- target before;
- style source;
- transplanted result.

`Open in Canvas` maps target, style source, extracted design system, transformation prompt, and result into a visible workflow.

## 7. Canvas adaptive shell

### 7.1 Left rail, static

Always available outside website edit mode:

1. Uncraft logo, returns to Home/Projects.
2. `New node`, opens the canvas node palette.
3. Assets, opens an overlay drawer.
4. Workflows, opens reusable workflow templates.
5. Account/workspace control at the bottom when expanded.

Expanded width: 224 px. Collapsed width: 52 px. The state is persisted locally.

`New node` and chat Add use the same taxonomy and creation handlers. The canvas palette may expose spatial operations such as Paste or Code while chat keeps attachment-specific actions.

### 7.2 Top bar, adaptive

Global zone:

- editable project name;
- save state: Saving, Saved, or retryable error;
- credits;
- Share only when functional.

No selection:

- do not show node-specific actions;
- do not show a meaningless `Canvas` breadcrumb if space becomes constrained.

Website selected:

- website identity;
- Desktop/Tablet/Mobile switcher;
- primary `Edit website`;
- `Open in Browser`;
- versions/overflow when available.

Other node selected:

- category and name;
- Run/Rerun when executable;
- node-relevant actions;
- no device switcher.

Edit mode:

- Cancel and Done;
- stable device switcher position;
- editor undo/redo;
- selected DOM element context when useful.

### 7.3 Right inspector, contextual

The inspector is hidden when there is no selection. It should never display an empty Figma imitation.

#### Site inspector

- preview thumbnail and status;
- name and provenance;
- source URL/capture method;
- viewport dimensions and active device;
- last update/version;
- inputs and outputs;
- last run and credits consumed when available;
- prominent `Edit website`;
- Run, duplicate, download, and delete in secondary actions.

#### Prompt inspector

- editable prompt body;
- variables and connected context;
- model/runtime metadata;
- output connections;
- Run/Rerun.

#### Image/asset inspector

- preview and natural dimensions;
- provenance and generation history;
- replace/download;
- existing Smart Edit;
- use as reference or connect to website.

#### design.md inspector

- color palette;
- type families and modular scale;
- spacing, radius, and token summary;
- raw markdown tab;
- `#EEA665` provenance grammar.

#### Code inspector

- language/runtime;
- code editor or preview;
- dependencies;
- input/output contract;
- accepted skills;
- validation/runtime state.

#### Shader subtype

Shaders remain `kind: code` with subtype `shader` or `react-shader`. They add:

- live preview;
- uniforms;
- time/pointer/resolution controls;
- runtime and performance data;
- the same versioning, dependencies, skills, and connections as other code nodes.

### 7.4 Minimap

- top-right, dynamically clearing top bar and inspector;
- no outline;
- compact nested rounded frames;
- `Nodes` button opens searchable color-coded navigation;
- framing control is aligned in the footer;
- edit mode position follows the Layers panel and never covers Cancel/Done.

### 7.5 Node chrome

- category label remains above the node at every zoom level, aligned to the same left corner;
- no decorative dot inside the category label;
- device widget moves into the contextual top bar;
- floating Edit text button is removed after topbar and inspector entries exist;
- ports, version state, run state, and category frame remain graph-local;
- website content preserves its own theme and border radius while editing.

## 8. Website editor integration

### 8.1 Release strategy

Do not rewrite editor-core before release. The existing editor remains the functional source of truth and is styled to match the Working Table shell.

### 8.2 Edit entry paths

1. primary button in the selected-site inspector;
2. contextual topbar action;
3. double-click site node;
4. node context menu.

### 8.3 Edit-mode layout

Left:

- document/project identity;
- Layers, Sections, Assets;
- search/filter;
- CSS/live mode status at the bottom.

Center:

- selected website framed between panels;
- device switcher centered above the website;
- Cancel and Done visible and unobstructed;
- minimap clear of edit controls.

Right:

- Properties and Code;
- functional existing controls;
- dark surfaces, spacing, borders, fields, typography, and elevation identical to Uncraft shell.

### 8.4 Save semantics

- Done writes a clean snapshot and returns to canvas selection state.
- Cancel restores the pre-edit snapshot or asks to discard when changes exist.
- editor chrome never leaks into saved HTML.
- shell dark mode never changes iframe website colors.

## 9. Canvas handoff from Create Studio

### 9.1 Real handoff contract

The mock implementation should create a real project and seed a real site node when the user chooses `Open in Canvas`.

Recommended client sequence:

1. create project through `/api/boards`;
2. create a site node through `/api/nodes` with a mock HTML snapshot;
3. encode the guided mode and source summary in node metadata;
4. redirect to `/canvas/:boardId?from=create&mode=:mode`;
5. select/frame the result or show it as the main node.

Later, production jobs replace mock HTML with generated artifacts but retain the same handoff contract.

### 9.2 Mode-to-graph mapping

#### Builder

- Prompt/brief node
- optional reference nodes
- optional design.md/brand nodes
- generated site node

#### Clone/Recreate

- source URL or screenshot node
- reconstruction instruction node
- recreated site node

#### Style Transplant

- target website node
- style reference node
- extracted design.md node
- transformation prompt/workflow
- result site node

The first mock may seed only the result site while showing the complete expected mapping in the studio result panel. The subsequent canvas implementation should materialize the full graph.

## 10. Mock interaction requirements

The guided studio mock is considered testable only if:

- all three modes switch without navigation failure;
- each mode has distinct required fields and validation;
- prompt starters populate editable fields;
- URL and source switches behave correctly;
- uploaded files show local metadata and can be removed;
- preservation/fidelity controls affect the review summary;
- generation enters a timed progress state with meaningful stages;
- progress respects reduced motion;
- result state is mode-specific;
- Back and Refine return to populated inputs;
- `Open in Canvas` creates a project and navigates to its canvas;
- keyboard focus is visible and logical;
- the layout works at 1280 px and remains usable at 768 px;
- mobile presents the flow as a single column and does not pretend the spatial canvas is mobile-editable.

## 11. Visual system

### 11.1 Color strategy

Restrained product palette:

- canvas: `#191917`
- chrome: `#222220`
- raised control: `#2F2F2C`
- ink: `#F1F0EB`
- muted: `#9A9891`
- line: `#3A3935`

Provenance colors remain semantic:

- site: `#2966EA`
- HTML: `#F97316`
- design.md: `#EEA665`
- asset: `#7951C2`
- prompt: `#ECEBF1`
- code/skill: `#F472B6`

Guided modes do not invent new graph colors. Their identity is expressed through icon and label until material becomes a node with real provenance.

### 11.2 Typography

- Inter/system sans only;
- body: 13 px / 1.4 / 450;
- labels: 11 px / 1.2 / 550;
- UI uppercase labels use 0.08 em tracking;
- large studio question: 28-32 px with negative tracking;
- no display type inside product controls.

### 11.3 Geometry

- 30-34 px control rhythm;
- 6 px small radius;
- 10 px menus and contextual panels;
- flat surfaces by default;
- ambient shadow only for fixed chrome, menus, and selected floating controls;
- no decorative glass blur.

### 11.4 Motion

- hover/press: 90-140 ms;
- tabs and input-state changes: 160-220 ms;
- result transition: 240-320 ms;
- ease-out for entry, ease-in for exit;
- no bounce or elastic motion;
- reduced-motion mode removes transform choreography and keeps state feedback.

## 12. Accessibility and responsive behavior

- WCAG 2.2 AA target;
- visible focus rings on all actions;
- icon-only controls have accessible labels and tooltips;
- color is never the only node/type signal;
- 44 px pointer target where space permits, with at least 30 px visual controls in dense desktop chrome;
- mode tabs use proper tab semantics or an equivalent labeled radio group;
- generated progress uses `aria-live` without announcing every animation frame;
- errors are placed next to the input and summarized at action level;
- 768 px studio stacks evidence below inputs;
- mobile supports creating, reviewing, and opening a project, while canvas editing remains desktop-first.

## 13. Data and implementation contracts

### 13.1 Guided draft shape

```js
{
  mode: 'builder' | 'clone' | 'style',
  title: string,
  brief: string,
  sourceMethod: 'url' | 'upload' | null,
  sourceUrl: string,
  sourceFile: { name, size, type } | null,
  targetUrl: string,
  styleUrl: string,
  fidelity: 'exact' | 'editable' | 'inspired',
  preservation: 'structure' | 'content' | 'direction',
  influences: { color, type, spacing, imagery },
  stage: 'input' | 'building' | 'result',
  mockResult: object | null
}
```

### 13.2 Site-node metadata from studio

```js
{
  name: string,
  source: 'guided-studio',
  studioMode: 'builder' | 'clone' | 'style',
  mock: true,
  brief: string,
  sourceSummary: object,
  createdAt: string
}
```

### 13.3 Migration language

Keep database/API `boards` naming until a deliberate migration. Visible UI uses Projects immediately. Avoid a high-risk schema rename during the visual and UX revamp.

## 14. Implementation sequence

### Phase A: specification and shell contract

- this specification;
- branch isolation;
- route and state contracts;
- test plan.

### Phase B: canvas and editors

1. static rail plus `New node` palette;
2. Assets and Workflows drawer shells with honest states;
3. hide empty inspector;
4. contextual inspectors by node kind;
5. prominent Edit website and topbar Edit;
6. move device switcher to topbar;
7. remove floating node Edit text;
8. preserve editor-core functionality while matching panel visuals;
9. ensure minimap clears contextual chrome.

### Phase C: three-mode studio mock

1. `/create` route and studio shell;
2. interactive mode switcher;
3. Builder input/result;
4. Clone source/fidelity/result;
5. Style target/source/preservation/result;
6. mock progress and errors;
7. real project and site-node handoff;
8. Home/Projects integration.

### Phase D: production generation

- replace mock generator with real jobs;
- persist guided drafts;
- materialize the complete mode-specific graph;
- estimates, holds, settlement, retries, cancellation;
- result comparison based on actual snapshots.

## 15. Test plan

### Unit/component

- mode reducer and validation;
- URL normalization;
- file metadata handling;
- progress stage transitions;
- canvas inspector mapping by node kind;
- sidebar New node action;
- project creation/handoff failure recovery.

### Browser flow

1. open Home/Projects;
2. enter Builder, use starter, generate mock, refine, generate again, open canvas;
3. verify project exists and result site is visible after reload;
4. enter Clone, switch URL/upload, validate error, generate and compare;
5. enter Style, supply target and style references, change preservation, generate;
6. use keyboard through the full studio;
7. select each node kind and verify right inspector content;
8. enter and exit website editor, checking device controls and Done/Cancel;
9. collapse/expand rail and inspector, checking minimap compensation;
10. verify 768 px studio layout.

### Build gate

- full Vitest suite;
- production Next build;
- `git diff --check`;
- no console errors during canonical flows;
- no accidental shell theme changes inside website iframes.

## 16. Acceptance criteria for the first comparison build

- A new branch contains this specification and implementation.
- Home/Projects clearly presents one Uncraft product with three functions.
- `/create` is a polished, fully interactive mock for Builder, Clone/Recreate, and Style Transplant.
- Every mode has distinct inputs, validation, progress, and a believable result.
- `Open in Canvas` creates a persistent project with a visible site result.
- The canvas uses a static left rail and contextual right inspector.
- A selected website has unmistakable Edit and Open in Browser actions.
- Editor-core remains functional and visually belongs to the same product.
- The mock and canvas use the current Uncraft design system and plain-English copy.
- Tests and production build pass.

## 17. Non-goals for the first comparison build

- real AI generation inside the guided studio;
- real multi-model comparison;
- full Assets and Workflows backend/library management;
- full graph materialization for every guided mode;
- mobile spatial canvas editing;
- database rename from boards to projects;
- rewriting editor-core in React for component purity.

These non-goals must remain explicit in the UI. The mock can simulate generation, but it must not imply that unimplemented provider calls or publishing actions already work.
