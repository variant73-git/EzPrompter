// Playwright helpers for the persisted /canvas native-motion editor.
//
// HARD RULE: the clone runs in an opaque sandboxed iframe (sandbox
// "allow-scripts allow-pointer-lock", no allow-same-origin) — it CANNOT be read
// from the host and these helpers NEVER touch iframe DOM. Every selection, edit,
// and assertion goes through HOST panels (the canvas node chrome, the editing
// sidebar's Layers list, the timeline strips, and the inspector fields) and reads
// host state attributes exposed by the React tree.
//
// Selector provenance (verified against the components, 2026-07-28):
//   • node root ................ [data-node-id]                        CanvasNode.jsx:1167
//   • float Edit button ........ button.cnode-float-edit (selection-gated, NOT hover)
//                                 CanvasNode.jsx:1283-1299 (span text "Edit" when no origin_url)
//   • editing body class ....... body.native-motion-editing            NativeMotionEditChrome.jsx:184
//   • viewport wrapper ......... [aria-label="Native website editing viewport"]
//                                 + data-viewport-width / data-edit-state  NativeEditViewport.jsx:133-147
//   • runtime iframe ........... iframe[title="Native animated website runtime"] (opaque)
//   • editing sidebar .......... aside[aria-label="Website editing sidebar"]  NativeEditSidebar.jsx
//   • layer button ............. button[aria-label^="<label>"] (…, kind, N motions) NativeEditSidebar.jsx:18-31
//   • timeline row ............. [data-element-row][data-selected]         NativeMotionEditor.jsx:1855
//   • timeline select strip .... [data-layer-strip] aria-label "Select <label>" NativeMotionEditor.jsx:1855-1866
//   • loop badge ............... [data-motion-loop="true"]                 NativeMotionEditor.jsx:1842 / NativeMotionInspector.jsx:50
//   • inspector tabs ........... #native-motion-inspector-tab-{properties|motion|code}  NativeMotionInspector.jsx:54-68
//   • board pan/zoom element ... .react-transform-component (inline style.transform) CanvasClient.jsx (react-zoom-pan-pinch)
//   • editor-busy signal ....... window event "uncraft:editor-busy" {detail:{nodeId,busy}}

export const VIEWPORT_SELECTOR = '[aria-label="Native website editing viewport"]';
export const RUNTIME_IFRAME_SELECTOR = 'iframe[title="Native animated website runtime"]';
export const SIDEBAR_SELECTOR = 'aside[aria-label="Website editing sidebar"]';
export const BOARD_TRANSFORM_SELECTOR = '.react-transform-component';

/**
 * Install a window-level tracker for the coalesced `uncraft:editor-busy` event so
 * waitIdle can poll a single flag. Must run before the first navigation.
 */
export async function installBusyTracker(page) {
  await page.addInitScript(() => {
    if (window.__uncraftBusyTrackerInstalled) return;
    window.__uncraftBusyTrackerInstalled = true;
    window.__uncraftEditorBusy = false;
    window.addEventListener('uncraft:editor-busy', (event) => {
      window.__uncraftEditorBusy = Boolean(event?.detail?.busy);
    });
  });
}

/**
 * Navigate to the seeded fixture board and wait for a node to render. Pass
 * `focusNode` to pre-select AND camera-frame that node on load (?focusNode= runs
 * setSelectedNodeId + zoomToNode, CanvasClient.jsx:4751) — this is how the
 * scenarios reach a specific node deterministically on a pan/zoom canvas instead
 * of clicking a node that the camera may have left off-screen or behind another.
 */
export async function gotoBoard(page, { focusNode } = {}) {
  const base = process.env.E2E_NATIVE_MOTION_BOARD_URL;
  if (!base) throw new Error('E2E_NATIVE_MOTION_BOARD_URL is not set (seed did not populate the canvas env).');
  const url = focusNode ? `${base}?focusNode=${encodeURIComponent(focusNode)}` : base;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-node-id]').first().waitFor({ state: 'visible', timeout: 60_000 });
  return url;
}

