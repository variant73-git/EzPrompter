// Persisted /canvas acceptance scenarios (Phase 4). Runs inside the Task 16 gate
// AFTER the fail-closed preflight passes and the seed has populated the four
// E2E_NATIVE_MOTION_* env vars. Mirrors runLab's harness (context, external-request
// block, createRecorder, evidence dir) but drives the CANVAS surface — a seeded,
// persisted board — entirely through HOST panels (the clone iframe is opaque).
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRecorder, DEVICES } from '../native-motion-editing.spec.js';
import {
  installBusyTracker,
  gotoBoard,
  openNativeEdit,
  openInspectorTab,
  selectStripByLabel,
  boardTransform,
  waitIdle,
  VIEWPORT_SELECTOR,
} from './canvas-helpers.mjs';

// Fixture element labels the runtime bridge reports for the seeded fixture-site:
//   hero  → "We found a better way" (finite `rise` entrance)
//   badge → "badge"                 (infinite `spin` loop)
//   ambiguous → "ambiguous"         (two infinite transforms = ambiguous owner)
const LABEL_FINITE = 'We found a better way';
const LABEL_LOOP = 'badge';
const LABEL_AMBIGUOUS = 'ambiguous';

const INSPECTOR_SELECTOR = 'aside[aria-label="Native website inspector"]';
const HISTORY_TOOLBAR = 'div[role="toolbar"][aria-label="Edit history"]';

// Transform-field input locator, SCOPED to the motion inspector and matched by the
// field's leaf label text (NOT getByLabel). The Transform-section Field wraps its input
// in a <label> whose leaf span reads exactly `field`; scoping to <label> elements also
// excludes the read-only Layout X/Y (those aren't inside a <label>), and exact-text
// matching keeps "X" from matching "Scale X" / "Skew X". This is DOM-structural, so it
// stays stable regardless of the accessible-name algorithm.
function transformInput(page, field) {
  return page.locator(`${INSPECTOR_SELECTOR} label`)
    .filter({ has: page.getByText(field, { exact: true }) })
    .locator('input');
}

// Ensure the Properties tab is active and its Transform section has rendered (the X field
// is a stable anchor). PropertiesPanel re-renders the selected element's committed styles,
// so this must run after the selection has settled.
async function openProperties(page) {
  await openInspectorTab(page, 'properties');
  await transformInput(page, 'X').waitFor({ state: 'visible', timeout: 20_000 });
}

// Type a transform component and commit it (Enter → blur → onCommit = retarget).
async function setTransform(page, field, value) {
  await openProperties(page);
  const input = transformInput(page, field);
  await input.fill(String(value));
  await input.press('Enter');
  await waitIdle(page).catch(() => {});
}

// Read a transform component as a number. The Field is keyed by its committed value
// (`key={label:effectiveValue}`), so a genuine edit re-mounts the input with the applied
// value — reading it here reflects committed state, not a stale render.
async function readTransform(page, field) {
  await openProperties(page);
  return Number.parseFloat(await transformInput(page, field).inputValue());
}

const undoButton = (page) => page.locator(`${HISTORY_TOOLBAR} button[aria-label="Undo"]`);

// Wait until the Undo button reaches the requested disabled state. Undo is
// `disabled={!canUndo || busy}`, and canUndo = past.length > 0, so `disabled === true`
// once the history is empty (or mid-round-trip) and `false` after a transaction lands.
async function waitUndoDisabled(page, disabled) {
  await page.waitForFunction((want) => {
    const button = document.querySelector('div[role="toolbar"][aria-label="Edit history"] button[aria-label="Undo"]');
    return Boolean(button) && button.disabled === want;
  }, disabled, { timeout: 20_000, polling: 150 });
}

