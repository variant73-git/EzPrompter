// Preparação da cópia editável no Edit (spec 2026-10-09 §4). Nenhum request espera a máquina: o canvas
// consulta e cada consulta avança UM passo curto sob a trava da tarefa.
import { claimOperation } from '../billing/operations.js';
import { settleOperation } from '../billing/ledger.js';
import { estimateOp } from '../billing/pricing.js';
import * as jobStore from './job-store.js';
import { randomUUID } from 'node:crypto';
import { createConfiguredBundleStore } from '../native-clone/bundle-store.js';
import { registerNativeBundle } from '../native-clone/register-bundle.js';
import { persistNativeBundleDescriptor } from '../motion-editor/edit-session-store.js';
import { PCT, parseProgressLog, pctFromVm } from './progress.js';
import { EXIT_MEANING, SANDBOX_TIMEOUT_MS, VM, createSandboxRunner, parseExitFile, sandboxNameFor } from './sandbox-runner.js';
import { chunkBySize, loadCapturePayload, loadCodePayload, loadNativeDescriptor } from './payload.js';
import { canonicalProducerOutput, readTarGz } from './output-bundle.js';
import { publishCanonical } from './publish.js';

export const CANONICAL_OP = 'clone.canonical';

export function canonicalEditEnabled(env = process.env) {
  return env.UNCRAFT_CANONICAL_EDIT === '1';
}

export function publicCanonicalJobView(job) {
  return {
    id: job.id,
    nodeId: job.node_id,
    status: job.status,
    progressPct: Number(job.progress_pct) || 0,
    errorCode: job.error_code || null,
  };
}

export function readyResult(job) {
  if (job?.status !== 'ready' || !job.result_bundle_id || !job.result_snapshot_id) return null;
  return {
    kind: 'native',
    snapshotId: job.result_snapshot_id,
    snapshotSource: 'canonical',
    bundleDescriptor: { bundleId: job.result_bundle_id },
    motionManifest: { schemaVersion: 2, baseBundleId: job.result_bundle_id },
  };
}

function logSettleFailure(jobId, error) {
  // eslint-disable-next-line no-console
  console.error('[canonical] settle failed', jobId, error?.code || error?.message);
}

export async function startCanonicalJob({ sql, userId, node, idemKey, deps = {} }) {
  const store = deps.jobStore || jobStore;
  const claim = deps.claimOperation || claimOperation;
  const settle = deps.settleOperation || settleOperation;
  if (node?.current_snapshot_source !== 'native-bundle' || !node.current_native_bundle_id || !node.current_snapshot_id) {
    return { error: { code: 'canonical_not_applicable', status: 409 } };
  }
  const active = await store.findActiveJobForNode({ sql, userId, nodeId: node.id });
  if (active) return { job: active };
  const previous = await store.findJobByIdem({ sql, userId, idemKey });
  if (previous) return { job: previous };

  const estimate = estimateOp(CANONICAL_OP);
  const claimed = await claim({ sql, userId, idemKey: `canonical:${idemKey}`, op: CANONICAL_OP, boardId: node.board_id, nodeId: node.id, estimate });
  if (claimed.outcome === 'insufficient') return { error: { code: 'insufficient_credits', status: 402, estimate, balance: claimed.balance } };
  const opId = claimed.outcome === 'claimed'
    ? claimed.operationId
    : (claimed.row?.status === 'in_flight' ? claimed.row.id : null);

  const job = await store.insertJob({
    sql, userId, boardId: node.board_id, nodeId: node.id,
    sourceSnapshotId: node.current_snapshot_id, nativeBundleId: node.current_native_bundle_id, idemKey, opId,
  });
  if (job) return { job };

  // Corrida: outra requisição criou a tarefa entre a leitura e a inserção. Só devolve a reserva que ESTA requisição
  // criou e que nenhuma tarefa adotou — com a mesma etiqueta a reserva é PARTILHADA e a tarefa vencedora vai usá-la.
  const winner = (await store.findJobByIdem({ sql, userId, idemKey })) || (await store.findActiveJobForNode({ sql, userId, nodeId: node.id }));
  if (opId && claimed.outcome === 'claimed' && winner?.op_id !== opId) {
    await settle({ sql, userId, opId, op: CANONICAL_OP, boardId: node.board_id, nodeId: node.id, holdCredits: estimate, chargeCredits: 0, opStatus: 'failed' })
      .catch((e) => logSettleFailure(null, e));
  }
  return winner ? { job: winner } : { error: { code: 'internal', status: 500 } };
}

