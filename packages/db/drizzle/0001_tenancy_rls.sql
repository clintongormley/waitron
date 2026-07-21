-- The application role. NOLOGIN: it is a privilege bucket, not a login. The
-- cloud deployment's login role is GRANTed membership of it; tests reach it
-- with `set local role app_user`. Idempotent because migrations may run
-- against a cluster where a sibling package already created it.
--
-- The existence check alone is not enough: `IF NOT EXISTS` happily accepts a
-- pre-existing `app_user` that some sibling package or operator created with
-- SUPERUSER or BYPASSRLS, and every GRANT below would then hand table access
-- to a role that bypasses every policy in this migration outright. So a
-- pre-existing role is also required to be NOSUPERUSER NOBYPASSRLS — raising
-- a clear exception rather than silently proceeding if it is not. This runs
-- on every migration application (roles are cluster-global and the test
-- harness creates many databases in one shared container), so it must stay
-- idempotent: a correctly-attributed pre-existing role passes silently.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'app_user' AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION
      'app_user already exists with SUPERUSER or BYPASSRLS — refusing to grant it table access, since that would silently defeat every row-level security policy in this migration';
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint

/*
 * Resolves app.tenant_id to a uuid, or NULL if it is unset, empty, or not a
 * uuid at all.
 *
 * The exception handler is load-bearing. Writing the policy as
 * `tenant_id = current_setting('app.tenant_id', true)::uuid` makes a malformed
 * tenant id RAISE 22P02 instead of matching nothing: an attacker-supplied
 * value would produce a distinguishable error rather than a uniform empty
 * result, and every caller would have to handle a cast failure. Verified: the
 * bare cast raises `invalid input syntax for type uuid` on the injection
 * payload; through this function the same payload returns zero rows.
 *
 * NULLIF is equally load-bearing. A custom GUC that has been set locally is
 * restored to the EMPTY STRING at transaction end, not to unset, so on a
 * pooled connection the second transaction would cast '' and fail.
 *
 * STABLE so the planner evaluates it once per query and can still index-scan
 * on tenant_id. A pinned search_path so the function cannot be captured by a
 * shadowing object in a caller-controlled schema.
 */
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog
AS $$
DECLARE
  v text := nullif(current_setting('app.tenant_id', true), '');
BEGIN
  RETURN v::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
--> statement-breakpoint

-- FORCE applies RLS to the table owner too. It does nothing against a
-- superuser — verified — so it is not the control that matters; it is there so
-- that a deployment which accidentally connects as the migration owner is
-- still isolated.
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tills" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- USING filters what is readable; WITH CHECK filters what is writable. Both,
-- or a tenant can INSERT rows it will never be able to read back.
CREATE POLICY "tenants_tenant_isolation" ON "tenants"
  FOR ALL
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());
--> statement-breakpoint
CREATE POLICY "locations_tenant_isolation" ON "locations"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
CREATE POLICY "tills_tenant_isolation" ON "tills"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- No DELETE is granted anywhere in this plan. A location or till with sales
-- behind it must not be removable, and nothing in the write path deletes.
GRANT SELECT ON "tenants" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "locations" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tills" TO app_user;
