-- Reference weighting v2: frozen cohorts, progressive quality dimensions,
-- and bounded aggregator confidence. Additive and idempotent.

CREATE TABLE IF NOT EXISTS reference_aggregators (
  id VARCHAR(32) PRIMARY KEY,
  name TEXT NOT NULL,
  homepage_url TEXT,
  overall_rating SMALLINT NOT NULL DEFAULT 3 CHECK (overall_rating BETWEEN 1 AND 5),
  editorial_quality SMALLINT CHECK (editorial_quality BETWEEN 1 AND 5),
  motion_density SMALLINT CHECK (motion_density BETWEEN 1 AND 5),
  metadata_quality SMALLINT CHECK (metadata_quality BETWEEN 1 AND 5),
  noise_control SMALLINT CHECK (noise_control BETWEEN 1 AND 5),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO reference_aggregators (id, name, homepage_url)
VALUES
  ('codrops', 'Codrops Webzibition', 'https://tympanus.net/codrops/webzibition/'),
  ('pafolios', 'Pafolios', 'https://pafolios.com/'),
  ('siteinspire', 'SiteInspire', 'https://www.siteinspire.com/')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  homepage_url = EXCLUDED.homepage_url,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS reference_review_cohorts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rubric_version SMALLINT NOT NULL DEFAULT 2,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','frozen','retired')),
  selection_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  frozen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reference_review_cohort_members (
  cohort_id TEXT NOT NULL REFERENCES reference_review_cohorts(id) ON DELETE CASCADE,
  reference_site_id TEXT NOT NULL REFERENCES reference_sites(id) ON DELETE CASCADE,
  rank SMALLINT NOT NULL CHECK (rank > 0),
  selection_score NUMERIC(7,3),
  selection_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cohort_id, reference_site_id),
  UNIQUE (cohort_id, rank)
);

CREATE INDEX IF NOT EXISTS reference_review_cohort_members_site
  ON reference_review_cohort_members(reference_site_id, cohort_id);

INSERT INTO reference_review_cohorts (
  id, name, rubric_version, status, selection_snapshot, frozen_at
)
VALUES (
  'cohort_v1', 'Cohort v1', 2, 'frozen',
  '{"basis":"initial_curation_rank","size":24,"purpose":"rating_calibration"}'::jsonb,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO reference_review_cohort_members (
  cohort_id, reference_site_id, rank, selection_score, selection_reason
)
SELECT
  'cohort_v1', id, curation_rank::smallint, curation_weight,
  '{"basis":"initial_curation_rank"}'::jsonb
FROM reference_sites
WHERE curation_rank BETWEEN 1 AND 24
ON CONFLICT DO NOTHING;

ALTER TABLE reference_preferences ADD COLUMN IF NOT EXISTS visual_quality SMALLINT CHECK (visual_quality BETWEEN 1 AND 5);
ALTER TABLE reference_preferences ADD COLUMN IF NOT EXISTS structure_quality SMALLINT CHECK (structure_quality BETWEEN 1 AND 5);
ALTER TABLE reference_preferences ADD COLUMN IF NOT EXISTS motion_quality SMALLINT CHECK (motion_quality BETWEEN 1 AND 5);
ALTER TABLE reference_preferences ADD COLUMN IF NOT EXISTS originality SMALLINT CHECK (originality BETWEEN 1 AND 5);
ALTER TABLE reference_preferences ADD COLUMN IF NOT EXISTS transferability SMALLINT CHECK (transferability BETWEEN 1 AND 5);
ALTER TABLE reference_preferences ADD COLUMN IF NOT EXISTS commercial_clarity SMALLINT CHECK (commercial_clarity BETWEEN 1 AND 5);
ALTER TABLE reference_preferences ADD COLUMN IF NOT EXISTS chassis_potential SMALLINT CHECK (chassis_potential BETWEEN 1 AND 5);
ALTER TABLE reference_preferences ADD COLUMN IF NOT EXISTS donor_potential SMALLINT CHECK (donor_potential BETWEEN 1 AND 5);

ALTER TABLE generation_reference_uses DROP CONSTRAINT IF EXISTS generation_reference_uses_schema_version_check;
ALTER TABLE generation_reference_uses ADD CONSTRAINT generation_reference_uses_schema_version_check CHECK (schema_version IN (1,2));
