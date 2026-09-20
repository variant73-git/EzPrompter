// Orquestração do job de challenge (spec 2026-09-08 §4.1–4.5). Regras:
// nenhum request espera uma pessoa; UMA sessão por job; transições cercadas;
// sessão liberada em TODO estado terminal; cobrança só pela máquina existente
// dentro de captureJob (nada de caminho novo de dinheiro).
import { createJob, getOwnedJob, transition, acquireLease, releaseLease, listExpired, TERMINAL } from './job-store.js';
import { checkChallengeQuota } from './quotas.js';
import { challengeVendorFromEnv, connectUrlForSession as vendorConnectUrl } from './vendor.js';
import { withBorrowedSession } from './borrowed-session.js';
import { verifyTarget } from './verify.js';
import { captureNativeBundle } from '../native-clone/capture-bundle.js';
import { captureSnapshot } from '../snapshot.js';
import { reconstructSiteNode } from '../deferred-reconstruction.js';
import { persistReferenceSnapshot } from '../snapshot-persist.js';

export const VERIFY_BUDGET_MS = 45_000;
export const SOLVER_TOLERANCE_MS = 40_000;
export const HUMAN_DEADLINE_MS = 5 * 60 * 1000;

export class ChallengeJobError extends Error {
  constructor(code, status = 409, extra = {}) {
    super(code);
    this.name = 'ChallengeJobError';
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

function defaultDeps(env) {
  return {
    browserbase: challengeVendorFromEnv(env),  // fornecedor corrente (browserbase|steel)
    withSession: withBorrowedSession,
    verify: verifyTarget,
    captureNative: captureNativeBundle,
    captureSnap: captureSnapshot,
    reconstruct: reconstructSiteNode,
    persistReference: persistReferenceSnapshot,
    now: () => new Date(),
  };
}

async function releaseQuiet(deps, job) {
  // Best-effort. ⚠️ RESÍDUO NOMEADO (Astra 2026-09-08 #2): se o release do
  // vendor falha de forma transitória, o varredor por estado terminal não o
  // retenta — MAS a sessão foi criada com `timeout: 600s`, então o próprio
  // vendor a recupera em ≤10 min. Fila durável de limpeza é escopo adiado
  // (spec §6). O impacto de dinheiro/correção é zero; o de recurso é limitado.
  if (job?.bb_session_id) await deps.browserbase.releaseSession(job.bb_session_id).catch(() => {});
}

// A connectUrl NUNCA é persistida (segredo portador). Quem reconecta pede ao
// fornecedor corrente pela sessão (browserbase|steel).
export function connectUrlForSession(sessionId, env = process.env) {
  return vendorConnectUrl(sessionId, env);
}

export async function startJob({ sql, userId, node, purpose, idemKey = null, env = process.env, deps = defaultDeps(env) }) {
  if (!deps.browserbase) return { error: { code: 'vendor_not_configured', status: 503 } };
  if (purpose === 'edit' && !idemKey) return { error: { code: 'idempotency_key_required', status: 400 } };
  const quota = await checkChallengeQuota({ sql, userId, purpose, env });
  if (!quota.ok) return { error: quota };

  let job = await createJob({ sql, userId, boardId: node.board_id, nodeId: node.id, purpose, targetUrl: node.origin_url, idemKey });
  let session;
  try {
    session = await deps.browserbase.createSession({
      targetUrl: job.target_url,
      proxy: String(env.UNCRAFT_BROWSERBASE_PROXY || 'off') === 'on',
      jobId: job.id,
    });
  } catch (e) {
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'failed', generation: job.generation, patch: { error_code: e?.code || 'vendor_unavailable' } }) || job;
    return { job, error: { code: e?.code || 'vendor_unavailable', status: 503 } };
  }
  // Grava o id da sessão. Isto é uma TRANSFERÊNCIA DE POSSE (Astra 2026-09-08
  // #1): entre createSession e este write, um cancelJob pode ter marcado o job
  // terminal SEM ver o id (e portanto sem liberar). Se o write não pega (null =
  // saiu de 'verifying', ou erro), a sessão fica órfã e o varredor não a acha
  // pelo id — então libera-se AQUI, na hora.
  let saved;
  try {
    saved = await transition({ sql, jobId: job.id, from: 'verifying', to: 'verifying', generation: job.generation, patch: { bb_session_id: session.id, session_expires_at: session.expiresAt } });
  } catch (e) {
    await releaseQuiet(deps, { bb_session_id: session.id });
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'failed', generation: job.generation, patch: { error_code: 'session_persist_failed' } }) || job;
    return { job, error: { code: 'session_persist_failed', status: 500 } };
  }
  if (!saved) {
    await releaseQuiet(deps, { bb_session_id: session.id });
    const current = await getOwnedJob({ sql, userId, jobId: job.id });
    return { job: current || job, status: current?.status };
  }
  job = saved;

  let verdict;
  try {
    const deadline = deps.now().getTime() + VERIFY_BUDGET_MS;
    verdict = await deps.withSession(session.connectUrl, ({ page }) =>
      deps.verify({ page, url: job.target_url, toleranceMs: SOLVER_TOLERANCE_MS, cancelled: () => Date.now() > deadline }));
  } catch {
    await releaseQuiet(deps, { bb_session_id: session.id });
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'failed', generation: job.generation, patch: { error_code: 'verify_failed' } }) || job;
    return { job, error: { code: 'verify_failed', status: 502 } };
  }

  if (verdict.verdict === 'clean') {
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'ready', generation: job.generation }) || job;
  } else if (verdict.verdict === 'needs_human') {
    const pageId = await deps.browserbase.liveUrls(session.id).then((l) => l.pages[0]?.id || null).catch(() => null);
    job = await transition({
      sql, jobId: job.id, from: 'verifying', to: 'needs_human', generation: job.generation,
      patch: { bb_page_id: pageId, human_deadline_at: new Date(deps.now().getTime() + HUMAN_DEADLINE_MS).toISOString() },
    }) || job;
  } else {
    await releaseQuiet(deps, { bb_session_id: session.id });
    job = await transition({ sql, jobId: job.id, from: 'verifying', to: 'unsupported', generation: job.generation, patch: { error_code: `challenge_${verdict.kind || 'unknown'}` } }) || job;
  }
  return { job, status: job.status };
}

