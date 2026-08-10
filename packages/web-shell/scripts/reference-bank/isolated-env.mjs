import path from 'node:path';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

export function assertDistinctDatabaseTargets(isolatedDatabaseUrl, sharedDatabaseUrl) {
  if (isolatedDatabaseUrl && sharedDatabaseUrl
    && isolatedDatabaseUrl.trim() === sharedDatabaseUrl.trim()) {
    throw new Error('Isolated database URL must not match DATABASE_URL.');
  }
}

export function loadIsolatedDatabaseConfig() {
  const configDir = path.resolve(process.env.REFERENCE_ENV_DIR || process.cwd());
  loadEnvConfig(configDir, false, undefined, true);
  const databaseUrl = process.env.E2E_ISOLATED_DATABASE_URL;
  const sharedDatabaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('E2E_ISOLATED_DATABASE_URL is required.');
  assertDistinctDatabaseTargets(databaseUrl, sharedDatabaseUrl);
  return { databaseUrl, sharedDatabaseUrl, configDir };
}
