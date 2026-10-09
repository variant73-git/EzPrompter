// SQL de canonical_jobs (spec 2026-10-09 §4.1). Leitura sempre pelo DONO; toda escrita da requisição que
// trabalha é cercada por status + geração + dono da trava (no challenge_jobs a trava só olhava id e validade).
export const ACTIVE = Object.freeze(['queued', 'provisioning', 'recording', 'packaging']);
export const TERMINAL = new Set(['ready', 'failed']);

// Conjunto FECHADO do que uma transição pode mudar — nunca um nome vindo de fora.
const PATCHABLE = new Set(['stage', 'sandbox_name', 'command_id', 'progress_pct', 'result_bundle_id', 'error_code', 'error_detail']);
function cleanPatch(patch) {
  const p = {};
  for (const [k, v] of Object.entries(patch || {})) if (PATCHABLE.has(k)) p[k] = v;
  return p;
}

export async function insertJob({ sql, userId, boardId, nodeId, sourceSnapshotId, nativeBundleId, idemKey, opId = null }) {
  const rows = await sql`
    INSERT INTO canonical_jobs (user_id, board_id, node_id, source_snapshot_id, native_bundle_id, idem_key, op_id)
    VALUES (${userId}, ${boardId}, ${nodeId}, ${sourceSnapshotId}, ${nativeBundleId}, ${idemKey}, ${opId})
    ON CONFLICT DO NOTHING
    RETURNING *`;
  return rows[0] || null;
}

export async function findActiveJobForNode({ sql, userId, nodeId }) {
  const rows = await sql`
    SELECT * FROM canonical_jobs
     WHERE node_id = ${nodeId} AND user_id = ${userId}
       AND status IN ('queued','provisioning','recording','packaging')
     LIMIT 1`;
  return rows[0] || null;
}

export async function findJobByIdem({ sql, userId, idemKey }) {
  const rows = await sql`SELECT * FROM canonical_jobs WHERE user_id = ${userId} AND idem_key = ${idemKey}`;
  return rows[0] || null;
}

export async function getOwnedJob({ sql, userId, jobId }) {
  const rows = await sql`SELECT * FROM canonical_jobs WHERE id = ${jobId} AND user_id = ${userId}`;
  return rows[0] || null;
}

export async function acquireLease({ sql, jobId, owner, ttlSecs }) {
  const rows = await sql`
    UPDATE canonical_jobs
       SET lease_owner = ${owner},
           lease_until = NOW() + make_interval(secs => ${ttlSecs}),
           updated_at = NOW()
     WHERE id = ${jobId}
       AND status IN ('queued','provisioning','recording','packaging')
       AND (lease_until IS NULL OR lease_until < NOW())
     RETURNING *`;
  return rows[0] || null;
}

export async function releaseLease({ sql, jobId, owner }) {
  await sql`
    UPDATE canonical_jobs SET lease_owner = NULL, lease_until = NULL, updated_at = NOW()
     WHERE id = ${jobId} AND lease_owner = ${owner}`;
}

export async function moveJob({ sql, jobId, owner, generation, from, to, patch = {} }) {
  const p = cleanPatch(patch);
  const rows = await sql`
    UPDATE canonical_jobs
       SET status = ${to},
           generation = generation + 1,
           stage = COALESCE(${p.stage ?? null}, stage),
           sandbox_name = COALESCE(${p.sandbox_name ?? null}, sandbox_name),
           command_id = COALESCE(${p.command_id ?? null}, command_id),
           progress_pct = GREATEST(progress_pct, COALESCE(${p.progress_pct ?? null}, progress_pct)),
           result_bundle_id = COALESCE(${p.result_bundle_id ?? null}, result_bundle_id),
           error_code = COALESCE(${p.error_code ?? null}, error_code),
           error_detail = COALESCE(${p.error_detail ?? null}, error_detail),
           updated_at = NOW()
     WHERE id = ${jobId} AND status = ${from} AND generation = ${generation} AND lease_owner = ${owner}
     RETURNING *`;
  return rows[0] || null;
}

// Anotação sem mudar de status (progresso, sub-estágio): mesma cerca, geração intacta.
export async function noteJob({ sql, jobId, owner, generation, patch = {} }) {
  const p = cleanPatch(patch);
  const rows = await sql`
    UPDATE canonical_jobs
       SET stage = COALESCE(${p.stage ?? null}, stage),
           command_id = COALESCE(${p.command_id ?? null}, command_id),
           progress_pct = GREATEST(progress_pct, COALESCE(${p.progress_pct ?? null}, progress_pct)),
           updated_at = NOW()
     WHERE id = ${jobId} AND generation = ${generation} AND lease_owner = ${owner}
       AND status IN ('queued','provisioning','recording','packaging')
     RETURNING *`;
  return rows[0] || null;
}

// Recomeço do zero numa máquina nova (uma vez): volta a 'queued' sem máquina nem comando.
export async function restartJob({ sql, jobId, owner, generation, from }) {
  const rows = await sql`
    UPDATE canonical_jobs
       SET status = 'queued',
           generation = generation + 1,
           attempt = attempt + 1,
           sandbox_name = NULL,
           command_id = NULL,
           stage = NULL,
           updated_at = NOW()
     WHERE id = ${jobId} AND status = ${from} AND generation = ${generation} AND lease_owner = ${owner}
       AND attempt < 2
     RETURNING *`;
  return rows[0] || null;
}

export async function listOverdueJobs({ sql, limit = 50 }) {
  return sql`
    SELECT * FROM canonical_jobs
     WHERE status IN ('queued','provisioning','recording','packaging') AND deadline_at < NOW()
     ORDER BY deadline_at ASC
     LIMIT ${limit}`;
}

// Limpeza de tarefa terminada: desligar a máquina e encerrar a cobrança podem falhar depois da transição;
// a varredura repete até confirmar (cada passo é idempotente).
export async function listCleanupPending({ sql, limit = 50 }) {
  return sql`
    SELECT * FROM canonical_jobs
     WHERE cleanup_done = false AND status IN ('ready','failed')
     ORDER BY updated_at ASC
     LIMIT ${limit}`;
}

export async function markCleanupDone({ sql, jobId }) {
  await sql`
    UPDATE canonical_jobs SET cleanup_done = true, updated_at = NOW()
     WHERE id = ${jobId} AND status IN ('ready','failed')`;
}

// Varredura (sem dono): só a vencida, na geração lida, e NUNCA com uma trava válida — a requisição dona pode estar
// no meio de criar a máquina; derrubá-la aqui deixaria a máquina nascer depois da limpeza (órfã). Com trava viva,
// quem falha a tarefa por prazo é a própria requisição (o passo seguinte checa o prazo) ou esta varredura depois que
// a trava vencer (330 s).
export async function failOverdueJob({ sql, jobId, generation, from }) {
  const rows = await sql`
    UPDATE canonical_jobs
       SET status = 'failed',
           generation = generation + 1,
           error_code = 'timeout',
           lease_owner = NULL,
           lease_until = NULL,
           updated_at = NOW()
     WHERE id = ${jobId} AND status = ${from} AND generation = ${generation} AND deadline_at < NOW()
       AND (lease_until IS NULL OR lease_until < NOW())
     RETURNING *`;
  return rows[0] || null;
}
