// SQL de challenge_jobs (spec 2026-09-08 §4.2). Toda leitura é pelo DONO; toda
// transição é CERCADA por status + geração (um worker vencido não publica por
// cima de uma retomada); a trava é curta e por dono (um controlador por vez no
// navegador remoto).
export const TERMINAL = new Set(['succeeded', 'failed', 'expired', 'cancelled', 'unsupported']);
export const OPEN = ['verifying', 'needs_human', 'ready', 'capturing', 'committing'];

// Conjunto FECHADO de colunas que uma transição pode alterar — nunca um nome
// vindo do cliente (status/target_url/generation ficam de fora de propósito).
const PATCHABLE = new Set([
  'bb_session_id', 'bb_page_id', 'human_deadline_at', 'session_expires_at',
  'lease_until', 'lease_owner', 'error_code',
]);

export async function createJob({ sql, userId, boardId, nodeId, purpose, targetUrl, idemKey = null }) {
  const [row] = await sql`
    INSERT INTO challenge_jobs (user_id, board_id, node_id, purpose, target_url, idem_key)
    VALUES (${userId}, ${boardId}, ${nodeId}, ${purpose}, ${targetUrl}, ${idemKey})
    RETURNING *`;
  return row;
}

export async function getOwnedJob({ sql, userId, jobId }) {
  const rows = await sql`SELECT * FROM challenge_jobs WHERE id = ${jobId} AND user_id = ${userId}`;
  return rows[0] || null;
}

export async function transition({ sql, jobId, from, to, generation, patch = {} }) {
  const p = {};
  for (const [k, v] of Object.entries(patch)) if (PATCHABLE.has(k)) p[k] = v;
  const rows = await sql`
    UPDATE challenge_jobs
       SET status = ${to},
           bb_session_id = COALESCE(${p.bb_session_id ?? null}, bb_session_id),
           bb_page_id = COALESCE(${p.bb_page_id ?? null}, bb_page_id),
           human_deadline_at = COALESCE(${p.human_deadline_at ?? null}, human_deadline_at),
           session_expires_at = COALESCE(${p.session_expires_at ?? null}, session_expires_at),
           lease_until = ${p.lease_until ?? null},
           lease_owner = ${p.lease_owner ?? null},
           error_code = COALESCE(${p.error_code ?? null}, error_code),
           updated_at = NOW()
     WHERE id = ${jobId} AND status = ${from} AND generation = ${generation}
     RETURNING *`;
  return rows[0] || null;
}

export async function acquireLease({ sql, jobId, owner, ttlMs }) {
  const secs = Math.ceil(ttlMs / 1000);
  const rows = await sql`
    UPDATE challenge_jobs
       SET lease_owner = ${owner},
           lease_until = NOW() + (${secs} || ' seconds')::interval,
           updated_at = NOW()
     WHERE id = ${jobId} AND (lease_until IS NULL OR lease_until < NOW())
     RETURNING id`;
  return rows.length === 1;
}

export async function releaseLease({ sql, jobId, owner }) {
  await sql`
    UPDATE challenge_jobs SET lease_until = NULL, lease_owner = NULL, updated_at = NOW()
     WHERE id = ${jobId} AND lease_owner = ${owner}`;
}

export async function listExpired({ sql, limit = 50 }) {
  return sql`
    SELECT * FROM challenge_jobs
     WHERE status IN ('verifying','needs_human','ready','capturing','committing')
       AND (session_expires_at < NOW()
            OR (status = 'needs_human' AND human_deadline_at < NOW())
            OR (status IN ('capturing','committing') AND lease_until < NOW()))
     ORDER BY updated_at ASC
     LIMIT ${limit}`;
}

export async function countOpenForUser({ sql, userId }) {
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM challenge_jobs WHERE user_id = ${userId} AND status IN ('verifying','needs_human','ready','capturing','committing')`;
  return r?.n || 0;
}
export async function countOpenSessions({ sql }) {
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM challenge_jobs WHERE bb_session_id IS NOT NULL AND status IN ('verifying','needs_human','ready','capturing','committing')`;
  return r?.n || 0;
}
export async function countTodayForUser({ sql, userId, purpose }) {
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM challenge_jobs WHERE user_id = ${userId} AND purpose = ${purpose} AND created_at > NOW() - interval '1 day'`;
  return r?.n || 0;
}
export async function countTodaySessions({ sql }) {
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM challenge_jobs WHERE bb_session_id IS NOT NULL AND created_at > NOW() - interval '1 day'`;
  return r?.n || 0;
}
