import { sql } from './db.js';
import { getReferenceCatalog, queryReferenceCatalog } from './reference-bank.js';

export const DEFAULT_REVIEW_COHORT_ID = 'cohort_v1';

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
    dimensionRatings: {
      visualQuality: row.preference_visual_quality == null ? null : Number(row.preference_visual_quality),
      structureQuality: row.preference_structure_quality == null ? null : Number(row.preference_structure_quality),
      motionQuality: row.preference_motion_quality == null ? null : Number(row.preference_motion_quality),
      originality: row.preference_originality == null ? null : Number(row.preference_originality),
      transferability: row.preference_transferability == null ? null : Number(row.preference_transferability),
      commercialClarity: row.preference_commercial_clarity == null ? null : Number(row.preference_commercial_clarity),
      chassisPotential: row.preference_chassis_potential == null ? null : Number(row.preference_chassis_potential),
      donorPotential: row.preference_donor_potential == null ? null : Number(row.preference_donor_potential),
    },
    notes: row.preference_notes || '',
    updatedAt: row.preference_updated_at || null,
  };
}

export function calculateSourceConfidence(sources = []) {
  const active = sources.filter((source) => source.status !== 'retired');
  if (!active.length) return 0.6;
  const sourceScores = active.map((source) => {
    const values = [source.overallRating, source.editorialQuality, source.metadataQuality, source.noiseControl]
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 1 && value <= 5);
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length / 5 : 0.6;
  });
  const base = sourceScores.reduce((total, value) => total + value, 0) / sourceScores.length;
  const consensusBoost = Math.min(0.08, Math.max(0, active.length - 1) * 0.04);
  return Number(Math.min(1, base + consensusBoost).toFixed(3));
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
    cohortRank: row.cohort_rank == null ? null : Number(row.cohort_rank),
    reviewCandidate: row.cohort_rank != null,
    featured: Boolean(row.featured),
    isPrivate: Boolean(row.is_private ?? row.isPrivate),
    privacyReason: row.privacy_reason || row.privacyReason || null,
    templatePlatform: row.template_platform || row.templatePlatform || null,
    publishedAt: row.published_at || null,
    generatedAt: row.generated_at || null,
    analysisStatus: row.analysis_status || 'listed',
    availabilityStatus: row.availability_status || 'unknown',
    lifecycleState: row.lifecycle_state || 'listed',
    sourceConfidence: calculateSourceConfidence(sources),
    preference: mapPreference(row),
  };
}

