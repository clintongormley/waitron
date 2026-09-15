CREATE OR REPLACE FUNCTION credential_tenants(p_purpose text)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT id
  FROM tenants
  WHERE EXISTS (SELECT 1 FROM tenant_credentials WHERE purpose = p_purpose)
  ORDER BY id
$$;
