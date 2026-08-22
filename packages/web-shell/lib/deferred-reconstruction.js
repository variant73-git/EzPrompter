import { reconstructPage } from './reconstruct.js';
import { resolveCloneEngine, producerForEngine } from './clone-router.js';
import { createCloneTimer, persistCloneTelemetry, readCloneTelemetry } from './clone-telemetry.js';
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
// The iter9 producer is a vision-reasoning pass measured at ~150s with ±40%
// variance (doctrine 183: size ceilings by measured percentile and raise the
// stack TOGETHER — this deadline < route maxDuration 300s; the client fetch
// has no cap). One 90s deadline for both lanes timed out most nominal iter9
// clones with a refunded `conversion_timeout`.
const ITER9_CONVERSION_DEADLINE_MS = 240_000;
// 240s applies ONLY to the user's single-item lane (reason 'edit' — the
// /reconstruct route, one reconstruction per request). The /run route can
// chain SEVERAL reconstructions under one 300s maxDuration; giving each 240s
// would let two items burn 480s and die mid-request with the first already
// billed (Sol). Its lanes keep the original 90s — that pre-existing 3×90s
// squeeze is a NAMED residual of /run, unchanged by this fix.
export function conversionDeadlineMs(producerFn, reason) {
  if (producerFn === captureNativeBundle) return CONTROL_CONVERSION_DEADLINE_MS;
  return reason === 'edit' ? ITER9_CONVERSION_DEADLINE_MS : CONTROL_CONVERSION_DEADLINE_MS;
}

// Vocabulário FECHADO de motivos — é o que `capture-bundle.js` escreve. Contar
// só o que está nesta lista garante que o relatório nunca carregue texto vindo
// do site clonado, que é a razão de o relatório ser sanitizado.
const MOTIVOS_DE_DESCARTE = new Set([
  'host nao publico', 'limite de arquivos', 'grande demais (declarado)',
  'grande demais', 'corpo nao chegou', 'chegou apos a montagem',
]);

