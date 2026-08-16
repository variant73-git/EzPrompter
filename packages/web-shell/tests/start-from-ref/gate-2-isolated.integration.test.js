// @vitest-environment node

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const gate2Enabled = process.env.UNCRAFT_GATE2_ISOLATED === '1'
  && process.env.UNCRAFT_GATE2_DATABASE?.startsWith('uncraft_gate2_');
const gate2Suite = gate2Enabled ? describe.sequential : describe.skip;

const captureSnapshot = vi.hoisted(() => vi.fn(async (_url, options) => ({
  chassisEvidence: {
    capturedAt: '2026-08-09T12:00:00.000Z',
    viewport: options.viewport,
    sections: [{
      id: options.viewport.width === 1440 ? 'desktop-hero' : 'mobile-hero',
      role: 'hero',
      order: 1,
      rect: { x: 0, y: 0, width: options.viewport.width, height: options.viewport.height },
      text: { visibleCharacters: 120 },
      mediaSlotIds: [],
      motionTrackIds: [],
    }],
    anchors: [],
    mediaSlots: [],
    motionTracks: [],
    metrics: { sectionCount: 1 },
  },
})));

vi.mock('../../lib/snapshot.js', () => ({ captureSnapshot }));
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

const { initDB, sql } = await import('../../lib/db.js');
const { createToken } = await import('../../lib/auth.js');
const { encodeReferenceGuidance } = await import('../../lib/reference-guidance.js');
const { POST: previewPlan } = await import('../../app/api/references/plan/preview/route.js');
const { POST: approvePlan } = await import('../../app/api/references/plan/route.js');
const { POST: analyzePlan } = await import('../../app/api/references/plan/[id]/analyze/route.js');

const brief = 'A landing page for an industrial company.';
const curatorEmail = 'variant73@gmail.com';
let curator;
let directUser;
let curatorToken;
let directToken;
let untouchedBaseline;

function routeRequest(pathname, body, token = curatorToken) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost${pathname}`, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function countPlans(userId = curator.id) {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM generation_reference_uses
    WHERE user_id = ${userId}
  `;
  return rows[0].count;
}