export async function checkJob({ sql, userId, jobId, env = process.env, deps = defaultDeps(env), connectUrlFor = (id) => connectUrlForSession(id, env) }) {
  const job = await getOwnedJob({ sql, userId, jobId });
  if (!job) throw new ChallengeJobError('not_found', 404);
  if (job.status !== 'needs_human') return { job };
  const owner = `check:${Math.random().toString(36).slice(2)}`;
  if (!(await acquireLease({ sql, jobId, owner, ttlMs: 15_000 }))) return { job };
  try {
    const verdict = await deps.withSession(await connectUrlFor(job.bb_session_id), ({ page }) =>
      deps.verify({ page, url: job.target_url, toleranceMs: 3_000 }));
    if (verdict.verdict === 'clean') {
      const next = await transition({ sql, jobId, from: 'needs_human', to: 'ready', generation: job.generation });
      return { job: next || job };
    }
    return { job };
  } finally {
    await releaseLease({ sql, jobId, owner });
  }
}

export async function captureJob({ sql, userId, jobId, env = process.env, deps = defaultDeps(env), loadNode, connectUrlFor = (id) => connectUrlForSession(id, env), signal = null }) {
  const job = await getOwnedJob({ sql, userId, jobId });
  if (!job) throw new ChallengeJobError('not_found', 404);
  if (job.status !== 'ready') throw new ChallengeJobError(job.status === 'succeeded' ? 'already_done' : 'job_not_ready', 409);
  const owner = `capture:${Math.random().toString(36).slice(2)}`;
  // ready → capturing, CERCADO: se alguém já capturou, nada roda.
  const capturing = await transition({ sql, jobId, from: 'ready', to: 'capturing', generation: job.generation, patch: { lease_owner: owner } });
  if (!capturing) throw new ChallengeJobError('job_conflict', 409);

  const node = await loadNode({ sql, userId, nodeId: job.node_id });
  try {
    const result = await deps.withSession(await connectUrlFor(job.bb_session_id), async (session) => {
      if (job.purpose === 'edit') {
        return deps.reconstruct({
          sql, userId, node, reason: 'edit', engine: 'native', idemKey: job.idem_key, op: 'clone.edit',
          producer: (url, o = {}) => deps.captureNative(url, { ...o, session, challengeToleranceMs: SOLVER_TOLERANCE_MS, signal }),
        });
      }
      const snap = await deps.captureSnap(job.target_url, { session });
      return deps.persistReference({ sql, userId, nodeId: job.node_id, html: snap.html, screenshotDataUrl: snap.screenshotDataUrl, title: snap.title });
    });
    await transition({ sql, jobId, from: 'capturing', to: 'committing', generation: job.generation });
    const done = await transition({ sql, jobId, from: 'committing', to: 'succeeded', generation: job.generation });
    await releaseQuiet(deps, job);
    return { job: done, result };
  } catch (e) {
    await transition({ sql, jobId, from: 'capturing', to: 'failed', generation: job.generation, patch: { error_code: e?.code || 'capture_failed' } });
    await releaseQuiet(deps, job);
    throw e;
  }
}

