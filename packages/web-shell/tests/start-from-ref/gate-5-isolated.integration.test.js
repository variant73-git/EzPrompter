// @vitest-environment node

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const gate5Enabled = process.env.UNCRAFT_GATE5_ISOLATED === '1'
  && process.env.UNCRAFT_GATE5_DATABASE?.startsWith('uncraft_gate5_');
const gate5Suite = gate5Enabled ? describe.sequential : describe.skip;

const { initDB, sql } = await import('../../lib/db.js');
const { createToken } = await import('../../lib/auth.js');
const { buildChassisManifest } = await import('../../lib/chassis-manifest.js');
const { POST: previewContract } = await import('../../app/api/references/plan/[id]/contract/preview/route.js');
const { POST: approveContract } = await import('../../app/api/references/plan/[id]/contract/route.js');

let user;
let board;
let planId;
let token;
let baseline;

function evidence(width) {
  return {
    capturedAt: '2026-08-09T12:00:00.000Z', viewport: { width, height: 900 },
    sections: [{
      id: 'hero', role: 'hero', order: 1,
      text: { heading: { value: 'Reference heading' }, body: { value: 'Reference body' }, visibleCharacters: 32 },
      mediaSlotIds: ['hero-media'], motionTrackIds: ['hero-reveal'],
    }],
    anchors: [], mediaSlots: [{ id: 'hero-media', sectionId: 'hero', role: 'hero-background' }],
    motionTracks: [{ id: 'hero-reveal', sectionId: 'hero', driver: 'scroll' }], metrics: { sectionCount: 1 },
  };
}