function sanitizeCaptureReport(relatorio) {
  const hosts = [];
  // ⭐ "1 descartado" sozinho não distingue "o site bloqueou o arquivo" de
  // "o arquivo passou do tamanho" — e o remédio de um não serve para o outro.
  // Sem o motivo, o número diz que ALGO se perdeu e não deixa agir.
  const motivos = {};
  for (const item of Array.isArray(relatorio?.descartados) ? relatorio.descartados : []) {
    try {
      const host = new URL(item?.u).hostname;
      // O teto de 10 corta a LISTA DE HOSTS, e só ela: parar o laço aqui faria
      // os motivos pararem de ser contados junto, sem ninguém saber.
      if (host && !hosts.includes(host) && hosts.length < 10) hosts.push(host);
    } catch { /* entrada sem URL válida não vira host */ }
    if (MOTIVOS_DE_DESCARTE.has(item?.motivo)) motivos[item.motivo] = (motivos[item.motivo] || 0) + 1;
  }
  // A contagem boa é a do produtor, feita sobre a lista inteira. Sem ela sobra
  // a amostra — que continua útil, mas vai ROTULADA como parcial: apresentar
  // amostra como explicação completa é o mesmo defeito que o motivo veio curar.
  const integral = relatorio?.motivosDescartados;
  const temIntegral = integral && typeof integral === 'object';
  const contagem = {};
  for (const [motivo, n] of Object.entries(temIntegral ? integral : motivos)) {
    if (MOTIVOS_DE_DESCARTE.has(motivo) && Number(n) > 0) contagem[motivo] = Number(n);
  }
  const somaClassificada = Object.values(contagem).reduce((s, n) => s + n, 0);
  return {
    files: Number(relatorio?.arquivos) || 0,
    bytes: Number(relatorio?.bytes) || 0,
    extraRefs: Number(relatorio?.refsExtras) || 0,
    discarded: Number(relatorio?.totalDescartados) || 0,
    discardedHosts: hosts,
    discardedReasons: contagem,
    discardedReasonsPartial: somaClassificada < (Number(relatorio?.totalDescartados) || 0),
  };
}

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
  idemKey = null,
  op = 'reconstruct',
  producer = null,
  bundleStore = null,
  generateControls = generateControlsForReconstruction,
  persistBundle = persistNativeBundleDescriptor,
}) {
  // ⏱️ Onde o clone gasta tempo: o cronometro nasce ANTES do billing porque a
  // espera da pessoa inclui a reserva de credito, nao so' o trabalho.
  const cronometro = createCloneTimer();
  const motorEscolhido = resolveCloneEngine({ requested: engine, reason });
  const { result, credits, balanceAfter, microcents, deduped } = await runBilledOperation(
    { sql, userId, op, boardId: node.board_id, nodeId: node.id, idemKey },
    async () => {
      const deadline = new AbortController();
      const deadlineError = Object.assign(new Error('control_conversion_timeout'), { code: 'control_conversion_timeout' });
      const aborted = new Promise((_, reject) => deadline.signal.addEventListener('abort', () => reject(deadline.signal.reason), { once: true }));
      const resolvedProducer = producer || chooseReconstructionProducer(reason, process.env, engine);
      const timer = setTimeout(() => deadline.abort(deadlineError), conversionDeadlineMs(resolvedProducer, reason));
      try {
      let materialized;
      try {
        // ⏱️ DUAS etapas, nao uma (achado do Sol). `materializeReconstructionOutput`
        // grava TODOS os assets do bundle no store; embrulhar isso junto com o
        // produtor atribuiria a persistencia ao motor — um produtor de 24s com
        // 100 uploads de 100s apareceria como "o motor demora 124s", que e'
        // exatamente a confusao que este instrumento existe para desfazer.
        const bruto = await cronometro.measure('motor', async () => Promise.race([
          resolvedProducer(node.origin_url),
          aborted,
        ]));
        materialized = await cronometro.measure('bundle', async () => Promise.race([
          materializeReconstructionOutput(bruto, { bundleStore }),
          aborted,
        ]));
      } catch (error) {
        if (deadline.signal.aborted) {
          const timeout = new Error('control_conversion_timeout');
          timeout.code = 'control_conversion_timeout';
          throw timeout;
        }
        throw error;
      }
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
          // Generated controls are an overlay on top of the clone, and they
          // require a validator. CONFIG ABSENCE is not a failure: when neither
          // the producer supplies a validation path nor the sandbox validator
          // service is configured (UNCRAFT_MOTION_CONTROL_VALIDATOR_URL), this
          // deployment simply does not sell generated controls — the clone
          // (native bundle + live editor, which inventories the runtime
          // directly) ships whole. When a validator IS configured, generation
          // stays mandatory and failures keep the hard-fail + refund contract
          // (a transient outage must never settle as a silently degraded paid
          // state — Sol review 2026-08-17).
          const validatorConfigured = Boolean(
            materialized.output?.controlValidationTransport
            || materialized.output?.validateControlCandidate
            || process.env.UNCRAFT_MOTION_CONTROL_VALIDATOR_URL,
          );
          const generated = !validatorConfigured ? null : await cronometro.measure('controles', async () => Promise.race([generateControls({
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
          }), aborted]));
          // Configured ⇒ a valid result is REQUIRED. Every downstream branch
          // keys on validatorConfigured (never on generated's truthiness), so a
          // configured-but-broken generator resolving null can never settle
          // mislabeled as "validator_not_configured" (Sol v2 round).
          if (validatorConfigured && !generated?.manifest) {
            throw Object.assign(new Error('control_generation_no_output'), { code: 'no_output' });
          }
          const baseManifest = createEmptyMotionManifest({
            baseBundleId: descriptor.bundleId,
            runtimeFingerprint: descriptor.runtimeFingerprint,
          });
          const motionManifest = validatorConfigured ? parseMotionManifest({
            ...baseManifest,
            controlManifest: generated.manifest,
          }, {
            expectedBundleId: descriptor.bundleId,
            runtimeFingerprint: descriptor.runtimeFingerprint,
          }) : baseManifest;
          const nextMeta = {
            animatedDetected: false,
            animatedRuntime: true,
            referenceMode: 'clone',
            reconstructionEngine: 'native-bundle',
            deferredReconstructionReason: reason,
            deferredReconstructedAt: new Date().toISOString(),
            // Typography measured by the producer from the LIVE page (rides
            // the output as a sibling of bundle — the bundle itself, its
            // hash and every existing clone stay untouched).
            ...(materialized.output?.typeSample ? { typeSample: materialized.output.typeSample } : {}),
            // Capture report, SANITIZED: the producer's relatorio was
            // assembled and then discarded here — missing assets vanished
            // without a trace. Persist counts and discarded HOSTS only; a
            // full URL can carry query strings/tokens (Sol advise 2026-08-20).
            ...(materialized.output?.relatorio ? {
              captureReport: sanitizeCaptureReport(materialized.output.relatorio),
            } : {}),
            motionControls: validatorConfigured ? generationMeta(generated) : {
              status: 'skipped',
              reason: 'validator_not_configured',
              acceptedControls: 0,
            },
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
          await persistMotionDiagnosticEvents(sql, {
            user_id: userId,
            board_id: node.board_id,
            node_id: node.id,
            snapshot_id: snapshotId,
            edit_session_id: null,
            runtime_fingerprint: descriptor.runtimeFingerprint,
            content_hash: descriptor.contentHash,
          }, validatorConfigured ? motionControlGenerationDiagnosticEvents(generated) : []).catch(() => null);
          return {
            ok: true,
            kind: 'native',
            nodeId: node.id,
            snapshotId,
            bundleDescriptor: descriptor,
            motionManifest,
            controlManifest: validatorConfigured ? generated.manifest : null,
            controlGeneration: nextMeta.motionControls,
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
      return { ok: true, nodeId: node.id, snapshotId: snapId, html: rec.html, meta: nextMeta };
      } finally {
        clearTimeout(timer);
      }
    },
  );

  // ⏱️ DEPOIS do settle, de proposito: e' so' aqui que `credits` e `microcents`
  // existem. E fail-open — a gravacao nunca derruba um clone que deu certo.
  //
  // Replay de dedup NAO grava: nao houve clone novo, e sobrescrever apagaria a
  // medicao do clone que de fato aconteceu.
  let cloneTelemetry = null;
  if (deduped) {
    // O replay nao clonou nada — o cronometro dele mediria milissegundos. Quem
    // tem a historia verdadeira e' a medicao guardada pelo clone original, que
    // costuma ser justamente o lento cuja resposta se perdeu (Sol).
    cloneTelemetry = await readCloneTelemetry({ sql, nodeId: node.id, idemKey, elapsedMs: cronometro.elapsed() });
  } else {
    cloneTelemetry = cronometro.report({ engine: motorEscolhido, credits, microcents });
    await persistCloneTelemetry({ sql, nodeId: node.id, report: cloneTelemetry, idemKey, elapsedMs: cronometro.elapsed() });
  }
  // Vai TAMBEM na resposta: o cliente ja tem o relogio de parede dele e so'
  // consegue casar os dois numeros na hora — reler o node do banco so' para
  // isso seria uma ida a mais por clone.
  return { ...result, credits, balanceAfter, cloneTelemetry };
}
