ALTER TABLE generation_reference_uses
  DROP CONSTRAINT IF EXISTS generation_reference_uses_schema_version_check;

ALTER TABLE generation_reference_uses
  ADD CONSTRAINT generation_reference_uses_schema_version_check
  CHECK (schema_version IN (1, 2, 3));
