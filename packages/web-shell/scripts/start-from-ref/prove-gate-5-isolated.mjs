import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import nextEnv from '@next/env';
import { neon } from '@neondatabase/serverless';

const { loadEnvConfig } = nextEnv;
const configDir = path.resolve(process.env.REFERENCE_ENV_DIR || process.cwd());
loadEnvConfig(configDir, false, undefined, true);

const sharedDatabaseUrl = process.env.DATABASE_URL;
const isolatedDatabaseUrl = process.env.E2E_ISOLATED_DATABASE_URL;
if (!sharedDatabaseUrl) throw new Error('DATABASE_URL is required only for offline target comparison.');
if (!isolatedDatabaseUrl) throw new Error('E2E_ISOLATED_DATABASE_URL is required.');

function canonicalTarget(rawUrl) {
  const parsed = new URL(rawUrl);
  return JSON.stringify({
    protocol: parsed.protocol,
    hostname: parsed.hostname.toLowerCase().replace(/^([^.]+)-pooler\./, '$1.'),
    port: parsed.port || '5432',
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    user: decodeURIComponent(parsed.username),
  });
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

const sharedTarget = canonicalTarget(sharedDatabaseUrl);
const isolatedTarget = canonicalTarget(isolatedDatabaseUrl);
if (sharedDatabaseUrl.trim() === isolatedDatabaseUrl.trim() || sharedTarget === isolatedTarget) {
  throw new Error('Gate 5 refused: isolated target matches the shared database target.');
}

const databaseName = `uncraft_gate5_${Date.now()}_${randomBytes(4).toString('hex')}`;
if (!/^uncraft_gate5_[a-z0-9_]+$/.test(databaseName)) throw new Error('Unsafe disposable database name.');
const isolatedAdmin = neon(isolatedDatabaseUrl);
const disposableDatabaseUrl = new URL(isolatedDatabaseUrl);
disposableDatabaseUrl.pathname = `/${databaseName}`;
let created = false;
let child;
let exitCode = 1;

async function cleanup() {
  if (!created) return;
  await isolatedAdmin(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  const rows = await isolatedAdmin`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS present`;
  if (rows[0]?.present) throw new Error('Disposable Gate 5 database still exists after cleanup.');
  created = false;
}

async function run() {
  console.log(JSON.stringify({
    gate: 5,
    target: 'isolated',
    sharedTargetFingerprint: fingerprint(sharedTarget),
    isolatedTargetFingerprint: fingerprint(isolatedTarget),
    canonicalTargetsDistinct: true,
    databaseName,
  }, null, 2));
  await isolatedAdmin(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const childEnv = {
    ...process.env,
    DATABASE_URL: disposableDatabaseUrl.toString(),
    E2E_ISOLATED_DATABASE_URL: disposableDatabaseUrl.toString(),
    JWT_SECRET: `uncraft-gate5-${randomBytes(24).toString('hex')}`,
    UNCRAFT_GATE5_ISOLATED: '1',
    UNCRAFT_GATE5_DATABASE: databaseName,
    UNCRAFT_GATE5_SHARED_TARGET_FINGERPRINT: fingerprint(sharedTarget),
    UNCRAFT_GATE5_ISOLATED_TARGET_FINGERPRINT: fingerprint(isolatedTarget),
  };
  delete childEnv.REFERENCE_ENV_DIR;
  exitCode = await new Promise((resolve, reject) => {
    child = spawn('bun', ['x', 'vitest', 'run', 'tests/start-from-ref/gate-5-isolated.integration.test.js', '--reporter=verbose'], {
      cwd: process.cwd(), env: childEnv, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => signal ? reject(new Error(`Gate 5 test process stopped by ${signal}.`)) : resolve(code ?? 1));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child?.kill(signal));

try {
  await run();
} finally {
  await cleanup();
  console.log(JSON.stringify({ gate: 5, databaseName, cleaned: true }, null, 2));
}

if (exitCode !== 0) process.exit(exitCode);