export async function cancelJob({ sql, userId, jobId, env = process.env, deps = defaultDeps(env) }) {
  const job = await getOwnedJob({ sql, userId, jobId });
  if (!job) throw new ChallengeJobError('not_found', 404);
  if (TERMINAL.has(job.status)) return { job };
  const next = await transition({ sql, jobId, from: job.status, to: 'cancelled', generation: job.generation });
  await releaseQuiet(deps, job);
  return { job: next || job };
}

// Só em needs_human E com a flag do humano ligada (spec §4.6). Devolve a URL
// da PÁGINA (segredo portador), nunca a resposta de debug inteira.
export async function liveViewFor({ job, env = process.env, deps = defaultDeps(env) }) {
  if (String(env.UNCRAFT_CHALLENGE_HUMAN || '') !== '1') return null;
  // Exige sessão E página atribuída: nada de fallback para "a primeira página"
  // (Astra 2026-09-08 #t89) — expor uma página que não é a do job entregaria
  // uma URL portadora de outra página da sessão.
  if (job?.status !== 'needs_human' || !job.bb_session_id || !job.bb_page_id) return null;
  const live = await deps.browserbase.liveUrls(job.bb_session_id).catch(() => null);
  const page = live?.pages?.find((p) => p.id === job.bb_page_id);
  return page?.debuggerFullscreenUrl ? { url: page.debuggerFullscreenUrl } : null;
}

export async function sweepExpiredJobs({ sql, env = process.env, deps = defaultDeps(env) }) {
  const rows = await listExpired({ sql });
  let expired = 0;
  for (const job of rows) {
    await releaseQuiet(deps, job);
    const r = await transition({ sql, jobId: job.id, from: job.status, to: 'expired', generation: job.generation, patch: { error_code: 'expired' } });
    if (r) expired += 1;
  }
  return { expired };
}

// O que o cliente vê: NUNCA ids do vendor nem URLs.
export function publicJobView(job) {
  return {
    id: job.id,
    status: job.status,
    purpose: job.purpose,
    nodeId: job.node_id,
    errorCode: job.error_code || null,
    humanDeadlineAt: job.human_deadline_at || null,
  };
}