function fallbackPage(options) {
  const catalog = getReferenceCatalog({ includePrivate: options.includePrivate });
  const rankById = new Map(catalog.map((item, index) => [item.id, index + 1]));
  const reviewIds = options.view === 'review' ? catalog.slice(0, 24).map((item) => item.id) : null;
  const page = queryReferenceCatalog({ ...options, referenceIds: reviewIds, includePrivate: options.includePrivate });
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      curationRank: rankById.get(item.id) || null,
      cohortRank: reviewIds?.indexOf(item.id) >= 0 ? reviewIds.indexOf(item.id) + 1 : null,
      reviewCandidate: Number(rankById.get(item.id) || Infinity) <= 24,
      sourceConfidence: calculateSourceConfidence(item.sources),
      preference: null,
    })),
    reviewStats: { total: 24, reviewed: 0, keep: 0, maybe: 0, pass: 0 },
    reviewCohort: { id: DEFAULT_REVIEW_COHORT_ID, name: 'Cohort v1', status: 'frozen', rubricVersion: 2 },
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
  includePrivate = false,
  offset = 0,
  limit = 48,
} = {}) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.min(96, Math.max(1, Number(limit) || 48));
  const safeView = ['review', 'curate'].includes(view) ? view : 'browse';
  const safeSort = ['curated', 'newest', 'name'].includes(sort) ? sort : 'curated';
  const trimmedQuery = String(query || '').trim();
  if (!process.env.DATABASE_URL) return fallbackPage({ query, source, category, sort: safeSort, view: safeView, includePrivate, offset: safeOffset, limit: safeLimit });

  const pattern = `%${trimmedQuery}%`;
  const [rows, sourceFacets, categoryFacets, reviewRows, cohortRows] = await Promise.all([
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
          preference.visual_quality AS preference_visual_quality,
          preference.structure_quality AS preference_structure_quality,
          preference.motion_quality AS preference_motion_quality,
          preference.originality AS preference_originality,
          preference.transferability AS preference_transferability,
          preference.commercial_clarity AS preference_commercial_clarity,
          preference.chassis_potential AS preference_chassis_potential,
          preference.donor_potential AS preference_donor_potential,
          preference.notes AS preference_notes,
          preference.updated_at AS preference_updated_at,
          cohort_member.rank AS cohort_rank,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', appearance.source_id,
              'name', appearance.source_name,
              'recordId', appearance.source_record_id,
              'listingUrl', appearance.listing_url,
              'detailUrl', appearance.detail_url,
              'thumbnailUrl', appearance.thumbnail_url,
              'overallRating', aggregator.overall_rating,
              'editorialQuality', aggregator.editorial_quality,
              'motionDensity', aggregator.motion_density,
              'metadataQuality', aggregator.metadata_quality,
              'noiseControl', aggregator.noise_control,
              'status', aggregator.status
            ) ORDER BY appearance.source_id)
            FROM reference_appearances appearance
            LEFT JOIN reference_aggregators aggregator ON aggregator.id = appearance.source_id
            WHERE appearance.reference_site_id = site.id
          ), '[]'::jsonb) AS sources
        FROM reference_sites site
        LEFT JOIN reference_preferences preference
          ON preference.reference_site_id = site.id AND preference.user_id = ${userId}
        LEFT JOIN reference_review_cohort_members cohort_member
          ON cohort_member.reference_site_id = site.id AND cohort_member.cohort_id = ${DEFAULT_REVIEW_COHORT_ID}
        WHERE site.lifecycle_state <> 'removed'
          AND (${Boolean(includePrivate)} OR site.is_private = FALSE)
          AND (${safeView} <> 'review' OR cohort_member.reference_site_id IS NOT NULL)
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
        CASE WHEN ${safeView} IN ('review','curate') AND preference_decision IS NULL THEN 0 ELSE 1 END ASC,
        CASE WHEN ${safeSort} = 'name' THEN LOWER(title) END ASC,
        CASE WHEN ${safeSort} = 'newest' THEN published_at END DESC NULLS LAST,
        CASE WHEN ${safeSort} = 'curated' THEN preference_rating END DESC NULLS LAST,
        CASE WHEN ${safeView} = 'review' THEN cohort_rank END ASC NULLS LAST,
        curation_rank ASC NULLS LAST,
        curation_weight DESC,
        LOWER(title) ASC
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `,
    sql`
      SELECT source_id AS value, COUNT(DISTINCT reference_site_id)::int AS count
      FROM reference_appearances
      JOIN reference_sites site ON site.id = reference_appearances.reference_site_id
      WHERE (${Boolean(includePrivate)} OR site.is_private = FALSE)
      GROUP BY source_id
      ORDER BY count DESC, value ASC
    `,
    sql`
      SELECT category AS value, COUNT(*)::int AS count
      FROM reference_sites, LATERAL unnest(categories) AS category
      WHERE lifecycle_state <> 'removed' AND (${Boolean(includePrivate)} OR is_private = FALSE)
      GROUP BY category
      ORDER BY count DESC, value ASC
    `,
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(preference.id)::int AS reviewed,
        COUNT(*) FILTER (WHERE preference.decision = 'keep')::int AS keep,
        COUNT(*) FILTER (WHERE preference.decision = 'maybe')::int AS maybe,
        COUNT(*) FILTER (WHERE preference.decision = 'pass')::int AS pass,
        COUNT(*) FILTER (WHERE preference.rating >= 4)::int AS high_quality,
        ROUND(AVG(preference.rating)::numeric, 2) AS average_rating
      FROM reference_review_cohort_members member
      JOIN reference_sites site ON site.id = member.reference_site_id
      LEFT JOIN reference_preferences preference
        ON preference.reference_site_id = site.id AND preference.user_id = ${userId}
      WHERE member.cohort_id = ${DEFAULT_REVIEW_COHORT_ID}
        AND site.lifecycle_state <> 'removed'
        AND (${Boolean(includePrivate)} OR site.is_private = FALSE)
    `,
    sql`
      SELECT id, name, status, rubric_version, frozen_at
      FROM reference_review_cohorts
      WHERE id = ${DEFAULT_REVIEW_COHORT_ID}
      LIMIT 1
    `,
  ]);

  const total = Number(rows[0]?.filtered_total || 0);
  const items = rows.map(mapReferenceRow);
  const cohort = cohortRows[0];
  const reviewStats = reviewRows[0] || { total: 24, reviewed: 0, keep: 0, maybe: 0, pass: 0, high_quality: 0, average_rating: null };
  return {
    items,
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + items.length < total,
    facets: { sources: sourceFacets, categories: categoryFacets },
    reviewStats: {
      total: Number(reviewStats.total || 0),
      reviewed: Number(reviewStats.reviewed || 0),
      keep: Number(reviewStats.keep || 0),
      maybe: Number(reviewStats.maybe || 0),
      pass: Number(reviewStats.pass || 0),
      highQuality: Number(reviewStats.high_quality || 0),
      averageRating: reviewStats.average_rating == null ? null : Number(reviewStats.average_rating),
    },
    reviewCohort: cohort ? {
      id: cohort.id,
      name: cohort.name,
      status: cohort.status,
      rubricVersion: Number(cohort.rubric_version),
      frozenAt: cohort.frozen_at,
    } : null,
    persistence: 'database',
  };
}

