REVOKE ALL ON "tenant_credentials" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_credentials" TO app_user;
--> statement-breakpoint
CREATE FUNCTION credential_tenants(p_purpose text)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT tenant_id
  FROM tenant_credentials
  WHERE purpose = p_purpose
  ORDER BY tenant_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION credential_tenants(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION credential_tenants(text) TO app_user;
