import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const defaultRoot = 'docs/superpowers/experiments/2026-08-03-daselva-clone-first-v2';
const manifestPath = resolve(process.cwd(), process.argv[2] || `${defaultRoot}/manifest.v2.json`);
const lockPath = resolve(process.cwd(), process.argv[3] || `${defaultRoot}/manifest.lock.json`);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const manifestRaw = await readFile(manifestPath);
const manifest = JSON.parse(manifestRaw.toString('utf8'));
const lock = JSON.parse(await readFile(lockPath, 'utf8'));

assert(manifest.schemaVersion === 'start-from-ref-clone-first-manifest-v2', 'Unexpected V2 schemaVersion');
assert(manifest.experiment?.status === 'frozen_gate_a', 'V2 manifest is not frozen at Gate A');
assert(manifest.experiment?.authorizedGate === 'A', 'V2 manifest authorizes a gate beyond A');
assert(manifest.experiment?.notAuthorized?.includes('reference retrieval, selection, or capture'), 'Gate B work must remain unauthorized');
assert(manifest.experiment?.notAuthorized?.includes('model, image, clone, or website generation'), 'Generation must remain unauthorized');

const basePath = resolve(process.cwd(), manifest.baseFixture?.manifestPath || '');
const baseRaw = await readFile(basePath);
assert(sha256(baseRaw) === manifest.baseFixture?.manifestSha256, 'Base Gate A manifest hash mismatch');
const base = JSON.parse(baseRaw.toString('utf8'));
assert(base.target?.brand === 'DaSelva', 'Base target must remain DaSelva');
assert(base.authority?.contentSource?.sha256 === manifest.baseFixture?.sourceContentSha256, 'Source authority hash drifted');

const mediaLockPath = resolve(manifest.sharedTargetMediaPolicy?.existingLockPath || '');
const mediaLockRaw = await readFile(mediaLockPath);
const mediaLock = JSON.parse(mediaLockRaw.toString('utf8'));
assert(mediaLock.mediaPackSha256 === manifest.sharedTargetMediaPolicy?.mediaPackSha256, 'Shared media pack hash mismatch');
assert(manifest.sharedTargetMediaPolicy?.newImageCallsAllowed === 0, 'V2 must reuse the frozen media pack without new image calls');

const selection = manifest.referenceSelection;
assert(selection?.businessCategoryWeight === 0, 'Business category must have zero selection weight');
assert(selection?.categoryMayFilterOrAssignRole === false, 'Category may not filter or assign a strategy role');
assert(selection?.candidatePool?.minimum === 12 && selection?.candidatePool?.maximum === 18, 'Candidate-pool bounds drifted');
assert(selection?.candidatePool?.minimumDistinctBusinessCategories >= 5, 'Candidate pool is not diverse enough to audit category bias');
assert(selection?.candidatePool?.maximumAdjacentCategoryShare <= 0.25, 'Adjacent-category cap is too permissive');
assert(selection?.scoreWeights?.reduce((sum, item) => sum + item.weight, 0) === 100, 'Reference-selection weights must total 100');
assert(!selection.scoreWeights.some((item) => /category|restaurant|hospitality/i.test(item.dimension)), 'Category leaked into selection scoring');

const clone = manifest.cloneFirstContract;
assert(clone?.baselineCloneRequiredBeforeSwap === true, 'A baseline clone must precede target swaps');
assert(clone?.finalSourceCodeReuseAllowed === false, 'Final source-code reuse must remain forbidden');
assert(clone?.finalReferenceAssetReuseAllowed === false, 'Final reference-asset reuse must remain forbidden');
assert(clone?.geometry?.medianNormalizedDriftPercentMax <= 8, 'Geometry tolerance is not clone-first');
assert(clone?.scrollLengthPercentDriftMax <= 10, 'Scroll-length tolerance is not clone-first');
assert(clone?.motion?.triggerPositionPercentViewportDriftMax <= 10, 'Motion trigger tolerance is too loose');

