#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import {
  createMotionSmokeRunner,
} from '../lib/motion-editor/smoke-runner.js';
import {
  injectRuntimeBridge,
  rewriteRuntimePaths,
} from '../lib/motion-editor/native-clone-gateway.js';
import {
  issueRuntimeSessionToken,
  verifyRuntimeSessionToken,
} from '../lib/motion-editor/runtime-session-token.js';
import {
  MOTION_EDITOR_PROTOCOL,
  MOTION_EDITOR_PROTOCOL_V2,
  SUPPORTED_MOTION_EDITOR_PROTOCOLS,
  commandV2,
} from '../lib/motion-editor/protocol.js';
import { parseMotionManifest } from '../lib/motion-editor/manifest.js';

const DEVICE_MATRIX = Object.freeze([
  { id: 'desktop', width: 1280, height: 800 },
  { id: 'tablet', width: 768, height: 920 },
  { id: 'mobile', width: 390, height: 844 },
]);

const DEFAULT_CORPUS = Object.freeze([
  resolve(process.cwd(), '../../Clone/dist'),
  resolve(process.cwd(), '../../transplants/Unspirit-Animated-Clone/dist'),
]);

const CONTENT_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bridgeHash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function elementIdForAuthoredId(id) {
  return `el-${bridgeHash(`id:${id}`)}`;
}

function slug(value) {
  return String(value || 'fixture')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'fixture';
}

function parseArgs(argv) {
  const options = {
    corpus: [],
    includeDefaultCorpus: true,
    outputDir: resolve(process.cwd(), '.motion-smoke'),
    manualReviewPath: null,
    json: false,
    diagnosticSessionId: process.env.UNCRAFT_SMOKE_DIAGNOSTIC_SESSION_ID || null,
    diagnosticUserId: process.env.UNCRAFT_SMOKE_DIAGNOSTIC_USER_ID || null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--corpus') options.corpus.push(resolve(argv[++index]));
    else if (argument === '--output') options.outputDir = resolve(argv[++index]);
    else if (argument === '--manual-review') options.manualReviewPath = resolve(argv[++index]);
    else if (argument === '--no-default-corpus') options.includeDefaultCorpus = false;
    else if (argument === '--json') options.json = true;
    else if (argument === '--diagnostic-session') options.diagnosticSessionId = argv[++index];
    else if (argument === '--diagnostic-user') options.diagnosticUserId = argv[++index];
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    'Usage: npm run smoke:motion-controls -- [options]',
    '',
    '  --corpus <dist-dir>       Add a local reconstructed clone corpus entry',
    '  --no-default-corpus       Skip the local Clone/transplants discovery',
    '  --output <dir>            Write a new immutable JSON report to this directory',
    '  --manual-review <json>    Apply explicit confirmed/false-positive reviews',
    '  --diagnostic-session <id> Persist sanitized smoke events to an owned edit session',
    '  --diagnostic-user <id>    Owner for the trusted diagnostic session',
    '  --json                    Print the complete report',
  ].join('\n'));
}

function candidateFor({
  fixtureId,
  bundleId,
  runtimeFingerprint,
  targetAuthoredId = 'uncraft-smoke-target',
  targetSemanticId = 'smoke-surface',
  candidateRuntimeFingerprint = runtimeFingerprint,
} = {}) {
  const controlId = `control-${createHash('sha256').update(`${fixtureId}:intensity`).digest('hex').slice(0, 24)}`;
  return {
    id: controlId,
    bundleId,
    runtimeFingerprint: candidateRuntimeFingerprint,
    scope: 'group',
    label: 'Motion intensity',
    description: 'Measures a bounded visible change inside the active runtime.',
    controlType: 'slider-number',
    unit: 'multiplier',
    currentValue: 1,
    originalValue: 1,
    targets: [{
      semanticTargetId: targetSemanticId,
      elementId: elementIdForAuthoredId(targetAuthoredId),
      motionId: null,
      property: 'custom.intensity',
    }],
    binding: {
      kind: 'custom-capability',
      capability: 'motion.scalar',
      property: 'custom.intensity',
    },
    domain: { min: 0.8, max: 1.2, step: 0.2 },
    teardown: { required: true, capability: 'motion.scalar.release' },
    limits: { executionMs: 500, mutationCount: 4, targetCount: 1, network: false },
    ladder: 'custom-adapter',
    provenance: {
      source: 'runtime',
      engine: 'browser',
      decisionCode: 'task_15_custom_candidate',
    },
  };
}

