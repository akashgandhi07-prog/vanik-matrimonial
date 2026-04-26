-- Vanik Matrimonial Register - Phase 1 schema + RLS
-- Note: age is maintained by trigger from member_private.date_of_birth (spec had cross-table generated column).

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Coupons first (referenced by member_private)
CREATE TABLE public.coupons (
  code text PRIMARY KEY,
  type text NOT NULL DEFAULT 'free' CHECK (type IN ('free', 'discount_percent')),
  discount_percent integer,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id)
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text UNIQUE,
  gender text NOT NULL CHECK (gender IN ('Male', 'Female')),
  first_name text NOT NULL,
  age integer,
  education text,
  job_title text,
  height_cm integer,
  weight_kg integer,
  diet text CHECK (diet IN ('Veg', 'Non-veg', 'Vegan')),
  religion text CHECK (religion IN ('Jain', 'Hindu', 'Other')),
  community text CHECK (community IN ('Vanik', 'Lohana', 'Brahmin', 'Other')),
  nationality text,
  place_of_birth text,
  town_country_of_origin text,
  future_settlement_plans text,
  hobbies text,
  photo_url text,
  photo_status text NOT NULL DEFAULT 'pending' CHECK (photo_status IN ('pending', 'approved', 'rejected')),
  status text NOT NULL DEFAULT 'pending_approval' CHECK (
    status IN ('pending_approval', 'active', 'rejected', 'expired', 'archived', 'matched')
  ),
  show_on_register boolean NOT NULL DEFAULT true,
  membership_expires_at timestamptz,
  last_request_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  auth_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX profiles_one_per_auth ON public.profiles (auth_user_id);

CREATE TABLE public.member_private (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE UNIQUE,
  surname text NOT NULL,
  date_of_birth date NOT NULL,
  email text NOT NULL,
  mobile_phone text NOT NULL,
  home_address_line1 text,
  home_address_city text,
  home_address_postcode text,
  home_address_country text DEFAULT 'UK',
  father_name text,
  mother_name text,
  id_document_url text,
  id_document_deleted_at timestamptz,
  coupon_used text REFERENCES public.coupons (code),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid REFERENCES public.profiles (id),
  candidate_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  email_sent_at timestamptz,
  email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed', 'bounced')),
  feedback_due_at timestamptz GENERATED ALWAYS AS (created_at + INTERVAL '21 days') STORED,
  week_start date GENERATED ALWAYS AS ((date_trunc('week', created_at))::date) STORED
);

CREATE TABLE public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.requests (id),
  candidate_id uuid REFERENCES public.profiles (id),
  requester_id uuid REFERENCES public.profiles (id),
  made_contact text CHECK (made_contact IN ('yes', 'no', 'no_response')),
  notes text,
  recommend_retain text CHECK (recommend_retain IN ('yes', 'no', 'unsure')),
  is_flagged boolean NOT NULL DEFAULT false,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  bookmarked_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, bookmarked_id)
);

CREATE TABLE public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES auth.users (id),
  target_profile_id uuid REFERENCES public.profiles (id),
  action_type text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email text,
  recipient_profile_id uuid REFERENCES public.profiles (id),
  email_type text NOT NULL,
  subject text,
  resend_message_id text,
  status text NOT NULL DEFAULT 'sent',
  sent_at timestamptz NOT NULL DEFAULT now()
);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helpers (JWT: user_metadata.is_admin) - defined before triggers that call is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false)
      OR coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- Sync age from DOB
CREATE OR REPLACE FUNCTION public.sync_profile_age_from_private()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
  SET age = EXTRACT(YEAR FROM AGE(NEW.date_of_birth))::integer
  WHERE id = NEW.profile_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER member_private_sync_age
  AFTER INSERT OR UPDATE OF date_of_birth ON public.member_private
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_age_from_private();

