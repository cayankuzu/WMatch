-- Forward-only P0/P1 security and privacy closures.
-- This migration intentionally preserves the public HTTP route surface while
-- moving sensitive tables/RPCs behind the service boundary.

INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260830120000',
  '20260819190000',
  '20260830120000',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

-- The historical RPC disclosed whether an arbitrary email existed in
-- auth.users and was callable with the public anon key. Keep it only for
-- trusted server compatibility; public auth flows return generic responses.
REVOKE ALL ON FUNCTION public.check_email_availability(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_email_availability(TEXT) TO service_role;

-- Signup metadata is attacker-controlled. Profile photos are finalized only
-- after an authenticated owner upload has passed the Edge validation boundary.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    ARRAY[]::TEXT[]
  );

  INSERT INTO public.discovery_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Messages are delivered through the authenticated Edge contract. Retaining a
-- participant-only PostgREST SELECT policy allowed per-user clear/delete state
-- to be bypassed with a direct table query.
DROP POLICY IF EXISTS "Users can view their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update their received messages" ON public.messages;
DROP POLICY IF EXISTS "No direct message writes" ON public.messages;
DROP POLICY IF EXISTS "No direct message updates" ON public.messages;
DROP POLICY IF EXISTS "Service boundary messages" ON public.messages;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages TO service_role;

CREATE POLICY "Service boundary messages" ON public.messages
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_payload_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_client_payload_hash_check'
      AND conrelid = 'public.messages'::REGCLASS
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_client_payload_hash_check
      CHECK (client_payload_hash IS NULL OR client_payload_hash ~ '^[a-f0-9]{64}$');
  END IF;
END $$;

-- Reports are service-boundary cases. Authenticated callers must not bypass
-- target validation/rate limits or mass-assign reviewer fields via PostgREST.
ALTER TABLE public.moderation_reports
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  ADD COLUMN IF NOT EXISTS last_transition_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'moderation_reports_idempotency_key_check'
      AND conrelid = 'public.moderation_reports'::REGCLASS
  ) THEN
    ALTER TABLE public.moderation_reports
      ADD CONSTRAINT moderation_reports_idempotency_key_check
      CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 180);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'moderation_reports_payload_hash_check'
      AND conrelid = 'public.moderation_reports'::REGCLASS
  ) THEN
    ALTER TABLE public.moderation_reports
      ADD CONSTRAINT moderation_reports_payload_hash_check
      CHECK (payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_reports_reporter_idempotency
  ON public.moderation_reports(reporter_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP POLICY IF EXISTS "Users can create their own moderation reports" ON public.moderation_reports;
DROP POLICY IF EXISTS "Users can view their own moderation reports" ON public.moderation_reports;
DROP POLICY IF EXISTS "Service boundary moderation reports" ON public.moderation_reports;

ALTER TABLE public.moderation_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.moderation_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.moderation_reports TO service_role;

CREATE POLICY "Service boundary moderation reports" ON public.moderation_reports
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

CREATE TABLE IF NOT EXISTS public.moderation_report_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.moderation_reports(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('case_created', 'case_updated', 'status_changed')),
  from_status TEXT,
  to_status TEXT,
  actor_kind TEXT NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('system', 'ops')),
  actor_label TEXT CHECK (actor_label IS NULL OR char_length(actor_label) <= 80),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_report_audit_case_created
  ON public.moderation_report_audit_events(report_id, created_at DESC);

ALTER TABLE public.moderation_report_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.moderation_report_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.moderation_report_audit_events TO service_role;

DROP POLICY IF EXISTS "Service boundary moderation audit" ON public.moderation_report_audit_events;
CREATE POLICY "Service boundary moderation audit" ON public.moderation_report_audit_events
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

CREATE OR REPLACE FUNCTION public.audit_moderation_report_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.moderation_report_audit_events (
      report_id,
      action,
      to_status,
      actor_kind
    )
    VALUES (NEW.id, 'case_created', NEW.status, 'system');
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.moderation_report_audit_events (
      report_id,
      action,
      from_status,
      to_status,
      actor_kind,
      actor_label
    )
    VALUES (
      NEW.id,
      'status_changed',
      OLD.status,
      NEW.status,
      'ops',
      NULLIF(current_setting('wmatch.ops_actor', TRUE), '')
    );
  ELSIF OLD.reviewer_notes IS DISTINCT FROM NEW.reviewer_notes THEN
    INSERT INTO public.moderation_report_audit_events (
      report_id,
      action,
      from_status,
      to_status,
      actor_kind,
      actor_label
    )
    VALUES (
      NEW.id,
      'case_updated',
      OLD.status,
      NEW.status,
      'ops',
      NULLIF(current_setting('wmatch.ops_actor', TRUE), '')
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_moderation_report_transition()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_moderation_report_transition ON public.moderation_reports;
CREATE TRIGGER audit_moderation_report_transition
  AFTER INSERT OR UPDATE OF status, reviewer_notes
  ON public.moderation_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_moderation_report_transition();

CREATE OR REPLACE FUNCTION public.transition_moderation_report_ops(
  p_report_id UUID,
  p_next_status TEXT,
  p_reviewer_notes TEXT DEFAULT NULL,
  p_actor_label TEXT DEFAULT 'ops'
)
RETURNS public.moderation_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.moderation_reports%ROWTYPE;
  v_actor_label TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_actor_label), ''), 'ops'), 80);
