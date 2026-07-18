CREATE OR REPLACE FUNCTION public.check_and_create_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mutual_like_exists BOOLEAN := FALSE;
  users_blocked BOOLEAN := FALSE;
  uid1 UUID;
  uid2 UUID;
BEGIN
  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_blocks
      WHERE (blocker_id = NEW.user_id AND blocked_id = NEW.liked_user_id)
         OR (blocker_id = NEW.liked_user_id AND blocked_id = NEW.user_id)
    ) INTO users_blocked;
  EXCEPTION
    WHEN undefined_table THEN
      users_blocked := FALSE;
  END;

  IF users_blocked THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.likes
    WHERE user_id = NEW.liked_user_id
      AND liked_user_id = NEW.user_id
  ) INTO mutual_like_exists;

  IF NOT mutual_like_exists THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id < NEW.liked_user_id THEN
    uid1 := NEW.user_id;
    uid2 := NEW.liked_user_id;
  ELSE
    uid1 := NEW.liked_user_id;
    uid2 := NEW.user_id;
  END IF;

  BEGIN
    INSERT INTO public.matches (user1_id, user2_id, status)
    VALUES (uid1, uid2, 'active')
    ON CONFLICT (user1_id, user2_id) DO UPDATE
      SET status = CASE
        WHEN matches.status = 'ended' THEN matches.status
        ELSE 'active'
      END;
  EXCEPTION
    WHEN undefined_table THEN
      RETURN NEW;
    WHEN undefined_column THEN
      BEGIN
        INSERT INTO public.matches (user1_id, user2_id, status)
        VALUES (uid1, uid2, 'active')
        ON CONFLICT (user1_id, user2_id) DO NOTHING;
      EXCEPTION
        WHEN undefined_table THEN
          RETURN NEW;
      END;
  END;

  RETURN NEW;
END;
$$;
