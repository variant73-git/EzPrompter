import { reconstructPage } from './reconstruct.js';
import { startCloneTimer, buildCloneTelemetry } from './clone-telemetry.js';
import { previewVideoUrl } from './preview-video.js';
import { resolveCloneEngine, producerForEngine } from './clone-router.js';
import { recordUsage, runBilledOperation } from './billing/context.js';
import { createConfiguredBundleStore } from './native-clone/bundle-store.js';
import { registerNativeBundle } from './native-clone/register-bundle.js';
import { captureNativeBundle } from './native-clone/capture-bundle.js';
import { generateControlsForReconstruction } from './motion-editor/control-generation.js';
import { persistNativeBundleDescriptor } from './motion-editor/edit-session-store.js';
import { createEmptyMotionManifest, parseMotionManifest } from './motion-editor/manifest.js';
import {
  motionControlGenerationDiagnosticEvents,
  persistMotionDiagnosticEvents,
} from './motion-editor/diagnostics.js';

const CONTROL_CONVERSION_DEADLINE_MS = 90_000;

function generationMeta(generated) {
  return {
    status: 'ready',
    provider: generated.provider?.provider || null,
    model: generated.provider?.model || null,
    repaired: generated.provider?.repaired === true,
    providerCostUsd: Number(generated.provider?.costUsd || 0),
    acceptedControls: generated.manifest.controls.length,
    decisionCodes: [...new Set((generated.diagnostics || []).map((item) => item.code))],
  };
}

async function persistNativeSnapshot({ sql, node, descriptor, motionManifest, current, meta }) {
  let rows;
  if (current?.id && current.source === 'capture') {
    rows = await sql`
      WITH current_node AS (
        SELECT current_snapshot_id
          FROM nodes
         WHERE id = ${node.id}
         FOR UPDATE
      ), updated_snapshot AS (
        UPDATE snapshots
           SET html = NULL,
               source = 'native-bundle',
               design_md = NULL,
               native_bundle_id = ${descriptor.bundleId},
               motion_manifest = ${JSON.stringify(motionManifest)}::jsonb,
               motion_manifest_version = ${motionManifest.schemaVersion}
         WHERE id = ${current.id}
           AND node_id = ${node.id}
           AND source = 'capture'
           AND EXISTS (
             SELECT 1 FROM current_node WHERE current_snapshot_id = ${current.id}
           )
        RETURNING id
      ), updated_node AS (
        UPDATE nodes
           SET current_snapshot_id = updated_snapshot.id,
               meta = meta || ${JSON.stringify(meta)}::jsonb
          FROM updated_snapshot
         WHERE nodes.id = ${node.id}
           AND nodes.current_snapshot_id = ${current.id}
        RETURNING updated_snapshot.id AS snapshot_id
      )
      SELECT snapshot_id FROM updated_node
    `;
  } else {
    rows = await sql`
      WITH current_node AS (
        SELECT current_snapshot_id
          FROM nodes
         WHERE id = ${node.id}
           AND current_snapshot_id IS NOT DISTINCT FROM ${current?.id || null}
         FOR UPDATE
      ), inserted_snapshot AS (
        INSERT INTO snapshots (
          node_id, html, screenshot_url, source, parent_snapshot_id,
          native_bundle_id, motion_manifest, motion_manifest_version
        )
        SELECT
          ${node.id}, NULL, NULL, 'native-bundle', ${current?.id || null},
          ${descriptor.bundleId}, ${JSON.stringify(motionManifest)}::jsonb, ${motionManifest.schemaVersion}
        FROM current_node
        RETURNING id
      ), updated_node AS (
        UPDATE nodes
           SET current_snapshot_id = inserted_snapshot.id,
               meta = meta || ${JSON.stringify(meta)}::jsonb
          FROM inserted_snapshot
         WHERE nodes.id = ${node.id}
           AND nodes.current_snapshot_id IS NOT DISTINCT FROM ${current?.id || null}
        RETURNING inserted_snapshot.id AS snapshot_id
      )
      SELECT snapshot_id FROM updated_node
    `;
  }
  const snapshotId = rows[0]?.snapshot_id || rows[0]?.id || null;
  if (!snapshotId) {
    const error = new Error('reconstruction_snapshot_changed');
    error.code = 'reconstruction_snapshot_changed';
    throw error;
  }
  return snapshotId;
}