export async function getPersistentReferenceCatalog({ userId, limit = 4 } = {}) {
  const page = await queryPersistentReferenceCatalog({ userId, limit });
  return page.items;
}

export async function saveReferencePreference(userId, referenceSiteId, preference) {
  const dimensions = preference.dimensionRatings || {};
  const visualQuality = dimensions.visualQuality ?? null;
  const structureQuality = dimensions.structureQuality ?? null;
  const motionQuality = dimensions.motionQuality ?? null;
  const originality = dimensions.originality ?? null;
  const transferability = dimensions.transferability ?? null;
  const commercialClarity = dimensions.commercialClarity ?? null;
  const chassisPotential = dimensions.chassisPotential ?? null;
  const donorPotential = dimensions.donorPotential ?? null;
  const rows = await sql`
    INSERT INTO reference_preferences (
      user_id, reference_site_id, decision, rating, preferred_role,
      business_tags, visual_tags, motion_tags,
      visual_quality, structure_quality, motion_quality, originality,
      transferability, commercial_clarity, chassis_potential, donor_potential,
      notes, updated_at
    ) VALUES (
      ${userId}, ${referenceSiteId}, ${preference.decision}, ${preference.rating},
      ${preference.preferredRole}, ${preference.businessTags}, ${preference.visualTags},
      ${preference.motionTags}, ${visualQuality}, ${structureQuality},
      ${motionQuality}, ${originality}, ${transferability},
      ${commercialClarity}, ${chassisPotential}, ${donorPotential},
      ${preference.notes}, NOW()
    )
    ON CONFLICT (user_id, reference_site_id) DO UPDATE SET
      decision = EXCLUDED.decision,
      rating = EXCLUDED.rating,
      preferred_role = EXCLUDED.preferred_role,
      business_tags = EXCLUDED.business_tags,
      visual_tags = EXCLUDED.visual_tags,
      motion_tags = EXCLUDED.motion_tags,
      visual_quality = EXCLUDED.visual_quality,
      structure_quality = EXCLUDED.structure_quality,
      motion_quality = EXCLUDED.motion_quality,
      originality = EXCLUDED.originality,
      transferability = EXCLUDED.transferability,
      commercial_clarity = EXCLUDED.commercial_clarity,
      chassis_potential = EXCLUDED.chassis_potential,
      donor_potential = EXCLUDED.donor_potential,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING decision, rating, preferred_role, business_tags, visual_tags, motion_tags,
      visual_quality, structure_quality, motion_quality, originality, transferability,
      commercial_clarity, chassis_potential, donor_potential, notes, updated_at
  `;
  const row = rows[0];
  return {
    decision: row.decision,
    rating: row.rating == null ? null : Number(row.rating),
    preferredRole: row.preferred_role,
    businessTags: asArray(row.business_tags),
    visualTags: asArray(row.visual_tags),
    motionTags: asArray(row.motion_tags),
    dimensionRatings: {
      visualQuality: row.visual_quality == null ? null : Number(row.visual_quality),
      structureQuality: row.structure_quality == null ? null : Number(row.structure_quality),
      motionQuality: row.motion_quality == null ? null : Number(row.motion_quality),
      originality: row.originality == null ? null : Number(row.originality),
      transferability: row.transferability == null ? null : Number(row.transferability),
      commercialClarity: row.commercial_clarity == null ? null : Number(row.commercial_clarity),
      chassisPotential: row.chassis_potential == null ? null : Number(row.chassis_potential),
      donorPotential: row.donor_potential == null ? null : Number(row.donor_potential),
    },
    notes: row.notes || '',
    updatedAt: row.updated_at,
  };
}

