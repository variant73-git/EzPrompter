#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
export const DEVICES = Object.freeze([
  { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
  { id: 'tablet', label: 'Tablet', width: 768, height: 920 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
]);
const REQUIRED_CANVAS_ENV = Object.freeze([
  'E2E_NATIVE_MOTION_BOARD_URL',
  'E2E_NATIVE_MOTION_PRIMARY_NODE_ID',
  'E2E_NATIVE_MOTION_SECONDARY_NODE_ID',
  'E2E_NATIVE_MOTION_SESSION_COOKIE',
]);

function parseArgs(argv) {
  const options = {
    mode: 'all',
    baseUrl: null,
    outputRoot: resolve('/tmp/uncraft-task16-e2e'),
    port: 34316,
    headed: false,
    startServer: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--lab-only') options.mode = 'lab';
    else if (argument === '--canvas-only') options.mode = 'canvas';
    else if (argument === '--base-url') options.baseUrl = argv[++index];
    else if (argument === '--output') options.outputRoot = resolve(argv[++index]);
    else if (argument === '--port') options.port = Number(argv[++index]);
    else if (argument === '--headed') options.headed = true;
    else if (argument === '--no-start-server') options.startServer = false;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isSafeInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error('The E2E port must be an integer between 1024 and 65535.');
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    'Usage: npm run e2e:native-motion -- [options]',
    '',
    '  --lab-only          Run non-persistent QA against the real local clone lab',
    '  --canvas-only       Run only the isolated persisted-board acceptance pack',
    '  --base-url <url>    Reuse an already-running web shell',
    '  --no-start-server   Do not start Next.js (requires --base-url)',
    '  --output <dir>      Select the evidence root (default: /tmp/uncraft-task16-e2e)',
    '  --port <number>     Local Next.js port when the runner starts it',
    '  --headed            Show the Playwright browser',
    '',
    'The default mode is the complete Task 16 gate. It fails closed unless an',
    'isolated migrated canvas fixture and explicit mutation approval are present.',
  ].join('\n') + '\n');
}

function parseEnvFile(source) {
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return null;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [match[1], value];
  }).filter(Boolean));
}

