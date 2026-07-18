ALTER FUNCTION public.handle_new_user()
  SET search_path = public;
ALTER FUNCTION public.update_updated_at()
  SET search_path = public;
ALTER FUNCTION public.check_and_create_match()
  SET search_path = public;
ALTER FUNCTION public.consume_rate_limit(TEXT, TEXT, INTEGER, INTEGER)
  SET search_path = public;
ALTER FUNCTION public.update_discovery_preferences_updated_at()
  SET search_path = public;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_and_create_match() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO service_role;