async function untouchedSnapshot() {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM boards) AS boards,
      (SELECT COUNT(*)::int FROM nodes) AS nodes,
      (SELECT COUNT(*)::int FROM snapshots) AS snapshots,
      (SELECT COUNT(*)::int FROM usage_events) AS usage_events,
      (SELECT COUNT(*)::int FROM credit_ledger) AS credit_ledger,
      (SELECT COUNT(*)::int FROM operations) AS operations,
      (SELECT COALESCE(SUM(credits_cents), 0)::bigint::text FROM users) AS credits_cents
  `;
  return rows[0];
}

async function restorePreferences() {
  const keeps = ['gate2-alpha', 'gate2-bravo', 'gate2-delta', 'gate2-zulu'];
  await sql`
    UPDATE reference_preferences
    SET decision = CASE
          WHEN reference_site_id = ANY(${keeps}) THEN 'keep'
          WHEN reference_site_id = 'gate2-maybe' THEN 'maybe'
          ELSE 'pass'
        END,
        notes = CASE
          WHEN reference_site_id = 'gate2-alpha' THEN ${encodeReferenceGuidance({ worthBorrowing: 'Anchor the hero copy.', avoid: 'Do not copy the palette.' })}
          ELSE NULL
        END,
        updated_at = NOW()
    WHERE user_id = ${curator.id}
  `;
}

async function createApprovedDirectPlan(referenceUrl = 'https://example.com/') {
  const previewResponse = await previewPlan(routeRequest('/api/references/plan/preview', { brief, referenceUrl }));
  expect(previewResponse.status).toBe(200);
  const { preview } = await previewResponse.json();
  const response = await approvePlan(routeRequest('/api/references/plan', {
    brief,
    referenceUrl,
    previewHash: preview.previewHash,
    selectedReferenceId: preview.options[0].id,
  }));
  expect(response.status).toBe(201);
  return response.json();
}

gate2Suite('Start from a Ref Gate 2 isolated route/store acceptance', () => {
beforeAll(async () => {
  await initDB();
  const [identity] = await sql`
    SELECT current_schema() AS schema, current_database() AS database
  `;
  expect(identity.schema).toBe('public');
  expect(identity.database).toBe(process.env.UNCRAFT_GATE2_DATABASE);
  expect(process.env.UNCRAFT_GATE2_SHARED_TARGET_FINGERPRINT).not.toBe(
    process.env.UNCRAFT_GATE2_ISOLATED_TARGET_FINGERPRINT,
  );

  [curator] = await sql`
    INSERT INTO users (email, password_hash, name, plan, credits_cents)
    VALUES (${curatorEmail}, 'gate2-not-used', 'Gate 2 Curator', 'free', 0)
    RETURNING *
  `;
  [directUser] = await sql`
    INSERT INTO users (email, password_hash, name, plan, credits_cents)
    VALUES ('gate2-direct@example.test', 'gate2-not-used', 'Gate 2 Direct', 'free', 0)
    RETURNING *
  `;
  curatorToken = createToken(curator);
  directToken = createToken(directUser);

  const references = [
    ['gate2-alpha', 'Alpha', 1],
    ['gate2-bravo', 'Bravo', 999],
    ['gate2-delta', 'Delta', 20],
    ['gate2-zulu', 'Zulu', 500],
    ['gate2-maybe', 'Maybe Reference', 1000],
    ['gate2-pass', 'Pass Reference', 1000],
  ];
  for (const [id, title, weight] of references) {
    await sql`
      INSERT INTO reference_sites (
        id, canonical_url, host, title, categories, tags, curation_weight, curation_rank
      ) VALUES (
        ${id}, ${`https://${id}.example/`}, ${`${id}.example`}, ${title},
        ${['landing-page']}, ${['industrial']}, ${weight}, ${references.findIndex((item) => item[0] === id) + 1}
      )
    `;
  }

  const decisions = [
    ['gate2-alpha', 'keep'],
    ['gate2-bravo', 'keep'],
    ['gate2-delta', 'keep'],
    ['gate2-zulu', 'keep'],
    ['gate2-maybe', 'maybe'],
    ['gate2-pass', 'pass'],
  ];
  for (const [referenceId, decision] of decisions) {
    await sql`
      INSERT INTO reference_preferences (
        user_id, reference_site_id, decision, business_tags, notes
      ) VALUES (
        ${curator.id}, ${referenceId}, ${decision}, ${['landing-page']},
        ${referenceId === 'gate2-alpha'
          ? encodeReferenceGuidance({ worthBorrowing: 'Anchor the hero copy.', avoid: 'Do not copy the palette.' })
          : null}
      )
    `;
  }
  untouchedBaseline = await untouchedSnapshot();
});

beforeEach(async () => {
  await sql`DELETE FROM generation_reference_uses`;
  await restorePreferences();
  captureSnapshot.mockClear();
});

afterEach(async () => {
  expect(await untouchedSnapshot()).toEqual(untouchedBaseline);
});

afterAll(async () => {
  await sql`DELETE FROM generation_reference_uses`;
});

  it('keeps previews zero-write and excludes Maybe and Pass from four tied Keeps', async () => {
    expect(await countPlans()).toBe(0);
    const response = await previewPlan(routeRequest('/api/references/plan/preview', { brief }));
    expect(response.status).toBe(200);
    const { preview } = await response.json();
    expect(preview).toMatchObject({ totalOptions: 4, optionOffset: 0, hasMore: true });
    expect(preview.options.map((option) => option.id)).toEqual(['gate2-alpha', 'gate2-bravo', 'gate2-delta']);
    expect(await countPlans()).toBe(0);
  });

  it('preserves pagination and persists only the explicitly selected chassis', async () => {
    const pageResponse = await previewPlan(routeRequest('/api/references/plan/preview', { brief, optionOffset: 3 }));
    const { preview } = await pageResponse.json();
    expect(preview).toMatchObject({ totalOptions: 4, optionOffset: 3, hasPrevious: true, hasMore: false });
    expect(preview.options.map((option) => option.id)).toEqual(['gate2-zulu']);

    const missingSelection = await approvePlan(routeRequest('/api/references/plan', {
      brief, optionOffset: 3, previewHash: preview.previewHash,
    }));
    expect(missingSelection.status).toBe(400);
    expect(await countPlans()).toBe(0);

    const approval = await approvePlan(routeRequest('/api/references/plan', {
      brief,
      optionOffset: 3,
      previewHash: preview.previewHash,
      selectedReferenceId: 'gate2-zulu',
    }));
    expect(approval.status).toBe(201);
    const payload = await approval.json();
    expect(payload.status).toBe('approved');
    expect(payload.plan).toMatchObject({ generationTriggered: false, selectionMode: 'curated-keeps' });
    expect(payload.plan.selectedReferences.map((reference) => reference.id)).toEqual(['gate2-zulu']);
    expect(await countPlans()).toBe(1);
  });

  it('allows Direct URL for a user with no curated candidates', async () => {
    const referenceUrl = 'https://direct.example/';
    const previewResponse = await previewPlan(routeRequest(
      '/api/references/plan/preview', { brief, referenceUrl }, directToken,
    ));
    expect(previewResponse.status).toBe(200);
    const { preview } = await previewResponse.json();
    expect(preview).toMatchObject({ totalOptions: 1, selectionMode: 'direct-url' });

    const approval = await approvePlan(routeRequest('/api/references/plan', {
      brief,
      referenceUrl,
      previewHash: preview.previewHash,
      selectedReferenceId: preview.options[0].id,
    }, directToken));
    expect(approval.status).toBe(201);
    expect(await countPlans(directUser.id)).toBe(1);
  });

  it('rejects stale previews after an option or its guidance changes', async () => {
    const previewResponse = await previewPlan(routeRequest('/api/references/plan/preview', { brief }));
    const { preview } = await previewResponse.json();
    await sql`
      UPDATE reference_preferences
      SET notes = ${encodeReferenceGuidance({ worthBorrowing: 'Changed after preview.', avoid: '' })}
      WHERE user_id = ${curator.id} AND reference_site_id = 'gate2-alpha'
    `;
    const approval = await approvePlan(routeRequest('/api/references/plan', {
      brief,
      previewHash: preview.previewHash,
      selectedReferenceId: 'gate2-alpha',
    }));
    expect(approval.status).toBe(409);
    await expect(approval.json()).resolves.toMatchObject({ error: 'preview_stale' });
    expect(await countPlans()).toBe(0);

    await restorePreferences();
    const optionPreviewResponse = await previewPlan(routeRequest('/api/references/plan/preview', { brief }));
    const { preview: optionPreview } = await optionPreviewResponse.json();
    await sql`
      UPDATE reference_preferences
      SET decision = 'maybe'
      WHERE user_id = ${curator.id} AND reference_site_id = 'gate2-bravo'
    `;
    const changedOptionsApproval = await approvePlan(routeRequest('/api/references/plan', {
      brief,
      previewHash: optionPreview.previewHash,
      selectedReferenceId: 'gate2-alpha',
    }));
    expect(changedOptionsApproval.status).toBe(409);
    await expect(changedOptionsApproval.json()).resolves.toMatchObject({ error: 'preview_stale' });
    expect(await countPlans()).toBe(0);
  });

  it('rejects a stale hash when warnings or the brief-derived profile changes', async () => {
    const vagueBrief = 'A polished digital presence for the company.';
    const previewResponse = await previewPlan(routeRequest('/api/references/plan/preview', { brief: vagueBrief }));
    const { preview } = await previewResponse.json();
    expect(preview.warnings.length).toBeGreaterThan(0);
    const approval = await approvePlan(routeRequest('/api/references/plan', {
      brief,
      previewHash: preview.previewHash,
      selectedReferenceId: 'gate2-alpha',
    }));
    expect(approval.status).toBe(409);
    expect(await countPlans()).toBe(0);
  });

  it('requires approval before analysis and keeps rejected plans blocked', async () => {
    const plan = {
      schemaVersion: 3,
      selectedReferences: [{ id: 'gate2-alpha', url: 'https://example.com/' }],
    };
    const [record] = await sql`
      INSERT INTO generation_reference_uses (
        user_id, schema_version, brief, selected_reference_ids, plan, status
      ) VALUES (
        ${curator.id}, 3, ${brief}, ${['gate2-alpha']}, ${JSON.stringify(plan)}::jsonb, 'shadow'
      )
      RETURNING id
    `;
    let response = await analyzePlan(
      routeRequest(`/api/references/plan/${record.id}/analyze`, undefined),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(response.status).toBe(409);
    expect(captureSnapshot).not.toHaveBeenCalled();

    await sql`UPDATE generation_reference_uses SET status = 'rejected' WHERE id = ${record.id}`;
    response = await analyzePlan(
      routeRequest(`/api/references/plan/${record.id}/analyze`, undefined),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(response.status).toBe(409);
    expect(captureSnapshot).not.toHaveBeenCalled();
  });

  it('captures desktop/mobile fixture evidence once and returns the persisted Manifest from cache', async () => {
    const created = await createApprovedDirectPlan();
    const context = { params: Promise.resolve({ id: created.id }) };
    const first = await analyzePlan(
      routeRequest(`/api/references/plan/${created.id}/analyze`, undefined), context,
    );
    expect(first.status).toBe(200);
    const firstPayload = await first.json();
    expect(firstPayload.cached).toBe(false);
    expect(firstPayload.manifest.hash).toHaveLength(64);
    expect(firstPayload.manifest.evidence.viewports).toEqual([
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]);
    expect(captureSnapshot).toHaveBeenCalledTimes(2);

    const [stored] = await sql`
      SELECT plan->'chassisManifest' AS manifest
      FROM generation_reference_uses
      WHERE id = ${created.id}
    `;
    expect(stored.manifest.hash).toBe(firstPayload.manifest.hash);

    const second = await analyzePlan(
      routeRequest(`/api/references/plan/${created.id}/analyze`, undefined),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(second.status).toBe(200);
    const secondPayload = await second.json();
    expect(secondPayload).toEqual({ manifest: firstPayload.manifest, cached: true });
    expect(captureSnapshot).toHaveBeenCalledTimes(2);
  });

  it('fails closed for invalid authentication and private-network targets', async () => {
    const unauthorized = await previewPlan(routeRequest(
      '/api/references/plan/preview', { brief }, null,
    ));
    expect(unauthorized.status).toBe(401);
    expect(await countPlans()).toBe(0);

    const privatePreview = await previewPlan(routeRequest('/api/references/plan/preview', {
      brief,
      referenceUrl: 'http://127.0.0.1/private',
    }));
    expect(privatePreview.status).toBe(400);
    expect(await countPlans()).toBe(0);

    const unsafePlan = {
      schemaVersion: 3,
      selectedReferences: [{ id: 'unsafe', url: 'http://127.0.0.1/private' }],
    };
    const [record] = await sql`
      INSERT INTO generation_reference_uses (
        user_id, schema_version, brief, selected_reference_ids, plan, status, reviewed_at
      ) VALUES (
        ${curator.id}, 3, ${brief}, ${['unsafe']}, ${JSON.stringify(unsafePlan)}::jsonb, 'approved', NOW()
      )
      RETURNING id
    `;
    const analysis = await analyzePlan(
      routeRequest(`/api/references/plan/${record.id}/analyze`, undefined),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(analysis.status).toBe(502);
    await expect(analysis.json()).resolves.toMatchObject({ error: 'analysis_failed', detail: 'private_reference_url' });
    expect(captureSnapshot).not.toHaveBeenCalled();
  });
});
