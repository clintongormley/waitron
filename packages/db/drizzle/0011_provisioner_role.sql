-- The provisioning privilege bucket. NOLOGIN, like `app_user` (0001_tenancy_rls.sql): a bucket,
-- not a login. `waitron-provision instance` creates the LOGIN role that is granted membership of
-- it, and of `app_user` alongside.
--
-- It exists for exactly one grant `app_user` deliberately does not hold: INSERT on `tenants`.
-- 0001 grants `app_user` SELECT only, so the running POS cannot create tenants — only a
-- provisioning connection can. Everything else a new tenant needs (locations, tills,
-- invoice_series, and SELECT on tenants itself) `app_user` already grants, which is why the
-- login role is a member of both rather than this bucket carrying a second copy of those grants.
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
-- behind it. The LOGIN check mirrors the newer `credentials_enumerator` guard
-- (packages/credentials/drizzle/0002_credentials_tenant_seam.sql:27-31): a pre-existing LOGIN role
-- of this name could be authenticated against directly, gaining INSERT on tenants outside the
-- login role this migration expects to gate that grant. Roles are cluster-global and the test
-- harness creates many databases in one shared container, so this must stay idempotent — a
-- correctly-attributed pre-existing role passes silently.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_provisioner') THEN
    CREATE ROLE tenant_provisioner NOLOGIN;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'tenant_provisioner' AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION
      'tenant_provisioner already exists with SUPERUSER or BYPASSRLS — refusing to grant it INSERT on tenants, since that would silently defeat every row-level security policy behind that grant';
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'tenant_provisioner' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'tenant_provisioner already exists with LOGIN — refusing to reuse it, since anyone who could authenticate as it directly would gain INSERT on tenants without going through a login role that also holds app_user';
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO tenant_provisioner;
--> statement-breakpoint

-- INSERT only, deliberately NOT SELECT alongside it: `app_user` already grants SELECT on tenants
-- (0001_tenancy_rls.sql), and the login role this bucket is granted to is always a member of both
-- (see :8-9 above), so a second copy of that grant here would be exactly the redundancy that
-- comment says this design avoids. Changing this grant to `SELECT, INSERT` leaves this file's own
-- test suite green either way — nothing here exercises the difference.
--
-- Recorded because a SELECT here would not have bought a by-NIF existence check regardless, which
-- matters beyond this file: a later plan names "check for an existing tenant by NIF" as its
-- idempotency strategy for a `tenant` command, and that check cannot work as specified. Verified
-- live: `tenants_tenant_isolation`'s USING (id = current_tenant_id()) hides an EXISTING row from
-- `select ... from tenants where nif = ...` under `provisioner_login` with app.tenant_id unset —
-- there is no tenant scope to adopt yet for a lookup that precedes knowing which tenant it would
-- be. A NIF collision surfaces only when it is actually inserted, as 23505 on tenants_nif_key,
-- independent of whether SELECT is granted.
GRANT INSERT ON "tenants" TO tenant_provisioner;
