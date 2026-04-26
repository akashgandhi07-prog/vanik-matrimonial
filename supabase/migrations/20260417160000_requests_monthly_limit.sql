-- Add a calendar-month cap (6 distinct candidates) on top of the existing rolling-7-day cap (3).
-- Members can request at most 3 distinct candidates in any rolling 7-day window AND
-- at most 6 distinct candidates in the current calendar month (00:00 UTC on the 1st to now()).

DROP FUNCTION IF EXISTS public.create_contact_request_atomic(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.create_contact_request_atomic(
  p_requester_id uuid,
  p_candidate_ids uuid[]
)
RETURNS TABLE (
  request_id uuid,
  error_code text,
  error_message text,
  slots_remaining integer,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_ids   uuid[];
  week_start       timestamptz := now() - interval '7 days';
  month_start      timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  oldest_recent    timestamptz;
  used_week        integer := 0;
  used_month       integer := 0;
  dup_exists       boolean := false;
  remaining_week   integer := 0;
  remaining_month  integer := 0;
  remaining        integer := 0;
  inserted_id      uuid;
BEGIN
  IF p_requester_id IS NULL THEN
    RETURN QUERY
    SELECT NULL::uuid, 'invalid_requester', 'requester_id is required', 0, NULL::timestamptz;
    RETURN;
  END IF;

  normalized_ids := COALESCE(
    ARRAY(
      SELECT DISTINCT id
      FROM unnest(p_candidate_ids) AS t(id)
      WHERE id IS NOT NULL
    ),
    '{}'::uuid[]
  );

  IF cardinality(normalized_ids) = 0 THEN
    RETURN QUERY
    SELECT NULL::uuid, 'invalid_candidates', 'At least one candidate is required', 0, NULL::timestamptz;
    RETURN;
  END IF;

  IF cardinality(normalized_ids) > 3 THEN
    RETURN QUERY
    SELECT NULL::uuid, 'weekly_limit', 'You can request up to 3 candidates at a time.', 0, NULL::timestamptz;
    RETURN;
  END IF;

  -- Serialize request creation per requester to avoid race windows.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_requester_id::text, 0));

  -- Oldest request inside the rolling 7-day window (used to calculate reset_at).
  SELECT min(created_at)
  INTO oldest_recent
  FROM public.requests
  WHERE requester_id = p_requester_id
    AND created_at >= week_start;

  -- Check for duplicate within rolling 7 days.
  SELECT EXISTS (
    SELECT 1
    FROM public.requests r
    CROSS JOIN LATERAL unnest(r.candidate_ids) AS cid(candidate_id)
    WHERE r.requester_id = p_requester_id
      AND r.created_at >= week_start
      AND cid.candidate_id = ANY(normalized_ids)
  )
  INTO dup_exists;

  IF dup_exists THEN
    RETURN QUERY
    SELECT
      NULL::uuid,
      'already_requested_this_week',
      'You already requested this profile within the last 7 days. You can ask again after that window, subject to weekly limits.',
      NULL::integer,
      CASE
        WHEN oldest_recent IS NULL THEN NULL::timestamptz
        ELSE oldest_recent + interval '7 days'
      END;
    RETURN;
  END IF;

  -- Count distinct candidates used in rolling 7-day window.
  SELECT count(DISTINCT cid.candidate_id)::integer
  INTO used_week
  FROM public.requests r
  CROSS JOIN LATERAL unnest(r.candidate_ids) AS cid(candidate_id)
  WHERE r.requester_id = p_requester_id
    AND r.created_at >= week_start;

  remaining_week := GREATEST(0, 3 - COALESCE(used_week, 0));

  IF remaining_week = 0 OR cardinality(normalized_ids) > remaining_week THEN
    RETURN QUERY
    SELECT
      NULL::uuid,
      'weekly_limit',
      CASE
        WHEN remaining_week = 0
          THEN 'Weekly limit reached (3 candidates per 7 days).'
        ELSE format(
          'You have %s candidate slot%s remaining this week. Please reduce your selection.',
          remaining_week,
          CASE WHEN remaining_week = 1 THEN '' ELSE 's' END
        )
      END,
      remaining_week,
      CASE
        WHEN oldest_recent IS NULL THEN NULL::timestamptz
        ELSE oldest_recent + interval '7 days'
      END;
    RETURN;
  END IF;

  -- Count distinct candidates used in the current calendar month.
  SELECT count(DISTINCT cid.candidate_id)::integer
  INTO used_month
  FROM public.requests r
  CROSS JOIN LATERAL unnest(r.candidate_ids) AS cid(candidate_id)
  WHERE r.requester_id = p_requester_id
    AND r.created_at >= month_start;

  remaining_month := GREATEST(0, 6 - COALESCE(used_month, 0));

  IF remaining_month = 0 OR cardinality(normalized_ids) > remaining_month THEN
    RETURN QUERY
    SELECT
      NULL::uuid,
      'monthly_limit',
      CASE
        WHEN remaining_month = 0
          THEN 'Monthly limit reached (6 candidates per calendar month).'
        ELSE format(
          'You only have %s candidate slot%s remaining this calendar month. Please reduce your selection.',
          remaining_month,
          CASE WHEN remaining_month = 1 THEN '' ELSE 's' END
        )
      END,
      remaining_month,
      date_trunc('month', now() AT TIME ZONE 'UTC' + interval '1 month') AT TIME ZONE 'UTC';
    RETURN;
  END IF;

  -- Both limits satisfied - insert the request.
  remaining := LEAST(remaining_week, remaining_month);

  INSERT INTO public.requests (requester_id, candidate_ids, email_status)
  VALUES (p_requester_id, normalized_ids, 'pending')
  RETURNING id INTO inserted_id;

  RETURN QUERY
  SELECT inserted_id, NULL::text, NULL::text, remaining - cardinality(normalized_ids), NULL::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION public.create_contact_request_atomic(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_contact_request_atomic(uuid, uuid[]) TO service_role;
