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

CREATE INDEX IF NOT EXISTS idx_workflow_templates_user
  ON workflow_templates(user_id, updated_at DESC);
