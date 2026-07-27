import { reconstructPage } from './reconstruct.js';
import { runBilledOperation } from './billing/context.js';
import { createConfiguredBundleStore } from './native-clone/bundle-store.js';
import { registerNativeBundle } from './native-clone/register-bundle.js';

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
export async function reconstructSiteNode({
  sql,
  userId,
  node,
  reason,
  idemKey = null,
  op = 'reconstruct',
  producer = reconstructPage,
  bundleStore = null,
}) {
  const { result, credits, balanceAfter } = await runBilledOperation(
    { sql, userId, op, boardId: node.board_id, nodeId: node.id, idemKey },
    async () => {
      const materialized = await materializeReconstructionOutput(
        await producer(node.origin_url),
        { bundleStore },
      );
      if (materialized.kind === 'native') {
        return {
          ok: true,
          kind: 'native',
          nodeId: node.id,
          bundleDescriptor: materialized.bundleDescriptor,
          meta: {
            animatedDetected: false,
            animatedRuntime: true,
            referenceMode: 'clone',
            reconstructionEngine: 'native-bundle',
            deferredReconstructionReason: reason,
          },
        };
      }
      const rec = materialized.output;
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
    },
  );
  return { ...result, credits, balanceAfter };
}