async function loadLocalEnv() {
  const source = await readFile(resolve(process.cwd(), '.env.local'), 'utf8').catch(() => '');
  const local = parseEnvFile(source);
  Object.entries(local).forEach(([key, value]) => {
    if (process.env[key] == null) process.env[key] = value;
  });
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 120_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`Next.js exited before readiness with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/motion-editor`, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError?.message || 'not ready'}`);
}

function startNextServer(port) {
  const nextBin = require.resolve('next/dist/bin/next');
  const logs = [];
  const child = spawn(process.execPath, [nextBin, 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      NEXT_DIST_DIR: '.next-task16-e2e',
      NEXT_PUBLIC_NATIVE_MOTION_CANVAS_EDIT: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 80) logs.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  return { child, logs };
}

async function stopNextServer(server) {
  if (!server?.child || server.child.exitCode != null) return;
  if (process.platform === 'win32') server.child.kill('SIGTERM');
  else process.kill(-server.child.pid, 'SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => server.child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ]);
  if (server.child.exitCode == null) server.child.kill('SIGKILL');
}

export function createRecorder(report) {
  return async function record(name, fn, { required = true } = {}) {
    const startedAt = Date.now();
    try {
      const details = await fn();
      report.checks.push({ name, status: 'passed', required, durationMs: Date.now() - startedAt, details: details || null });
      return details;
    } catch (error) {
      report.checks.push({
        name,
        status: required ? 'failed' : 'blocked',
        required,
        durationMs: Date.now() - startedAt,
        error: error?.message || String(error),
      });
      if (required) throw error;
      return null;
    }
  };
}

async function writeJsonExclusive(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

export async function computedTargetState(target) {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
    return {
      transform: style.transform,
      inlineTransform: element.style.transform,
      transformComponents: {
        translateX: matrix.e,
        translateY: matrix.f,
        rotate: Math.atan2(matrix.b, matrix.a) * (180 / Math.PI),
      },
      transformOrigin: style.transformOrigin,
      opacity: style.opacity,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      scrollY: window.scrollY,
    };
  });
}

export async function waitForTargetState(target, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = await computedTargetState(target);
    if (predicate(state)) return state;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
  }
  return state;
}

async function runLab({ browser, baseUrl, evidenceDir, report }) {
  const externalRequests = [];
  const consoleErrors = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
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
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const record = createRecorder(report);
  const metrics = {};
  const targetText = process.env.E2E_NATIVE_MOTION_TARGET_TEXT || 'We found a better way';

  try {
    await record('lab.runtime-ready', async () => {
      const startedAt = Date.now();
      const response = await page.goto(`${baseUrl}/motion-editor`, { waitUntil: 'domcontentloaded' });
      assert(response?.ok(), `motion-editor returned ${response?.status()}`);
      await page.getByText('Runtime connected', { exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
      metrics.runtimeReadyMs = Date.now() - startedAt;
      const iframe = page.locator('iframe[title="Native animated website runtime"]');
      assert.equal(await iframe.count(), 1);
      assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts allow-pointer-lock');
      assert.equal(await iframe.getAttribute('referrerpolicy'), 'no-referrer');
      const frame = page.frames().find((candidate) => candidate.parentFrame());
      assert(frame, 'native runtime frame was not attached');
      const title = await frame.title();
      assert(title && title !== 'Native animated clone', 'real local clone title was not loaded');
      return { runtimeReadyMs: metrics.runtimeReadyMs, title };
    });

    const frame = page.frames().find((candidate) => candidate.parentFrame());
    assert(frame, 'native runtime frame was not attached');
    const target = frame.getByRole('heading', { name: targetText, exact: true });

    await record('lab.fixed-device-framing', async () => {
      const iframe = page.locator('iframe[title="Native animated website runtime"]');
      const geometry = await iframe.evaluate((element) => ({
        width: element.parentElement?.style.width,
        height: element.parentElement?.style.height,
      }));
      assert.deepEqual(geometry, { width: '1280px', height: '800px' });
      await page.screenshot({ path: resolve(evidenceDir, 'lab-desktop-editing.png'), animations: 'disabled' });
      return geometry;
    });

    await record('lab.scroll-isolation-and-partial-selection', async () => {
      assert.equal(await target.count(), 1, `expected one fixture heading named ${targetText}`);
      const hostBefore = await page.evaluate(() => window.scrollY);
      await target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        window.scrollTo(0, Math.max(0, window.scrollY + rect.top - window.innerHeight + rect.height / 2));
      });
      const partial = await target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0 && (rect.top < 0 || rect.bottom > window.innerHeight);
      });
      const cloneScroll = await frame.evaluate(() => window.scrollY);
      assert(cloneScroll > 0, 'clone did not scroll');
      assert.equal(await page.evaluate(() => window.scrollY), hostBefore, 'host page scrolled with the clone');
      const startedAt = Date.now();
      await target.click();
      const inspector = page.locator('aside').filter({ hasText: targetText });
      await inspector.waitFor({ state: 'visible', timeout: 20_000 });
      metrics.firstSelectableMs = Date.now() - startedAt;
      return { partial, cloneScroll, hostScroll: hostBefore, firstSelectableMs: metrics.firstSelectableMs };
    });

    await record('lab.finite-settlement-and-motion-inspection', async () => {
      const motionTab = page.getByRole('button', { name: 'Motion', exact: true });
      assert.equal(await motionTab.count(), 1);
      const startedAt = Date.now();
      await motionTab.click();
      const motionPanel = page.locator('aside').filter({ hasText: 'Animation' });
      await motionPanel.waitFor({ state: 'visible', timeout: 20_000 });
      const text = await motionPanel.innerText();
      assert.match(text, /GSAP|CSS|WAAPI|ScrollTrigger/);
      metrics.selectionSettlementMs = Date.now() - startedAt;
      return { selectionSettlementMs: metrics.selectionSettlementMs, engineVisible: true };
    });

    await record('lab.direct-retarget-and-single-undo', async () => {
      const properties = page.getByRole('button', { name: 'Properties', exact: true });
      assert.equal(await properties.count(), 1);
      await properties.click();
      const before = await computedTargetState(target);
      assert(before, 'selected target state was unavailable');
      const xField = page.getByLabel('X', { exact: true });
      assert.equal(await xField.count(), 1);
      const startedAt = Date.now();
      await xField.fill('24px');
      await xField.press('Enter');
      await page.getByText('1 change', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
      metrics.patchCommitMs = Date.now() - startedAt;
      const after = await waitForTargetState(target, (state) => state.transform !== before.transform);
      assert(after && after.transform !== before.transform, 'direct transform edit had no visible effect');
      const undo = page.getByRole('button', { name: 'Undo', exact: true });
      assert.equal(await undo.count(), 1);
      assert.equal(await undo.isEnabled(), true);
      await undo.click();
      await page.getByText('0 changes', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
      assert.equal(await undo.isDisabled(), true);
      const restored = await waitForTargetState(target, (state) => state.transform === before.transform);
      assert.equal(restored?.transform, before.transform, 'Undo did not restore the exact transform');
      return { patchCommitMs: metrics.patchCommitMs, before: before.transform, after: after.transform };
    });

    await record('lab.independent-transform-components', async () => {
      const xField = page.getByLabel('X', { exact: true });
      await xField.fill('18px');
      await xField.press('Enter');
      const rotateField = page.getByLabel('Rotate', { exact: true });
      assert.equal(await rotateField.count(), 1);
      await rotateField.fill('7deg');
      await rotateField.press('Enter');
      await page.getByText('2 changes', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
      const state = await computedTargetState(target);
      assert(Math.abs(state.transformComponents.translateX - 18) < 0.01, 'Rotate discarded the confirmed X component');
      assert(Math.abs(state.transformComponents.rotate - 7) < 0.01, 'Rotate was not applied');
      const undo = page.getByRole('button', { name: 'Undo', exact: true });
      await undo.click();
      await undo.click();
      await page.getByText('0 changes', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
      return { composedTransform: state.transform, inlineTransform: state.inlineTransform };
    });

    await record('lab.preview-scroll-restoration', async () => {
      await frame.evaluate(() => window.scrollTo(0, Math.min(1200, document.documentElement.scrollHeight - innerHeight)));
      const before = await frame.evaluate(() => window.scrollY);
      const preview = page.getByRole('button', { name: 'Preview', exact: true });
      assert.equal(await preview.count(), 1);
      const startedAt = Date.now();
      await preview.click();
      await page.screenshot({ path: resolve(evidenceDir, 'lab-desktop-preview.png'), animations: 'disabled' });
      const edit = page.getByRole('button', { name: 'Edit', exact: true });
      assert.equal(await edit.count(), 1);
      await edit.click();
      metrics.previewSwitchMs = Date.now() - startedAt;
      const after = await frame.evaluate(() => window.scrollY);
      assert.equal(after, before, 'Preview did not restore clone scroll');
      return { previewSwitchMs: metrics.previewSwitchMs, scrollY: before };
    });

    await record('lab.canonical-device-visuals', async () => {
      const results = [];
      for (const device of DEVICES) {
        const button = page.getByRole('button', { name: device.label, exact: true });
        assert.equal(await button.count(), 1);
        await button.click();
        await page.getByText(`${device.width} × ${device.height}`, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
        const pressed = await button.getAttribute('aria-pressed');
        assert.equal(pressed, 'true');
        const path = resolve(evidenceDir, `lab-${device.id}-editing.png`);
        await page.screenshot({ path, animations: 'disabled' });
        results.push({ ...device, screenshot: path });
      }
      return results;
    });

    await record('lab.security-boundary', async () => {
      const iframe = page.locator('iframe[title="Native animated website runtime"]');
      const sandbox = await iframe.getAttribute('sandbox');
      assert(sandbox && !sandbox.includes('allow-same-origin'));
      assert(!sandbox.includes('allow-top-navigation'));
      assert(!sandbox.includes('allow-popups'));
      const isolation = await frame.evaluate(() => {
        let hostDomReadable = false;
        try { hostDomReadable = Boolean(window.top.document.body); } catch (_) {}
        return { hostDomReadable, origin: window.origin };
      });
      assert.equal(isolation.hostDomReadable, false);
      assert.equal(isolation.origin, 'null');
      assert.deepEqual([...new Set(externalRequests)], []);
      return { sandbox, ...isolation, externalRequests: [] };
    });

    await record('lab.accessibility-and-responsive-shell', async () => {
      const hostWidths = [1440, 1024, 768];
      const widths = [];
      for (const width of hostWidths) {
        await page.setViewportSize({ width, height: 960 });
        const overflow = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        assert(overflow.scrollWidth <= overflow.clientWidth, `host requires horizontal scroll at ${width}px`);
        widths.push({ width, ...overflow });
      }
      const audit = await page.evaluate(() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const controls = [...document.querySelectorAll('button,input,select,textarea,a[href]')].filter(visible);
        const unnamed = controls.filter((element) => {
          const label = element.getAttribute('aria-label')
            || element.getAttribute('title')
            || element.textContent?.trim()
            || (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim())
            || element.closest('label')?.textContent?.trim();
          return !label;
        }).map((element) => element.outerHTML.slice(0, 180));
        return { controls: controls.length, unnamed };
      });
      assert.deepEqual(audit.unnamed, []);
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const active = document.activeElement;
        const style = active ? getComputedStyle(active) : null;
        return { tag: active?.tagName, name: active?.getAttribute('aria-label') || active?.textContent?.trim(), outline: style?.outlineStyle };
      });
      assert(focus.tag && focus.tag !== 'BODY', 'keyboard focus did not enter the editor');
      assert(await page.getByText('Runtime connected', { exact: true }).isVisible(), 'runtime status is not available as text');
      return { hostWidths: widths, controls: audit.controls, focus };
    });

    await record('lab.reduced-motion-host-only', async () => {
      const reduced = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      });
      try {
        const reducedPage = await reduced.newPage();
        await reducedPage.goto(`${baseUrl}/motion-editor`, { waitUntil: 'domcontentloaded' });
        await reducedPage.getByText('Runtime connected', { exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
        const hostDuration = await reducedPage.getByRole('button', { name: 'Desktop', exact: true })
          .evaluate((element) => getComputedStyle(element).transitionDuration);
        const reducedFrame = reducedPage.frames().find((candidate) => candidate.parentFrame());
        assert(reducedFrame);
        const cloneMotion = await reducedFrame.evaluate(() => {
          const values = [...document.querySelectorAll('*')].slice(0, 4000).map((element) => {
            const style = getComputedStyle(element);
            return { animation: style.animationDuration, transition: style.transitionDuration };
          });
          return values.find((value) => value.animation !== '0s' || value.transition !== '0s') || null;
        });
        assert(Number.parseFloat(hostDuration) <= 0.00001, `host chrome transition remained ${hostDuration}`);
        assert(cloneMotion, 'clone-authored motion disappeared under reduced motion');
        return { hostDuration, cloneMotion };
      } finally {
        await reduced.close();
      }
    });

    await record('lab.console-and-performance-evidence', async () => {
      const actionable = consoleErrors.filter((message) => !message.includes('Invalid property force3D'));
      assert.deepEqual(actionable, []);
      report.metrics = metrics;
      report.console = { errors: consoleErrors };
      report.network = { blockedExternalRequests: [...new Set(externalRequests)] };
      return { metrics, consoleErrors: consoleErrors.length };
    });
  } finally {
    await context.close();
  }
}

async function inspectCanvasPrerequisites() {
  const missingEnvironment = REQUIRED_CANVAS_ENV.filter((key) => !process.env[key]);
  const result = {
    explicitMutationApproval: process.env.E2E_NATIVE_MOTION_ALLOW_MUTATIONS === '1',
    missingEnvironment,
    schema: null,
  };
  if (!process.env.DATABASE_URL) return result;
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('native_bundles','native_motion_edit_sessions','motion_diagnostic_events')
     ORDER BY table_name`;
  const columns = await sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='snapshots'
       AND column_name IN ('native_bundle_id','motion_manifest','motion_manifest_version')
     ORDER BY column_name`;
  result.schema = {
    tables: tables.map((row) => row.table_name),
    snapshotColumns: columns.map((row) => row.column_name),
    migrated: tables.length === 3 && columns.length === 3,
  };
  return result;
}

async function runCanvasGate({ browser, baseUrl, evidenceDir, report }) {
  const prerequisites = await inspectCanvasPrerequisites();
  report.canvasPrerequisites = prerequisites;
  const problems = [];
  if (!prerequisites.explicitMutationApproval) problems.push('E2E_NATIVE_MOTION_ALLOW_MUTATIONS=1 is required for the isolated fixture.');
  if (prerequisites.missingEnvironment.length) problems.push(`Missing ${prerequisites.missingEnvironment.join(', ')}.`);
  if (!prerequisites.schema?.migrated) problems.push('The connected database is not migrated for native sessions and diagnostics.');
  if (problems.length) {
    const error = new Error(`Persisted /canvas acceptance is unavailable: ${problems.join(' ')}`);
    error.code = 'task16_canvas_prerequisite';
    throw error;
  }
  throw new Error('Persisted /canvas fixture is configured, but its mutation pack must be reviewed against the fixture ownership record before execution.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.startServer && !options.baseUrl) throw new Error('--no-start-server requires --base-url.');
  await loadLocalEnv();

  const runId = `task16-${timestampId()}-${randomUUID().slice(0, 8)}`;
  const evidenceDir = resolve(options.outputRoot, runId);
  await mkdir(options.outputRoot, { recursive: true });
  await mkdir(evidenceDir, { recursive: false });
  const report = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    mode: options.mode,
    branch: process.env.GIT_BRANCH || null,
    checks: [],
    verdict: 'running',
  };
  let server = null;
  let browser = null;
  const baseUrl = options.baseUrl || `http://127.0.0.1:${options.port}`;

  try {
    if (options.startServer && !options.baseUrl) {
      server = startNextServer(options.port);
      await waitForServer(baseUrl, server.child);
    }
    browser = await chromium.launch({ headless: !options.headed });
    if (options.mode !== 'canvas') await runLab({ browser, baseUrl, evidenceDir, report });
    if (options.mode !== 'lab') await runCanvasGate({ browser, baseUrl, evidenceDir, report });
    report.verdict = report.checks.every((check) => check.status === 'passed') ? 'passed' : 'failed';
  } catch (error) {
    report.verdict = error?.code === 'task16_canvas_prerequisite' ? 'blocked' : 'failed';
    report.failure = { code: error?.code || 'e2e_failed', message: error?.message || String(error) };
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await stopNextServer(server);
    if (server?.logs?.length) {
      await writeFile(resolve(evidenceDir, 'next-server.log'), server.logs.join(''), { flag: 'wx' });
    }
    report.completedAt = new Date().toISOString();
    await writeJsonExclusive(resolve(evidenceDir, 'report.json'), report);
    process.stdout.write([
      `Task 16 E2E run: ${runId}`,
      `Mode: ${options.mode}`,
      `Verdict: ${report.verdict}`,
      `Evidence: ${evidenceDir}`,
      ...(report.failure ? [`Reason: ${report.failure.message}`] : []),
    ].join('\n') + '\n');
  }
}

// Only auto-run when executed directly (node …spec.js). Importing the module for
// tests must NOT start a server or run the gate.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Task 16 E2E failed before evidence initialization: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
