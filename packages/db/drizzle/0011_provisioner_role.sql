-- The provisioning privilege bucket. NOLOGIN, like `app_user` (0001_tenancy_rls.sql): a bucket,
-- not a login. A provisioning tool creates the LOGIN role that is granted membership of it.
--
-- It exists for exactly one grant `app_user` deliberately does not hold: INSERT on `tenants`.
-- 0001 grants `app_user` SELECT only, so the running POS cannot create tenants — only a
-- provisioning connection can. Everything else a new tenant needs (locations, tills,
-- invoice_series, and SELECT on tenants itself) `app_user` already grants, so this bucket is
-- granted `app_user` and INHERITS them rather than carrying a second copy — see the GRANT at the
-- bottom of this file.
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
--
-- The NOINHERIT check has no sibling to mirror; it guards the mechanism the GRANT at the bottom of
-- this file depends on. Postgres records the grant's `inherit_option` from the MEMBER's own
-- `rolinherit` at grant time, so a pre-existing NOINHERIT `tenant_provisioner` takes
-- `GRANT app_user TO tenant_provisioner` with `inherit_option = f` and the chain silently stops
-- there — the bucket keeps its own INSERT on `tenants` and passes none of app_user's grants down.
-- Verified live on PostgreSQL 18.4, with this ELSIF absent: `create role tenant_provisioner nologin
-- noinherit` before the core set, which then applied clean; `pg_auth_members` recorded
-- tenant_provisioner -> app_user with `inherit_option = f` while the login role's own membership
-- read `t`; and as a LOGIN role created `in role tenant_provisioner`, `select count(*) from tenants`
-- failed `permission denied for table tenants` while the tenant INSERT succeeded — a provisioning
-- run gets past `tenants` and dies on the next statement, `permission denied for table locations`.
-- Refusing the role up front is cheaper than diagnosing that.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_provisioner') THEN
    CREATE ROLE tenant_provisioner NOLOGIN NOSUPERUSER;
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
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'tenant_provisioner' AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION
      'tenant_provisioner already exists with NOINHERIT — refusing to reuse it, since the GRANT below would be recorded with inherit_option = f and a login role granted this bucket would insert a tenant and then fail on locations, half-provisioning it';
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO tenant_provisioner;
--> statement-breakpoint

-- Membership of `app_user`, so this bucket inherits SELECT on tenants and the
-- locations/tills/invoice_series grants instead of restating them. Postgres's default INHERIT
-- means a LOGIN role granted THIS bucket alone gets all of them transitively, which is what makes
-- the "member of both" pairing an enforced property of the schema rather than an instruction a
-- future tool or an operator at a psql prompt has to remember.
--
-- Proven on PostgreSQL 18.4, and proven by deletion: with this GRANT in place, a LOGIN role
-- created `in role tenant_provisioner` ALONE (its only direct membership, confirmed via
-- pg_auth_members) both reads and inserts. `revoke app_user from tenant_provisioner` and the same
-- role's read fails "permission denied for table ...". Re-running the GRANT is a NOTICE, not an
-- error, so this stays idempotent against a cluster where a sibling database already applied it.
GRANT app_user TO tenant_provisioner;
--> statement-breakpoint

-- INSERT only, deliberately NOT SELECT alongside it: SELECT arrives through the `app_user`
-- membership above, so a second copy here would be pure redundancy. Changing this grant to
-- `SELECT, INSERT` leaves this file's own test suite green either way — nothing here exercises
-- the difference.
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