/**
 * Open the focused node into native edit and wait until the runtime has connected
 * and the editor has reported at least one element (layers/timeline populated).
 * Drives the fixed side inspector's Edit action (viewport-stable), not the
 * in-canvas float button which the zoom camera can push off-screen.
 */
export async function openNativeEdit(page, nodeId) {
  // Make sure the ?focusNode selection has actually settled before we click Edit —
  // onEditSite is a no-op if selectedSiteNode is momentarily null during the camera
  // frame, which otherwise makes entering native edit intermittently fail.
  await page.locator(`[data-node-id="${nodeId}"].selected`).waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  const inspector = page.locator('aside[aria-label="Selected node inspector"]');
  const expand = page.locator('button[aria-label="Expand inspector"]');
  if (await expand.isVisible().catch(() => false)) await expand.click();
  await inspector.waitFor({ state: 'visible', timeout: 30_000 });
  const editingBody = page.locator('body.native-motion-editing');
  // Retry the Edit click if native edit didn't enter. Safe against a double-toggle:
  // the inspector button reads "Edit" only while NOT editing (it flips to Done inside
  // the node once editing starts), so a re-query never clicks a "Done" affordance.
  let entered = false;
  for (let attempt = 0; attempt < 3 && !entered; attempt += 1) {
    const editButton = inspector.getByRole('button', { name: 'Edit', exact: true });
    await editButton.waitFor({ state: 'visible', timeout: 30_000 });
    await editButton.click();
    entered = await editingBody.waitFor({ state: 'attached', timeout: 12_000 }).then(() => true).catch(() => false);
  }
  if (!entered) throw new Error('native edit did not enter after 3 attempts (body.native-motion-editing never attached)');
  await page.locator(VIEWPORT_SELECTOR).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator(RUNTIME_IFRAME_SELECTOR).waitFor({ state: 'attached', timeout: 120_000 });
  // Runtime connected once the editor reports elements as layer rows / timeline strips.
  await page.waitForFunction(() => {
    return document.querySelectorAll('[data-element-row]').length > 0
      || document.querySelectorAll('aside[aria-label="Website editing sidebar"] button[aria-label]').length > 0;
  }, null, { timeout: 120_000, polling: 250 });
  await waitIdle(page, 30_000).catch(() => {});
}

/** Wait until the coalesced editor-busy flag is false (best-effort; resolves fast if never busy). */
export async function waitIdle(page, timeoutMs = 20_000) {
  await page.waitForFunction(() => window.__uncraftEditorBusy === false, null, { timeout: timeoutMs, polling: 100 });
}

/** Select an element from the editing sidebar's Layers list by its label prefix. */
export async function selectLayer(page, labelPrefix) {
  const button = page.locator(`${SIDEBAR_SELECTOR} button[aria-label^=${JSON.stringify(labelPrefix)}]`).first();
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  await button.click();
  await waitIdle(page).catch(() => {});
  return button;
}

/**
 * Select an element by clicking its timeline strip (aria-label "Select <label>").
 * Returns the enclosing [data-element-row] locator.
 */
export async function selectStripByLabel(page, label) {
  const strip = page.locator(`[data-layer-strip][aria-label=${JSON.stringify(`Select ${label}`)}]`);
  await strip.waitFor({ state: 'visible', timeout: 20_000 });
  await strip.click();
  await waitIdle(page).catch(() => {});
  return strip;
}

/** Click an inspector tab: name ∈ {properties, motion, code}. */
export async function openInspectorTab(page, name) {
  const tab = page.locator(`#native-motion-inspector-tab-${name}`);
  await tab.waitFor({ state: 'visible', timeout: 20_000 });
  await tab.click();
  return tab;
}

/** The Transform-section input for a given label (exact) — lives on the Properties tab. */
export function transformField(page, label) {
  return page.getByLabel(label, { exact: true });
}

/** Read the board pan/zoom transform (react-zoom-pan-pinch inner content inline style). */
export async function boardTransform(page) {
  return page.locator(BOARD_TRANSFORM_SELECTOR).first().evaluate((element) => ({
    inline: element.style.transform || '',
    computed: getComputedStyle(element).transform,
  }));
}