function routeRequest(pathname, body) {
  return new Request(`http://localhost${pathname}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function protectedSnapshot() {
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM boards) AS boards,
      (SELECT COUNT(*)::int FROM nodes) AS nodes,
      (SELECT COUNT(*)::int FROM snapshots) AS snapshots,
      (SELECT COUNT(*)::int FROM usage_events) AS usage_events,
      (SELECT COUNT(*)::int FROM credit_ledger) AS credit_ledger,
      (SELECT COUNT(*)::int FROM operations) AS operations,
      (SELECT COALESCE(SUM(credits_cents), 0)::bigint::text FROM users) AS credits_cents
  `;
  return row;
}

function targetInput(overrides = {}) {
  return {
    authorityType: 'project', projectId: board.id, brand: '',
    intent: 'Modernize this group experience while keeping it recognizable and trustworthy.',
    notes: 'Approved local project authority.', strategySelections: {},
    ...overrides,
  };
}

gate5Suite('Start from a Ref Gate 5 isolated contract acceptance', () => {
  beforeAll(async () => {
    await initDB();
    const [identity] = await sql`SELECT current_schema() AS schema, current_database() AS database`;
    expect(identity.schema).toBe('public');
    expect(identity.database).toBe(process.env.UNCRAFT_GATE5_DATABASE);
    expect(process.env.UNCRAFT_GATE5_SHARED_TARGET_FINGERPRINT).not.toBe(process.env.UNCRAFT_GATE5_ISOLATED_TARGET_FINGERPRINT);

    [user] = await sql`
      INSERT INTO users (email, password_hash, name, plan, credits_cents)
      VALUES ('gate5@example.test', 'not-used', 'Gate 5 User', 'free', 350)
      RETURNING *
    `;
    [board] = await sql`
      INSERT INTO boards (user_id, name) VALUES (${user.id}, 'Gate 5 Target') RETURNING *
    `;
    const [targetNode] = await sql`
      INSERT INTO nodes (board_id, kind, origin_url, is_main)
      VALUES (${board.id}, 'site', 'https://target.example/', TRUE)
      RETURNING id
    `;
    const [targetSnapshot] = await sql`
      INSERT INTO snapshots (node_id, html, source)
      VALUES (
        ${targetNode.id},
        ${`<!doctype html><html><head><title>Gate 5 Target</title><meta name="description" content="Create a group and invite your friends."><meta name="theme-color" content="#D9382E"><style>body{font-family:Archivo,sans-serif;color:#23281F;background:#F7F1E8}</style></head><body><main><h1>Create your group</h1><p>Invite your friends and complete the exchange online.</p><button>Start now</button></main></body></html>`},
        'capture'
      )
      RETURNING id
    `;
    await sql`UPDATE nodes SET current_snapshot_id = ${targetSnapshot.id} WHERE id = ${targetNode.id}`;
    const manifest = buildChassisManifest({
      reference: { id: 'gate5-reference', title: 'Gate 5 Reference', url: 'https://reference.example/' },
      captures: [evidence(1440), evidence(390)],
      guidance: { worthBorrowing: 'Hero pacing.', avoid: 'Reference identity.' },
    });
    const plan = {
      schemaVersion: 3,
      selectedReferences: [{ id: 'gate5-reference', title: 'Gate 5 Reference', url: 'https://reference.example/' }],
      chassisManifest: manifest,
    };
    const [record] = await sql`
      INSERT INTO generation_reference_uses (
        user_id, schema_version, brief, selected_reference_ids, plan, status, reviewed_at
      ) VALUES (
        ${user.id}, 3, 'A technical landing page for farm operators.', ${['gate5-reference']},
        ${JSON.stringify(plan)}::jsonb, 'approved', NOW()
      ) RETURNING id
    `;
    planId = record.id;
    token = createToken(user);
    baseline = await protectedSnapshot();
  });

  beforeEach(async () => {
    await sql`
      UPDATE generation_reference_uses
      SET plan = plan - 'chassisTargetContract'
      WHERE id = ${planId}
    `;
  });

  it('keeps preview zero-write and exposes genuinely missing source evidence as blockers', async () => {
    const response = await previewContract(
      routeRequest(`/api/references/plan/${planId}/contract/preview`, targetInput({
        authorityType: 'provided', sourceLabel: 'A label without supplied artifacts', brand: 'Unverified target',
      })),
      { params: Promise.resolve({ id: planId }) },
    );
    expect(response.status).toBe(200);
    const { contract } = await response.json();
    expect(contract.approvable).toBe(false);
    expect(contract.gaps.map((gap) => gap.code)).toEqual(['target-content-missing', 'target-design-system-missing']);
    const [stored] = await sql`SELECT plan ? 'chassisTargetContract' AS present FROM generation_reference_uses WHERE id = ${planId}`;
    expect(stored.present).toBe(false);
    expect(await protectedSnapshot()).toEqual(baseline);
  });

  it('persists only the exact ready contract while generation, credits, and canvas remain locked', async () => {
    const target = targetInput();
    const previewResponse = await previewContract(
      routeRequest(`/api/references/plan/${planId}/contract/preview`, target),
      { params: Promise.resolve({ id: planId }) },
    );
    const { contract: preview } = await previewResponse.json();
    expect(preview.approvable).toBe(true);
    expect(preview.target).toMatchObject({
      brand: 'Gate 5 Target',
      readiness: { content: true, designSystem: true, media: true },
    });
    expect(preview.strategy.questions.length).toBeGreaterThan(0);

    const response = await approveContract(
      routeRequest(`/api/references/plan/${planId}/contract`, { target, contractHash: preview.hash }),
      { params: Promise.resolve({ id: planId }) },
    );
    expect(response.status).toBe(201);
    const { contract } = await response.json();
    expect(contract).toMatchObject({
      hash: preview.hash, status: 'approved',
      locks: { generationAuthorized: false, creditSpendAuthorized: false, canvasMutationAuthorized: false },
    });
    const [stored] = await sql`SELECT plan->'chassisTargetContract' AS contract FROM generation_reference_uses WHERE id = ${planId}`;
    expect(stored.contract).toMatchObject({ hash: preview.hash, status: 'approved' });
    expect(await protectedSnapshot()).toEqual(baseline);
  });

  it('rejects a stale hash after any target input changes and leaves no approval behind', async () => {
    const previewResponse = await previewContract(
      routeRequest(`/api/references/plan/${planId}/contract/preview`, targetInput()),
      { params: Promise.resolve({ id: planId }) },
    );
    const { contract: preview } = await previewResponse.json();
    const response = await approveContract(
      routeRequest(`/api/references/plan/${planId}/contract`, {
        target: targetInput({ intent: 'Reimagine this target as a completely different visual identity.' }), contractHash: preview.hash,
      }),
      { params: Promise.resolve({ id: planId }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'target_contract_stale' });
    const [stored] = await sql`SELECT plan ? 'chassisTargetContract' AS present FROM generation_reference_uses WHERE id = ${planId}`;
    expect(stored.present).toBe(false);
    expect(await protectedSnapshot()).toEqual(baseline);
  });
});
