-- Uncraft canvas — Postgres schema (idempotent).
-- Run via lib/db.js initDB() on cold start, or apply manually.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  plan VARCHAR(20) DEFAULT 'free',
  stripe_customer_id VARCHAR(255),
  captures_this_month INTEGER DEFAULT 0,
  captures_reset_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_node ON snapshots(node_id, created_at DESC);

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

-- ============================================================================
-- Start from a Ref: persistent, provenance-aware reference catalog.
-- Global catalog rows are imported by server-side tooling. User taste and
-- shadow plans remain user-scoped and are never inferred from account plan.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reference_sites (
  id TEXT PRIMARY KEY,
  canonical_url TEXT UNIQUE NOT NULL,
  host TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  editorial_consensus SMALLINT NOT NULL DEFAULT 1 CHECK (editorial_consensus > 0),
  curation_weight NUMERIC(7,3) NOT NULL DEFAULT 1,
  curation_rank INTEGER CHECK (curation_rank IS NULL OR curation_rank > 0),
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TEXT,
  generated_at TIMESTAMPTZ,
  availability_status VARCHAR(16) NOT NULL DEFAULT 'unknown'
    CHECK (availability_status IN ('unknown','available','unavailable','blocked')),
  lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'listed'
    CHECK (lifecycle_state IN ('listed','reviewing','enriched','excluded','removed')),
  analysis_status VARCHAR(20) NOT NULL DEFAULT 'listed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reference_sites_curated
  ON reference_sites(lifecycle_state, curation_rank, curation_weight DESC);
CREATE INDEX IF NOT EXISTS reference_sites_host ON reference_sites(host);
CREATE INDEX IF NOT EXISTS reference_sites_categories ON reference_sites USING GIN(categories);
CREATE INDEX IF NOT EXISTS reference_sites_tags ON reference_sites USING GIN(tags);

CREATE TABLE IF NOT EXISTS reference_appearances (
  id BIGSERIAL PRIMARY KEY,
  reference_site_id TEXT NOT NULL REFERENCES reference_sites(id) ON DELETE CASCADE,
  source_id VARCHAR(32) NOT NULL,
  source_name TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  listing_url TEXT NOT NULL,
  detail_url TEXT,
  thumbnail_url TEXT,
  source_taxonomy JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(reference_site_id, source_id, source_record_id)
);
CREATE INDEX IF NOT EXISTS reference_appearances_site ON reference_appearances(reference_site_id);
CREATE INDEX IF NOT EXISTS reference_appearances_source ON reference_appearances(source_id, reference_site_id);

CREATE TABLE IF NOT EXISTS reference_aggregators (
  id VARCHAR(32) PRIMARY KEY,
  name TEXT NOT NULL,
  homepage_url TEXT,
  overall_rating SMALLINT NOT NULL DEFAULT 3 CHECK (overall_rating BETWEEN 1 AND 5),
  editorial_quality SMALLINT CHECK (editorial_quality BETWEEN 1 AND 5),
  motion_density SMALLINT CHECK (motion_density BETWEEN 1 AND 5),
  metadata_quality SMALLINT CHECK (metadata_quality BETWEEN 1 AND 5),
  noise_control SMALLINT CHECK (noise_control BETWEEN 1 AND 5),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reference_review_cohorts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rubric_version SMALLINT NOT NULL DEFAULT 2,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','frozen','retired')),
  selection_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  frozen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reference_review_cohort_members (
  cohort_id TEXT NOT NULL REFERENCES reference_review_cohorts(id) ON DELETE CASCADE,
  reference_site_id TEXT NOT NULL REFERENCES reference_sites(id) ON DELETE CASCADE,
  rank SMALLINT NOT NULL CHECK (rank > 0),
  selection_score NUMERIC(7,3),
  selection_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cohort_id, reference_site_id),
  UNIQUE (cohort_id, rank)
);
CREATE INDEX IF NOT EXISTS reference_review_cohort_members_site
  ON reference_review_cohort_members(reference_site_id, cohort_id);

CREATE TABLE IF NOT EXISTS reference_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_site_id TEXT NOT NULL REFERENCES reference_sites(id) ON DELETE CASCADE,
  decision VARCHAR(12) NOT NULL CHECK (decision IN ('keep','maybe','pass')),
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  preferred_role VARCHAR(12) NOT NULL DEFAULT 'either'
    CHECK (preferred_role IN ('chassis','donor','either')),
  business_tags TEXT[] NOT NULL DEFAULT '{}',
  visual_tags TEXT[] NOT NULL DEFAULT '{}',
  motion_tags TEXT[] NOT NULL DEFAULT '{}',
  visual_quality SMALLINT CHECK (visual_quality BETWEEN 1 AND 5),
  structure_quality SMALLINT CHECK (structure_quality BETWEEN 1 AND 5),
  motion_quality SMALLINT CHECK (motion_quality BETWEEN 1 AND 5),
  originality SMALLINT CHECK (originality BETWEEN 1 AND 5),
  transferability SMALLINT CHECK (transferability BETWEEN 1 AND 5),
  commercial_clarity SMALLINT CHECK (commercial_clarity BETWEEN 1 AND 5),
  chassis_potential SMALLINT CHECK (chassis_potential BETWEEN 1 AND 5),
  donor_potential SMALLINT CHECK (donor_potential BETWEEN 1 AND 5),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, reference_site_id)
);
CREATE INDEX IF NOT EXISTS reference_preferences_user_decision
  ON reference_preferences(user_id, decision, updated_at DESC);
CREATE INDEX IF NOT EXISTS reference_preferences_site ON reference_preferences(reference_site_id);

CREATE TABLE IF NOT EXISTS generation_reference_uses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (schema_version IN (1,2)),
  mode VARCHAR(16) NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','generation')),
  status VARCHAR(16) NOT NULL DEFAULT 'shadow'
    CHECK (status IN ('shadow','approved','rejected','executed','failed')),
  brief TEXT NOT NULL CHECK (char_length(brief) BETWEEN 12 AND 6000),
  selected_reference_ids TEXT[] NOT NULL
    CHECK (cardinality(selected_reference_ids) BETWEEN 2 AND 4),
  plan JSONB NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  board_id UUID REFERENCES boards(id) ON DELETE SET NULL,
  output_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS generation_reference_uses_user_time
  ON generation_reference_uses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_reference_uses_status
  ON generation_reference_uses(user_id, status, created_at DESC);
