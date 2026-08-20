-- Service-only operational read model for the durable push delivery outbox.
-- The scheduler uses this after every drain so dead letters and stalled work
-- become an actionable failed job instead of a silent backlog.
INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260819100000',
  '20260720012500',
  '20260819100000',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.get_push_delivery_health()
RETURNS TABLE (
  pending_count BIGINT,
  retry_count BIGINT,
  processing_count BIGINT,
  dead_count BIGINT,
  stalled_count BIGINT,
  oldest_due_at TIMESTAMPTZ,
  oldest_due_age_seconds BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE event.push_status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE event.push_status = 'retry') AS retry_count,
    COUNT(*) FILTER (WHERE event.push_status = 'processing') AS processing_count,
    COUNT(*) FILTER (WHERE event.push_status = 'dead') AS dead_count,
    COUNT(*) FILTER (
      WHERE (
        event.push_status IN ('pending', 'retry')
        AND event.push_next_attempt_at <= NOW() - INTERVAL '10 minutes'
      ) OR (
        event.push_status = 'processing'
        AND COALESCE(event.push_locked_at, event.created_at) <= NOW() - INTERVAL '10 minutes'
      )
    ) AS stalled_count,
    MIN(event.push_next_attempt_at) FILTER (
      WHERE event.push_status IN ('pending', 'retry')
        AND event.push_next_attempt_at <= NOW()
    ) AS oldest_due_at,
    COALESCE(
      FLOOR(EXTRACT(EPOCH FROM (
        NOW() - MIN(event.push_next_attempt_at) FILTER (
          WHERE event.push_status IN ('pending', 'retry')
            AND event.push_next_attempt_at <= NOW()
        )
      )))::BIGINT,
      0
    ) AS oldest_due_age_seconds
  FROM public.notification_events AS event;
$$;

REVOKE ALL ON FUNCTION public.get_push_delivery_health()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_delivery_health() TO service_role;

COMMENT ON FUNCTION public.get_push_delivery_health() IS
  'Service-only push outbox counts and stalled/dead-letter health for the external drain scheduler.';
