# Uncraft Adaptive Canvas Shell

**Status:** product and UX direction proposed before public canvas release  
**Date:** 2026-07-15  
**Scope:** canvas chrome, panels, edit-mode entry, and contextual navigation

## Context

The canvas is close to release maturity. The `unspirit` shell added a visually coherent left sidebar, top bar, vertical tool rail, and right inspector. However, the persistent shell currently exposes the wrong product objects:

- the left sidebar lists Boards, even though those entries represent separate projects or canvases and belong in the project hub;
- the right panel imitates a Figma inspector but is largely empty or disconnected from the real site editor;
- the top bar spends permanent canvas space on a breadcrumb, credits, Share, and an unusable Preview action;
- the most important transition, entering the website editor, is represented mainly by a small floating button above the selected node.

The earlier `feat/canvas` version preserved more canvas area and only introduced the mature editor panels during site editing. The target should combine that spatial efficiency with the stronger visual shell of `unspirit`.

## Product decision

Keep the current shell as an **adaptive shell**, not as three permanently open regions. Its content and density change with the user's current state.

| State | Left side | Top bar | Right side |
|---|---|---|---|
| Canvas, no selection | Static 48-52px product rail for Assets and workflow templates | Project name, save state, credits, Share when functional | Hidden |
| Node selected | Same static rail | Node-context actions and device switcher | Contextual node inspector with the relevant preview, properties, and edit actions |
| Website editing | Layers/Sections/Assets panel | Cancel, Done, device switcher, undo/redo, element context | Full editable site inspector |
| Workflow or section selected | Workflows drawer available | Run, reroll, cost, stop, and selection context | Workflow summary and inputs |
| Multi-selection | Navigator available | Selection count and batch actions | Shared properties or compact selection summary |

This preserves one stable interface while applying progressive disclosure. The canvas owns the default state; chrome earns space only when it has a current job.

## Top bar

Retain a compact, stable bar, but make it contextual.

### Global zone

- the Uncraft logo returns to Projects/Home; no separate Home/Projects item is needed in the rail
- editable project name
- saved/saving/error state
- credits balance
- Share only when implemented

### Context zone

When a site node is selected:

- site identity and node category
- desktop/tablet/mobile device switcher
- Run from here or Reroll when relevant
- versions and overflow actions
- primary `Edit website` action
- `Open in Browser` for a selected website

When editing:

- device switcher remains in the same position to avoid control jumping;
- Cancel and Done become the dominant actions;
- undo and redo apply to the current editing scope;
- optional breadcrumb describes the selected DOM element, not the generic location `Canvas`.

The global Preview button becomes `Open in Browser`. It is contextual, appears only when a website node is selected, and opens that website in a clean browser surface.

## Right panel

The right panel becomes the main bridge between selecting a site and editing it.

### Resting canvas state

- Do not display an empty inspector.
- When collapsed, its reopen control lives in the top bar rather than as a detached square.
- Remember the user's collapsed/pinned preference.

### Contextual node inspector

The right panel is the single place for properties and node-specific editing. It changes by node type.

For a selected site, present:

- name, category, status, and provenance;
- source URL and capture/generation method;
- viewport dimensions and active device;
- latest version and last updated time;
- input and output connections;
- last execution and credits consumed;
- contextual actions such as Run from here, duplicate, download, and delete;
- a visually dominant `Edit website` button.

For other node types:

- **Prompt:** editable prompt text, variables, model/runtime metadata, and connected context.
- **Image/asset:** thumbnail, natural dimensions, provenance, generation history, and the existing Smart Edit experience.
- **design.md:** extracted color palette, typography families, modular type scale, spacing/tokens summary, and raw markdown access.
- **Code:** code editor, language/runtime, dependencies, accepted skills, input/output contract, preview, and validation state.
- **Shader:** use the Code inspector foundation plus specialized controls for uniforms, time, pointer input, resolution, performance, and live preview.

Use `Overview` and `Code` before editing. Use `Properties` and `Code` while editing. Do not render a Code tab until code is available.

### Edit mode

The existing editor-core inspector remains the functional source of truth for the first release. Restyle it to match the canvas shell instead of rewriting it before publication. Later, it can be mounted inside the same React panel container so the transition from Overview to editable Properties becomes structurally continuous.

## Entering edit mode

Support several discoverable but consistent paths:

1. primary `Edit website` button in the selected-node inspector;
2. primary Edit action in the contextual top bar;
3. double-click on a site node;
4. Edit in the node context menu.

Once the inspector and top bar paths exist, remove the floating text button above the node or reduce it to a secondary icon. The node itself should remain visually clean.

On edit entry, frame the selected website between the active left and right panels. Preserve the spatial position as much as possible and avoid an abrupt camera jump.

## Left panel

Remove Boards from the canvas shell. Project switching belongs in the authenticated Home/Projects area.

