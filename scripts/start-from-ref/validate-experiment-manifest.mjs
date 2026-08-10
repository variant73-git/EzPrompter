import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_MANIFEST = 'docs/superpowers/experiments/2026-08-03-daselva-three-strategy/manifest.v1.json';
const DEFAULT_LOCK = 'docs/superpowers/experiments/2026-08-03-daselva-three-strategy/manifest.lock.json';

const manifestPath = resolve(process.cwd(), process.argv[2] || DEFAULT_MANIFEST);
const lockPath = resolve(process.cwd(), process.argv[3] || DEFAULT_LOCK);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const manifestRaw = await readFile(manifestPath);
const manifest = JSON.parse(manifestRaw.toString('utf8'));
const lock = JSON.parse(await readFile(lockPath, 'utf8'));

assert(manifest.schemaVersion === 'start-from-ref-real-output-manifest-v1', 'Unexpected schemaVersion');
assert(manifest.experiment?.status === 'frozen_gate_a', 'Manifest is not frozen at Gate A');
assert(manifest.experiment?.authorizedGate === 'A', 'Manifest authorizes a gate beyond A');

const sourcePath = manifest.authority?.contentSource?.pathAtFreeze;
const expectedSourceSha = manifest.authority?.contentSource?.sha256;
assert(sourcePath && expectedSourceSha, 'Content source path and hash are required');
const sourceRaw = await readFile(sourcePath);
assert(sha256(sourceRaw) === expectedSourceSha, 'Content source hash mismatch');

assert(manifest.target?.brand === 'DaSelva', 'Target brand must be DaSelva');
assert(manifest.target?.publicationMode?.variant === 'A_pre_INPI', 'Pre-INPI A language must be frozen');
assert(manifest.target?.palette?.deepGreen && manifest.target?.palette?.offWhite && manifest.target?.palette?.terracotta, 'Required palette is incomplete');

const homeArc = manifest.contentPlan?.homeArc || [];
assert(homeArc.length === 7, 'Home arc must contain exactly seven frozen movements');
assert(homeArc.map((section) => section.order).join(',') === '1,2,3,4,5,6,7', 'Home arc order must be contiguous');
assert(homeArc.some((section) => section.id === 'banda'), 'Home arc must include a Banda movement');
assert(manifest.contentPlan?.bandaProminence?.dedicatedRouteRequired === true, 'Banda route must be required');
assert(manifest.contentPlan?.homeVisibleWordTarget?.min === 280, 'Home minimum word target drifted');
assert(manifest.contentPlan?.homeVisibleWordTarget?.max === 420, 'Home maximum word target drifted');

const routes = manifest.routesAndInteractions?.requiredRoutes || [];
assert(routes.length === 2 && routes.includes('/') && routes.includes('/banda-de-tambaqui'), 'Required route set drifted');

const strategies = manifest.strategies || [];
assert(strategies.map((strategy) => strategy.id).join(',') === 'S,C,W', 'Strategies must be exactly S, C and W');

const outputPaths = Object.values(manifest.outputIsolation?.strategies || {});
assert(outputPaths.length === 3 && new Set(outputPaths).size === 3, 'Strategy output paths must be distinct');
const ports = Object.values(manifest.outputIsolation?.ports || {});
assert(ports.length === 3 && new Set(ports).size === 3, 'Strategy ports must be distinct');

const weightedScore = manifest.qualityRubric?.weightedScore || [];
const totalWeight = weightedScore.reduce((sum, item) => sum + Number(item.weight || 0), 0);
assert(totalWeight === 100, `Rubric weights must total 100, got ${totalWeight}`);
assert(manifest.qualityRubric?.qualityFloor?.minimumTotalOutOf100 === 80, 'Quality floor drifted');

const budget = manifest.equalConditions || {};
assert(budget.codingModel === 'gpt-5.6-sol', 'Coding model drifted');
assert(budget.reasoningEffort === 'high', 'Reasoning effort drifted');
assert(budget.maxBillableModelCallsPerStrategy === 6, 'Per-strategy call ceiling drifted');
assert(budget.maximumSharedImageCalls === 6, 'Shared image call ceiling drifted');
assert(budget.maximumBillableCallsTotal === 24, 'Total call ceiling drifted');
assert(budget.costCeiling?.totalCredits === 1545, 'Credit ceiling drifted');
assert(
  (budget.maxBillableModelCallsPerStrategy * strategies.length) + budget.maximumSharedImageCalls === budget.maximumBillableCallsTotal,
  'Call-ceiling arithmetic mismatch',
);
assert(
  (budget.costCeiling.perStrategyCredits * strategies.length) + budget.costCeiling.sharedMediaPackCredits === budget.costCeiling.totalCredits,
  'Credit-ceiling arithmetic mismatch',
);

assert(manifest.sharedTargetMediaPolicy?.gateCPreflightRequired === true, 'Shared media pack preflight must fail closed');
assert(Array.isArray(manifest.failureAndRollback?.failClosedWhen) && manifest.failureAndRollback.failClosedWhen.length > 0, 'Fail-closed policy is required');

const manifestSha = sha256(manifestRaw);
const expectedToken = `START-DASELVA-GATE-C-${manifestSha.slice(0, 16).toUpperCase()}`;
assert(lock.manifestSha256 === manifestSha, 'Manifest lock hash mismatch');
assert(lock.sourceContentSha256 === expectedSourceSha, 'Lock source hash mismatch');
assert(lock.gateCConfirmationToken === expectedToken, 'Gate C confirmation token mismatch');
assert(lock.tokenDoesNotAuthorizeExecution === true, 'Lock must state that the token alone does not authorize execution');

console.log(JSON.stringify({
  ok: true,
  experimentId: manifest.experiment.id,
  manifestSha256: manifestSha,
  sourceContentSha256: expectedSourceSha,
  gateCConfirmationToken: expectedToken,
  authorizedGate: manifest.experiment.authorizedGate,
  strategies: strategies.map((strategy) => strategy.id),
  totalCreditsCeiling: budget.costCeiling.totalCredits,
}, null, 2));
