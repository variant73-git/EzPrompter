import { neon } from '@neondatabase/serverless';
import nextEnv from '@next/env';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPromotionPlan,
  loadReviewedPromotion,
} from '../../lib/reference-bank-promotion.js';
import {
  applyPromotionPlan,
  fetchPromotionTargetSnapshot,
} from './promotion-db.mjs';
import {
  assertDistinctDatabaseTargets,
  loadIsolatedDatabaseConfig,
} from './isolated-env.mjs';

const { loadEnvConfig } = nextEnv;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(scriptDir, '../../../..');

function flagValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(path.resolve(filePath), 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

async function writeJson(filePath, value) {
  if (!filePath) return;
  await writeFile(path.resolve(filePath), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function loadSharedDatabaseConfig() {
  const configDir = path.resolve(process.env.REFERENCE_ENV_DIR || process.cwd());
  loadEnvConfig(configDir, false, undefined, true);
  const databaseUrl = process.env.DATABASE_URL;
  const isolatedDatabaseUrl = process.env.E2E_ISOLATED_DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for an explicitly authorized shared operation.');
  assertDistinctDatabaseTargets(isolatedDatabaseUrl, databaseUrl);
  return { databaseUrl, isolatedDatabaseUrl, configDir };
}

function selectedMode() {
  const modes = [
    '--offline-plan',
    '--isolated-preflight',
    '--isolated-apply',
    '--shared-preflight',
    '--shared-apply',
  ].filter(hasFlag);
  if (modes.length !== 1) {
    throw new Error('Choose exactly one mode: --offline-plan, --isolated-preflight, --isolated-apply, --shared-preflight, or --shared-apply.');
  }
  return modes[0];
}

function publicResult(mode, reviewed, plan, extra = {}) {
  return {
    mode,
    reviewedArtifactHashes: Object.fromEntries(
      Object.entries(reviewed.artifacts).map(([key, artifact]) => [key, artifact.sha256]),
    ),
    catalogSha256: reviewed.catalog.catalogSha256,
    planSha256: plan.planSha256,
    summary: plan.summary,
    ...extra,
  };
}

const mode = selectedMode();
const reviewed = await loadReviewedPromotion(worktreeRoot);
const snapshotPath = flagValue('--snapshot');
const snapshotOutPath = flagValue('--snapshot-out');
const planOutPath = flagValue('--plan-out');

if (mode === '--offline-plan') {
  if (!snapshotPath) throw new Error('--offline-plan requires --snapshot <path>.');
  const snapshot = await readJson(snapshotPath, 'target snapshot');
  const plan = buildPromotionPlan(reviewed.catalog, snapshot);
  await writeJson(planOutPath, plan);
  process.stdout.write(`${JSON.stringify(publicResult('offline-plan', reviewed, plan, {
    planWritten: Boolean(planOutPath),
  }), null, 2)}\n`);
  process.exit(0);
}

const target = mode.includes('shared') ? 'shared' : 'isolated';
const isPreflight = mode.endsWith('preflight');
if (isPreflight && !snapshotOutPath) {
  throw new Error(`${mode} requires --snapshot-out <path> so the reviewed target state is durable.`);
}

if (isPreflight) {
  const config = target === 'shared'
    ? loadSharedDatabaseConfig()
    : loadIsolatedDatabaseConfig();
  const sql = neon(config.databaseUrl);
  const snapshot = await fetchPromotionTargetSnapshot(sql, reviewed.catalog, { target });
  const plan = buildPromotionPlan(reviewed.catalog, snapshot);
  await writeJson(snapshotOutPath, snapshot);
  await writeJson(planOutPath, plan);
  process.stdout.write(`${JSON.stringify(publicResult(`${target}-preflight`, reviewed, plan, {
    readOnly: true,
    snapshotWritten: true,
    planWritten: Boolean(planOutPath),
  }), null, 2)}\n`);
  process.exit(0);
}

if (!snapshotPath) throw new Error(`${mode} requires --snapshot <path> from an authorized preflight.`);
const suppliedSnapshot = await readJson(snapshotPath, 'authorized target snapshot');
if (suppliedSnapshot.target !== target) {
  throw new Error(`Snapshot target ${suppliedSnapshot.target} cannot be applied to ${target}.`);
}
const suppliedPlan = buildPromotionPlan(reviewed.catalog, suppliedSnapshot);
const confirmedPlanSha256 = flagValue('--confirm-plan-sha256');
if (!confirmedPlanSha256 || confirmedPlanSha256 !== suppliedPlan.planSha256) {
  throw new Error('Apply requires --confirm-plan-sha256 matching the supplied snapshot plan.');
}
if (target === 'shared' && flagValue('--confirm-shared-import') !== 'reviewed-delta-v1') {
  throw new Error('Shared apply requires --confirm-shared-import reviewed-delta-v1 after a separate authorization gate.');
}

const config = target === 'shared'
  ? loadSharedDatabaseConfig()
  : loadIsolatedDatabaseConfig();
const sql = neon(config.databaseUrl);
const liveSnapshot = await fetchPromotionTargetSnapshot(sql, reviewed.catalog, { target });
const livePlan = buildPromotionPlan(reviewed.catalog, liveSnapshot);
if (livePlan.planSha256 !== suppliedPlan.planSha256) {
  throw new Error(`Target drifted after preflight: authorized ${suppliedPlan.planSha256}, live ${livePlan.planSha256}.`);
}

const applied = await applyPromotionPlan(sql, reviewed.catalog, suppliedPlan);
process.stdout.write(`${JSON.stringify(publicResult(`${target}-apply`, reviewed, suppliedPlan, {
  applied,
}), null, 2)}\n`);
