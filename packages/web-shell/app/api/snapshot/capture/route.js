import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { requireUser } from '../../../../lib/auth.js';
import { captureSnapshot, ChallengeRequiredError } from '../../../../lib/snapshot.js';
import { signHandoffToken } from '../../../../lib/handoff-token.js';

export const runtime = 'nodejs';
// Bumped from 60 to 240 — reconstruction path (lib/reconstruct.js) takes
// ~150s end-to-end (scroll-stops + thumbnails + GPT-5.5 vision). Add
// headroom for slower sites / network jitter.
export const maxDuration = 240;

// On challenge, create a placeholder node owned by the user so the canvas
// has something to poll against while the user does the handoff in their
// browser. Returns the new nodeId. Validates board ownership.
async function ensurePlaceholderNode({ sql, userId, placement, url }) {
  const { boardId, posX = 0, posY = 0, width = 1280, height = 720, isMain = false } = placement || {};
  if (!boardId) return { error: 'placement.boardId required for handoff' };
  const [board] = await sql`SELECT id FROM boards WHERE id = ${boardId} AND user_id = ${userId}`;
  if (!board) return { error: 'board not found' };
  const meta = { awaiting_handoff: true, handoff_started_at: new Date().toISOString() };
  const [node] = await sql`
    INSERT INTO nodes (board_id, kind, origin_url, pos_x, pos_y, width, height, is_main, meta)
    VALUES (${boardId}, 'site', ${url}, ${posX}, ${posY}, ${width}, ${height}, ${isMain}, ${meta}::jsonb)
    RETURNING *
  `;
  return { node };
}

