-- Function to auto-promote specific emails to admin on user creation
CREATE OR REPLACE FUNCTION public.auto_promote_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_emails text[] := ARRAY['akashgandhi07@gmail.com', 'mahesh.gandhi@vanikcouncil.uk'];
BEGIN
  IF NEW.email = ANY(admin_emails) THEN
    NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER auto_admin_on_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_promote_admin();
