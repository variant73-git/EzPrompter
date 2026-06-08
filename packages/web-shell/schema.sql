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
  html TEXT NOT NULL,
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
