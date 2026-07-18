ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS show_age_on_profile BOOLEAN NOT NULL DEFAULT TRUE;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, age, show_age_on_profile, username, bio, letterboxd, photos)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', 'User'),
    COALESCE((NEW.raw_user_meta_data->>'age')::INTEGER, 18),
    COALESCE(
      (NEW.raw_user_meta_data->>'show_age_on_profile')::BOOLEAN,
      (NEW.raw_user_meta_data->>'showAgeOnProfile')::BOOLEAN,
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
  )
  ON CONFLICT (id) DO UPDATE
  SET show_age_on_profile = EXCLUDED.show_age_on_profile;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
