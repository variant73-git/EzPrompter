import { sql } from './db.js';
import { getReferenceCatalog, queryReferenceCatalog } from './reference-bank.js';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

function mapPreference(row) {
  if (!row.preference_decision) return null;
  return {
    decision: row.preference_decision,
    rating: row.preference_rating == null ? null : Number(row.preference_rating),
    preferredRole: row.preference_role || 'either',
    businessTags: asArray(row.preference_business_tags),
    visualTags: asArray(row.preference_visual_tags),
    motionTags: asArray(row.preference_motion_tags),
    notes: row.preference_notes || '',
    updatedAt: row.preference_updated_at || null,
  };
}

export function mapReferenceRow(row) {
  const sources = asArray(row.sources);
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    url: row.canonical_url,
    host: row.host,
    thumbnailUrl: row.thumbnail_url || '',
    categories: asArray(row.categories),
    tags: asArray(row.tags),
    sourceIds: sources.map((source) => source.id).filter(Boolean),
    sourceNames: sources.map((source) => source.name).filter(Boolean),
    sources,
    editorialConsensus: Number(row.editorial_consensus || sources.length || 1),
    curationWeight: Number(row.curation_weight || 0),
    curationRank: row.curation_rank == null ? null : Number(row.curation_rank),
    reviewCandidate: Number(row.curation_rank || Infinity) <= 24,
    featured: Boolean(row.featured),
    publishedAt: row.published_at || null,
    generatedAt: row.generated_at || null,
    analysisStatus: row.analysis_status || 'listed',
    availabilityStatus: row.availability_status || 'unknown',
    lifecycleState: row.lifecycle_state || 'listed',
    preference: mapPreference(row),
  };
}

function fallbackPage(options) {
  const catalog = getReferenceCatalog();
  const rankById = new Map(catalog.map((item, index) => [item.id, index + 1]));
  const reviewIds = options.view === 'review' ? catalog.slice(0, 24).map((item) => item.id) : null;
  const page = queryReferenceCatalog({ ...options, referenceIds: reviewIds });
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      curationRank: rankById.get(item.id) || null,
      reviewCandidate: Number(rankById.get(item.id) || Infinity) <= 24,
      preference: null,
    })),
    reviewStats: { total: 24, reviewed: 0, keep: 0, maybe: 0, pass: 0 },
    persistence: 'seed',
  };
}

