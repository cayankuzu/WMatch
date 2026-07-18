ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS show_gender_on_profile BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;
UPDATE profiles
SET
  gender = COALESCE(NULLIF(btrim(gender), ''), 'other'),
  show_gender_on_profile = COALESCE(show_gender_on_profile, TRUE),
  name = LEFT(COALESCE(NULLIF(btrim(name), ''), 'Kullanici'), 32),
  bio = LEFT(COALESCE(bio, ''), 280),
  letterboxd = LEFT(COALESCE(letterboxd, ''), 80),
  age = LEAST(GREATEST(COALESCE(age, 18), 18), 99)
WHERE TRUE;
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_name_length_check,
  DROP CONSTRAINT IF EXISTS profiles_bio_length_check,
  DROP CONSTRAINT IF EXISTS profiles_letterboxd_length_check,
  DROP CONSTRAINT IF EXISTS profiles_username_length_check,
  DROP CONSTRAINT IF EXISTS profiles_age_range_check,
  DROP CONSTRAINT IF EXISTS profiles_gender_check,
  DROP CONSTRAINT IF EXISTS profiles_location_pair_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_name_length_check CHECK (char_length(btrim(name)) BETWEEN 2 AND 32),
  ADD CONSTRAINT profiles_bio_length_check CHECK (char_length(btrim(bio)) <= 280),
  ADD CONSTRAINT profiles_letterboxd_length_check CHECK (char_length(btrim(letterboxd)) <= 80),
  ADD CONSTRAINT profiles_username_length_check CHECK (char_length(username) BETWEEN 4 AND 20),
  ADD CONSTRAINT profiles_age_range_check CHECK (age BETWEEN 18 AND 99),
  ADD CONSTRAINT profiles_gender_check CHECK (gender IN ('female', 'male', 'nonbinary', 'other')),
  ADD CONSTRAINT profiles_location_pair_check CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (
      latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
    )
  );
ALTER TABLE likes
  ADD COLUMN IF NOT EXISTS hidden_by_liked_user BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_likes_liked_user_hidden_created_at
  ON likes(liked_user_id, hidden_by_liked_user, created_at DESC);
CREATE TABLE IF NOT EXISTS discovery_preferences (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  gender_preference TEXT NOT NULL DEFAULT 'random',
  age_min INTEGER NOT NULL DEFAULT 18,
  age_max INTEGER NOT NULL DEFAULT 99,
  distance_min_km INTEGER NOT NULL DEFAULT 0,
  distance_max_km INTEGER NOT NULL DEFAULT 500,
  compatibility_min INTEGER NOT NULL DEFAULT 0,
  compatibility_max INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT discovery_preferences_gender_preference_check
    CHECK (gender_preference IN ('random', 'female', 'male', 'nonbinary', 'other')),
  CONSTRAINT discovery_preferences_age_range_check
    CHECK (age_min BETWEEN 18 AND 99 AND age_max BETWEEN 18 AND 99 AND age_min <= age_max),
  CONSTRAINT discovery_preferences_distance_range_check
    CHECK (distance_min_km BETWEEN 0 AND 500 AND distance_max_km BETWEEN 0 AND 500 AND distance_min_km <= distance_max_km),
  CONSTRAINT discovery_preferences_compatibility_range_check
    CHECK (compatibility_min BETWEEN 0 AND 100 AND compatibility_max BETWEEN 0 AND 100 AND compatibility_min <= compatibility_max)
);
CREATE INDEX IF NOT EXISTS idx_discovery_preferences_updated_at
  ON discovery_preferences(updated_at DESC);
INSERT INTO discovery_preferences (user_id)
SELECT id
FROM profiles
ON CONFLICT (user_id) DO NOTHING;
ALTER TABLE discovery_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own discovery preferences" ON discovery_preferences;
CREATE POLICY "Users can manage their own discovery preferences" ON discovery_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.update_discovery_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS update_discovery_preferences_updated_at ON discovery_preferences;
CREATE TRIGGER update_discovery_preferences_updated_at
  BEFORE UPDATE ON discovery_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_discovery_preferences_updated_at();
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    name,
    age,
    show_age_on_profile,
    gender,
    show_gender_on_profile,
    username,
    bio,
    letterboxd,
    photos
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', 'User'),
    COALESCE((NEW.raw_user_meta_data->>'age')::INTEGER, 18),
    COALESCE(
      (NEW.raw_user_meta_data->>'show_age_on_profile')::BOOLEAN,
      (NEW.raw_user_meta_data->>'showAgeOnProfile')::BOOLEAN,
      TRUE
    ),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'gender', ''), 'other'),
    COALESCE(
      (NEW.raw_user_meta_data->>'show_gender_on_profile')::BOOLEAN,
      (NEW.raw_user_meta_data->>'showGenderOnProfile')::BOOLEAN,
      TRUE
    ),
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id::TEXT, 1, 8)),
    COALESCE(NEW.raw_user_meta_data->>'bio', ''),
    COALESCE(NEW.raw_user_meta_data->>'letterboxd', ''),
    CASE
      WHEN jsonb_typeof(NEW.raw_user_meta_data->'photos') = 'array' THEN
        ARRAY(SELECT jsonb_array_elements_text(NEW.raw_user_meta_data->'photos'))
      ELSE ARRAY[]::TEXT[]
    END
  );

  INSERT INTO public.discovery_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