// A trava dura MAIS que o tempo máximo da rota (maxDuration = 300 s): ela nunca vence enquanto a requisição dona
// ainda pode estar rodando. E toda escrita cercada que volta vazia = trava perdida → a requisição PARA (sem
// efeito externo: nem iniciar, nem desligar, nem cobrar).
export const LEASE_SECS = 330;
const LEASE_LOST = 'lease_lost';
const KNOWN_FAILURES = new Set(['capture_failed', 'sandbox_unavailable', 'recording_failed', 'timeout', 'publish_conflict', 'internal']);

function failure(code, detail) {
  return Object.assign(new Error(code), { code, detail });
}
function must(row) {
  if (!row) throw failure(LEASE_LOST);
  return row;
}
const text = (buf) => (buf ? Buffer.from(buf).toString('utf8') : '');

export function createCanonicalDeps(overrides = {}) {
  return {
    jobStore,
    runner: createSandboxRunner(),
    bundleStore: createConfiguredBundleStore(),
    loadCodePayload,
    loadCapturePayload,
    loadNativeDescriptor,
    readTarGz,
    registerNativeBundle,
    persistNativeBundleDescriptor,
    publishCanonical,
    settleOperation,
    newOwner: () => randomUUID(),
    ...overrides,
  };
}

function view(job) {
  const result = readyResult(job);
  return { job: publicCanonicalJobView(job), ...(result ? { result } : {}) };
}

async function settleJob({ sql, job, deps }) {
  if (!job.op_id) return;
  const ok = job.status === 'ready';
  const price = estimateOp(CANONICAL_OP);
  // settleOperation é cercado (só mexe em operação 'in_flight'): repetir é inofensivo.
  await deps.settleOperation({
    sql, userId: job.user_id, opId: job.op_id, op: CANONICAL_OP, boardId: job.board_id, nodeId: job.node_id,
    holdCredits: price, chargeCredits: ok ? price : 0, opStatus: ok ? 'settled' : 'failed',
    ...(ok ? { result: { snapshotId: job.result_snapshot_id } } : {}),
  });
}

// Limpeza de tarefa TERMINADA: encerrar a cobrança e desligar a máquina. Só marca `cleanup_done` quando as duas
// confirmam; se algo falhar, a varredura do cron repete (cada passo é idempotente).
// Máquina AUSENTE só prova "desligada" depois do prazo dela: uma criação que uma requisição morta deixou no ar
// ainda pode terminar e fazer a máquina nascer depois desta limpeza. Passado o prazo da própria máquina (30 min),
// ela não pode estar viva — aí a ausência fecha a limpeza.
const ABSENCE_PROOF_MS = SANDBOX_TIMEOUT_MS + 60_000;
async function finishCleanup({ sql, job, deps }) {
  try {
    await settleJob({ sql, job, deps });
    if (job.sandbox_name) {
      const found = await deps.runner.stop(job.sandbox_name);
      if (found === 'absent' && Date.now() - new Date(job.created_at).getTime() < ABSENCE_PROOF_MS) return false;
    }
    await deps.jobStore.markCleanupDone({ sql, jobId: job.id });
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[canonical] cleanup pending', job.id, error?.code || error?.message);
    return false;
  }
}

