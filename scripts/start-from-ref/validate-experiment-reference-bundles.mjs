import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = 'docs/superpowers/experiments/2026-08-03-daselva-three-strategy';
const DEFAULT_BUNDLE = `${ROOT}/reference-bundles.v1.json`;
const DEFAULT_LOCK = `${ROOT}/reference-bundles.lock.json`;
const DEFAULT_MANIFEST = `${ROOT}/manifest.v1.json`;

const bundlePath = resolve(process.cwd(), process.argv[2] || DEFAULT_BUNDLE);
const lockPath = resolve(process.cwd(), process.argv[3] || DEFAULT_LOCK);
const manifestPath = resolve(process.cwd(), process.argv[4] || DEFAULT_MANIFEST);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const bundleRaw = await readFile(bundlePath);
const bundle = JSON.parse(bundleRaw.toString('utf8'));
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const manifestRaw = await readFile(manifestPath);
const manifest = JSON.parse(manifestRaw.toString('utf8'));

assert(bundle.schemaVersion === 'start-from-ref-reference-bundles-v1', 'Unexpected bundle schemaVersion');
assert(bundle.experimentId === manifest.experiment?.id, 'Experiment ID does not match manifest');
assert(bundle.parentManifest?.sha256 === sha256(manifestRaw), 'Parent manifest hash mismatch');
assert(bundle.gate?.status === 'frozen_gate_b', 'Reference bundle is not frozen at Gate B');
assert(bundle.gate?.authorizedGate === 'B', 'Bundle does not identify Gate B');
assert(bundle.gate?.mode === 'bounded_read_only_retrieval', 'Gate B must be read-only retrieval');
assert(bundle.catalogSnapshot?.persistenceWrites === 0, 'Catalog persistence writes must remain zero');

const referenceKeys = Object.keys(bundle.references || {});
assert(referenceKeys.join(',') === 'amici,hotel_odisej,museum_department,root_food,mun', 'Reference key set drifted');
assert(new Set(referenceKeys.map((key) => bundle.references[key].catalog.id)).size === referenceKeys.length, 'Reference IDs must be unique');

const strategies = bundle.strategies || [];
assert(strategies.map((strategy) => strategy.id).join(',') === 'S,C,W', 'Strategies must be exactly S, C and W');
assert(strategies[0].referenceKeys.join(',') === 'amici', 'S must use only Amici');
assert(strategies[1].referenceKeys.join(',') === 'amici,hotel_odisej,museum_department', 'C reference set drifted');
assert(strategies[2].referenceKeys.join(',') === 'root_food,mun,museum_department', 'W reference set drifted');
assert(strategies[1].contextualPlan?.[0]?.scope === 'global page authority for this strategy only', 'C must freeze one contextual global authority');
assert(strategies[2].preImplementationRequirements?.length === 5, 'W pre-implementation evidence requirements drifted');

assert(bundle.references.root_food.liveEvidence?.desktop1440x1000?.document?.width === 28070, 'Root Food horizontal evidence drifted');
assert(bundle.references.mun.runtimeObservations?.contentSnapshotObservation?.includes('596'), 'Mùn sequence limitation must remain explicit');
assert(bundle.references.hotel_odisej.liveEvidence?.mobile390x844?.visualContentExtentByHeadingTop === 10330, 'Hotel virtual-scroll evidence drifted');
assert(bundle.references.museum_department.liveEvidence?.mobile390x844?.horizontalOverflowObserved === false, 'Museum mobile reordering evidence drifted');
assert(bundle.references.amici.liveEvidence?.mobile390x844?.horizontalOverflowObserved === false, 'Amici mobile overflow evidence drifted');

const evidence = referenceKeys.flatMap((key) => bundle.references[key].evidence || []);
assert(evidence.length === 24, `Expected 24 evidence artifacts, found ${evidence.length}`);
assert(new Set(evidence.map((item) => item.path)).size === evidence.length, 'Evidence paths must be unique');

const evidenceHashes = [];
for (const item of evidence) {
  const raw = await readFile(resolve(process.cwd(), item.path));
  const actualSha = sha256(raw);
  assert(actualSha === item.sha256, `Evidence hash mismatch: ${item.path}`);
  evidenceHashes.push(`${item.path}\u0000${actualSha}`);
}
const evidenceAggregateSha256 = sha256(evidenceHashes.sort().join('\n'));

assert(bundle.gateCState?.ready === false, 'Gate C must remain blocked');
assert(bundle.gateCState?.generationCallsMade === 0, 'Generation calls must remain zero');
assert(bundle.gateCState?.generationCreditsSpent === 0, 'Generation credits must remain zero');
assert(bundle.gateCState?.generatedOutputDirectoriesCreated === 0, 'No generated output directory may exist');

const bundleSha256 = sha256(bundleRaw);
assert(lock.schemaVersion === 'start-from-ref-reference-bundles-lock-v1', 'Unexpected lock schemaVersion');
assert(lock.experimentId === bundle.experimentId, 'Lock experiment ID mismatch');
assert(lock.manifestSha256 === bundle.parentManifest.sha256, 'Lock manifest hash mismatch');
assert(lock.referenceBundlesSha256 === bundleSha256, 'Reference bundle lock hash mismatch');
assert(lock.evidenceArtifactCount === evidence.length, 'Evidence artifact count mismatch');
assert(lock.evidenceAggregateSha256 === evidenceAggregateSha256, 'Evidence aggregate hash mismatch');
assert(lock.authorizedGate === 'B', 'Lock authorizes an unexpected gate');
assert(lock.gateCReady === false, 'Lock must fail closed for Gate C');
assert(lock.lockDoesNotAuthorizeGeneration === true, 'Lock must state that it does not authorize generation');

console.log(JSON.stringify({
  ok: true,
  experimentId: bundle.experimentId,
  manifestSha256: bundle.parentManifest.sha256,
  referenceBundlesSha256: bundleSha256,
  evidenceArtifactCount: evidence.length,
  evidenceAggregateSha256,
  authorizedGate: lock.authorizedGate,
  gateCReady: lock.gateCReady,
  strategies: strategies.map((strategy) => ({ id: strategy.id, references: strategy.referenceKeys })),
  generationCallsMade: bundle.gateCState.generationCallsMade,
  generationCreditsSpent: bundle.gateCState.generationCreditsSpent
}, null, 2));
