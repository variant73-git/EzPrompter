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
