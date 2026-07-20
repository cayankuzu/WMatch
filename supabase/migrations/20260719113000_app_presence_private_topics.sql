-- Presence is published once per signed-in app session. Only the owner can
-- publish it, and only an active match can subscribe to another user's topic.
INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260719113000',
  '20260718120000',
  '20260719113000',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

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
            )
            OR (
              match.user2_id = (SELECT auth.uid())
              AND match.user1_id::TEXT = split_part(realtime.topic(), ':', 2)
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
    )
  );
