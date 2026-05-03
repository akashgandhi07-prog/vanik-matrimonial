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
  v_week_start     timestamptz := now() - interval '7 days';
  month_start      timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  oldest_recent    timestamptz;
  used_week        integer := 0;
  used_month       integer := 0;
  dup_exists       boolean := false;
  remaining_week   integer := 0;
  remaining_month  integer := 0;
  remaining        integer := 0;
  inserted_id      uuid;
  v_weekly_bonus   integer := 0;
  v_monthly_bonus  integer := 0;
  v_weekly_limit   integer;
  v_monthly_limit  integer;
  v_max_per_request integer;
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

  -- Serialize request creation per requester to avoid race windows.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_requester_id::text, 0));

  SELECT
    COALESCE(MAX(mp.contact_request_weekly_bonus), 0)::integer,
    COALESCE(MAX(mp.contact_request_monthly_bonus), 0)::integer
  INTO v_weekly_bonus, v_monthly_bonus
  FROM public.member_private mp
  WHERE mp.profile_id = p_requester_id;

  v_weekly_limit := 3 + v_weekly_bonus;
  v_monthly_limit := 6 + v_monthly_bonus;
  v_max_per_request := LEAST(10, v_weekly_limit, v_monthly_limit);

  IF cardinality(normalized_ids) > v_max_per_request THEN
    RETURN QUERY
    SELECT
      NULL::uuid,
      'weekly_limit',
      format('You can request up to %s candidate(s) in one go.', v_max_per_request),
      0,
      NULL::timestamptz;
    RETURN;
  END IF;

  -- Oldest request inside the rolling 7-day window (used to calculate reset_at).
  SELECT min(created_at)
  INTO oldest_recent
  FROM public.requests
  WHERE requester_id = p_requester_id
    AND created_at >= v_week_start;

  -- Check for duplicate within rolling 7 days.
  SELECT EXISTS (
    SELECT 1
    FROM public.requests r
    CROSS JOIN LATERAL unnest(r.candidate_ids) AS cid(candidate_id)
    WHERE r.requester_id = p_requester_id
      AND r.created_at >= v_week_start
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
    AND r.created_at >= v_week_start;

  remaining_week := GREATEST(0, v_weekly_limit - COALESCE(used_week, 0));

  IF remaining_week = 0 OR cardinality(normalized_ids) > remaining_week THEN
    RETURN QUERY
    SELECT
      NULL::uuid,
      'weekly_limit',
      CASE
        WHEN remaining_week = 0
          THEN format('Weekly limit reached (%s distinct candidates per 7 days).', v_weekly_limit)
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

  remaining_month := GREATEST(0, v_monthly_limit - COALESCE(used_month, 0));

  IF remaining_month = 0 OR cardinality(normalized_ids) > remaining_month THEN
    RETURN QUERY
    SELECT
      NULL::uuid,
      'monthly_limit',
      CASE
        WHEN remaining_month = 0
          THEN format('Monthly limit reached (%s distinct candidates per calendar month).', v_monthly_limit)
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