// Falha lê a linha ATUAL (um erro depois de uma transição não pode ficar preso na geração velha). Se a transição
// não for NOSSA (trava perdida), não toca em nada — o novo dono cuida da máquina e da cobrança.
async function failJob({ sql, job, owner, deps, code, detail }) {
  const store = deps.jobStore;
  const current = (await store.getOwnedJob({ sql, userId: job.user_id, jobId: job.id })) || job;
  if (store.TERMINAL.has(current.status)) return current;
  const moved = await store.moveJob({
    sql, jobId: job.id, owner, generation: current.generation, from: current.status, to: 'failed',
    patch: { error_code: code, error_detail: detail ? String(detail).slice(0, 500) : null },
  });
  if (!moved) return current;
  await finishCleanup({ sql, job: moved, deps });
  return moved;
}

async function retryOrFail({ sql, job, owner, deps, reason }) {
  if (job.attempt < 2) {
    const restarted = must(await deps.jobStore.restartJob({ sql, jobId: job.id, owner, generation: job.generation, from: job.status }));
    // a máquina velha só sai DEPOIS que o recomeço é nosso
    await deps.runner.stop(job.sandbox_name).catch(() => {});
    return restarted;
  }
  throw failure('sandbox_unavailable', reason);
}

async function provision({ sql, job, owner, deps }) {
  const store = deps.jobStore;
  let sandbox;
  try { sandbox = await deps.runner.ensure(job.sandbox_name); } catch (e) { throw failure('sandbox_unavailable', e?.message); }
  // A máquina é a verdade: o script escreve `iniciado` logo depois de pegar a trava dele. Se já está lá, uma
  // requisição anterior iniciou e morreu antes de gravar o estado — não reescrever, não iniciar de novo.
  if (await deps.runner.readFile(sandbox, VM.started)) {
    return must(await store.moveJob({ sql, jobId: job.id, owner, generation: job.generation, from: 'provisioning', to: 'recording', patch: { stage: 'started', progress_pct: PCT.started } }));
  }
  let current = must(await store.noteJob({ sql, jobId: job.id, owner, generation: job.generation, patch: { stage: 'created', progress_pct: PCT.created } }));
  const nativeDescriptor = await deps.loadNativeDescriptor({ sql, bundleId: job.native_bundle_id });
  const files = [...await deps.loadCodePayload(), ...await deps.loadCapturePayload({ store: deps.bundleStore, descriptor: nativeDescriptor })];
  for (const lote of chunkBySize(files)) await deps.runner.writeFiles(sandbox, lote);
  current = must(await store.noteJob({ sql, jobId: job.id, owner, generation: current.generation, patch: { stage: 'files', progress_pct: PCT.files } }));
  const commandId = await deps.runner.start(sandbox);
  return must(await store.moveJob({
    sql, jobId: job.id, owner, generation: current.generation, from: 'provisioning', to: 'recording',
    patch: { command_id: commandId, stage: 'started', progress_pct: PCT.started },
  }));
}

async function packageAndPublish({ sql, job, owner, deps }) {
  const sandbox = await deps.runner.find(job.sandbox_name);
  if (!deps.runner.isAlive(sandbox)) return retryOrFail({ sql, job, owner, deps, reason: 'sandbox gone before packaging' });
  const archive = await deps.runner.readFile(sandbox, VM.archive);
  if (!archive) throw failure('recording_failed', 'archive_missing');
  const files = await deps.readTarGz(archive);
  const nativeDescriptor = await deps.loadNativeDescriptor({ sql, bundleId: job.native_bundle_id });
  const output = canonicalProducerOutput({ files, nativeDescriptor });
  const descriptor = await deps.registerNativeBundle(output, { store: deps.bundleStore });
  await deps.persistNativeBundleDescriptor({ sql, descriptor });
  const html = text(files.find((f) => f.path === 'index.html').body);
  const { snapshotId } = await deps.publishCanonical({ sql, job, owner, descriptor, html });
  const ready = {
    ...job, status: 'ready', generation: job.generation + 1, progress_pct: 100,
    result_bundle_id: descriptor.bundleId, result_snapshot_id: snapshotId, lease_owner: null,
  };
  await finishCleanup({ sql, job: ready, deps });
  return ready;
}

