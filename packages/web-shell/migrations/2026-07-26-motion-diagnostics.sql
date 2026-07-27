-- Motion diagnostics (Task 14).
--
-- Approved policy:
-- - admin identity is an explicit users.role value, never inferred from plan,
--   email domain, or signup order;
-- - linked diagnostic events expire after 30 days;
-- - only anonymous groups of at least 10 events survive for 12 months;
-- - deleting a user, project, node, snapshot, or edit session removes its
--   linked diagnostics through foreign-key cascades;
-- - cleanup targets only these two diagnostic tables. It must never delete or
--   rewrite snapshots, native bundles, manifests, or edit sessions.

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'member'
  CONSTRAINT users_role_check CHECK (role IN ('member','admin'));

CREATE TABLE IF NOT EXISTS motion_diagnostic_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  edit_session_id UUID REFERENCES native_motion_edit_sessions(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(12) NOT NULL CHECK (source IN ('runtime','binding','recovery','smoke')),
  transition VARCHAR(32) NOT NULL,
  failure_code VARCHAR(64) NOT NULL,
  failure_class VARCHAR(40) NOT NULL,
  validation_stage VARCHAR(24) NOT NULL DEFAULT 'unknown',
  operation VARCHAR(96),
  attempt SMALLINT,
  stack_fingerprint VARCHAR(72),
  automatic_steps JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(automatic_steps) = 'array'),
  final_outcome VARCHAR(20) NOT NULL CHECK (final_outcome IN ('pending','supported','recovered','disabled','failed','restored')),
  runtime_fingerprint VARCHAR(72),
  bundle_hash_prefix VARCHAR(20),
  build_version VARCHAR(96),
  engine VARCHAR(96),
  engine_version VARCHAR(96),
  adapter_version VARCHAR(96),
  app_version VARCHAR(96),
  control_id VARCHAR(96),
  control_scope VARCHAR(16) NOT NULL DEFAULT 'unknown',
  control_kind VARCHAR(20) NOT NULL DEFAULT 'unknown',
  device VARCHAR(12) NOT NULL DEFAULT 'unknown',
  viewport_width SMALLINT,
  viewport_height SMALLINT,
  aggregation_fingerprint VARCHAR(72),
  duration_ms INTEGER,
  origin VARCHAR(12) NOT NULL DEFAULT 'production' CHECK (origin IN ('production','smoke')),
  site_class VARCHAR(96),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE motion_diagnostic_events ADD COLUMN IF NOT EXISTS operation VARCHAR(96);
ALTER TABLE motion_diagnostic_events ADD COLUMN IF NOT EXISTS attempt SMALLINT;
CREATE INDEX IF NOT EXISTS motion_diagnostic_events_time ON motion_diagnostic_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS motion_diagnostic_events_failure ON motion_diagnostic_events(failure_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS motion_diagnostic_events_control ON motion_diagnostic_events(control_id, occurred_at DESC) WHERE control_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS motion_diagnostic_events_session ON motion_diagnostic_events(edit_session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS motion_diagnostic_events_expiry ON motion_diagnostic_events(expires_at);

CREATE TABLE IF NOT EXISTS motion_diagnostic_daily_aggregates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_day DATE NOT NULL,
  source VARCHAR(12) NOT NULL,
  failure_code VARCHAR(64) NOT NULL,
  validation_stage VARCHAR(24) NOT NULL,
  final_outcome VARCHAR(20) NOT NULL,
  control_kind VARCHAR(20) NOT NULL,
  device VARCHAR(12) NOT NULL,
  origin VARCHAR(12) NOT NULL,
  event_count BIGINT NOT NULL CHECK (event_count >= 10),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_day, source, failure_code, validation_stage, final_outcome, control_kind, device, origin)
);
CREATE INDEX IF NOT EXISTS motion_diagnostic_aggregates_expiry ON motion_diagnostic_daily_aggregates(expires_at);