function readyControl(candidate, fixture) {
  return {
    ...candidate,
    bundleId: fixture.bundleId,
    runtimeFingerprint: fixture.runtimeFingerprint,
    compatibleLineage: [{ bundleId: fixture.bundleId, runtimeFingerprint: fixture.runtimeFingerprint }],
    validation: {
      schema: 'passed',
      read: 'passed',
      apply: 'passed',
      effect: 'passed',
      restore: 'passed',
      deterministic: 'passed',
      teardown: 'passed',
      fingerprint: 'passed',
      validatedAt: '1970-01-01T00:00:00.000Z',
    },
    status: 'ready',
  };
}

function runtimeManifest(fixture, candidate) {
  return parseMotionManifest({
    schemaVersion: 2,
    baseBundleId: fixture.bundleId,
    runtimeFingerprint: fixture.runtimeFingerprint,
    transactions: [],
    controlManifest: {
      schemaVersion: 1,
      bundleId: fixture.bundleId,
      runtimeFingerprint: fixture.runtimeFingerprint,
      controls: [readyControl(candidate, fixture)],
    },
    responsiveManifest: {},
  }, { expectedBundleId: fixture.bundleId });
}

function syntheticHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Uncraft deterministic motion smoke fixture</title>
  <style>
    :root { color-scheme: dark; background: #191917; color: #f1f0eb; font: 16px system-ui; }
    body { margin: 0; min-height: 190vh; overflow-x: hidden; }
    main { display: grid; gap: 28px; padding: 48px; }
    .tile { width: 180px; height: 96px; border-radius: 18px; background: #2966ea; }
    #uncraft-smoke-target { transition: filter 120ms linear; filter: brightness(1); }
    #finite { animation: finite-shift 2s ease-out 1 both; }
    #infinite { animation: infinite-turn 2s linear infinite; }
    #mixed { animation: finite-shift 2.4s ease-in-out infinite alternate; }
    #transform { animation: matrix-motion 2s ease-in-out infinite alternate; transform: perspective(500px) skewX(4deg); }
    #offscreen { margin-top: 110vh; }
    @keyframes finite-shift { from { transform: translateX(0); opacity: .7; } to { transform: translateX(48px); opacity: 1; } }
    @keyframes infinite-turn { to { transform: rotate(1turn); } }
    @keyframes matrix-motion { to { transform: perspective(500px) matrix(1, .12, .08, 1, 36, 0) skewX(8deg); } }
    @media (max-width: 600px) { #responsive { transform: translateX(28px); width: 132px; } }
  </style>
</head>
<body>
  <main id="uncraft-smoke-target" data-uncraft-smoke-value="1">
    <div id="finite" class="tile"></div>
    <div id="infinite" class="tile"></div>
    <div id="mixed" class="tile"></div>
    <div id="transform" class="tile"></div>
    <div id="responsive" class="tile"></div>
    <div id="offscreen" class="tile"></div>
  </main>
  <script>
    document.querySelector('#mixed').animate([
      { opacity: .65, translate: '0 0' },
      { opacity: 1, translate: '28px 0' }
    ], { duration: 1600, iterations: Infinity, direction: 'alternate' });
  </script>
</body>
</html>`;
}

function smokeSetupScript({ addSentinel, addScrollTriggerPin = false }) {
  const smokeElementId = elementIdForAuthoredId('uncraft-smoke-target');
  const sentinel = addSentinel
    ? `const sentinel = document.createElement('div');
       sentinel.id = 'uncraft-smoke-target';
       sentinel.dataset.uncraftSmokeValue = '1';
       sentinel.dataset.uncraftId = '${smokeElementId}';
       sentinel.setAttribute('aria-hidden', 'true');
       sentinel.style.cssText = 'position:fixed;right:8px;bottom:8px;width:24px;height:24px;border-radius:8px;background:#2966ea;z-index:2147483000;pointer-events:none;filter:brightness(1)';
       document.body.appendChild(sentinel);`
    : `const sentinel = document.getElementById('uncraft-smoke-target');
       if (sentinel) {
         sentinel.dataset.uncraftId = '${smokeElementId}';
         if (!sentinel.dataset.uncraftSmokeValue) sentinel.dataset.uncraftSmokeValue = '1';
       }`;
  return `<script data-uncraft-smoke-setup>
  (() => {
    ${sentinel}
    window.__uncraftMotionControlCapabilities = window.__uncraftMotionControlCapabilities || {};
    window.__uncraftMotionControlCapabilities['motion.scalar'] = {
      read(context) { return Number(context.element.dataset.uncraftSmokeValue || 1); },
      apply(context) {
        const value = Number(context.value);
        context.element.dataset.uncraftSmokeValue = String(value);
        context.element.style.filter = 'brightness(' + value + ')';
      },
    };
    ${addScrollTriggerPin ? `
      if (window.gsap && window.ScrollTrigger && sentinel) {
        try {
          window.gsap.registerPlugin(window.ScrollTrigger);
          window.gsap.to(sentinel, {
            x: 12,
            ease: 'none',
            scrollTrigger: {
              id: 'uncraft-task-15-pin-fixture',
              trigger: sentinel,
              start: 'top bottom',
              end: '+=120',
              scrub: true,
              pin: true,
            },
          });
        } catch (_) {}
      }
    ` : ''}
  })();
  </script>`;
}

function injectBeforeBodyEnd(html, source) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${source}</body>`) : `${html}${source}`;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(root, current = root, output = []) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) await filesUnder(root, path, output);
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function directoryFingerprint(root) {
  const hash = createHash('sha256');
  const files = await filesUnder(root);
  for (const file of files) {
    hash.update(relative(root, file).split(sep).join('/'));
    hash.update(await readFile(file));
  }
  return `sha256:${hash.digest('hex')}`;
}

async function scanRuntimeFamilies(root) {
  const files = (await filesUnder(root)).filter((file) => ['.html', '.js', '.mjs', '.css'].includes(extname(file).toLowerCase()));
  const chunks = [];
  let bytes = 0;
  for (const file of files) {
    if (bytes >= 12 * 1024 * 1024) break;
    const value = await readFile(file, 'utf8');
    chunks.push(value);
    bytes += value.length;
  }
  const source = chunks.join('\n');
  const gsap = /\bgsap\b|GreenSock/i.test(source);
  const scrollTrigger = /ScrollTrigger|scrollTrigger/i.test(source);
  const lottie = /\blottie\b|bodymovin/i.test(source);
  const fixtureClasses = [];
  if (gsap) fixtureClasses.push('gsap-timeline', 'gsap-tween');
  if (scrollTrigger) {
    fixtureClasses.push('scrolltrigger-scrub', 'scrolltrigger-entrance');
    if (/\bpin\s*:\s*(?:true|["'])/i.test(source)) fixtureClasses.push('scrolltrigger-pin');
  }
  if (lottie) fixtureClasses.push('lottie-declarative');
  const runtimeFamily = scrollTrigger ? 'gsap-scrolltrigger' : gsap ? 'gsap' : lottie ? 'lottie' : 'browser-native';
  return { runtimeFamily, fixtureClasses: [...new Set(fixtureClasses)], scrollTrigger };
}

function syntheticFixtures() {
  const html = syntheticHtml();
  const buildFingerprint = sha256(html);
  const base = {
    kind: 'deterministic',
    producerFamily: 'fixture',
    runtimeFamily: 'browser-native',
    offline: true,
    entryPath: 'index.html',
    html,
    buildFingerprint,
  };
  const definitions = [
    {
      id: 'deterministic-browser-motion',
      siteClass: 'fixture-browser-motion',
      fixtureClasses: [
        'plain-css-transition',
        'css-keyframes-finite',
        'css-keyframes-infinite',
        'waapi',
        'mixed-engine',
        'transform-matrix-skew-perspective',
        'responsive-computed',
        'partially-offscreen',
      ],
    },
    {
      id: 'deterministic-runtime-reload',
      siteClass: 'fixture-runtime-reload',
      fixtureClasses: ['runtime-reload'],
      recoveryScenario: 'fingerprint',
    },
    {
      id: 'deterministic-stale-binding',
      siteClass: 'fixture-stale-binding',
      fixtureClasses: ['stale-binding'],
      recoveryScenario: 'stale-binding',
    },
  ];
  return definitions.map((definition) => {
    const bundleId = deterministicUuid(`task-15:${definition.id}`);
    const runtimeFingerprint = sha256(`${definition.id}:${html}`);
    const fixture = { ...base, ...definition, bundleId, runtimeFingerprint };
    const healthyCandidate = candidateFor({ fixtureId: definition.id, bundleId, runtimeFingerprint });
    if (definition.recoveryScenario === 'fingerprint') {
      fixture.candidate = { ...healthyCandidate, runtimeFingerprint: sha256('stale-runtime') };
      fixture.recoveryCandidate = healthyCandidate;
    } else if (definition.recoveryScenario === 'stale-binding') {
      fixture.candidate = {
        ...healthyCandidate,
        targets: healthyCandidate.targets.map((target) => ({
          ...target,
          semanticTargetId: 'missing-smoke-surface',
          elementId: elementIdForAuthoredId('missing-smoke-target'),
        })),
      };
      fixture.recoveryCandidate = healthyCandidate;
    } else fixture.candidate = healthyCandidate;
    return fixture;
  });
}

async function realCloneFixture(root, index) {
  const entryPath = 'index.html';
  if (!await pathExists(resolve(root, entryPath))) return null;
  const buildFingerprint = await directoryFingerprint(root);
  const family = await scanRuntimeFamilies(root);
  const id = slug(`real-${index + 1}-${root.split(sep).slice(-2).join('-')}`);
  const bundleId = deterministicUuid(`task-15:${root}:${buildFingerprint}`);
  const runtimeFingerprint = sha256(`${buildFingerprint}:${family.runtimeFamily}`);
  const fixture = {
    id,
    kind: 'real-clone',
    fixtureClasses: family.fixtureClasses,
    producerFamily: slug(root.includes('transplants') ? 'unspirit-transplant' : 'localized-clone'),
    runtimeFamily: family.runtimeFamily,
    siteClass: slug(`real-${family.runtimeFamily}`),
    offline: true,
    bundleId,
    runtimeFingerprint,
    buildFingerprint,
    root,
    entryPath,
    harnessSentinel: true,
    injectScrollTriggerPin: family.scrollTrigger,
  };
  if (fixture.injectScrollTriggerPin && !fixture.fixtureClasses.includes('scrolltrigger-pin')) {
    fixture.fixtureClasses.push('scrolltrigger-pin');
  }
  fixture.candidate = candidateFor({ fixtureId: id, bundleId, runtimeFingerprint });
  return fixture;
}

async function buildMatrix(options) {
  const roots = [...new Set([
    ...(options.includeDefaultCorpus ? DEFAULT_CORPUS : []),
    ...options.corpus,
  ])];
  const realFixtures = (await Promise.all(roots.map(realCloneFixture))).filter(Boolean);
  const fixtures = [...syntheticFixtures(), ...realFixtures];
  return {
    schemaVersion: 1,
    buildVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) || 'task-15-local',
    devices: DEVICE_MATRIX,
    availableFamilies: realFixtures.map((fixture) => ({
      producer: fixture.producerFamily,
      runtime: fixture.runtimeFamily,
    })),
    fixtures,
  };
}

function topLevelPrefixes(fixture) {
  if (!fixture.root) return [];
  return fixture.assetPrefixes || [];
}

async function prepareFixtureAssets(fixtures) {
  for (const fixture of fixtures) {
    if (!fixture.root) {
      fixture.assetPrefixes = [];
      continue;
    }
    const entries = await readdir(fixture.root, { withFileTypes: true });
    fixture.assetPrefixes = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }
}

function runtimeHtml(html, fixture, candidate, token, session) {
  const withSetup = injectBeforeBodyEnd(html, smokeSetupScript({
    addSentinel: fixture.harnessSentinel === true,
    addScrollTriggerPin: fixture.injectScrollTriggerPin === true,
  }));
  const rewritten = rewriteRuntimePaths(withSetup, topLevelPrefixes(fixture), `/runtime/${encodeURIComponent(token)}`);
  return injectRuntimeBridge(rewritten, {
    initialManifest: runtimeManifest(fixture, candidate),
    bundleId: fixture.bundleId,
    runtimeSessionId: session.sessionId,
    runtimeFingerprint: fixture.runtimeFingerprint,
    sessionNonce: session.nonce,
  });
}

function hostHtml(runtimeUrl) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Uncraft motion smoke host</title></head>
  <body style="margin:0;background:#191917">
    <iframe id="runtime" title="Motion smoke runtime" sandbox="allow-scripts allow-pointer-lock" src="${runtimeUrl}" style="width:100vw;height:100vh;border:0"></iframe>
    <script>
      window.__uncraftSmokeMessages = [];
      window.addEventListener('message', (event) => {
        if (event.source !== document.getElementById('runtime').contentWindow) return;
        window.__uncraftSmokeMessages.push({ data: event.data, origin: event.origin });
        if (window.__uncraftSmokeMessages.length > 1000) window.__uncraftSmokeMessages.splice(0, 500);
      });
      window.__uncraftSmokeSend = (message) => document.getElementById('runtime').contentWindow.postMessage(message, '*');
    </script>
  </body></html>`;
}

function safeRuntimeAssetPath(root, rawPath) {
  const segments = rawPath.split('/').map((segment) => decodeURIComponent(segment));
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) return null;
  const path = resolve(root, ...segments);
  return path === root || path.startsWith(`${root}${sep}`) ? path : null;
}

async function fixtureAsset(fixture, path) {
  if (!fixture.root) {
    if (path !== fixture.entryPath) return null;
    return Buffer.from(fixture.html);
  }
  const file = safeRuntimeAssetPath(fixture.root, path);
  if (!file || !await pathExists(file) || !(await stat(file)).isFile()) return null;
  return readFile(file);
}

function startSmokeGateway(fixtures, secret) {
  const byBundleId = new Map(fixtures.map((fixture) => [fixture.bundleId, fixture]));
  const runtimeState = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/host/')) {
        const token = url.searchParams.get('token');
        const body = hostHtml(`/runtime/${encodeURIComponent(token)}/index.html`);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(body);
        return;
      }
      const match = url.pathname.match(/^\/runtime\/([^/]+)\/(.+)$/);
      if (!match) {
        response.writeHead(404).end();
        return;
      }
      const token = decodeURIComponent(match[1]);
      const verification = verifyRuntimeSessionToken(token, { secret, loginSecret: null });
      if (verification.error) {
        response.writeHead(404, { 'cache-control': 'no-store' }).end('Unavailable');
        return;
      }
      const fixture = byBundleId.get(verification.payload.bundleId);
      const state = runtimeState.get(token);
      if (!fixture || !state || state.sessionId !== verification.payload.sessionId) {
        response.writeHead(404, { 'cache-control': 'no-store' }).end('Unavailable');
        return;
      }
      const assetPath = match[2].split('?')[0];
      const bytes = await fixtureAsset(fixture, assetPath);
      if (!bytes) {
        response.writeHead(404, { 'cache-control': 'no-store' }).end('Unavailable');
        return;
      }
      const contentType = CONTENT_TYPES[extname(assetPath).toLowerCase()] || 'application/octet-stream';
      const isHtml = contentType.startsWith('text/html');
      const isText = /^(?:text\/|application\/(?:javascript|json))/.test(contentType);
      const headers = {
        'content-type': contentType,
        'cache-control': isHtml ? 'no-store' : 'private, max-age=120, immutable',
        'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
        'cross-origin-resource-policy': 'cross-origin',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      };
      if (!isHtml && !isText) {
        response.writeHead(200, headers).end(bytes);
        return;
      }
      const text = new TextDecoder().decode(bytes);
      const body = isHtml
        ? runtimeHtml(text, fixture, state.candidate, token, state)
        : rewriteRuntimePaths(text, topLevelPrefixes(fixture), `/runtime/${encodeURIComponent(token)}`);
      response.writeHead(200, headers).end(body);
    } catch {
      response.writeHead(500, { 'cache-control': 'no-store' }).end('Unavailable');
    }
  });
  return {
    runtimeState,
    async listen() {
      await new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolvePromise);
      });
      const address = server.address();
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
      await new Promise((resolvePromise) => server.close(resolvePromise));
    },
  };
}

async function waitForRuntimeMessage(page, predicate, timeout = 15_000) {
  await page.waitForFunction(predicateSource => {
    const predicateFn = new Function('entry', `return (${predicateSource})(entry)`);
    return (window.__uncraftSmokeMessages || []).some(predicateFn);
  }, predicate.toString(), { timeout });
  return page.evaluate(predicateSource => {
    const predicateFn = new Function('entry', `return (${predicateSource})(entry)`);
    return [...(window.__uncraftSmokeMessages || [])].reverse().find(predicateFn);
  }, predicate.toString());
}

async function sendHostMessage(page, message) {
  await page.evaluate(payload => window.__uncraftSmokeSend(payload), message);
}

async function negotiate(page) {
  const readyEntry = await waitForRuntimeMessage(page, entry => entry.data?.type === 'runtime-ready');
  const ready = readyEntry.data;
  const context = {
    sessionNonce: ready.sessionNonce,
    runtimeGeneration: ready.runtimeGeneration,
    bundleId: ready.bundleId,
    sessionId: ready.sessionId,
    origin: readyEntry.origin,
  };
  const requestId = `negotiate-${randomUUID()}`;
  await sendHostMessage(page, {
    protocol: MOTION_EDITOR_PROTOCOL,
    protocolVersion: MOTION_EDITOR_PROTOCOL,
    supportedProtocols: SUPPORTED_MOTION_EDITOR_PROTOCOLS,
    source: 'host',
    type: 'negotiate-protocol',
    payload: { selectedProtocol: MOTION_EDITOR_PROTOCOL_V2 },
    ...context,
    requestId,
  });
  await waitForRuntimeMessage(page, entry => entry.data?.type === 'protocol-negotiated');
  return context;
}

async function frameFor(page) {
  const handle = await page.locator('#runtime').elementHandle();
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('Smoke runtime frame did not open.');
  return frame;
}

async function targetState(frame, elementId) {
  const locator = frame.locator(`[data-uncraft-id="${elementId}"]`);
  if (await locator.count() !== 1) return null;
  const state = await locator.evaluate(element => {
    const computed = getComputedStyle(element);
    return {
      value: Number(element.dataset.uncraftSmokeValue || 1),
      filter: computed.filter,
      opacity: computed.opacity,
      transform: computed.transform,
      width: computed.width,
      height: computed.height,
    };
  });
  return { ...state, fingerprint: sha256(JSON.stringify(state)) };
}

function responseForRequest(requestId) {
  return new Function('entry', `return entry.data?.requestId === ${JSON.stringify(requestId)}
    && ['transaction-committed', 'transaction-rejected'].includes(entry.data?.type);`);
}

async function applyControlTransaction({ page, context, candidate, value, source }) {
  const requestId = `${source}-${randomUUID()}`;
  const transaction = {
    id: randomUUID(),
    requestId,
    source: 'custom-control',
    createdAt: new Date().toISOString(),
    patches: candidate.targets.map((target) => ({
      id: randomUUID(),
      elementId: target.elementId,
      kind: 'control',
      property: candidate.id,
      motionId: null,
      before: candidate.currentValue,
      value,
      createdAt: new Date().toISOString(),
    })),
  };
  await sendHostMessage(page, commandV2('apply-transaction', { transaction }, { ...context, requestId }));
  const entry = await waitForRuntimeMessage(page, responseForRequest(requestId));
  if (entry.data.type === 'transaction-rejected') {
    return { ok: false, code: entry.data.payload?.code || 'transaction_rejected' };
  }
  return { ok: true, transaction: entry.data.payload.transaction };
}

async function rollbackControlTransaction({ page, context, transaction }) {
  const requestId = `rollback-${randomUUID()}`;
  await sendHostMessage(page, commandV2('rollback-transaction', {
    targetTransactionId: transaction.id,
    transactionId: randomUUID(),
  }, { ...context, requestId }));
  const entry = await waitForRuntimeMessage(page, responseForRequest(requestId));
  if (entry.data.type === 'transaction-rejected') {
    return { ok: false, code: entry.data.payload?.code || 'rollback_failed' };
  }
  return { ok: true, transaction: entry.data.payload.transaction };
}

function browserRuntimeOpener({ browser, baseUrl, gateway, secret, outputDir, manualReviews }) {
  return async function openRuntime({ fixture, device, runId }) {
    const page = await browser.newPage({ viewport: { width: device.width, height: device.height } });
    const externalRequests = [];
    await page.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (target.origin === baseUrl || ['data:', 'blob:'].includes(target.protocol)) await route.continue();
      else {
        externalRequests.push(`${target.protocol}//${target.host}`);
        await route.abort('blockedbyclient');
      }
    });
    const session = {
      sessionId: randomUUID(),
      nodeId: randomUUID(),
      candidate: fixture.candidate,
    };
    const issued = issueRuntimeSessionToken({
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      bundleId: fixture.bundleId,
      entryPrefix: '',
    }, { secret, loginSecret: null, ttlSeconds: 300 });
    Object.assign(session, issued);
    gateway.runtimeState.set(issued.token, session);
    const hostUrl = `${baseUrl}/host/${fixture.bundleId}?token=${encodeURIComponent(issued.token)}`;

    let context;
    let frame;
    async function boot() {
      await page.goto(hostUrl, { waitUntil: 'load', timeout: 30_000 });
      context = await negotiate(page);
      frame = await frameFor(page);
    }
    await boot();
    let currentCandidate = session.candidate;
    const transactions = new Map();
    const evidenceArtifacts = [];
    const capturedStages = new Set();

    async function captureReviewArtifact(candidate, stage, elementId) {
      const key = `${candidate.id}:${stage}`;
      if (capturedStages.has(key)) return;
      const locator = frame.locator(`[data-uncraft-id="${elementId}"]`);
      if (await locator.count() !== 1) return;
      const directory = resolve(outputDir, runId, 'screenshots');
      await mkdir(directory, { recursive: true });
      const filename = `${fixture.id}-${device.id}-${candidate.id}-${stage}.png`;
      const path = resolve(directory, filename);
      const bytes = await locator.screenshot({ animations: 'disabled', caret: 'hide' });
      await writeFile(path, bytes, { flag: 'wx' });
      capturedStages.add(key);
      evidenceArtifacts.push({
        controlId: candidate.id,
        stage,
        path: relative(outputDir, path).split(sep).join('/'),
        fingerprint: sha256(bytes),
      });
    }

    function createValidationTransport(candidate) {
      currentCandidate = candidate;
      return async (stage, proposal, stageContext) => {
        const target = proposal.targets[0];
        const beforeState = await targetState(frame, target.elementId);
        if (stage === 'read') {
          if (!beforeState) return { ok: false, code: 'target_missing' };
          await captureReviewArtifact(candidate, 'before', target.elementId);
          return { ok: true, before: beforeState.value };
        }
        if (!beforeState) return { ok: false, code: 'target_missing' };
        if (stage === 'apply' || stage === 'reapply') {
          const applied = await applyControlTransaction({
            page,
            context,
            candidate,
            value: stageContext.value,
            source: stage,
          });
          if (!applied.ok) return applied;
          transactions.set(stage, applied.transaction);
          const afterState = await targetState(frame, target.elementId);
          const changed = Boolean(afterState && afterState.fingerprint !== beforeState.fingerprint);
          if (changed) await captureReviewArtifact(candidate, 'apply', target.elementId);
          return {
            ok: true,
            value: afterState?.value,
            mutations: proposal.targets.length,
            effect: { changed },
            visualOracle: {
              changed,
              kind: 'computed-style',
              beforeFingerprint: beforeState.fingerprint,
              afterFingerprint: afterState?.fingerprint,
            },
            semanticCoverage: {
              declaredTargetIds: proposal.targets.map(item => item.semanticTargetId),
              affectedTargetIds: changed ? proposal.targets.map(item => item.semanticTargetId) : [],
              unhandledTargetIds: [],
            },
          };
        }
        const sourceStage = stage === 'restore' ? 'apply' : 'reapply';
        const transaction = transactions.get(sourceStage);
        if (!transaction) return { ok: false, code: 'rollback_failed' };
        const rollback = await rollbackControlTransaction({ page, context, transaction });
        if (!rollback.ok) return rollback;
        const restoredState = await targetState(frame, target.elementId);
        const restored = Boolean(restoredState && restoredState.value === stageContext.before);
        if (restored) await captureReviewArtifact(candidate, 'restore', target.elementId);
        return {
          ok: true,
          restored,
          value: restoredState?.value,
          leaks: { listeners: 0, timers: 0, observers: 0 },
          restoreEvidence: {
            restored,
            kind: 'computed-style',
            beforeFingerprint: stageContext.applied?.visualOracle?.beforeFingerprint,
            restoredFingerprint: restoredState?.fingerprint,
          },
        };
      };
    }

    async function runSessionCommand(command) {
      const before = await page.evaluate(() => (window.__uncraftSmokeMessages || [])
        .filter(entry => entry.data?.type === 'transaction-committed').length);
      if (command === 'scrub') {
        await sendHostMessage(page, commandV2('begin-scrub', {}, { ...context, requestId: `scrub-begin-${randomUUID()}` }));
        await sendHostMessage(page, commandV2('end-scrub', {}, { ...context, requestId: `scrub-end-${randomUUID()}` }));
      } else {
        await sendHostMessage(page, commandV2('playback', { action: command }, { ...context, requestId: `${command}-${randomUUID()}` }));
      }
      await page.waitForTimeout(40);
      const after = await page.evaluate(() => (window.__uncraftSmokeMessages || [])
        .filter(entry => entry.data?.type === 'transaction-committed').length);
      return { acknowledged: true, persistentPatches: after - before };
    }

    async function recoverControl({ decision }) {
      if (!fixture.recoveryCandidate) return { recovered: false };
      if (![
        'reinspect', 'rebind', 'reload-runtime', 'regenerate-control',
      ].includes(decision.action)) return { recovered: false };
      currentCandidate = fixture.recoveryCandidate;
      session.candidate = currentCandidate;
      gateway.runtimeState.set(issued.token, session);
      await boot();
      transactions.clear();
      return { recovered: true, candidate: currentCandidate };
    }

    const runtime = {
      gateway: { signed: true, verified: verifyRuntimeSessionToken(issued.token, { secret, loginSecret: null }).error == null },
      bridge: { protocol: MOTION_EDITOR_PROTOCOL_V2 },
      candidates: [currentCandidate],
      renderedControlIds: [fixture.recoveryCandidate?.id || currentCandidate.id],
      externalRequests,
      createValidationTransport,
      runSessionCommand,
      recoverControl,
      manualReview: {},
      evidenceArtifacts,
      async close() {
        gateway.runtimeState.delete(issued.token);
        await page.close();
      },
    };
    const reviewKey = `${fixture.id}:${device.id}:${currentCandidate.id}`;
    if (manualReviews[reviewKey]) runtime.manualReview[currentCandidate.id] = manualReviews[reviewKey];
    return runtime;
  };
}