const strategies = manifest.strategies || [];
assert(strategies.map((strategy) => strategy.id).join(',') === 'S,C,W', 'V2 strategies must be exactly S, C and W');
assert(strategies.find((strategy) => strategy.id === 'S')?.referenceCount === 1, 'S must use exactly one reference');
const c = strategies.find((strategy) => strategy.id === 'C');
assert(c?.primaryChassisCount === 1 && c?.maximumDonors === 2, 'C must use one primary chassis and at most two donors');
const w = strategies.find((strategy) => strategy.id === 'W');
assert(w?.staticTasteGate?.humanApprovalRequired === true, 'W must stop for human static-taste approval');
assert(w?.staticTasteGate?.motionMayStartBeforeApproval === false, 'Motion may not mask an unapproved W board');
assert(w?.staticTasteGate?.minimumScorePerDimension === 4, 'W taste floor drifted');

const rubric = manifest.qualityRubric;
assert(rubric?.weightedScore?.reduce((sum, item) => sum + item.weight, 0) === 100, 'Quality-rubric weights must total 100');
assert(rubric?.qualityFloor?.minimumTotalOutOf100 === 85, 'V2 quality floor must remain 85');
assert(rubric?.qualityFloor?.minimumCriticalDimensionScoreOutOf5?.['static visual taste and art direction'] === 4, 'Taste is not a critical dimension');
assert(rubric?.qualityFloor?.minimumCriticalDimensionScoreOutOf5?.['reference fidelity'] === 4, 'Fidelity is not a critical dimension');

const budget = manifest.equalConditions;
assert(budget?.maxBillableModelCallsPerStrategy === 6, 'Per-strategy call ceiling drifted');
assert(budget?.maximumSharedImageCalls === 0, 'V2 must not budget new shared image calls');
assert(budget?.maximumBillableCallsTotal === 18, 'Total call ceiling drifted');
assert(budget?.costCeiling?.perStrategyCredits === 475, 'Per-strategy credit ceiling drifted');
assert(budget?.costCeiling?.sharedMediaPackCredits === 0, 'Shared media should cost zero new credits in V2');
assert(budget?.costCeiling?.totalCredits === 1425, 'V2 credit ceiling drifted');

const paths = Object.values(manifest.outputIsolation?.strategies || {});
assert(paths.length === 3 && new Set(paths).size === 3, 'V2 strategy output paths must be distinct');
assert(paths.every((path) => path.includes('clone-first-v2')), 'V2 output paths may not overlap V1');
const ports = Object.values(manifest.outputIsolation?.ports || {});
assert(ports.length === 3 && new Set(ports).size === 3, 'V2 ports must be distinct');
assert(ports.every((port) => port >= 4321 && port <= 4323), 'V2 ports drifted');

const manifestSha = sha256(manifestRaw);
const suffix = manifestSha.slice(0, 16).toUpperCase();
const expectedGateBToken = `START-DASELVA-V2-GATE-B-${suffix}`;
const expectedGateCToken = `START-DASELVA-V2-GATE-C-${suffix}`;
assert(lock.manifestSha256 === manifestSha, 'V2 manifest lock hash mismatch');
assert(lock.baseManifestSha256 === manifest.baseFixture.manifestSha256, 'V2 lock base hash mismatch');
assert(lock.gateBConfirmationToken === expectedGateBToken, 'V2 Gate B token mismatch');
assert(lock.gateCConfirmationToken === expectedGateCToken, 'V2 Gate C token mismatch');
assert(lock.tokensDoNotAuthorizeExecution === true, 'V2 lock must state that tokens alone do not authorize execution');

console.log(JSON.stringify({
  ok: true,
  experimentId: manifest.experiment.id,
  manifestSha256: manifestSha,
  baseManifestSha256: manifest.baseFixture.manifestSha256,
  sharedMediaPackSha256: manifest.sharedTargetMediaPolicy.mediaPackSha256,
  gateBConfirmationToken: expectedGateBToken,
  gateCConfirmationToken: expectedGateCToken,
  authorizedGate: manifest.experiment.authorizedGate,
  strategies: strategies.map((strategy) => strategy.id),
  totalCreditsCeiling: budget.costCeiling.totalCredits,
}, null, 2));