BEGIN
  IF p_next_status NOT IN ('pending', 'reviewing', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid moderation status';
  END IF;

  IF p_reviewer_notes IS NOT NULL AND char_length(BTRIM(p_reviewer_notes)) > 2000 THEN
    RAISE EXCEPTION 'reviewer notes exceed 2000 characters';
  END IF;

  PERFORM set_config('wmatch.ops_actor', v_actor_label, TRUE);

  UPDATE public.moderation_reports
  SET
    status = p_next_status,
    reviewer_notes = CASE
      WHEN p_reviewer_notes IS NULL THEN reviewer_notes
      ELSE NULLIF(BTRIM(p_reviewer_notes), '')
    END,
    reviewed_at = CASE
      WHEN p_next_status IN ('resolved', 'dismissed') THEN NOW()
      ELSE NULL
    END,
    last_transition_at = NOW(),
    updated_at = NOW()
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'moderation report not found';
  END IF;

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_moderation_report_ops(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_moderation_report_ops(UUID, TEXT, TEXT, TEXT)
  TO service_role;

-- Cloudflare-to-origin signatures use a database-backed nonce claim so replay
-- protection is atomic across every Edge Function isolate.
CREATE TABLE IF NOT EXISTS public.edge_origin_hmac_nonces (
  key_id TEXT NOT NULL CHECK (key_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  nonce UUID NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key_id, nonce),
  CHECK (expires_at > signed_at)
);

CREATE INDEX IF NOT EXISTS idx_edge_origin_hmac_nonces_expires_at
  ON public.edge_origin_hmac_nonces(expires_at);

ALTER TABLE public.edge_origin_hmac_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.edge_origin_hmac_nonces FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.edge_origin_hmac_nonces TO service_role;

DROP POLICY IF EXISTS "Service boundary origin HMAC nonces" ON public.edge_origin_hmac_nonces;
CREATE POLICY "Service boundary origin HMAC nonces" ON public.edge_origin_hmac_nonces
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

CREATE OR REPLACE FUNCTION public.claim_edge_origin_hmac_nonce(
  p_key_id TEXT,
  p_nonce UUID,
  p_timestamp BIGINT,
  p_max_skew_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_signed_at TIMESTAMPTZ;
  v_inserted INTEGER := 0;
BEGIN
  IF p_key_id !~ '^[A-Za-z0-9._-]{1,64}$'
     OR p_max_skew_seconds < 30
     OR p_max_skew_seconds > 300 THEN
    RETURN FALSE;
  END IF;

  v_signed_at := to_timestamp(p_timestamp);
  IF ABS(EXTRACT(EPOCH FROM (v_now - v_signed_at))) > p_max_skew_seconds THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.edge_origin_hmac_nonces WHERE expires_at <= v_now;

  INSERT INTO public.edge_origin_hmac_nonces (
    key_id,
    nonce,
    signed_at,
    expires_at
  )
  VALUES (
    p_key_id,
    p_nonce,
    v_signed_at,
    GREATEST(v_now, v_signed_at) + make_interval(secs => p_max_skew_seconds)
  )
  ON CONFLICT (key_id, nonce) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_edge_origin_hmac_nonce(TEXT, UUID, BIGINT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_edge_origin_hmac_nonce(TEXT, UUID, BIGINT, INTEGER)
  TO service_role;

-- Restore the conversation authorization conditions that were accidentally
-- weakened when app-presence topics were added. Every broadcast operation is
-- tied to a canonical active match and a bilateral block check.
DROP POLICY IF EXISTS "WMatch private realtime select" ON realtime.messages;
CREATE POLICY "WMatch private realtime select" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() = 'user:' || (SELECT auth.uid())::TEXT
    OR realtime.topic() = 'user-events:' || (SELECT auth.uid())::TEXT
    OR realtime.topic() = 'presence:' || (SELECT auth.uid())::TEXT
    OR (
      realtime.topic() ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (
        split_part(realtime.topic(), ':', 2) = (SELECT auth.uid())::TEXT
        OR split_part(realtime.topic(), ':', 3) = (SELECT auth.uid())::TEXT
      )
      AND split_part(realtime.topic(), ':', 2)::UUID < split_part(realtime.topic(), ':', 3)::UUID
      AND EXISTS (
        SELECT 1
        FROM public.matches AS match
        WHERE match.user1_id = split_part(realtime.topic(), ':', 2)::UUID
          AND match.user2_id = split_part(realtime.topic(), ':', 3)::UUID
          AND match.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_blocks AS block
        WHERE (
          block.blocker_id = split_part(realtime.topic(), ':', 2)::UUID
          AND block.blocked_id = split_part(realtime.topic(), ':', 3)::UUID
        ) OR (
          block.blocker_id = split_part(realtime.topic(), ':', 3)::UUID
          AND block.blocked_id = split_part(realtime.topic(), ':', 2)::UUID
        )
      )
    )
    OR (
      realtime.topic() ~ '^presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1
        FROM public.matches AS match
        WHERE match.status = 'active'
          AND (
            (
              match.user1_id = (SELECT auth.uid())
              AND match.user2_id::TEXT = split_part(realtime.topic(), ':', 2)
            ) OR (
              match.user2_id = (SELECT auth.uid())
              AND match.user1_id::TEXT = split_part(realtime.topic(), ':', 2)
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.user_blocks AS block
            WHERE (
              block.blocker_id = match.user1_id
              AND block.blocked_id = match.user2_id
            ) OR (
              block.blocker_id = match.user2_id
              AND block.blocked_id = match.user1_id
            )
          )
      )
    )
  );

DROP POLICY IF EXISTS "WMatch private realtime insert" ON realtime.messages;
CREATE POLICY "WMatch private realtime insert" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.topic() = 'user:' || (SELECT auth.uid())::TEXT
    OR realtime.topic() = 'user-events:' || (SELECT auth.uid())::TEXT
    OR realtime.topic() = 'presence:' || (SELECT auth.uid())::TEXT
    OR (
      realtime.topic() ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (
        split_part(realtime.topic(), ':', 2) = (SELECT auth.uid())::TEXT
        OR split_part(realtime.topic(), ':', 3) = (SELECT auth.uid())::TEXT
      )
      AND split_part(realtime.topic(), ':', 2)::UUID < split_part(realtime.topic(), ':', 3)::UUID
      AND EXISTS (
        SELECT 1
        FROM public.matches AS match
        WHERE match.user1_id = split_part(realtime.topic(), ':', 2)::UUID
          AND match.user2_id = split_part(realtime.topic(), ':', 3)::UUID
          AND match.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_blocks AS block
        WHERE (
          block.blocker_id = split_part(realtime.topic(), ':', 2)::UUID
          AND block.blocked_id = split_part(realtime.topic(), ':', 3)::UUID
        ) OR (
          block.blocker_id = split_part(realtime.topic(), ':', 3)::UUID
          AND block.blocked_id = split_part(realtime.topic(), ':', 2)::UUID
        )
      )
    )
  );

-- Each of these internal tables already has one fail-closed FOR ALL policy.
-- Remove the older overlapping SELECT-only policy so every role/action is
-- evaluated once without widening access.
DROP POLICY IF EXISTS "No direct chat repair audit reads"
  ON public.chat_repair_audit;
DROP POLICY IF EXISTS "No direct media identity repair history reads"
  ON public.media_identity_repair_history;
DROP POLICY IF EXISTS "No direct media identity repair reads"
  ON public.media_identity_repair_queue;
DROP POLICY IF EXISTS "No direct entitlement reads"
  ON public.user_entitlements;

-- Both indexes had the exact same key definition. Keep the descriptive
-- keyset index and remove the redundant historical copy.
DROP INDEX IF EXISTS public.idx_currently_watching_movie_id;
