-- The provisioning privilege bucket. NOLOGIN, like `app_user` (0001_tenancy_rls.sql): a bucket,
-- not a login. `waitron-provision instance` creates the LOGIN role that is granted membership of
-- it, and of `app_user` alongside.
--
-- It exists for exactly one grant `app_user` deliberately does not hold: INSERT on `tenants`.
-- 0001 grants `app_user` SELECT only, so the running POS cannot create tenants — only a
-- provisioning connection can. Everything else a new tenant needs (locations, tills,
-- invoice_series) `app_user` already grants, which is why the login role is a member of both
-- rather than this bucket carrying a second copy of those grants.
--
-- This removes a PRIVILEGE failure, not a POLICY one. `tenants_tenant_isolation`'s
-- WITH CHECK (id = current_tenant_id()) still applies in full: a provisioning caller must choose
-- the tenant's uuid itself and set app.tenant_id to that value before inserting, adopting the
-- scope of the tenant it is creating. Without the grant the first INSERT fails with
-- "permission denied for table tenants" BEFORE any policy is evaluated, which is what made the
-- old "superuser is required" belief look confirmed.
--
-- The NOSUPERUSER/NOBYPASSRLS assertion mirrors 0001's for `app_user`, for the identical reason: a
-- pre-existing role carrying either attribute would take this grant while bypassing every policy
-- behind it. Roles are cluster-global and the test harness creates many databases in one shared
-- container, so this must stay idempotent — a correctly-attributed pre-existing role passes
-- silently.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_provisioner') THEN
    CREATE ROLE tenant_provisioner NOLOGIN;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'tenant_provisioner' AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION
      'tenant_provisioner already exists with SUPERUSER or BYPASSRLS — refusing to grant it INSERT on tenants, since that would silently defeat every row-level security policy behind that grant';
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO tenant_provisioner;
--> statement-breakpoint

-- SELECT alongside INSERT: `tenant` (the second plan) checks for an existing tenant by NIF before
-- creating one, and a role that can insert but not read cannot be idempotent.
GRANT SELECT, INSERT ON "tenants" TO tenant_provisioner;
