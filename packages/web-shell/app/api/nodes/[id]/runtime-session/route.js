import { posix } from 'node:path';
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth.js';
import { db } from '../../../../../lib/db.js';
import { openOrResumeEditSession } from '../../../../../lib/motion-editor/edit-session-store.js';
import {
  RUNTIME_SESSION_EDIT_TTL_SECONDS,
  assertRuntimeSessionSigningConfiguration,
  issueRuntimeSessionToken,
  resolveRuntimeOrigin,
} from '../../../../../lib/motion-editor/runtime-session-token.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function runtimePath(token, entryPath) {
  const encodedToken = encodeURIComponent(token);
  const encodedEntry = entryPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `/api/runtime/${encodedToken}/${encodedEntry}`;
}

function unavailable(status = 404) {
  return NextResponse.json({ error: 'not_available' }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request, { params }, releituras = 0, avisoArrastado = null) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const { id } = await params;
  let sql;
  let snapshot;
  let runtimeOrigin;
  try {
    assertRuntimeSessionSigningConfiguration();
    runtimeOrigin = resolveRuntimeOrigin(request.url);
    sql = await db();
    [snapshot] = await sql`
      SELECT n.id AS node_id, s.id AS snapshot_id, s.native_bundle_id,
             nb.entry_path, nb.runtime_fingerprint
        FROM nodes n
        JOIN boards b ON b.id = n.board_id
        JOIN snapshots s ON s.id = n.current_snapshot_id AND s.node_id = n.id
        JOIN native_bundles nb ON nb.bundle_id = s.native_bundle_id
       WHERE n.id = ${id}
         AND b.user_id = ${user.id}
         AND s.native_bundle_id IS NOT NULL
    `;
  } catch {
    return unavailable(503);
  }
  if (!snapshot) return unavailable();

  try {
    const session = await openOrResumeEditSession({
      sql,
      userId: user.id,
      nodeId: id,
      baseSnapshotId: snapshot.snapshot_id,
    });
    const prefix = posix.dirname(snapshot.entry_path);
    const issued = issueRuntimeSessionToken({
      nodeId: id,
      bundleId: snapshot.native_bundle_id,
      sessionId: session.id,
      entryPrefix: prefix === '.' ? '' : prefix,
    }, { ttlSeconds: RUNTIME_SESSION_EDIT_TTL_SECONDS });
    const url = new URL(runtimePath(issued.token, snapshot.entry_path), runtimeOrigin).toString();
    return NextResponse.json({
      runtime: {
        url,
        expiresAt: issued.expiresAt,
        bundleId: snapshot.native_bundle_id,
        runtimeFingerprint: snapshot.runtime_fingerprint,
      },
      session: {
        id: session.id,
        baseSnapshotId: session.baseSnapshotId,
        revision: session.revision,
        // Um rascunho de um clone que o node não tem mais foi aposentado. Sem
        // isto na resposta o aviso morre no servidor e a pessoa vê o clone novo
        // sem as edições dela, lendo como perda silenciosa (Sol).
        ...(session.supersededDraft || avisoArrastado
          ? { supersededDraft: session.supersededDraft || avisoArrastado }
          : {}),
      },
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (sessionError) {
    // O node foi re-clonado entre a leitura acima e a abertura da sessão. Relê
    // UMA vez: o token do runtime tem que sair do MESMO snapshot da sessão, e
    // insistir na leitura velha é o defeito que esta correção fecha.
    // UMA releitura, nunca um laço: se o node for re-clonado outra vez no meio,
    // insistir viraria giro infinito sob a mão de quem clona.
    if (sessionError?.code === 'stale_base_snapshot' && releituras < 1) {
      return POST(request, { params }, releituras + 1,
        sessionError.supersededDraft || avisoArrastado);
    }
    if (sessionError?.code === 'not_found') return unavailable();
    return unavailable(503);
  }
}
