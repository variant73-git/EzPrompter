import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const defaultRoot = 'docs/superpowers/experiments/2026-08-03-daselva-clone-first-v2';
const bundlePath = resolve(process.cwd(), process.argv[2] || `${defaultRoot}/reference-bundles.v2.json`);
const lockPath = resolve(process.cwd(), process.argv[3] || `${defaultRoot}/reference-bundles.lock.json`);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertAbsent(path, message) {
  try {
    await access(path);
    throw new Error(message);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const bundleRaw = await readFile(bundlePath);
const bundle = JSON.parse(bundleRaw.toString('utf8'));
const lock = JSON.parse(await readFile(lockPath, 'utf8'));

const manifestPath = resolve(process.cwd(), bundle.manifest?.path || '');
const manifestRaw = await readFile(manifestPath);
const manifest = JSON.parse(manifestRaw.toString('utf8'));
const manifestSha256 = sha256(manifestRaw);

assert(bundle.schemaVersion === 'start-from-ref-clone-first-reference-bundles-v2', 'Unexpected Gate B bundle schema');
assert(bundle.experimentId === manifest.experiment?.id, 'Bundle experiment does not match manifest');
assert(bundle.gate === 'B' && bundle.status === 'frozen_gate_b', 'Bundle is not frozen at Gate B');
assert(bundle.manifest?.sha256 === manifestSha256, 'Bundle manifest hash mismatch');
assert(bundle.gateAuthorization?.tokenMatchesManifest === true, 'Gate B authorization token was not verified');
assert(bundle.gateAuthorization?.receivedToken === `START-DASELVA-V2-GATE-B-${manifestSha256.slice(0, 16).toUpperCase()}`, 'Gate B token drifted');

const candidatePoolPath = resolve(process.cwd(), bundle.candidatePool?.path || '');
const candidatePoolRaw = await readFile(candidatePoolPath);
const candidatePool = JSON.parse(candidatePoolRaw.toString('utf8'));
const candidatePoolSha256 = sha256(candidatePoolRaw);

assert(bundle.candidatePool?.sha256 === candidatePoolSha256, 'Candidate-pool hash mismatch');
assert(candidatePool.status === 'frozen_gate_b' && candidatePool.gate === 'B', 'Candidate pool is not frozen at Gate B');
assert(candidatePool.manifestSha256 === manifestSha256, 'Candidate pool manifest hash mismatch');
assert(candidatePool.selectionMethod?.businessCategoryWeight === 0, 'Business category leaked into candidate scoring');
assert(candidatePool.selectionMethod?.categoryUsedDuringScoring === false, 'Category was used during scoring');
assert(candidatePool.selectionMethod?.categoryUsedToFilterOrAssignRoles === false, 'Category filtered or assigned roles');
assert(candidatePool.selectionMethod?.categoryUsedToBreakTies === false, 'Category broke a tie');
assert(candidatePool.selectionMethod?.prohibitedQueryTermsUsed?.length === 0, 'A prohibited category discovery term was used');

const candidates = candidatePool.candidates || [];
const poolRules = manifest.referenceSelection?.candidatePool || {};
assert(candidates.length >= poolRules.minimum && candidates.length <= poolRules.maximum, 'Candidate-pool size is outside the frozen bounds');
assert(new Set(candidates.map((candidate) => candidate.referenceId)).size === candidates.length, 'Candidate reference IDs are not unique');
assert(new Set(candidates.map((candidate) => candidate.url)).size === candidates.length, 'Candidate URLs are not unique');

const scoreWeights = candidatePool.scoreWeights || {};
const expectedScoreWeights = {
  staticTaste: 25,
  cloneability: 25,
  motionEvidence: 20,
  responsiveQuality: 15,
  contentCapacity: 10,
  runtimeFeasibility: 5,
};
assert(JSON.stringify(scoreWeights) === JSON.stringify(expectedScoreWeights), 'Candidate score weights drifted');
assert(Object.values(scoreWeights).reduce((sum, weight) => sum + weight, 0) === 100, 'Candidate score weights do not total 100');
assert(manifest.referenceSelection?.scoreWeights?.map((item) => item.weight).join(',') === Object.values(scoreWeights).join(','), 'Candidate score weights do not match the manifest');

for (const candidate of candidates) {
  assert(candidate.categoryAudit && candidate.categoryGroup && typeof candidate.adjacentCategory === 'boolean', `Candidate ${candidate.referenceId} lacks the post-score category audit`);
  assert(Object.keys(scoreWeights).every((key) => Number.isInteger(candidate.scores?.[key]) && candidate.scores[key] >= 1 && candidate.scores[key] <= 5), `Candidate ${candidate.referenceId} has an invalid score`);
  const expectedTotal = Object.entries(scoreWeights).reduce((total, [key, weight]) => total + candidate.scores[key] / 5 * weight, 0);
  assert(candidate.weightedTotalOutOf100 === expectedTotal, `Candidate ${candidate.referenceId} weighted total is incorrect`);
  assert(candidate.decision && candidate.decisionReason, `Candidate ${candidate.referenceId} lacks a decision record`);
}

const categoryAudit = candidatePool.postScoreCategoryAudit || {};
const distinctCategories = new Set(candidates.map((candidate) => candidate.categoryGroup)).size;
const adjacentCount = candidates.filter((candidate) => candidate.adjacentCategory).length;
assert(categoryAudit.candidateCount === candidates.length, 'Category-audit candidate count mismatch');
assert(categoryAudit.distinctBusinessCategoryCount === distinctCategories, 'Distinct-category count mismatch');
assert(distinctCategories >= poolRules.minimumDistinctBusinessCategories, 'Candidate pool fails the diversity audit');
assert(categoryAudit.adjacentCategoryCount === adjacentCount, 'Adjacent-category count mismatch');
assert(categoryAudit.adjacentCategoryShare === adjacentCount / candidates.length, 'Adjacent-category share mismatch');
assert(categoryAudit.adjacentCategoryShare <= poolRules.maximumAdjacentCategoryShare, 'Adjacent-category share exceeds the frozen cap');
assert(categoryAudit.biasStopRequired === false && categoryAudit.result === 'pass', 'Category-bias audit did not pass');

for (const evidence of candidatePool.discoveryEvidence || []) {
  const raw = await readFile(resolve(process.cwd(), evidence.path));
  assert(sha256(raw) === evidence.sha256, `Discovery evidence hash mismatch: ${evidence.path}`);
}

const allocations = bundle.strategyAllocations || [];
assert(allocations.map((allocation) => allocation.strategyId).join(',') === 'S,C,W', 'Strategy allocations must be S, C and W');
const allocationReferences = allocations.flatMap((allocation) => allocation.references.map((reference) => ({ ...reference, strategyId: allocation.strategyId })));
assert(new Set(allocationReferences.map((reference) => reference.referenceId)).size === allocationReferences.length, 'An exact reference is reused across strategies');
assert(allocations.find((allocation) => allocation.strategyId === 'S')?.references?.length === 1, 'S must have exactly one reference');

const cAllocation = allocations.find((allocation) => allocation.strategyId === 'C');
assert(cAllocation?.references?.length >= 2 && cAllocation.references.length <= 3, 'C must have two or three references');
assert(cAllocation.references.filter((reference) => reference.role === 'primary_chassis').length === 1, 'C must have exactly one primary chassis');
assert(cAllocation.references.filter((reference) => reference.role.startsWith('bounded_donor_')).length === cAllocation.references.length - 1, 'Every non-primary C reference must be a bounded donor');
assert(cAllocation.documentedPrimaryGaps?.length === cAllocation.references.length - 1, 'Every C donor must repair one documented primary gap');

const wAllocation = allocations.find((allocation) => allocation.strategyId === 'W');
assert(wAllocation?.references?.length >= 2 && wAllocation.references.length <= 3, 'W must have two or three references');
assert(/motion-free|motion may begin|No W motion/i.test(`${wAllocation.mandatoryStop}`), 'W lacks the frozen static taste stop');

const references = bundle.references || [];
assert(references.length === allocationReferences.length, 'Selected reference-detail count mismatch');
assert(new Set(references.map((reference) => reference.referenceId)).size === references.length, 'Selected reference details are duplicated');
assert(references.every((reference) => allocationReferences.some((allocated) => allocated.referenceId === reference.referenceId && allocated.strategyId === reference.strategyId)), 'Reference detail does not match its allocation');

const candidateById = new Map(candidates.map((candidate) => [candidate.referenceId, candidate]));
const requiredEvidenceKinds = ['scrape_markdown_links', 'runtime_html', 'desktop_hero', 'desktop_motion_stage', 'mobile_hero'];
const evidencePaths = [];
for (const reference of references) {
  const candidate = candidateById.get(reference.referenceId);
  assert(candidate, `Selected reference ${reference.referenceId} is not in the candidate pool`);
  assert(candidate.weightedTotalOutOf100 === reference.weightedScoreOutOf100, `Selected score drifted for ${reference.referenceId}`);
  assert(reference.capture?.desktop?.viewport === '1440x1000', `Desktop evidence viewport drifted for ${reference.referenceId}`);
  assert(reference.capture?.mobile?.viewport === '390x844', `Mobile evidence viewport drifted for ${reference.referenceId}`);
  assert(reference.capture.desktop.horizontalOverflowPx === 0, `Desktop overflow observed for ${reference.referenceId}`);
  assert(reference.capture.mobile.horizontalOverflowPx === 0, `Mobile overflow observed for ${reference.referenceId}`);
  assert(reference.capture.motionEvidence && reference.capture.runtimeObservation, `Motion or runtime observation missing for ${reference.referenceId}`);
  assert(requiredEvidenceKinds.every((kind) => reference.evidence?.some((item) => item.kind === kind)), `Evidence set is incomplete for ${reference.referenceId}`);
  assert(new Set(reference.evidence.map((item) => item.kind)).size === reference.evidence.length, `Duplicate evidence kind for ${reference.referenceId}`);
  for (const evidence of reference.evidence) {
    const path = resolve(process.cwd(), evidence.path);
    const raw = await readFile(path);
    assert(sha256(raw) === evidence.sha256, `Reference evidence hash mismatch: ${evidence.path}`);
    evidencePaths.push(evidence.path);
  }
}

assert(bundle.allocationAudit?.selectedReferenceCount === references.length, 'Allocation-audit selected count mismatch');
assert(bundle.allocationAudit?.exactReferenceReuseAcrossStrategies === false, 'Allocation audit reports reference reuse');
assert(bundle.allocationAudit?.businessCategoryInfluencedAllocation === false, 'Allocation audit reports category influence');
assert(bundle.allocationAudit?.result === 'pass', 'Allocation audit did not pass');

const accounting = bundle.generationAccounting || {};
assert(accounting.modelCalls === 0, 'Gate B cannot make model calls');
assert(accounting.imageCalls === 0, 'Gate B cannot make image calls');
assert(accounting.websiteOrCloneGenerations === 0, 'Gate B cannot generate clones or websites');
assert(accounting.creditsSpent === 0, 'Gate B cannot spend credits');
assert(accounting.v2OutputRootCreated === false, 'Gate B cannot create the V2 output root');
assert(accounting.sharedTargetMediaPackTouched === false, 'Gate B cannot mutate the target media pack');
assert(accounting.v1OutputsTouched === false, 'Gate B cannot touch V1 outputs');
await assertAbsent(resolve(manifest.outputIsolation.root), 'The V2 output root exists before Gate C authorization');

assert(bundle.gateC?.authorized === false, 'Gate C is unexpectedly authorized');
assert(bundle.gateC?.proposedCreditCeiling === manifest.equalConditions?.costCeiling?.totalCredits, 'Gate C proposed ceiling drifted');
assert(bundle.gateC?.newImageCallsAllowed === 0, 'Gate C cannot add image calls');
assert(bundle.gateC?.reuseMediaPackSha256 === manifest.sharedTargetMediaPolicy?.mediaPackSha256, 'Gate C media-pack hash drifted');
assert(bundle.gateC?.confirmationToken === `START-DASELVA-V2-GATE-C-${manifestSha256.slice(0, 16).toUpperCase()}`, 'Gate C token drifted');
assert(bundle.gateC?.tokenAloneAuthorizesExecution === false, 'Gate C token must not authorize execution alone');

const bundleSha256 = sha256(bundleRaw);
const aggregateHash = createHash('sha256');
for (const evidencePath of [...evidencePaths].sort()) aggregateHash.update(await readFile(resolve(process.cwd(), evidencePath)));
const evidenceAggregateSha256 = aggregateHash.digest('hex');

assert(lock.status === 'frozen_gate_b' && lock.gate === 'B', 'Reference-bundle lock is not frozen at Gate B');
assert(lock.manifestSha256 === manifestSha256, 'Reference-bundle lock manifest hash mismatch');
assert(lock.candidatePoolSha256 === candidatePoolSha256, 'Reference-bundle lock candidate-pool hash mismatch');
assert(lock.bundleSha256 === bundleSha256, 'Reference-bundle lock hash mismatch');
assert(lock.evidenceAggregateSha256 === evidenceAggregateSha256, 'Reference evidence aggregate hash mismatch');
assert(lock.selectedReferenceIds.join(',') === references.map((reference) => reference.referenceId).join(','), 'Locked selected-reference order drifted');
assert(lock.gateC?.authorized === false && lock.gateC?.tokenAloneAuthorizesExecution === false, 'Lock unexpectedly authorizes Gate C');

console.log(JSON.stringify({
  ok: true,
  experimentId: bundle.experimentId,
  manifestSha256,
  candidatePoolSha256,
  bundleSha256,
  evidenceAggregateSha256,
  candidateCount: candidates.length,
  distinctBusinessCategoryCount: distinctCategories,
  adjacentCategoryShare: categoryAudit.adjacentCategoryShare,
  selectedReferenceIds: references.map((reference) => reference.referenceId),
  allocation: Object.fromEntries(allocations.map((allocation) => [allocation.strategyId, allocation.references.map((reference) => reference.referenceId)])),
  generationAccounting: accounting,
  gateC: { authorized: bundle.gateC.authorized, proposedCreditCeiling: bundle.gateC.proposedCreditCeiling },
}, null, 2));
