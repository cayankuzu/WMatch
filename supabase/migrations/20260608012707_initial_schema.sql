-- WMatch Database Schema
-- Bu dosyayi Supabase Dashboard > SQL Editor'da calistirin

-- Kullanici profilleri (auth.users ile baglantili)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 18),
  show_age_on_profile BOOLEAN NOT NULL DEFAULT TRUE,
  username TEXT UNIQUE NOT NULL,
  bio TEXT DEFAULT '',
  letterboxd TEXT DEFAULT '',
  photos TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS show_age_on_profile BOOLEAN NOT NULL DEFAULT TRUE;

-- Kullanici film tercihleri (favoriler ve izlenenler)
CREATE TABLE IF NOT EXISTS user_movies (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  movie_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('favorite', 'watched')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, movie_id, type)
);

-- Su an izledigi film
CREATE TABLE IF NOT EXISTS currently_watching (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  movie_id INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Begeniler
CREATE TABLE IF NOT EXISTS likes (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  liked_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, liked_user_id),
  CHECK (user_id != liked_user_id)
);

-- Eslesmeler (karsilikli begeniler)
CREATE TABLE IF NOT EXISTS matches (
  user1_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  user2_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'blocked_by_user1', 'blocked_by_user2')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user1_id, user2_id),
  CHECK (user1_id < user2_id)
);

-- Mesajlar
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (sender_id != receiver_id)
);

-- Index'ler (performans icin)
CREATE INDEX IF NOT EXISTS idx_user_movies_user_id ON user_movies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_movies_type ON user_movies(user_id, type);
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_liked_user_id ON likes(liked_user_id);
CREATE INDEX IF NOT EXISTS idx_matches_users ON matches(user1_id, user2_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(sender_id, receiver_id, created_at DESC);

-- Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_movies ENABLE ROW LEVEL SECURITY;
ALTER TABLE currently_watching ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Herkes kendi profilini okuyabilir ve guncelleyebilir
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Kullanici kesfi icin eski genis okuma policy'si sonraki hardening migration'lariyla daraltilir.
DROP POLICY IF EXISTS "Users can view other profiles" ON profiles;
CREATE POLICY "Users can view other profiles" ON profiles
  FOR SELECT USING (true);

-- Kullanicilar kendi film tercihlerini yonetebilir
DROP POLICY IF EXISTS "Users can manage their own movies" ON user_movies;
CREATE POLICY "Users can manage their own movies" ON user_movies
  FOR ALL USING (auth.uid() = user_id);

-- Kullanicilar diger kullanicilarin film tercihlerini gorebilir
DROP POLICY IF EXISTS "Users can view others' movies" ON user_movies;
CREATE POLICY "Users can view others' movies" ON user_movies
  FOR SELECT USING (true);

-- Currently watching politikalari
DROP POLICY IF EXISTS "Users can manage their currently watching" ON currently_watching;
CREATE POLICY "Users can manage their currently watching" ON currently_watching
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view others' currently watching" ON currently_watching;
CREATE POLICY "Users can view others' currently watching" ON currently_watching
  FOR SELECT USING (true);

-- Begeni politikalari
DROP POLICY IF EXISTS "Users can manage their own likes" ON likes;
CREATE POLICY "Users can manage their own likes" ON likes
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view likes they received" ON likes;
CREATE POLICY "Users can view likes they received" ON likes
  FOR SELECT USING (auth.uid() = liked_user_id OR auth.uid() = user_id);

-- Eslesme politikalari
DROP POLICY IF EXISTS "Users can view their own matches" ON matches;
CREATE POLICY "Users can view their own matches" ON matches
  FOR SELECT USING (auth.uid() = user1_id OR auth.uid() = user2_id);

DROP POLICY IF EXISTS "Users can update their own matches" ON matches;
CREATE POLICY "Users can update their own matches" ON matches
  FOR UPDATE USING (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Mesaj politikalari
DROP POLICY IF EXISTS "Users can view their own messages" ON messages;
CREATE POLICY "Users can view their own messages" ON messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can send messages" ON messages;
CREATE POLICY "Users can send messages" ON messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Users can update their received messages" ON messages;
CREATE POLICY "Users can update their received messages" ON messages
  FOR UPDATE USING (auth.uid() = receiver_id);

-- Yeni kullanici kaydinda otomatik profil olusturma
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
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Eslesme olusturma fonksiyonu (karsilikli begeni varsa)
CREATE OR REPLACE FUNCTION public.check_and_create_match()
RETURNS TRIGGER AS $$
DECLARE
  mutual_like_exists BOOLEAN;
  uid1 UUID;
  uid2 UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM likes
    WHERE user_id = NEW.liked_user_id
    AND liked_user_id = NEW.user_id
  ) INTO mutual_like_exists;

  IF mutual_like_exists THEN
    IF NEW.user_id < NEW.liked_user_id THEN
      uid1 := NEW.user_id;
      uid2 := NEW.liked_user_id;
    ELSE
      uid1 := NEW.liked_user_id;
      uid2 := NEW.user_id;
    END IF;

    INSERT INTO matches (user1_id, user2_id)
    VALUES (uid1, uid2)
    ON CONFLICT (user1_id, user2_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_like_created ON likes;
CREATE TRIGGER on_like_created
  AFTER INSERT ON likes
  FOR EACH ROW EXECUTE FUNCTION public.check_and_create_match();

-- updated_at otomatik guncelleme
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_matches_updated_at ON matches;
CREATE TRIGGER update_matches_updated_at
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
