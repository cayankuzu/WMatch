-- Persist Expo push receipts and inspect them after the provider has had time
-- to hand the message to FCM/APNs. Expo recommends waiting 15 minutes before
-- the first receipt lookup and expires receipts after 24 hours.

INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260819190000',
  '20260720012500',
  '20260819190000',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.push_delivery_receipts (
  ticket_id TEXT PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.notification_events(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'delivered', 'error', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 minutes'),
  locked_at TIMESTAMPTZ,
  checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(ticket_id) BETWEEN 8 AND 200),
  CHECK (char_length(token) BETWEEN 8 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_receipts_outbox
  ON public.push_delivery_receipts(next_attempt_at, created_at, ticket_id)
  WHERE status IN ('pending', 'retry', 'processing');

CREATE INDEX IF NOT EXISTS idx_push_delivery_receipts_event
  ON public.push_delivery_receipts(event_id, created_at DESC);

ALTER TABLE public.push_delivery_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_delivery_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_delivery_receipts TO service_role;

DROP TRIGGER IF EXISTS update_push_delivery_receipts_updated_at
  ON public.push_delivery_receipts;
CREATE TRIGGER update_push_delivery_receipts_updated_at
  BEFORE UPDATE ON public.push_delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.claim_push_receipt_jobs(
  p_limit INTEGER DEFAULT 300
)
RETURNS TABLE (
  ticket_id TEXT,
  event_id UUID,
  token TEXT,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.push_delivery_receipts AS receipt
  SET
    status = 'dead',
    locked_at = NULL,
    next_attempt_at = NULL,
    checked_at = NOW(),
    last_error = 'expo_receipt_expired'
  WHERE receipt.status IN ('pending', 'retry', 'processing')
    AND receipt.created_at <= NOW() - INTERVAL '24 hours';

  DELETE FROM public.push_delivery_receipts AS receipt
  WHERE receipt.status IN ('delivered', 'error', 'dead')
    AND receipt.updated_at <= NOW() - INTERVAL '7 days';

  RETURN QUERY
  WITH claimable AS (
    SELECT receipt.ticket_id
    FROM public.push_delivery_receipts AS receipt
    WHERE (
      (
        receipt.status IN ('pending', 'retry')
        AND receipt.next_attempt_at <= NOW()
      ) OR (
        receipt.status = 'processing'
        AND receipt.locked_at <= NOW() - INTERVAL '5 minutes'
      )
    )
      AND receipt.created_at > NOW() - INTERVAL '24 hours'
    ORDER BY receipt.next_attempt_at, receipt.created_at, receipt.ticket_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000)
  ),
  claimed AS (
    UPDATE public.push_delivery_receipts AS receipt
    SET
      status = 'processing',
      attempt_count = receipt.attempt_count + 1,
      locked_at = NOW(),
      last_error = NULL
    FROM claimable
    WHERE receipt.ticket_id = claimable.ticket_id
    RETURNING receipt.*
  )
  SELECT
    claimed.ticket_id,
    claimed.event_id,
    claimed.token,
    claimed.attempt_count
  FROM claimed
  ORDER BY claimed.created_at, claimed.ticket_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_push_receipt_job(
  p_ticket_id TEXT,
  p_status TEXT,
  p_error TEXT DEFAULT NULL,
  p_retry_after_seconds INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_status NOT IN ('retry', 'delivered', 'error', 'dead') THEN
    RAISE EXCEPTION 'Invalid push receipt completion status.';
  END IF;

  UPDATE public.push_delivery_receipts
  SET
    status = p_status,
    locked_at = NULL,
    checked_at = CASE WHEN p_status IN ('delivered', 'error', 'dead') THEN NOW() ELSE checked_at END,
    next_attempt_at = CASE
      WHEN p_status = 'retry' THEN NOW() + make_interval(
        secs => LEAST(GREATEST(COALESCE(p_retry_after_seconds, 300), 60), 3600)
      )
      ELSE NULL
    END,
    last_error = CASE WHEN p_error IS NULL THEN NULL ELSE LEFT(p_error, 500) END
  WHERE ticket_id = p_ticket_id
    AND status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_receipt_jobs(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_push_receipt_job(TEXT, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_receipt_jobs(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_push_receipt_job(TEXT, TEXT, TEXT, INTEGER) TO service_role;

DROP FUNCTION IF EXISTS public.get_push_delivery_health();
CREATE FUNCTION public.get_push_delivery_health()
RETURNS TABLE (
  pending_count BIGINT,
  retry_count BIGINT,
  processing_count BIGINT,
  dead_count BIGINT,
  stalled_count BIGINT,
  oldest_due_at TIMESTAMPTZ,
  oldest_due_age_seconds BIGINT,
  receipt_pending_count BIGINT,
  receipt_retry_count BIGINT,
  receipt_processing_count BIGINT,
  receipt_failed_count BIGINT,
  receipt_stalled_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH event_health AS (
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
      ) AS oldest_due_at
    FROM public.notification_events AS event
  ),
  receipt_health AS (
    SELECT
      COUNT(*) FILTER (WHERE receipt.status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE receipt.status = 'retry') AS retry_count,
      COUNT(*) FILTER (WHERE receipt.status = 'processing') AS processing_count,
      COUNT(*) FILTER (
        WHERE receipt.status IN ('error', 'dead')
          AND receipt.updated_at >= NOW() - INTERVAL '24 hours'
      ) AS failed_count,
      COUNT(*) FILTER (
        WHERE (
          receipt.status IN ('pending', 'retry')
          AND receipt.next_attempt_at <= NOW() - INTERVAL '10 minutes'
        ) OR (
          receipt.status = 'processing'
          AND COALESCE(receipt.locked_at, receipt.created_at) <= NOW() - INTERVAL '10 minutes'
        )
      ) AS stalled_count
    FROM public.push_delivery_receipts AS receipt
  )
  SELECT
    event_health.pending_count,
    event_health.retry_count,
    event_health.processing_count,
    event_health.dead_count,
    event_health.stalled_count,
    event_health.oldest_due_at,
    COALESCE(
      FLOOR(EXTRACT(EPOCH FROM (NOW() - event_health.oldest_due_at)))::BIGINT,
      0
    ) AS oldest_due_age_seconds,
    receipt_health.pending_count AS receipt_pending_count,
    receipt_health.retry_count AS receipt_retry_count,
    receipt_health.processing_count AS receipt_processing_count,
    receipt_health.failed_count AS receipt_failed_count,
    receipt_health.stalled_count AS receipt_stalled_count
  FROM event_health
  CROSS JOIN receipt_health;
$$;

REVOKE ALL ON FUNCTION public.get_push_delivery_health()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_delivery_health() TO service_role;

COMMENT ON TABLE public.push_delivery_receipts IS
  'Service-only durable queue for delayed Expo receipt inspection and invalid-device cleanup.';
COMMENT ON FUNCTION public.claim_push_receipt_jobs(INTEGER) IS
  'Claims due Expo receipt lookups after their initial 15 minute visibility delay.';
