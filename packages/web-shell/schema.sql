-- Uncraft canvas — Postgres schema (idempotent).
-- Run via lib/db.js initDB() on cold start, or apply manually.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  plan VARCHAR(20) DEFAULT 'free',
  role VARCHAR(16) NOT NULL DEFAULT 'member' CONSTRAINT users_role_check CHECK (role IN ('member','admin')),
  stripe_customer_id VARCHAR(255),
  captures_this_month INTEGER DEFAULT 0,
  captures_reset_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'member'
  CONSTRAINT users_role_check CHECK (role IN ('member','admin'));

-- Canvas boards: each user has many.
CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL DEFAULT 'Untitled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id, updated_at DESC);

-- Nodes on a board: a captured site, a template, an uploaded design.md, or a chunk.
CREATE TABLE IF NOT EXISTS nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL,
  origin_url TEXT,
  template_slug VARCHAR(120),
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 1280,
  height REAL NOT NULL DEFAULT 800,
  is_main BOOLEAN DEFAULT FALSE,
  current_snapshot_id UUID,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nodes_board ON nodes(board_id);

-- Immutable native clone bundles. Storage keys are opaque outside the bundle
-- store; snapshots reference the descriptor rather than serializing live DOM.
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_native_bundles_content_hash ON native_bundles(content_hash);

-- Snapshots: every captured/computed state of a node.
CREATE TABLE IF NOT EXISTS snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  -- Nullable: designmd/content/tokens snapshots carry design_md only, prompt
  -- and asset nodes carry no snapshot at all. Only site/style snapshots have html.
  html TEXT,
  design_md TEXT,
  screenshot_url TEXT,
  source VARCHAR(20) NOT NULL,
  parent_snapshot_id UUID,
  native_bundle_id UUID CONSTRAINT snapshots_native_bundle_fk
    REFERENCES native_bundles(bundle_id) ON DELETE RESTRICT,
  motion_manifest JSONB,
  motion_manifest_version SMALLINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT snapshots_native_manifest_shape CHECK (
    (motion_manifest IS NULL AND motion_manifest_version IS NULL)
    OR
    (native_bundle_id IS NOT NULL
      AND motion_manifest IS NOT NULL
      AND motion_manifest_version = 2
      AND jsonb_typeof(motion_manifest) = 'object'
      AND motion_manifest->>'schemaVersion' = '2'
      AND motion_manifest->>'baseBundleId' = native_bundle_id::text)
  )
);
CREATE INDEX IF NOT EXISTS idx_snapshots_node ON snapshots(node_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_native_bundle ON snapshots(native_bundle_id) WHERE native_bundle_id IS NOT NULL;

-- One mutable server draft per native node. Immutable snapshots remain the
-- version history; discarded/expired drafts never rewrite their base snapshot.
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

-- Sanitized motion diagnostics are separate from agent traces. Linked events
-- expire after 30 days. Only anonymous groups of at least 10 events survive
-- for 12 months; raw page content, prompts, selectors, URLs, and stack paths
-- have no storage column here.
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

-- Directed edges with declarative payload.
CREATE TABLE IF NOT EXISTS edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) DEFAULT 'pending',
  last_error TEXT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_edges_board ON edges(board_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_node_id);

-- Reusable node graphs. Definitions preserve structure, node kinds, relative
-- geometry, and safe labels only. Snapshot HTML, prompts, source URLs, image
-- data, and other user content are deliberately excluded when saving.
CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_board_id UUID REFERENCES boards(id) ON DELETE SET NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  definition JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, source_board_id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_user ON workflow_templates(user_id, updated_at DESC);

