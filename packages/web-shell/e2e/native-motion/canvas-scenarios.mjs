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
  } finally {
    report.network = report.network || {};
    report.network.canvasBlockedExternalRequests = [...new Set(externalRequests)];
    report.console = report.console || {};
    report.console.canvasErrors = consoleErrors;
    await context.close();
  }
}
