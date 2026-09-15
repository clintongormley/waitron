-- Custom SQL migration file, put your code below! --
REVOKE ALL ON "tenant_credentials" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_credentials" TO app_user;
--> statement-breakpoint
-- Which taxpayers to serve for a purpose: the database's one taxpayer when a credential for that
-- purpose is provisioned, and none when it is not. `tenants.id` is the integer 1, so the return
-- type is `integer` and not the `uuid` this function returned before the taxpayer row became a
-- singleton. Invoker rights, and the caller's own grants, exactly as before.
CREATE FUNCTION credential_tenants(p_purpose text)
  RETURNS SETOF integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT id
  FROM tenants
  WHERE EXISTS (SELECT 1 FROM tenant_credentials WHERE purpose = p_purpose)
  ORDER BY id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION credential_tenants(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION credential_tenants(text) TO app_user;