export function normalizeReconstructionOutput(output) {
  if (!output || typeof output !== 'object') {
    const error = new Error('reconstruction_output_missing');
    error.code = 'no_output';
    throw error;
  }
  const kind = output.kind || (output.html ? 'iter9' : null);
  if (kind === 'iter9') {
    if (!output.html) {
      const error = new Error('iter9_reconstruction_output_missing_html');
      error.code = 'no_output';
      throw error;
    }
    return { kind: 'iter9', output };
  }
  if (kind === 'native') {
    if (!output.bundle || typeof output.bundle !== 'object') {
      const error = new Error('native_reconstruction_output_missing_bundle');
      error.code = 'invalid_native_bundle';
      throw error;
    }
    return { kind: 'native', output };
  }
  const error = new Error('reconstruction_output_kind_unsupported');
  error.code = 'no_output';
  throw error;
}

export async function materializeReconstructionOutput(output, { bundleStore = null } = {}) {
  const normalized = normalizeReconstructionOutput(output);
  if (normalized.kind === 'iter9') return normalized;
  const store = bundleStore || createConfiguredBundleStore();
  const bundleDescriptor = await registerNativeBundle(normalized.output.bundle, { store });
  return { kind: 'native', output: normalized.output, bundleDescriptor };
}

// One implementation for every paid upgrade path. Capture stays free; edit
// and strict workflow dependencies call this service only after the policy in
// reconstruction-policy.js has approved the action.
/**
 * ESCOLHA DE PRODUTOR — a metade que faltava da l.332 do plano de 2026-07-26.
 *
 * Até aqui existia UM produtor: `reconstructPage`, que devolve HTML de visão e
 * **descarta o movimento** (medido: zero gsap/@keyframes na saída). Como
 * `needsDeferredReconstruction` manda TODA referência de URL para a
 * reconstrução no Edit — animada ou não —, o iter9 virou o clone de tudo, que
 * nunca foi o papel dele.
 *
 * Agora o Edit usa o produtor NATIVO, que preserva o site com os scripts vivos
 * e é o formato que o editor consome. O iter9 continua alcançável e intacto para
 * as demais razões, exatamente como o plano pedia.
 *
 * `UNCRAFT_NATIVE_CLONE_PRODUCER=off` desliga e devolve o comportamento antigo,
 * sem precisar reverter código.
 *
 * ⚠️ POR QUE SÓ 'edit', E NÃO 'transform-target'/'runtime-source'
 *   O Sol apontou que a rota `/run` usa essas duas razões justamente para
 *   dependências declaradas como runtime editável, e que elas caem no iter9
 *   perdendo o movimento. A OBSERVAÇÃO procede; a prescrição de ampliar, não:
 *   `/run` alimenta `runCompose` com `reconstructed.html`, e um bundle nativo é
 *   um DIRETÓRIO, sem `html` — ampliar deixaria a composição sem entrada.
 *
 *   Logo o limite é deliberado, e o buraco fica NOMEADO: uma aresta que pede
 *   "preserve o movimento" ainda recebe uma fonte iter9 sem movimento, porque a
 *   composição é textual. Fechar isso exige compor sobre bundle, que é outra
 *   feature — não fiação. Fixado pelo teste "o limite de 'edit' e deliberado".
 */
export function chooseReconstructionProducer(reason, env = process.env, requested = null) {
  if (String(env.UNCRAFT_NATIVE_CLONE_PRODUCER || '').toLowerCase() === 'off') return reconstructPage;
  // A doutrina vive em lib/clone-router.js (ordem do Adilson, 2026-08-15):
  // "clone" e' UM — o animado; iter9 SOMENTE por nome; consumo textual
  // (composicao) e' a excecao deliberada. Este wrapper existe para os
  // chamadores antigos; a decisao em si mora la'.
  return producerForEngine(resolveCloneEngine({ requested, reason }));
}