export async function POST(request) {
  const { user, error } = await requireUser(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const { url, nodeId, placement } = body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'valid http(s) url required' }, { status: 400 });
  }

  // Reachability pre-check — fast bail-out so we don't spin Playwright
  // up against a typo or dead host. HEAD first; some servers reject it
  // (405/501) so fall back to a tiny ranged GET. 6s budget.
  //
  // Use a realistic browser UA — Cloudflare / WAFs return 403/406 on
  // any "bot-shaped" user-agent. Playwright would still load the page
  // fine (real Chrome), so the pre-check should mirror that posture
  // rather than bail on bot-policy responses.
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // Single pre-check attempt. Wrapped in a retry loop below so we can
  // re-try once on transient DNS failure (ENOTFOUND / EAI_AGAIN) —
  // those bubble up from undici in dev / under flaky resolvers even
  // when the domain is fine on the next call. Returns either a Response
  // (success — even a bot-policy 403) or an Error.
  async function attempt() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      let res = await fetch(url, {
        method: 'HEAD', redirect: 'follow', signal: ctrl.signal,
        headers: { 'user-agent': UA }
      });
      if (!res.ok && [405, 501].includes(res.status)) {
        res = await fetch(url, {
          method: 'GET', redirect: 'follow', signal: ctrl.signal,
          headers: { 'user-agent': UA, range: 'bytes=0-256' }
        });
      }
      return { res };
    } catch (e) {
      return { err: e };
    } finally { clearTimeout(timer); }
  }

  let { res, err } = await attempt();
  // Transient-DNS retry. Node's fetch (undici) occasionally returns
  // ENOTFOUND / EAI_AGAIN even for healthy domains — especially on first
  // resolve after a long idle. 350ms is enough for the resolver cache
  // to refresh without making the user wait.
  if (err) {
    const code = err?.cause?.code || err?.code || '';
    const msg = String(err?.message || '');
    const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN/.test(msg);
    if (isDns) {
      await new Promise((r) => setTimeout(r, 350));
      ({ res, err } = await attempt());
    }
  }

  if (err) {
    const code = err?.cause?.code || err?.code || '';
    const msg = String(err?.message || '');
    const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN/.test(msg);
    const isAbort = err?.name === 'AbortError';
    return NextResponse.json({
      error: 'site_unreachable',
      detail: isDns
        // Soften: DNS failure isn't necessarily a typo (transient resolver
        // hiccups masquerade as ENOTFOUND). Suggest the typo case AND
        // the retry case without accusing the user.
        ? 'Could not resolve this domain. Double-check the URL or try again in a moment.'
        : isAbort
          ? 'Site did not respond within 6 seconds.'
          : 'Could not reach the site.',
      code
    }, { status: 400 });
  }

  // 403 / 406 / 429 / 503 are commonly emitted by bot-policy walls on
  // HEAD requests even when the actual page loads in a real browser.
  // We pass those through and let Playwright try — the page may well
  // succeed once it executes with a real-browser fingerprint.
  const passThrough = res && [403, 406, 429, 503].includes(res.status);
  if (!res || (!passThrough && res.status >= 400)) {
    const status = res ? res.status : 0;
    return NextResponse.json({
      error: 'site_unreachable',
      detail: status ? `Server responded with HTTP ${status}.` : 'No response from server.',
      status
    }, { status: 400 });
  }

  // Streaming path: when the client sends `Accept: text/event-stream`, we
  // emit progress events as the capture (and potential reconstruction)
  // progresses through stages. Final event carries the snapshot data.
  // This lets the canvas node show "Reconstructing…" with stage labels
  // instead of a generic 60-150s "Capturing…" spinner.
  const acceptsStream = request.headers.get('accept')?.includes('text/event-stream');
  if (acceptsStream) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event, data) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch (e) {}
        };
        try {
          const cap = await captureSnapshot(url, {
            onProgress: (step) => send('progress', { step })
          });
          let snapshotId = null;
          if (nodeId) {
            const sql = await db();
            const [node] = await sql`
              SELECT n.id FROM nodes n
                JOIN boards b ON b.id = n.board_id
               WHERE n.id = ${nodeId} AND b.user_id = ${user.id}
            `;
            if (!node) {
              send('error', { error: 'node_not_found', detail: 'node not found' });
              controller.close();
              return;
            }
            const [snap] = await sql`
              INSERT INTO snapshots (node_id, html, screenshot_url, source)
              VALUES (${nodeId}, ${cap.html}, ${cap.screenshotDataUrl}, 'capture')
              RETURNING id, created_at
            `;
            await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${nodeId}`;
            snapshotId = snap.id;
          }
          send('done', {
            ok: true,
            snapshotId,
            html: cap.html,
            screenshotDataUrl: cap.screenshotDataUrl,
            title: cap.title,
            baseUrl: cap.baseUrl,
            stats: cap.stats || null
          });
        } catch (e) {
          if (e instanceof ChallengeRequiredError) {
            // Pre-create a placeholder node (if placement was provided)
            // so the canvas has something to poll against. Then mint a
            // handoff token bound to that node so the Uncraft extension
            // can ship the user-verified DOM back to /api/snapshot/handoff.
            let handoffToken = null;
            let createdNodeId = nodeId || null;
            if (!createdNodeId && placement) {
              try {
                const sql = await db();
                const r = await ensurePlaceholderNode({ sql, userId: user.id, placement, url: e.url });
                if (r.node) {
                  createdNodeId = r.node.id;
                  handoffToken = signHandoffToken({ userId: user.id, nodeId: createdNodeId, url: e.url });
                  send('challenge', {
                    error: 'challenge_required',
                    kind: e.kind, url: e.url, signals: e.signals,
                    nodeId: createdNodeId, node: r.node, handoffToken
                  });
                  return; // finally still closes controller
                }
                // Placement was given but board check failed — fall through
                // to the no-handoff challenge event so the modal still shows.
              } catch (mintErr) {
                console.error('handoff pre-create failed', mintErr);
              }
            } else if (createdNodeId) {
              // nodeId was passed in (re-capture into existing node) —
              // mint a token for it so the extension can handle the retry.
              try {
                handoffToken = signHandoffToken({ userId: user.id, nodeId: createdNodeId, url: e.url });
              } catch (mintErr) {
                console.error('handoff token mint failed', mintErr);
              }
            }
            send('challenge', {
              error: 'challenge_required',
              kind: e.kind, url: e.url, signals: e.signals,
              nodeId: createdNodeId, handoffToken
            });
          } else {
            console.error('captureSnapshot error', e);
            send('error', { error: 'capture_failed', detail: String(e?.message || e) });
          }
        } finally {
          controller.close();
        }
      }
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'  // disable nginx-style buffering
      }
    });
  }

  // Legacy JSON path — single blocking response. Kept for backwards
  // compatibility with any caller that doesn't stream.
  let cap;
  try {
    cap = await captureSnapshot(url);
  } catch (e) {
    if (e instanceof ChallengeRequiredError) {
      // Mirror the streaming branch: pre-create placeholder + mint
      // handoff token when placement is provided so the extension can
      // ship the verified DOM back.
      let handoffToken = null;
      let createdNodeId = nodeId || null;
      let createdNode = null;
      if (!createdNodeId && placement) {
        try {
          const sql = await db();
          const r = await ensurePlaceholderNode({ sql, userId: user.id, placement, url: e.url });
          if (r.node) {
            createdNode = r.node;
            createdNodeId = r.node.id;
            handoffToken = signHandoffToken({ userId: user.id, nodeId: createdNodeId, url: e.url });
          }
        } catch (mintErr) { console.error('handoff pre-create failed', mintErr); }
      } else if (createdNodeId) {
        try {
          handoffToken = signHandoffToken({ userId: user.id, nodeId: createdNodeId, url: e.url });
        } catch (mintErr) { console.error('handoff token mint failed', mintErr); }
      }
      return NextResponse.json({
        error: 'challenge_required',
        kind: e.kind, url: e.url, signals: e.signals,
        nodeId: createdNodeId, node: createdNode, handoffToken
      }, { status: 409 });
    }
    console.error('captureSnapshot error', e);
    return NextResponse.json({ error: 'capture_failed', detail: String(e?.message || e) }, { status: 502 });
  }

  if (nodeId) {
    const sql = await db();
    const [node] = await sql`
      SELECT n.id FROM nodes n
        JOIN boards b ON b.id = n.board_id
       WHERE n.id = ${nodeId} AND b.user_id = ${user.id}
    `;
    if (!node) return NextResponse.json({ error: 'node not found' }, { status: 404 });

    const [snap] = await sql`
      INSERT INTO snapshots (node_id, html, screenshot_url, source)
      VALUES (${nodeId}, ${cap.html}, ${cap.screenshotDataUrl}, 'capture')
      RETURNING id, created_at
    `;
    await sql`UPDATE nodes SET current_snapshot_id = ${snap.id} WHERE id = ${nodeId}`;
    return NextResponse.json({ ok: true, snapshotId: snap.id, title: cap.title });
  }

  return NextResponse.json({
    ok: true,
    html: cap.html,
    screenshotDataUrl: cap.screenshotDataUrl,
    title: cap.title,
    baseUrl: cap.baseUrl
  });
}