export async function queryPersistentReferenceCatalog({
  userId,
  query = '',
  source = 'all',
  category = 'all',
  sort = 'curated',
  view = 'browse',
  offset = 0,
  limit = 48,
} = {}) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.min(96, Math.max(1, Number(limit) || 48));
  const safeView = view === 'review' ? 'review' : 'browse';
  const safeSort = ['curated', 'newest', 'name'].includes(sort) ? sort : 'curated';
  const trimmedQuery = String(query || '').trim();
  if (!process.env.DATABASE_URL) return fallbackPage({ query, source, category, sort: safeSort, view: safeView, offset: safeOffset, limit: safeLimit });

  const pattern = `%${trimmedQuery}%`;
  const [rows, sourceFacets, categoryFacets, reviewRows] = await Promise.all([
    sql`
      WITH filtered AS (
        SELECT
          site.*,
          preference.decision AS preference_decision,
          preference.rating AS preference_rating,
          preference.preferred_role AS preference_role,
          preference.business_tags AS preference_business_tags,
          preference.visual_tags AS preference_visual_tags,
          preference.motion_tags AS preference_motion_tags,
          preference.notes AS preference_notes,
          preference.updated_at AS preference_updated_at,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', appearance.source_id,
              'name', appearance.source_name,
              'recordId', appearance.source_record_id,
              'listingUrl', appearance.listing_url,
              'detailUrl', appearance.detail_url,
              'thumbnailUrl', appearance.thumbnail_url
            ) ORDER BY appearance.source_id)
            FROM reference_appearances appearance
            WHERE appearance.reference_site_id = site.id
          ), '[]'::jsonb) AS sources
        FROM reference_sites site
        LEFT JOIN reference_preferences preference
          ON preference.reference_site_id = site.id AND preference.user_id = ${userId}
        WHERE site.lifecycle_state <> 'removed'
          AND (${safeView} <> 'review' OR site.curation_rank <= 24)
          AND (${source} = 'all' OR EXISTS (
            SELECT 1 FROM reference_appearances source_appearance
            WHERE source_appearance.reference_site_id = site.id
              AND source_appearance.source_id = ${source}
          ))
          AND (${category} = 'all' OR ${category} = ANY(site.categories))
          AND (${trimmedQuery} = ''
            OR site.title ILIKE ${pattern}
            OR site.host ILIKE ${pattern}
            OR site.description ILIKE ${pattern}
            OR array_to_string(site.categories, ' ') ILIKE ${pattern}
            OR array_to_string(site.tags, ' ') ILIKE ${pattern})
      )
      SELECT filtered.*, COUNT(*) OVER()::int AS filtered_total
      FROM filtered
      ORDER BY
        CASE WHEN ${safeView} = 'review' AND preference_decision IS NULL THEN 0 ELSE 1 END ASC,
        CASE WHEN ${safeSort} = 'name' THEN LOWER(title) END ASC,
        CASE WHEN ${safeSort} = 'newest' THEN published_at END DESC NULLS LAST,
        CASE WHEN ${safeSort} = 'curated' THEN preference_rating END DESC NULLS LAST,
        curation_rank ASC NULLS LAST,
        curation_weight DESC,
        LOWER(title) ASC
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `,
    sql`
      SELECT source_id AS value, COUNT(DISTINCT reference_site_id)::int AS count
      FROM reference_appearances
      GROUP BY source_id
      ORDER BY count DESC, value ASC
    `,
    sql`
      SELECT category AS value, COUNT(*)::int AS count
      FROM reference_sites, LATERAL unnest(categories) AS category
      WHERE lifecycle_state <> 'removed'
      GROUP BY category
      ORDER BY count DESC, value ASC
    `,
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(preference.id)::int AS reviewed,
        COUNT(*) FILTER (WHERE preference.decision = 'keep')::int AS keep,
        COUNT(*) FILTER (WHERE preference.decision = 'maybe')::int AS maybe,
        COUNT(*) FILTER (WHERE preference.decision = 'pass')::int AS pass
      FROM reference_sites site
      LEFT JOIN reference_preferences preference
        ON preference.reference_site_id = site.id AND preference.user_id = ${userId}
      WHERE site.curation_rank <= 24 AND site.lifecycle_state <> 'removed'
    `,
  ]);

  const total = Number(rows[0]?.filtered_total || 0);
  const items = rows.map(mapReferenceRow);
  return {
    items,
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + items.length < total,
    facets: { sources: sourceFacets, categories: categoryFacets },
    reviewStats: reviewRows[0] || { total: 24, reviewed: 0, keep: 0, maybe: 0, pass: 0 },
    persistence: 'database',
  };
}

export async function getPersistentReferenceCatalog({ userId, limit = 4 } = {}) {
  const page = await queryPersistentReferenceCatalog({ userId, limit });
  return page.items;
}

export async function saveReferencePreference(userId, referenceSiteId, preference) {
  const rows = await sql`
    INSERT INTO reference_preferences (
      user_id, reference_site_id, decision, rating, preferred_role,
      business_tags, visual_tags, motion_tags, notes, updated_at
    ) VALUES (
      ${userId}, ${referenceSiteId}, ${preference.decision}, ${preference.rating},
      ${preference.preferredRole}, ${preference.businessTags}, ${preference.visualTags},
      ${preference.motionTags}, ${preference.notes}, NOW()
    )
    ON CONFLICT (user_id, reference_site_id) DO UPDATE SET
      decision = EXCLUDED.decision,
      rating = EXCLUDED.rating,
      preferred_role = EXCLUDED.preferred_role,
      business_tags = EXCLUDED.business_tags,
      visual_tags = EXCLUDED.visual_tags,
      motion_tags = EXCLUDED.motion_tags,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING decision, rating, preferred_role, business_tags, visual_tags, motion_tags, notes, updated_at
  `;
  const row = rows[0];
  return {
    decision: row.decision,
    rating: row.rating == null ? null : Number(row.rating),
    preferredRole: row.preferred_role,
    businessTags: asArray(row.business_tags),
    visualTags: asArray(row.visual_tags),
    motionTags: asArray(row.motion_tags),
    notes: row.notes || '',
    updatedAt: row.updated_at,
  };
}

export async function getReviewedPlanningCandidates(userId) {
  if (!process.env.DATABASE_URL) return [];
  const rows = await sql`
    SELECT
      site.*,
      preference.decision AS preference_decision,
      preference.rating AS preference_rating,
      preference.preferred_role AS preference_role,
      preference.business_tags AS preference_business_tags,
      preference.visual_tags AS preference_visual_tags,
      preference.motion_tags AS preference_motion_tags,
      preference.notes AS preference_notes,
      preference.updated_at AS preference_updated_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', appearance.source_id, 'name', appearance.source_name))
        FROM reference_appearances appearance
        WHERE appearance.reference_site_id = site.id
      ), '[]'::jsonb) AS sources
    FROM reference_sites site
    JOIN reference_preferences preference
      ON preference.reference_site_id = site.id AND preference.user_id = ${userId}
    WHERE preference.decision IN ('keep','maybe') AND site.lifecycle_state <> 'removed'
    ORDER BY
      CASE preference.decision WHEN 'keep' THEN 0 ELSE 1 END,
      preference.rating DESC NULLS LAST,
      site.curation_rank ASC NULLS LAST
    LIMIT 40
  `;
  return rows.map(mapReferenceRow);
}

export async function saveShadowReferencePlan(userId, brief, plan) {
  const ids = plan.selectedReferences.map((reference) => reference.id);
  const rows = await sql`
    INSERT INTO generation_reference_uses (user_id, brief, selected_reference_ids, plan)
    VALUES (${userId}, ${brief}, ${ids}, ${JSON.stringify(plan)}::jsonb)
    RETURNING id, status, created_at
  `;
  return rows[0];
}

export async function updateShadowReferencePlan(userId, planId, status) {
  const rows = await sql`
    UPDATE generation_reference_uses
    SET status = ${status}, reviewed_at = NOW(), updated_at = NOW()
    WHERE id = ${planId} AND user_id = ${userId} AND mode = 'shadow' AND status = 'shadow'
    RETURNING id, status, reviewed_at
  `;
  return rows[0] || null;
}