Replace the current sidebar with a static collapsed product rail, inspired by dense creative tools:

- New node
- Assets
- Workflows, meaning reusable workflow templates

`New node` is the primary deterministic insertion action. It opens the canvas node palette beside the sidebar button and reuses the same creation handlers and node taxonomy as Add in the chat widget. The canvas palette may additionally expose spatial actions such as paste and raw code, while chat keeps its conversation-specific attachment flow.

Selecting a library icon opens a 240-280px drawer over the canvas. Closing the drawer returns to the 48-52px rail. Assets and workflows must support drag or insert into the current viewport.

The logo itself is the route back to Home/Projects. Brainstorm stays inside the AI chat widget, using its existing Brainstorm control. Neither needs a separate rail item.

### Node navigation

A permanent node list would duplicate the spatial overview already provided by the minimap. Add a node-menu button to the minimap instead. The menu is compact, searchable when the board is large, and supports:

- color-coded node rows;
- node name and category;
- jump-to-node and frame-selection;
- status indicators for running, failed, or stale outputs.

This keeps navigation close to the existing spatial map without consuming a permanent sidebar destination.

### Edit mode

The same left-side region switches to the already-functional Layers, Sections, and Assets editor panel. Its behavior stays intact, but its surfaces, borders, spacing, typography, tabs, fields, and elevation adopt the exact visual pattern of the `unspirit` canvas panels.

The right editor inspector receives the same treatment and visually replaces the resting contextual inspector when edit mode begins.

## Node chrome

- Move the device switcher from above each node into the contextual top bar.
- Remove or demote the floating Edit button after edit entry exists in the inspector and top bar.
- Keep the category tag, ports, run state, and version affordances close to the node because they belong to the graph grammar.
- Keep node bodies free from permanent toolbars.

## New project, new node, and new workflow

Do not replace `New board` with `New canvas` in either inspector. Creation must follow scope:

- a separate workspace item is `New project` and belongs in Home/Projects, reached through the logo;
- any new graph item begins with `New node` in the static left panel or Add in the chat widget; both use the same node taxonomy and creation handlers;
- another website inside the current project is one option inside that shared palette (`Add URL` or `Blank site`);
- a reusable chain begins through `Insert workflow` in the Workflows library.

Centralizing these actions by scope prevents the inspector and chat from offering competing creation paths.

## Shader taxonomy

Treat shaders as a specialized subtype of Code, not as a separate top-level provenance category.

Recommended model:

- `kind: code`
- `subtype: shader` or `react-shader`
- `language: jsx | tsx | glsl | wgsl`
- `runtime: react | react-three-fiber | webgl | webgpu | ogl`

Shaders share import, code editing, dependencies, versioning, skills, and connections with code snippets. They still receive a distinct creation option, icon/badge, preview body, and contextual inspector because their controls and runtime behavior are specialized. Keep the same code-family provenance color and distinguish the subtype through iconography and label.

## Spatial behavior

- Panels overlay the world rather than changing world coordinates.
- Framing and fit-to-selection account for whichever panels are open.
- Opening an inspector should only nudge the viewport when it would cover the selected node.
- Entering edit mode may explicitly reframe the site between panels.
- The minimap dynamically clears the top bar and right inspector.
- Collapsing a panel must not leave an unexplained floating control over the canvas.

## Release-oriented implementation order

1. Replace Boards with the static collapsed product rail, a shared `New node` palette, and Assets/Workflow Templates drawers.
2. Turn the selected-node inspector into a useful read-only overview and add the primary edit entry.
3. Make the top bar contextual, replace Preview with Open in Browser, and move the device switcher there.
4. Add the compact node menu to the minimap.
5. Keep editor-core panels during editing, but align their colors, spacing, and geometry exactly with the new shell.
6. After release, unify the React canvas inspector and editor-core inspector behind one panel container.

## Non-goals before publication

- Do not rewrite the mature editor-core inspector merely to achieve component purity.
- Do not build a permanent node list or Navigator item in the sidebar.
- Do not keep disabled or empty Figma-like panels to imply future functionality.
- Do not move project navigation back inside the active project canvas.

## Acceptance criteria

- With no selection, the canvas has only a slim left rail and compact global top bar.
- Selecting a site reveals useful information and an unmistakable Edit website action.
- Entering edit mode keeps the device selector spatially stable and exposes Done/Cancel.
- Assets and Workflow Templates are accessible without leaving the current project.
- New node is available in the static left panel and reuses the Add taxonomy and creation handlers.
- Projects are accessed from Home/Projects, not from a Boards list inside the canvas.
- Brainstorm remains in the AI chat widget.
- The minimap opens a compact node navigation menu.
- Code shaders use the Code family with a specialized subtype and inspector.
- No permanent panel is displayed without meaningful current content.
