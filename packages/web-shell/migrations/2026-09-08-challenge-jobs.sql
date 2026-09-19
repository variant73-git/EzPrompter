-- Spec 2026-09-08-challenge-remote-browser-design §4.2: job persistido para
-- sites com verificação de bot. NENHUM request espera uma pessoa — o estado
-- vive aqui. Tudo ADITIVO.
CREATE TABLE IF NOT EXISTS challenge_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  purpose VARCHAR(12) NOT NULL CHECK (purpose IN ('reference','edit')),
  target_url TEXT NOT NULL,                       -- imutável desde a criação
  generation INTEGER NOT NULL DEFAULT 1,          -- cerca: commit só com a geração corrente
  status VARCHAR(16) NOT NULL DEFAULT 'verifying' CHECK (status IN (
    'verifying','needs_human','ready','capturing','committing','succeeded',
    'failed','expired','cancelled','unsupported')),
  bb_session_id TEXT,                             -- id do vendor; NUNCA connectUrl/URLs de visualizador
  bb_page_id TEXT,
  idem_key TEXT,                                  -- etiqueta de idempotência do Edit
  human_deadline_at TIMESTAMPTZ,
  session_expires_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,                        -- trava curta de controlador
  lease_owner TEXT,
  error_code VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_challenge_jobs_user_id_status ON challenge_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_challenge_jobs_open ON challenge_jobs(status)
  WHERE status IN ('verifying','needs_human','ready','capturing','committing');