-- Restrict non-admin profile updates to allowed public fields only
CREATE OR REPLACE FUNCTION public.enforce_profile_member_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT public.is_admin() INTO admin;
  IF admin THEN
    RETURN NEW;
  END IF;
  IF OLD.photo_status IS DISTINCT FROM NEW.photo_status AND NEW.photo_status <> 'pending' THEN
    RAISE EXCEPTION 'Members may only set photo status to pending when submitting a new photo';
  END IF;
  IF OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id
     OR OLD.reference_number IS DISTINCT FROM NEW.reference_number
     OR OLD.gender IS DISTINCT FROM NEW.gender
     OR OLD.first_name IS DISTINCT FROM NEW.first_name
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.show_on_register IS DISTINCT FROM NEW.show_on_register
     OR OLD.membership_expires_at IS DISTINCT FROM NEW.membership_expires_at
     OR OLD.last_request_at IS DISTINCT FROM NEW.last_request_at
     OR OLD.rejection_reason IS DISTINCT FROM NEW.rejection_reason
     OR OLD.place_of_birth IS DISTINCT FROM NEW.place_of_birth
     OR OLD.religion IS DISTINCT FROM NEW.religion
     OR OLD.community IS DISTINCT FROM NEW.community
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Members may only update allowed public profile fields';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_member_update_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_member_update();

-- Reference number assignment (call from Edge Function with service role)
CREATE OR REPLACE FUNCTION public.assign_next_reference_number(p_profile_id uuid, p_gender text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  next_num integer;
  max_num integer;
  floor_num integer;
BEGIN
  IF p_gender = 'Male' THEN
    prefix := 'M';
    floor_num := 2541;
  ELSIF p_gender = 'Female' THEN
    prefix := 'F';
    floor_num := 2517;
  ELSE
    RAISE EXCEPTION 'Invalid gender';
  END IF;

  SELECT COALESCE(
    MAX(
      (regexp_match(reference_number, '^' || prefix || ' (\d+)$'))[1]::integer
    ),
    floor_num
  )
  INTO max_num
  FROM public.profiles
  WHERE reference_number ~ ('^' || prefix || ' \d+$');

  next_num := max_num + 1;

  UPDATE public.profiles
  SET reference_number = prefix || ' ' || next_num::text
  WHERE id = p_profile_id;

  RETURN prefix || ' ' || next_num::text;
END;
$$;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY profiles_select_opposite_active ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      status = 'active'
      AND show_on_register = true
      AND membership_expires_at > now()
      AND EXISTS (
        SELECT 1 FROM public.profiles viewer
        WHERE viewer.auth_user_id = auth.uid()
          AND viewer.status = 'active'
          AND viewer.membership_expires_at > now()
          AND viewer.gender IS DISTINCT FROM profiles.gender
      )
    )
  );

CREATE POLICY profiles_select_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY profiles_update_own_or_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_admin())
  WITH CHECK (auth_user_id = auth.uid() OR public.is_admin());

-- member_private
CREATE POLICY member_private_select ON public.member_private
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  );

CREATE POLICY member_private_insert_own ON public.member_private
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  );

CREATE POLICY member_private_update_admin ON public.member_private
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- requests
CREATE POLICY requests_select ON public.requests
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR requester_id = public.current_profile_id()
  );

CREATE POLICY requests_insert_own ON public.requests
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = public.current_profile_id());

-- feedback (Phase 1: table used; magic links Phase 2)
CREATE POLICY feedback_select ON public.feedback
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR requester_id = public.current_profile_id()
  );

CREATE POLICY feedback_insert_own ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = public.current_profile_id());

-- coupons: admin read only (validation via Edge Function)
CREATE POLICY coupons_admin_all ON public.coupons
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- bookmarks
CREATE POLICY bookmarks_select ON public.bookmarks
  FOR SELECT TO authenticated
  USING (member_id = public.current_profile_id());

CREATE POLICY bookmarks_insert ON public.bookmarks
  FOR INSERT TO authenticated
  WITH CHECK (member_id = public.current_profile_id());

CREATE POLICY bookmarks_delete ON public.bookmarks
  FOR DELETE TO authenticated
  USING (member_id = public.current_profile_id());

-- admin_actions
CREATE POLICY admin_actions_select ON public.admin_actions
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY admin_actions_insert ON public.admin_actions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- email_log
CREATE POLICY email_log_all ON public.email_log
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Storage buckets
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('id-documents', 'id-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
CREATE POLICY profile_photos_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] IN ('Male', 'Female')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY profile_photos_authenticated_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY profile_photos_authenticated_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY id_docs_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'id-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY id_docs_authenticated_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'id-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY id_docs_service_all ON storage.objects
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY profile_photos_service_all ON storage.objects
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Grant usage
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_next_reference_number(uuid, text) TO service_role;