async function record({ sql, job, owner, deps }) {
  const store = deps.jobStore;
  const sandbox = await deps.runner.find(job.sandbox_name);
  if (!deps.runner.isAlive(sandbox)) return retryOrFail({ sql, job, owner, deps, reason: `sandbox ${sandbox ? sandbox.status : 'missing'}` });
  const exitCode = parseExitFile(text(await deps.runner.readFile(sandbox, VM.done)));
  if (exitCode == null) {
    const pct = pctFromVm(parseProgressLog(text(await deps.runner.readFile(sandbox, VM.progress))));
    if (pct == null) return job;
    return must(await store.noteJob({ sql, jobId: job.id, owner, generation: job.generation, patch: { stage: 'recording', progress_pct: pct } }));
  }
  if (exitCode === 0) {
    const moved = must(await store.moveJob({ sql, jobId: job.id, owner, generation: job.generation, from: 'recording', to: 'packaging', patch: { stage: 'packaging', progress_pct: PCT.packaging } }));
    return packageAndPublish({ sql, job: moved, owner, deps });
  }
  const tail = text(await deps.runner.readFile(sandbox, VM.errors).catch(() => null));
  throw failure('recording_failed', `exit ${exitCode} (${EXIT_MEANING[exitCode] || 'unknown'}) ${tail.slice(-400)}`);
}

async function step({ sql, job, owner, deps }) {
  if (new Date(job.deadline_at).getTime() < Date.now()) throw failure('timeout', 'deadline');
  if (job.status === 'queued') {
    const moved = must(await deps.jobStore.moveJob({
      sql, jobId: job.id, owner, generation: job.generation, from: 'queued', to: 'provisioning',
      patch: { sandbox_name: sandboxNameFor(job.id, job.attempt), stage: 'creating' },
    }));
    return provision({ sql, job: moved, owner, deps });
  }
  if (job.status === 'provisioning') return provision({ sql, job, owner, deps });
  if (job.status === 'recording') return record({ sql, job, owner, deps });
  if (job.status === 'packaging') return packageAndPublish({ sql, job, owner, deps });
  return job;
}

export async function advanceCanonicalJob({ sql, userId, jobId, deps: given }) {
  const deps = given || createCanonicalDeps();
  const store = deps.jobStore;
  const job = await store.getOwnedJob({ sql, userId, jobId });
  if (!job) return { error: { code: 'not_found', status: 404 } };
  if (store.TERMINAL.has(job.status)) return view(job);
  const owner = deps.newOwner();
  const leased = await store.acquireLease({ sql, jobId, owner, ttlSecs: LEASE_SECS });
  if (!leased) return view(job); // outra requisição está trabalhando nesta tarefa
  let current = leased;
  try {
    current = await step({ sql, job: leased, owner, deps });
  } catch (error) {
    if (error?.code === LEASE_LOST) {
      current = (await store.getOwnedJob({ sql, userId, jobId })) || leased;
    } else {
      const code = KNOWN_FAILURES.has(error?.code) ? error.code : 'internal';
      current = await failJob({ sql, job: leased, owner, deps, code, detail: error?.detail || error?.message });
    }
  } finally {
    await store.releaseLease({ sql, jobId, owner }).catch(() => {});
  }
  return view(current);
}

export async function sweepCanonicalJobs({ sql, deps: given, limit = 50 }) {
  const deps = given || createCanonicalDeps();
  const overdue = await deps.jobStore.listOverdueJobs({ sql, limit });
  let failed = 0;
  for (const job of overdue) {
    if (await deps.jobStore.failOverdueJob({ sql, jobId: job.id, generation: job.generation, from: job.status })) failed += 1;
  }
  // Inclui as que acabaram de falhar acima e as terminadas cuja limpeza não confirmou.
  const pending = await deps.jobStore.listCleanupPending({ sql, limit });
  let cleaned = 0;
  for (const job of pending) if (await finishCleanup({ sql, job, deps })) cleaned += 1;
  return { scanned: overdue.length, failed, cleaned };
}