export async function reconstructSiteNode({
  sql,
  userId,
  node,
  reason,
  engine = null,
  harness = null,
  idemKey = null,
  op = 'reconstruct',
  producer = null,
  bundleStore = null,
  generateControls = generateControlsForReconstruction,
  persistBundle = persistNativeBundleDescriptor,
}) {
  const cloneTimer = startCloneTimer();
  const { result, credits, balanceAfter, deduped, usageMicrocents } = await runBilledOperation(
    { sql, userId, op, boardId: node.board_id, nodeId: node.id, idemKey },
    async () => {
      const deadline = new AbortController();
      const deadlineError = Object.assign(new Error('control_conversion_timeout'), { code: 'control_conversion_timeout' });
      const aborted = new Promise((_, reject) => deadline.signal.addEventListener('abort', () => reject(deadline.signal.reason), { once: true }));
      const timer = setTimeout(() => deadline.abort(deadlineError), CONTROL_CONVERSION_DEADLINE_MS);
      try {
      let materialized;
      try {
        materialized = await materializeReconstructionOutput(
          await Promise.race([
            (producer || chooseReconstructionProducer(reason, process.env, engine))(node.origin_url, { visionModel: harness?.cloneVision || null, signal: deadline.signal }),
            aborted,
          ]),
          { bundleStore },
        );
      } catch (error) {
        if (deadline.signal.aborted) {
          const timeout = new Error('control_conversion_timeout');
          timeout.code = 'control_conversion_timeout';
          throw timeout;
        }
        throw error;
      }
      cloneTimer.mark('capture');
      // Read the CURRENT snapshot AUTHORITATIVELY — never trust the caller's
      // node fields. The run route builds its node without current_snapshot_id
      // (adversarial review Codex #2), and the row can change between the
      // caller's read and here. This single read is the source of truth.
      const [current] = await sql`
        SELECT n.current_snapshot_id AS id, s.source AS source
          FROM nodes n
          LEFT JOIN snapshots s ON s.id = n.current_snapshot_id
         WHERE n.id = ${node.id}
      `;

      if (materialized.kind === 'native') {
          const descriptor = await persistBundle({ sql, descriptor: materialized.bundleDescriptor });
          const generated = await Promise.race([generateControls({
            descriptor,
            reconstructionOutput: materialized.output,
            signal: deadline.signal,
            onUsage: (usage) => recordUsage({
              provider: usage.provider,
              model: usage.model,
              tokensIn: usage.inputTokens,
              tokensOut: usage.outputTokens,
              cachedIn: usage.cachedInputTokens,
              cacheWrite: usage.cacheWriteTokens,
              meta: { stage: 'motion-control-generation' },
            }),
          }), aborted]);
          cloneTimer.mark('motion-controls');
          const baseManifest = createEmptyMotionManifest({
            baseBundleId: descriptor.bundleId,
            runtimeFingerprint: descriptor.runtimeFingerprint,
          });
          const motionManifest = parseMotionManifest({
            ...baseManifest,
            controlManifest: generated.manifest,
          }, {
            expectedBundleId: descriptor.bundleId,
            runtimeFingerprint: descriptor.runtimeFingerprint,
          });
          // Preview ANIMADO: a URL só existe quando o bundle trouxe o arquivo.
          // Ausente = o node segue no PNG, que é o comportamento de hoje.
          const previewUrl = previewVideoUrl(descriptor, node.id);
          const nextMeta = {
            animatedDetected: false,
            animatedRuntime: true,
            ...(previewUrl ? { previewVideo: { url: previewUrl } } : {}),
            referenceMode: 'clone',
            reconstructionEngine: 'native-bundle',
            deferredReconstructionReason: reason,
            deferredReconstructedAt: new Date().toISOString(),
            motionControls: generationMeta(generated),
          };
          if (deadline.signal.aborted) throw deadline.signal.reason;
          const snapshotId = await persistNativeSnapshot({
            sql,
            node,
            descriptor,
            motionManifest,
            current,
            meta: nextMeta,
          });
          cloneTimer.mark('persist');
          await persistMotionDiagnosticEvents(sql, {
            user_id: userId,
            board_id: node.board_id,
            node_id: node.id,
            snapshot_id: snapshotId,
            edit_session_id: null,
            runtime_fingerprint: descriptor.runtimeFingerprint,
            content_hash: descriptor.contentHash,
          }, motionControlGenerationDiagnosticEvents(generated)).catch(() => null);
          return {
            ok: true,
            kind: 'native',
            nodeId: node.id,
            snapshotId,
            bundleDescriptor: descriptor,
            motionManifest,
            controlManifest: generated.manifest,
            controlGeneration: generationMeta(generated),
            meta: nextMeta,
          };
      }
      const rec = materialized.output;

      // The reconstruction is a FORMAT UPGRADE of the SAME state (animated
      // capture → editable Iter9 clone), not a saved edit. Overwrite the current
      // snapshot IN PLACE — inserting a NEW snapshot left the pre-clone capture
      // behind as a spurious history version even when the user saved nothing,
      // so the clone simply BECOMES the default state.
      //
      // BUT only when the current snapshot is the plain automatic capture
      // (source='capture'). One-time reconstruction does NOT imply current is
      // still the capture: several routes advance current_snapshot_id on a
      // still-animatedDetected node — replace-content, manual/handoff/assisted
      // capture, an `agent-edit` from editSite, a run result — WITHOUT clearing
      // the flag. Overwriting any of those would silently, irreversibly destroy
      // user-owned content (adversarial review F1 / Codex #1). For every
      // non-capture source, fall through to INSERT + repoint so the user's
      // snapshot survives as history. The `AND source='capture'` in the UPDATE
      // is optimistic concurrency: a racing reconstruction that already flipped
      // it no-ops here and takes the INSERT path instead. design_md is cleared —
      // it described the pre-clone animated site, not the clone (F3).
      let snapId = null;
      if (current?.id && current.source === 'capture') {
        const [snap] = await sql`
          UPDATE snapshots
             SET html = ${rec.html},
                 screenshot_url = ${rec.screenshotDataUrl || null},
                 source = 'reconstruct',
                 design_md = NULL
           WHERE id = ${current.id} AND node_id = ${node.id} AND source = 'capture'
          RETURNING id
        `;
        snapId = snap?.id || null;
      }
      if (!snapId) {
        const [snap] = await sql`
          INSERT INTO snapshots (node_id, html, screenshot_url, source, parent_snapshot_id)
          VALUES (${node.id}, ${rec.html}, ${rec.screenshotDataUrl || null}, 'reconstruct', ${current?.id || null})
          RETURNING id
        `;
        snapId = snap.id;
      }
      const nextMeta = {
        animatedDetected: false,
        animatedRuntime: true,
        referenceMode: 'clone',
        reconstructionEngine: 'iter9',
        deferredReconstructionReason: reason,
        deferredReconstructedAt: new Date().toISOString(),
      };
      await sql`
        UPDATE nodes
           SET current_snapshot_id = ${snapId},
               meta = meta || ${JSON.stringify(nextMeta)}::jsonb
         WHERE id = ${node.id}
      `;
      cloneTimer.mark('persist');
      return { ok: true, nodeId: node.id, snapshotId: snapId, html: rec.html, meta: nextMeta };
      } finally {
        clearTimeout(timer);
      }
    },
  );
  // ⏱️💰 Telemetria por clone (pedido do Adilson, 2026-08-20): tempo por etapa
  // + custo real de API gravados no meta DEPOIS do settle (só assim credits e
  // µ¢ existem). Replay de dedup não é clone novo — não grava. Fail-open: a
  // telemetria nunca derruba um clone que deu certo.
  let telemetry = null;
  if (!deduped && result?.ok) {
    const { stages, totalMs } = cloneTimer.finish();
    telemetry = buildCloneTelemetry({
      engine: result.kind === 'native' ? 'native-bundle' : 'iter9',
      harness: harness?.id || null,
      reason,
      url: node.origin_url || null,
      stages,
      totalMs,
      credits,
      usageMicrocents: usageMicrocents ?? null,
    });
    await sql`
      UPDATE nodes SET meta = meta || ${JSON.stringify({ cloneTelemetry: telemetry })}::jsonb
       WHERE id = ${node.id}
    `.catch((e) => console.warn(`[clone-telemetry] gravação falhou (node=${node.id}): ${String(e?.message || e).slice(0, 120)}`));
  }
  return { ...result, credits, balanceAfter, telemetry };
}
