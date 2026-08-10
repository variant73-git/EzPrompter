import { neon } from '@neondatabase/serverless';
import nextEnv from '@next/env';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPromotionPlan } from '../../lib/reference-bank-promotion.js';
import { buildUserCalibrationCatalog } from '../../lib/reference-user-calibration.js';
import { applyPromotionPlan, fetchPromotionTargetSnapshot } from './promotion-db.mjs';
import { assertDistinctDatabaseTargets, loadIsolatedDatabaseConfig } from './isolated-env.mjs';

const { loadEnvConfig } = nextEnv;
const SHARED_CONFIRMATION = 'user-calibration-2026-08-05';

function hasFlag(name) {
  return process.argv.includes(name);
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function selectedMode() {
  const modes = ['--isolated-preflight', '--isolated-apply', '--shared-preflight', '--shared-apply'].filter(hasFlag);
  if (modes.length !== 1) {
    throw new Error('Choose exactly one calibration mode.');
  }
  return modes[0];
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
  if (!databaseUrl) throw new Error('DATABASE_URL is required for an authorized shared calibration import.');
  assertDistinctDatabaseTargets(isolatedDatabaseUrl, databaseUrl);
  return { databaseUrl };
}

function publicResult(mode, catalog, plan, extra = {}) {
  return {
    mode,
    catalogSha256: catalog.catalogSha256,
    planSha256: plan.planSha256,
    summary: plan.summary,
    ...extra,
  };
}

const mode = selectedMode();
const target = mode.includes('shared') ? 'shared' : 'isolated';
const preflight = mode.endsWith('preflight');
const catalog = buildUserCalibrationCatalog();
const snapshotPath = flagValue('--snapshot');
const snapshotOutPath = flagValue('--snapshot-out');
const planOutPath = flagValue('--plan-out');

if (preflight) {
  if (!snapshotOutPath) throw new Error(`${mode} requires --snapshot-out.`);
  const config = target === 'shared' ? loadSharedDatabaseConfig() : loadIsolatedDatabaseConfig();
  const sql = neon(config.databaseUrl);
  const snapshot = await fetchPromotionTargetSnapshot(sql, catalog, { target });
  const plan = buildPromotionPlan(catalog, snapshot);
  await writeJson(snapshotOutPath, snapshot);
  await writeJson(planOutPath, plan);
  process.stdout.write(`${JSON.stringify(publicResult(`${target}-preflight`, catalog, plan, {
    readOnly: true,
    snapshotWritten: true,
    planWritten: Boolean(planOutPath),
  }), null, 2)}\n`);
  process.exit(0);
}

if (!snapshotPath) throw new Error(`${mode} requires --snapshot.`);
const suppliedSnapshot = await readJson(snapshotPath, 'calibration target snapshot');
if (suppliedSnapshot.target !== target) {
  throw new Error(`Snapshot target ${suppliedSnapshot.target} cannot be applied to ${target}.`);
}
const suppliedPlan = buildPromotionPlan(catalog, suppliedSnapshot);
const confirmedPlanSha256 = flagValue('--confirm-plan-sha256');
if (!confirmedPlanSha256 || confirmedPlanSha256 !== suppliedPlan.planSha256) {
  throw new Error('Apply requires the exact --confirm-plan-sha256 from preflight.');
}
if (target === 'shared' && flagValue('--confirm-shared-import') !== SHARED_CONFIRMATION) {
  throw new Error(`Shared apply requires --confirm-shared-import ${SHARED_CONFIRMATION}.`);
}

const config = target === 'shared' ? loadSharedDatabaseConfig() : loadIsolatedDatabaseConfig();
const sql = neon(config.databaseUrl);
const liveSnapshot = await fetchPromotionTargetSnapshot(sql, catalog, { target });
const livePlan = buildPromotionPlan(catalog, liveSnapshot);
if (livePlan.planSha256 !== suppliedPlan.planSha256) {
  throw new Error(`Target drifted after preflight: authorized ${suppliedPlan.planSha256}, live ${livePlan.planSha256}.`);
}

const applied = await applyPromotionPlan(sql, catalog, suppliedPlan);
process.stdout.write(`${JSON.stringify(publicResult(`${target}-apply`, catalog, suppliedPlan, { applied }), null, 2)}\n`);
