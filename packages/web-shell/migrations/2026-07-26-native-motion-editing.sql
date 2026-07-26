-- Native animated-clone persistence (Task 2).
--
-- Rollback is intentionally manual and non-destructive: first stop native edit
-- traffic, retain or export every referenced bundle/manifest, then remove the
-- partial active-session index, session table, snapshot constraints/columns,
-- and finally native_bundles. Never drop native_bundles while a snapshot still
-- references it; ON DELETE RESTRICT is the durable guard.

CREATE TABLE IF NOT EXISTS native_bundles (
  bundle_id UUID PRIMARY KEY,
  schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
  storage_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  entry_path TEXT NOT NULL,
  asset_index JSONB NOT NULL,
  runtime_fingerprint TEXT NOT NULL CHECK (runtime_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  reconstruction_capabilities JSONB NOT NULL DEFAULT '{"detectedEngines":[],"candidateControls":[]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(asset_index) = 'array'),
  CHECK (jsonb_typeof(reconstruction_capabilities) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_native_bundles_content_hash
  ON native_bundles(content_hash);

ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS native_bundle_id UUID;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS motion_manifest JSONB;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS motion_manifest_version SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'snapshots_native_bundle_fk'
  ) THEN
    ALTER TABLE snapshots
      ADD CONSTRAINT snapshots_native_bundle_fk
      FOREIGN KEY (native_bundle_id) REFERENCES native_bundles(bundle_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'snapshots_native_manifest_shape'
  ) THEN
    ALTER TABLE snapshots
      ADD CONSTRAINT snapshots_native_manifest_shape CHECK (
        (motion_manifest IS NULL AND motion_manifest_version IS NULL)
        OR
        (native_bundle_id IS NOT NULL
          AND motion_manifest IS NOT NULL
          AND motion_manifest_version = 2
          AND jsonb_typeof(motion_manifest) = 'object'
          AND motion_manifest->>'schemaVersion' = '2'
          AND motion_manifest->>'baseBundleId' = native_bundle_id::text)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_snapshots_native_bundle
  ON snapshots(native_bundle_id) WHERE native_bundle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS native_motion_edit_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  base_snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  draft_manifest JSONB NOT NULL,
  draft_manifest_version SMALLINT NOT NULL DEFAULT 2 CHECK (draft_manifest_version = 2),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status VARCHAR(12) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','committed','discarded','expired')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CHECK (jsonb_typeof(draft_manifest) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS native_motion_sessions_one_active_per_node
  ON native_motion_edit_sessions(node_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_native_motion_sessions_user_status
  ON native_motion_edit_sessions(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_native_motion_sessions_node
  ON native_motion_edit_sessions(node_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_native_motion_sessions_base_snapshot
  ON native_motion_edit_sessions(base_snapshot_id);