export async function runCanvasScenarios({ browser, baseUrl, evidenceDir, report }) {
  const externalRequests = [];
  const consoleErrors = [];
  const context = await browser.newContext({
    viewport: { width: DEVICES[0].width, height: DEVICES[0].height },
    colorScheme: 'dark',
  });
  const allowedOrigin = new URL(baseUrl).origin;
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:') || new URL(requestUrl).origin === allowedOrigin) {
      await route.continue();
      return;
    }
    externalRequests.push(requestUrl.replace(/[?#].*$/, ''));
    await route.abort('blockedbyclient');
  });
  await context.addCookies([{
    name: 'uncraft_sess',
    value: process.env.E2E_NATIVE_MOTION_SESSION_COOKIE,
    url: baseUrl,
  }]);

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await installBusyTracker(page);

  const record = createRecorder(report);
  const metrics = report.metrics || (report.metrics = {});
  const primaryNodeId = process.env.E2E_NATIVE_MOTION_PRIMARY_NODE_ID;
  assert(primaryNodeId, 'E2E_NATIVE_MOTION_PRIMARY_NODE_ID is not set');

  try {
    await record('canvas.fixed-viewport-framing', async () => {
      await gotoBoard(page, { focusNode: primaryNodeId });
      const openedAt = Date.now();
      await openNativeEdit(page, primaryNodeId);
      metrics.canvasRuntimeReadyMs = Date.now() - openedAt;
      const viewport = page.locator(VIEWPORT_SELECTOR);
      assert.equal(await viewport.count(), 1, 'expected exactly one native editing viewport');
      assert.equal(await viewport.getAttribute('data-viewport-width'), String(DEVICES[0].width),
        'viewport is not framed at the desktop device width');
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      assert(overflow.scrollWidth <= overflow.innerWidth,
        `host requires horizontal scroll (${overflow.scrollWidth} > ${overflow.innerWidth})`);
      await page.screenshot({ path: resolve(evidenceDir, 'canvas-desktop-edit.png'), animations: 'disabled' });
      return { ...overflow, runtimeReadyMs: metrics.canvasRuntimeReadyMs };
    });

    await record('canvas.scroll-pan-disabled', async () => {
      const before = await boardTransform(page);
      const box = await page.locator(VIEWPORT_SELECTOR).boundingBox();
      assert(box, 'editing viewport has no bounding box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(400);
      const after = await boardTransform(page);
      assert.equal(after.inline, before.inline,
        `board pan/zoom changed on scroll (before=${before.inline} after=${after.inline})`);
      return { boardTransform: after.inline || '(none)' };
    });

    await record('canvas.partial-selection', async () => {
      const startedAt = Date.now();
      // The ambiguous element lives in the second (below-the-fold) section, so it is
      // only partially in view — selection still resolves through the host layer list.
      const strip = await selectStripByLabel(page, LABEL_AMBIGUOUS);
      metrics.firstSelectableMs = Date.now() - startedAt;
      await page.locator('[data-layer-strip][data-selected="true"]').first().waitFor({ state: 'visible', timeout: 20_000 });
      assert.equal(await strip.getAttribute('data-selected'), 'true', 'selected strip is not marked selected');
      const header = page.locator(`${INSPECTOR_SELECTOR} strong`).first();
      const headerText = (await header.textContent())?.trim();
      assert(headerText && headerText !== 'Nothing selected',
        `inspector header did not reflect a selection (was "${headerText}")`);
      return { headerText, firstSelectableMs: metrics.firstSelectableMs };
    });

    await record('canvas.finite-settlement-and-loop-indicator', async () => {
      const startedAt = Date.now();
      // Loop element (badge): selecting it and opening the Motion tab surfaces a loop
      // indicator INSIDE the inspector. This is the discriminating signal — the
      // timeline's own loop badges are always present for loop rows regardless of
      // what's selected, so they can't distinguish the selected element.
      await selectStripByLabel(page, LABEL_LOOP);
      await openInspectorTab(page, 'motion');
      const inspectorLoop = page.locator(`${INSPECTOR_SELECTOR} [data-motion-loop="true"]`);
      await inspectorLoop.first().waitFor({ state: 'visible', timeout: 20_000 });
      metrics.selectionSettlementMs = Date.now() - startedAt;

      // Finite element (hero): once its selection settles, the inspector shows NO loop
      // indicator. Wait for the inspector header to reflect the hero first so we never
      // read the previous (loop) selection's badge.
      await selectStripByLabel(page, LABEL_FINITE);
      await openInspectorTab(page, 'motion');
      await page.waitForFunction((label) => {
        const insp = document.querySelector('aside[aria-label="Native website inspector"]');
        return insp?.querySelector('strong')?.textContent?.trim() === label;
      }, LABEL_FINITE, { timeout: 20_000, polling: 150 }).catch(() => {});
      await page.waitForTimeout(1200);
      const finiteLoopCount = await page.locator(`${INSPECTOR_SELECTOR} [data-motion-loop="true"]`).count();
      assert.equal(finiteLoopCount, 0, 'the finite hero wrongly shows a loop indicator in the inspector');

      // A finite duration readout is present in the timeline transport (e.g. "0.00s / 1.00s").
      const durationReadout = page.getByText(/\b\d+(?:\.\d+)?s\s*\/\s*\d+(?:\.\d+)?s\b/).first();
      const hasFiniteDuration = await durationReadout.isVisible().catch(() => false);
      const durationText = hasFiniteDuration ? (await durationReadout.textContent())?.trim() : null;
      assert(hasFiniteDuration, 'no finite duration readout found in the timeline transport');
      return { selectionSettlementMs: metrics.selectionSettlementMs, finiteLoopCount, durationText };
    });

    // --- Task 11: direct retarget · independent transform components · single undo ---
    // The hero's single `rise` motion owns its whole transform channel, so editing X or
    // Rotate is a genuine single-owner retarget (not the ambiguous #ambiguous element,
    // and not an unowned override). Each transform commit is its own transaction
    // (applyStyle → one applyPatches → one history entry; canUndo = past.length > 0).

    // single-undo-disables runs FIRST, while the edit history is empty. The check asserts
    // one Undo reverts the last transaction AND exhausts the stack (button disables) —
    // which only holds with exactly one transaction present. After the two accumulating
    // retargets below, a single Undo would leave a transaction and NOT disable. Undo here
    // restores hero's X to its original 0, leaving it pristine for the retargets that follow.
    await record('canvas.single-undo-disables', async () => {
      await selectStripByLabel(page, LABEL_FINITE);
      await openProperties(page);
      await undoButton(page).waitFor({ state: 'visible', timeout: 20_000 });
      await waitUndoDisabled(page, true);
      const original = await readTransform(page, 'X');
      await setTransform(page, 'X', '12px');
      await waitUndoDisabled(page, false); // the edit recorded a transaction
      const afterEdit = await readTransform(page, 'X');
      assert(Math.abs(afterEdit - 12) < 0.5, `X did not apply before undo (was ${afterEdit})`);
      await undoButton(page).click();
      await waitIdle(page).catch(() => {});
      await waitUndoDisabled(page, true); // one undo exhausted the single-entry stack
      const reverted = await readTransform(page, 'X');
      assert(Math.abs(reverted - original) < 0.5, `undo did not revert X to ${original} (was ${reverted})`);
      return { original, afterEdit, reverted };
    });

    await record('canvas.direct-retarget', async () => {
      await selectStripByLabel(page, LABEL_FINITE);
      await setTransform(page, 'X', '18px');
      await waitUndoDisabled(page, false); // a genuine retarget records a transaction
      const appliedX = await readTransform(page, 'X');
      assert(Math.abs(appliedX - 18) < 0.5, `retarget did not apply X=18 (was ${appliedX})`);
      // Retarget, not override: the finite motion survives (an override that clobbered the
      // animation would drop the Motion-tab duration readout).
      await openInspectorTab(page, 'motion');
      const duration = page.getByText(/\b\d+(?:\.\d+)?s\s*\/\s*\d+(?:\.\d+)?s\b/).first();
      const motionSurvived = await duration.isVisible().catch(() => false);
      assert(motionSurvived, 'the finite motion did not survive the retarget (no duration readout)');
      return { appliedX, motionSurvived };
    });

    await record('canvas.independent-transform-components', async () => {
      await selectStripByLabel(page, LABEL_FINITE);
      await setTransform(page, 'Rotate', '7deg');
      // Both components must compose: setting Rotate must NOT drop the earlier X=18
      // translation (the browser-QA regression fixed 2026-07-27). The X Field re-mounts if
      // its committed value changes, so a lost X reads back 0, not the value typed earlier.
      const appliedRotate = await readTransform(page, 'Rotate');
      const retainedX = await readTransform(page, 'X');
      assert(Math.abs(appliedRotate - 7) < 0.5, `Rotate did not apply (was ${appliedRotate})`);
      assert(Math.abs(retainedX - 18) < 0.5, `setting Rotate lost the earlier X=18 translation (X=${retainedX})`);
      return { appliedRotate, retainedX };
    });
  } finally {
    report.network = report.network || {};
    report.network.canvasBlockedExternalRequests = [...new Set(externalRequests)];
    report.console = report.console || {};
    report.console.canvasErrors = consoleErrors;
    await context.close();
  }
}