export async function saveReferencePrivacy(referenceSiteId, isPrivate) {
  const rows = await sql`
    UPDATE reference_sites
    SET
      is_private = ${Boolean(isPrivate)},
      privacy_reason = CASE WHEN ${Boolean(isPrivate)} THEN COALESCE(privacy_reason, 'manual-curation') ELSE NULL END,
      updated_at = NOW()
    WHERE id = ${referenceSiteId}
    RETURNING id, is_private, privacy_reason, template_platform, updated_at
  `;
  if (!rows[0]) return null;
  return {
    referenceId: rows[0].id,
    isPrivate: Boolean(rows[0].is_private),
    privacyReason: rows[0].privacy_reason || null,
    templatePlatform: rows[0].template_platform || null,
    updatedAt: rows[0].updated_at,
  };
}

export async function getReviewedPlanningCandidates(userId, { includePrivate = false } = {}) {
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
      preference.visual_quality AS preference_visual_quality,
      preference.structure_quality AS preference_structure_quality,
      preference.motion_quality AS preference_motion_quality,
      preference.originality AS preference_originality,
      preference.transferability AS preference_transferability,
      preference.commercial_clarity AS preference_commercial_clarity,
      preference.chassis_potential AS preference_chassis_potential,
      preference.donor_potential AS preference_donor_potential,
      preference.notes AS preference_notes,
      preference.updated_at AS preference_updated_at,
      cohort_member.rank AS cohort_rank,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', appearance.source_id,
          'name', appearance.source_name,
          'overallRating', aggregator.overall_rating,
          'editorialQuality', aggregator.editorial_quality,
          'motionDensity', aggregator.motion_density,
          'metadataQuality', aggregator.metadata_quality,
          'noiseControl', aggregator.noise_control,
          'status', aggregator.status
        ))
        FROM reference_appearances appearance
        LEFT JOIN reference_aggregators aggregator ON aggregator.id = appearance.source_id
        WHERE appearance.reference_site_id = site.id
      ), '[]'::jsonb) AS sources
    FROM reference_sites site
    JOIN reference_preferences preference
      ON preference.reference_site_id = site.id AND preference.user_id = ${userId}
    LEFT JOIN reference_review_cohort_members cohort_member
      ON cohort_member.reference_site_id = site.id AND cohort_member.cohort_id = ${DEFAULT_REVIEW_COHORT_ID}
    WHERE preference.decision IN ('keep','maybe')
      AND site.lifecycle_state <> 'removed'
      AND (${Boolean(includePrivate)} OR site.is_private = FALSE)
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
    INSERT INTO generation_reference_uses (user_id, schema_version, brief, selected_reference_ids, plan)
    VALUES (${userId}, ${plan.schemaVersion || 1}, ${brief}, ${ids}, ${JSON.stringify(plan)}::jsonb)
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