-- Asset groups: composite assets created via Cmd+G in the widget's
-- Collect Assets mode. Each group has its own snapshot (cloned common
-- ancestor with non-selected siblings stripped) and references its
-- member assets via assets.group_id.
CREATE TABLE IF NOT EXISTS asset_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = global library; non-NULL pins the group to a single project.
  project_id UUID REFERENCES boards(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT 'Untitled group',
  html TEXT NOT NULL,
  css TEXT,
  thumb_url TEXT,
  source_url TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_asset_groups_user ON asset_groups(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_groups_project ON asset_groups(project_id) WHERE project_id IS NOT NULL;

-- Individual assets: images, svgs, icons, fonts, components, sections,
-- text snippets, background images, etc. project_id NULL = global asset
-- library (shared across all of the user's projects). group_id NULL =
-- standalone asset (not part of a group). Both are nullable foreign
-- keys with ON DELETE SET NULL so deleting a project or group doesn't
-- cascade through the user's whole library.
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES boards(id) ON DELETE SET NULL,
  group_id UUID REFERENCES asset_groups(id) ON DELETE SET NULL,
  type VARCHAR(24) NOT NULL,
  name TEXT NOT NULL,
  source_url TEXT,           -- the page the asset was collected from
  html TEXT,                 -- outerHTML for component/section/text/group children
  css TEXT,                  -- isolated computed CSS (v2)
  blob_url TEXT,             -- hosted file URL (image/svg/video/font binary) — v2
  thumb_url TEXT,            -- preview PNG — v2
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_group ON assets(group_id) WHERE group_id IS NOT NULL;
-- Dedup convenience: lookup by (user, source_url, type) for the global
-- library. Not a unique constraint (the user may collect the same image
-- twice intentionally; dedup is opt-in at the API layer).
CREATE INDEX IF NOT EXISTS idx_assets_user_source ON assets(user_id, source_url, type);

-- ============================================================================
-- Chat agent (Phase 1 of agent-promptdock feature).
-- See docs/superpowers/specs/2026-05-31-agent-promptdock-design.md §9.
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(10) NOT NULL DEFAULT 'board' CHECK (scope IN ('board','asset')),
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  title TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CHECK ((scope = 'board' AND asset_id IS NULL) OR (scope = 'asset' AND asset_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_one_active_per_board
  ON chat_threads(board_id) WHERE status = 'active' AND scope = 'board';
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_one_active_per_asset
  ON chat_threads(asset_id) WHERE status = 'active' AND scope = 'asset';

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content TEXT,
  tool_calls JSONB,
  tool_call_id TEXT,
  model VARCHAR(60),
  agent_run_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_ts ON chat_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN (
    'running','paused_confirm','paused_choice','paused_softlimit',
    'completed','failed','cancelled','hard_limited'
  )),
  iterations INT NOT NULL DEFAULT 0,
  tool_call_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  err TEXT,
  tokens_in INT,
  tokens_out INT,
  cost_cents INT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_runs_thread_status ON agent_runs(thread_id, status);

-- Per-event audit log for every agent run. Records every iteration,
-- tool call, tool result (slimmed), provider call, and error. Queried
-- for: production debugging ("why did run X fail?"), LGPD compliance
-- (right-to-access + right-to-deletion forensics), cost attribution,
-- security review (what did the agent actually do).
--
-- Partitioning note: at scale (millions of events), partition by
-- created_at (monthly). For MVP a single table is fine — Postgres
-- handles tens of millions of rows cleanly with proper indexes.
CREATE TABLE IF NOT EXISTS agent_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type VARCHAR(40) NOT NULL CHECK (type IN (
    'iter_start','llm_call','llm_response',
    'tool_call','tool_result','tool_error',
    'needs_confirm','needs_choice','needs_softlimit_continue',
    'safety_net_fired','run_status','error'
  )),
  -- Free-form payload. Big strings (dataUrl, html, raw LLM output) are
  -- pre-truncated at the application layer before insert — driver uses
  -- slimForHistory() to keep this column under a few KB per row.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INT,
  cost_cents INT
);
CREATE INDEX IF NOT EXISTS agent_run_events_run_ts ON agent_run_events(run_id, ts);
CREATE INDEX IF NOT EXISTS agent_run_events_user_ts ON agent_run_events(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS agent_run_events_type_ts ON agent_run_events(type, ts DESC);
-- ── Credits system (2026-07-03) ─────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_cents BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_cost_cents BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cost_window_start TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_device_hash TEXT;

-- Per-AI-call audit (metering; charge 0 rows included — cost cap counts them).
CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op_id UUID NOT NULL,
  op VARCHAR(40) NOT NULL,
  board_id UUID,
  node_id UUID,
  provider VARCHAR(20),
  model VARCHAR(80),
  tokens_in INT DEFAULT 0,
  tokens_out INT DEFAULT 0,
  cached_in INT DEFAULT 0,
  images INT DEFAULT 0,
  cost_microcents BIGINT DEFAULT 0,
  charged BOOLEAN DEFAULT FALSE,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS usage_events_user_time ON usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_op ON usage_events(op_id);

-- Balance history — every credit movement (welcome/charge/refund/grant/purchase).
CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_credits INT NOT NULL,
  reason VARCHAR(20) NOT NULL,
  op_id UUID,
  balance_after BIGINT NOT NULL,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_time ON credit_ledger(user_id, created_at DESC);

-- Logical-operation idempotency (money-safety: dedup of retries; spec
-- 2026-07-24). ONE row per logical action, keyed by the requester's idempotency
-- ticket (client-supplied) or the agent's derived key. The row ABSORBS the hold
-- (hold_credits) so a stranded hold is just an in_flight row the reconciliation
-- sweep finds deterministically — not a naked balance debit to guess at. The
-- immutable money audit stays in credit_ledger / usage_events; this table is
-- coordination/dedup only.
CREATE TABLE IF NOT EXISTS operations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idem_key       TEXT NOT NULL,          -- requester ticket, or agent-derived key
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op             VARCHAR(40) NOT NULL,
  board_id       UUID,
  node_id        UUID,                   -- SOURCE node (not the created artifact)
  status         VARCHAR(12) NOT NULL,   -- in_flight | settled | failed | expired
  hold_credits   BIGINT DEFAULT 0,
  charge_credits BIGINT DEFAULT 0,
  result         JSONB,                  -- stored response for dedup replay + created-artifact ref
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  settled_at     TIMESTAMPTZ,
  UNIQUE (user_id, idem_key)
);
CREATE INDEX IF NOT EXISTS operations_user_status ON operations(user_id, status);
CREATE INDEX IF NOT EXISTS operations_inflight_age ON operations(status, created_at);
