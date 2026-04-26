-- Atomic guard for request creation to prevent race conditions under retries/double-submit.
-- This function serializes per-requester writes and enforces:
-- - No re-requesting same candidate within rolling 7 days
-- - Max 3 distinct candidates in rolling 7 days

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
  normalized_ids uuid[];
  v_week_start timestamptz := now() - interval '7 days';
  oldest_recent timestamptz;
  used_count integer := 0;
  dup_exists boolean := false;
  remaining integer := 0;
  inserted_id uuid;
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

  SELECT min(created_at)
  INTO oldest_recent
  FROM public.requests
  WHERE requester_id = p_requester_id
    AND created_at >= v_week_start;

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

  SELECT count(DISTINCT cid.candidate_id)::integer
  INTO used_count
  FROM public.requests r
  CROSS JOIN LATERAL unnest(r.candidate_ids) AS cid(candidate_id)
  WHERE r.requester_id = p_requester_id
    AND r.created_at >= v_week_start;

  remaining := GREATEST(0, 3 - COALESCE(used_count, 0));

  IF remaining = 0 OR cardinality(normalized_ids) > remaining THEN
    RETURN QUERY
    SELECT
      NULL::uuid,
      'weekly_limit',
      CASE
        WHEN remaining = 0
          THEN 'Weekly limit reached (3 candidates).'
        ELSE format(
          'You have %s candidate slot%s remaining this week. Please reduce your selection.',
          remaining,
          CASE WHEN remaining = 1 THEN '' ELSE 's' END
        )
      END,
      remaining,
      CASE
        WHEN oldest_recent IS NULL THEN NULL::timestamptz
        ELSE oldest_recent + interval '7 days'
      END;
    RETURN;
  END IF;

  INSERT INTO public.requests (requester_id, candidate_ids, email_status)
  VALUES (p_requester_id, normalized_ids, 'pending')
  RETURNING id INTO inserted_id;

  RETURN QUERY
  SELECT inserted_id, NULL::text, NULL::text, remaining - cardinality(normalized_ids), NULL::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION public.create_contact_request_atomic(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_contact_request_atomic(uuid, uuid[]) TO service_role;
