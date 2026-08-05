ALTER TABLE reference_sites ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reference_sites ADD COLUMN IF NOT EXISTS privacy_reason VARCHAR(64);
ALTER TABLE reference_sites ADD COLUMN IF NOT EXISTS template_platform VARCHAR(32);

CREATE INDEX IF NOT EXISTS reference_sites_visibility
  ON reference_sites(is_private, lifecycle_state, curation_rank);
