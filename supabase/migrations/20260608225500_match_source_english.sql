UPDATE matches
SET match_source_type = 'compatibility'
WHERE match_source_type = 'uyum';
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_match_source_type_check;
ALTER TABLE matches
  ADD CONSTRAINT matches_match_source_type_check
  CHECK (match_source_type IN ('watch', 'compatibility', 'like'));
