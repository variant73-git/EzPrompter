// Preparação da cópia editável no Edit (spec 2026-10-09 §4). Nenhum request espera a máquina: o canvas
// consulta e cada consulta avança UM passo curto sob a trava da tarefa.
import { claimOperation } from '../billing/operations.js';
import { settleOperation } from '../billing/ledger.js';
import { estimateOp } from '../billing/pricing.js';
import * as jobStore from './job-store.js';

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
