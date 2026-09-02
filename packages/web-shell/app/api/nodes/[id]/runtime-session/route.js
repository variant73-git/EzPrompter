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
import {
  LEASE_TTL_SECONDS,
  deriveLeaseNonce,
  mintBootstrapBadge,
  mintRuntimeHostname,
} from '../../../../../lib/motion-editor/runtime-lease.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function leaseEnabled() {
  return process.env.UNCRAFT_RUNTIME_LEASE === '1';
}

function runtimePath(token, entryPath) {
  const encodedToken = encodeURIComponent(token);
  const encodedEntry = entryPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `/api/runtime/${encodedToken}/${encodedEntry}`;
}

function runtimeAuthority(hostname) {
  // Porta/esquema vivem no TEMPLATE (dev https local com porta), nunca na
  // identidade validada do host (Sol r3 #4). Prod default: https://<host>.
  const template = process.env.UNCRAFT_RUNTIME_AUTHORITY_TEMPLATE;
  return template ? template.replace('{host}', hostname) : `https://${hostname}`;
}

// Hostname mintado UMA vez por sessão e PERSISTIDO — resume/F5 reusa o mesmo
// (sem isto cada reabertura mudaria a origem e destruiria o cache; Sol r3 #2).
// CAS: só o 1º open escreve; opens concorrentes que perdem RELÊEM o vencedor
// antes de assinar o badge (Sol r4 #5). Colisão de 128 bits é desprezível — o
// retry cobre o caso patológico do índice UNIQUE.
async function resolveSessionHostname(sql, sessionId, suffix) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const minted = mintRuntimeHostname({ suffix });
    try {
      const [claimed] = await sql`
        UPDATE native_motion_edit_sessions SET runtime_hostname = ${minted}
         WHERE id = ${sessionId} AND runtime_hostname IS NULL
        RETURNING runtime_hostname
      `;
      if (claimed) return claimed.runtime_hostname;
    } catch (error) {
      if (error?.code !== '23505') throw error;
      continue; // colisão no índice — minta de novo
    }
    const [existing] = await sql`
      SELECT runtime_hostname FROM native_motion_edit_sessions WHERE id = ${sessionId}
    `;
    if (existing?.runtime_hostname) return existing.runtime_hostname;
  }
  return null;
}

async function buildLeaseRuntime({ sql, nodeId, snapshot, session }) {
  const suffix = process.env.UNCRAFT_RUNTIME_HOST_SUFFIX;
  if (!suffix) return null; // flag on sem sufixo é misconfig — não silenciar em legado
  const hostname = await resolveSessionHostname(sql, session.id, suffix);
  if (!hostname) return null;
  const { badge } = mintBootstrapBadge({
    nodeId,
    bundleId: snapshot.native_bundle_id,
    sessionId: session.id,
    entryPath: snapshot.entry_path,
    hostname,
  });
  const origin = runtimeAuthority(hostname);
  return {
    url: `${origin}/api/runtime-bootstrap/${encodeURIComponent(badge)}`,
    mode: 'lease',
    origin,
    // A lease real nasce no bootstrap; aqui é estimativa para o timer do
    // cliente (que renova a cada 10min de qualquer forma).
    expiresAt: new Date(Date.now() + LEASE_TTL_SECONDS * 1000).toISOString(),
    nonce: deriveLeaseNonce(session.id),
    bundleId: snapshot.native_bundle_id,
    runtimeFingerprint: snapshot.runtime_fingerprint,
  };
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
    // A origem única do legado não se aplica ao modo lease (hostname por
    // sessão) — só resolvê-la quando o legado vai usá-la, senão prod-lease
    // sem UNCRAFT_RUNTIME_ORIGIN cairia num 503 falso.
    if (!leaseEnabled()) runtimeOrigin = resolveRuntimeOrigin(request.url);
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
    let runtimePayload;
    if (leaseEnabled()) {
      runtimePayload = await buildLeaseRuntime({ sql, nodeId: id, snapshot, session });
      if (!runtimePayload) return unavailable(503); // sufixo ausente ou host não resolvido
    } else {
      const prefix = posix.dirname(snapshot.entry_path);
      const issued = issueRuntimeSessionToken({
        nodeId: id,
        bundleId: snapshot.native_bundle_id,
        sessionId: session.id,
        entryPrefix: prefix === '.' ? '' : prefix,
      }, { ttlSeconds: RUNTIME_SESSION_EDIT_TTL_SECONDS });
      const url = new URL(runtimePath(issued.token, snapshot.entry_path), runtimeOrigin).toString();
      runtimePayload = {
        url,
        expiresAt: issued.expiresAt,
        bundleId: snapshot.native_bundle_id,
        runtimeFingerprint: snapshot.runtime_fingerprint,
      };
    }
    return NextResponse.json({
      runtime: runtimePayload,
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
