-- Cópia editável no Edit (spec 2026-10-09 §4.1): tarefa persistida que prepara a cópia canônica numa
-- máquina descartável. Toda transição é cercada por status + geração + dono da trava.
-- Espelho de migrations/2026-10-09-canonical-jobs.sql.
CREATE TABLE IF NOT EXISTS canonical_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  source_snapshot_id UUID NOT NULL,               -- versão do node ao enfileirar (comparação-e-troca)
  native_bundle_id UUID NOT NULL,                 -- captura nativa de onde a cópia nasce
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','provisioning','recording','packaging','ready','failed')),
  stage VARCHAR(24),
  progress_pct SMALLINT NOT NULL DEFAULT 10,
  generation INTEGER NOT NULL DEFAULT 1,          -- sobe a cada transição de status
  attempt SMALLINT NOT NULL DEFAULT 1,            -- 2 = recomeço do zero numa máquina nova
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  sandbox_name TEXT,                              -- nome determinístico, gravado ANTES de criar a máquina
  command_id TEXT,
  op_id UUID,                                     -- reserva de cobrança (operations.id)
  result_bundle_id UUID,
  result_snapshot_id UUID,
  error_code VARCHAR(40),
  error_detail TEXT,
  cleanup_done BOOLEAN NOT NULL DEFAULT false,    -- máquina desligada E cobrança encerrada; a varredura retoma até confirmar
  idem_key TEXT NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '35 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idem_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_jobs_one_active ON canonical_jobs(node_id)
  WHERE status IN ('queued','provisioning','recording','packaging');
CREATE INDEX IF NOT EXISTS idx_canonical_jobs_cleanup ON canonical_jobs(updated_at)
  WHERE cleanup_done = false AND status IN ('ready','failed');
CREATE INDEX IF NOT EXISTS idx_canonical_jobs_overdue ON canonical_jobs(deadline_at)
  WHERE status IN ('queued','provisioning','recording','packaging');
