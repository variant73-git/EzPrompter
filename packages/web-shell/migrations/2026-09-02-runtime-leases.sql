-- Lease B (plano 2026-08-26-runtime-lease-b, Task 3): concessão opaca
-- revogável em cookie + hostname persistido por sessão + quota atômica de
-- upload. Tudo ADITIVO — nenhuma linha existente muda.

-- Hostname por sessão: mintado UMA vez (CAS no chamador), reusado em todo
-- resume — sem isto cada reabertura mudaria a origem e destruiria o cache
-- que o B existe para criar (Sol r3 #2). UNIQUE = registro durável do
-- "nunca reutilizado" (cinto; 128 bits já tornam colisão desprezível).
ALTER TABLE native_motion_edit_sessions ADD COLUMN IF NOT EXISTS runtime_hostname TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_native_motion_sessions_runtime_hostname
  ON native_motion_edit_sessions(runtime_hostname) WHERE runtime_hostname IS NOT NULL;

CREATE TABLE IF NOT EXISTS native_runtime_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_hash CHAR(64) NOT NULL UNIQUE,          -- sha256(cookieValue): vazamento de banco nao vira cookie vivo
  badge_jti VARCHAR(64) NOT NULL UNIQUE,        -- consumo atomico do badge one-shot
  edit_session_id UUID NOT NULL REFERENCES native_motion_edit_sessions(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  bundle_id UUID NOT NULL,
  hostname TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  expires_at TIMESTAMPTZ NOT NULL,              -- SLIDING: renew = NOW() + ttl; cookie de sessao nao tem idade
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_native_runtime_leases_session
  ON native_runtime_leases(edit_session_id, status);
-- Lease unica ativa por sessao (Sol r4 #1): a renovacao toca exatamente UMA
-- linha, e uma lease replicada/abandonada nao e mantida viva pelo timer do
-- usuario legitimo.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_native_runtime_leases_one_active
  ON native_runtime_leases(edit_session_id) WHERE status = 'active';

-- Quota agregada de upload por no, reservada ATOMICAMENTE por UPDATE
-- condicional ANTES do putImmutable (Sol r4 #3: contar-depois-gravar e TOCTOU).
CREATE TABLE IF NOT EXISTS native_node_upload_quota (
  node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  bytes_used BIGINT NOT NULL DEFAULT 0 CHECK (bytes_used >= 0)
);