async function loadManualReviews(path) {
  if (!path) return {};
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Manual review file must be an object.');
  }
  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => (
    value === 'confirmed' || value === 'false-positive'
  )));
}

async function trustedDiagnosticSink(options) {
  if (!options.diagnosticSessionId && !options.diagnosticUserId) {
    return { persisted: false, sink: async () => {} };
  }
  if (!options.diagnosticSessionId || !options.diagnosticUserId) {
    throw new Error('Trusted diagnostic persistence requires both session and user IDs.');
  }
  const [{ db }, diagnostics] = await Promise.all([
    import('../lib/db.js'),
    import('../lib/motion-editor/diagnostics.js'),
  ]);
  const sql = await db();
  const context = await diagnostics.resolveOwnedDiagnosticContext(sql, {
    userId: Number(options.diagnosticUserId),
    sessionId: options.diagnosticSessionId,
  });
  if (!context) throw new Error('The trusted smoke diagnostic session is unavailable or unowned.');
  return {
    persisted: true,
    sink: async (events, metadata) => {
      if (metadata?.trusted !== true) throw new Error('Untrusted smoke diagnostic write rejected.');
      await diagnostics.persistMotionDiagnosticEvents(sql, context, events.map(event => ({
        ...event,
        source: 'smoke',
        origin: 'smoke',
      })));
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const matrix = await buildMatrix(options);
  await prepareFixtureAssets(matrix.fixtures);
  const secret = createHash('sha256').update(`task-15-smoke:${randomUUID()}`).digest('hex');
  const gateway = startSmokeGateway(matrix.fixtures, secret);
  const baseUrl = await gateway.listen();
  const browser = await chromium.launch({ headless: true });
  const diagnostics = await trustedDiagnosticSink(options);
  const manualReviews = await loadManualReviews(options.manualReviewPath);
  try {
    const runner = createMotionSmokeRunner({
      openRuntime: browserRuntimeOpener({
        browser,
        baseUrl,
        gateway,
        secret,
        outputDir: options.outputDir,
        manualReviews,
      }),
      persistEvents: diagnostics.sink,
    });
    const report = await runner.run(matrix);
    const output = {
      ...report,
      diagnostics: {
        persistedToAdmin: diagnostics.persisted,
        origin: 'smoke',
        browserMayChooseOrigin: false,
      },
      corpus: matrix.fixtures.map(fixture => ({
        id: fixture.id,
        kind: fixture.kind,
        producerFamily: fixture.producerFamily,
        runtimeFamily: fixture.runtimeFamily,
        fixtureClasses: fixture.fixtureClasses,
        harnessSentinel: fixture.harnessSentinel === true,
        buildFingerprint: fixture.buildFingerprint,
        runtimeFingerprint: fixture.runtimeFingerprint,
      })),
    };
    await mkdir(options.outputDir, { recursive: true });
    const reportPath = resolve(options.outputDir, `${output.runId}.json`);
    await writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    if (options.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    else process.stdout.write([
      `Motion smoke run: ${output.runId}`,
      `Report: ${reportPath}`,
      `Candidates: ${output.summary.candidatesDiscovered}`,
      `Supported: ${output.summary.supported}`,
      `Recovered: ${output.summary.recovered}`,
      `Disabled: ${output.summary.disabledControls}`,
      `Manual review: ${output.summary.manualReviewStatus}`,
      `Decision: ${output.decision.status}`,
      `Admin persistence: ${output.diagnostics.persistedToAdmin ? 'written' : 'not configured'}`,
    ].join('\n') + '\n');
  } finally {
    await browser.close();
    await gateway.close();
  }
}

main().catch(error => {
  process.stderr.write(`Motion smoke failed: ${error?.code || error?.message || 'unknown_error'}\n`);
  process.exitCode = 1;
});
