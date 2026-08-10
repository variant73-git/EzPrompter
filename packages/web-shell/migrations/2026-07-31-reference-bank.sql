-- Start from a Ref: persistent catalog, private taste signals, and shadow plans.
-- Additive and idempotent. Does not promote users or trigger generation.

CREATE TABLE IF NOT EXISTS reference_sites (
  id TEXT PRIMARY KEY,
  canonical_url TEXT UNIQUE NOT NULL,
  host TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  editorial_consensus SMALLINT NOT NULL DEFAULT 1 CHECK (editorial_consensus > 0),
  curation_weight NUMERIC(7,3) NOT NULL DEFAULT 1,
  curation_rank INTEGER CHECK (curation_rank IS NULL OR curation_rank > 0),
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TEXT,
  generated_at TIMESTAMPTZ,
  availability_status VARCHAR(16) NOT NULL DEFAULT 'unknown'
    CHECK (availability_status IN ('unknown','available','unavailable','blocked')),
  lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'listed'
    CHECK (lifecycle_state IN ('listed','reviewing','enriched','excluded','removed')),
  analysis_status VARCHAR(20) NOT NULL DEFAULT 'listed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reference_sites_curated
  ON reference_sites(lifecycle_state, curation_rank, curation_weight DESC);
CREATE INDEX IF NOT EXISTS reference_sites_host ON reference_sites(host);
CREATE INDEX IF NOT EXISTS reference_sites_categories ON reference_sites USING GIN(categories);
CREATE INDEX IF NOT EXISTS reference_sites_tags ON reference_sites USING GIN(tags);

CREATE TABLE IF NOT EXISTS reference_appearances (
  id BIGSERIAL PRIMARY KEY,
  reference_site_id TEXT NOT NULL REFERENCES reference_sites(id) ON DELETE CASCADE,
  source_id VARCHAR(32) NOT NULL,
  source_name TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  listing_url TEXT NOT NULL,
  detail_url TEXT,
  thumbnail_url TEXT,
  source_taxonomy JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(reference_site_id, source_id, source_record_id)
);
CREATE INDEX IF NOT EXISTS reference_appearances_site ON reference_appearances(reference_site_id);
CREATE INDEX IF NOT EXISTS reference_appearances_source ON reference_appearances(source_id, reference_site_id);

CREATE TABLE IF NOT EXISTS reference_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_site_id TEXT NOT NULL REFERENCES reference_sites(id) ON DELETE CASCADE,
  decision VARCHAR(12) NOT NULL CHECK (decision IN ('keep','maybe','pass')),
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  preferred_role VARCHAR(12) NOT NULL DEFAULT 'either'
    CHECK (preferred_role IN ('chassis','donor','either')),
  business_tags TEXT[] NOT NULL DEFAULT '{}',
  visual_tags TEXT[] NOT NULL DEFAULT '{}',
  motion_tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, reference_site_id)
);
CREATE INDEX IF NOT EXISTS reference_preferences_user_decision
  ON reference_preferences(user_id, decision, updated_at DESC);
CREATE INDEX IF NOT EXISTS reference_preferences_site ON reference_preferences(reference_site_id);

CREATE TABLE IF NOT EXISTS generation_reference_uses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  mode VARCHAR(16) NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','generation')),
  status VARCHAR(16) NOT NULL DEFAULT 'shadow'
    CHECK (status IN ('shadow','approved','rejected','executed','failed')),
  brief TEXT NOT NULL CHECK (char_length(brief) BETWEEN 12 AND 6000),
  selected_reference_ids TEXT[] NOT NULL
    CHECK (cardinality(selected_reference_ids) BETWEEN 2 AND 4),
  plan JSONB NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  board_id UUID REFERENCES boards(id) ON DELETE SET NULL,
  output_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS generation_reference_uses_user_time
  ON generation_reference_uses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_reference_uses_status
  ON generation_reference_uses(user_id, status, created_at DESC);
