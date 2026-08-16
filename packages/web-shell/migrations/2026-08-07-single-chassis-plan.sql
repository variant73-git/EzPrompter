ALTER TABLE generation_reference_uses
  DROP CONSTRAINT IF EXISTS generation_reference_uses_selected_reference_ids_check;

ALTER TABLE generation_reference_uses
  ADD CONSTRAINT generation_reference_uses_selected_reference_ids_check
  CHECK (cardinality(selected_reference_ids) BETWEEN 1 AND 3);
