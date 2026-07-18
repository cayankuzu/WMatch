CREATE OR REPLACE FUNCTION public.check_email_availability(p_email TEXT)
RETURNS TABLE (
  email_available BOOLEAN,
  email_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_email TEXT := lower(trim(p_email));
BEGIN
  IF normalized_email IS NULL OR normalized_email = '' THEN
    RETURN QUERY
    SELECT FALSE, 'E-posta adresi gerekli.';
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM auth.users
      WHERE lower(coalesce(email, '')) = normalized_email
    ) AS email_available,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM auth.users
        WHERE lower(coalesce(email, '')) = normalized_email
      ) THEN 'Bu e-posta zaten kullanılıyor.'
      ELSE NULL
    END AS email_message;
END;
$$;
REVOKE ALL ON FUNCTION public.check_email_availability(TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.check_email_availability(TEXT) TO anon, authenticated, service_role;
