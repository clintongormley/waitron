-- The deli's own rows. Run ONCE, by hand, against a migrated database, as a SUPERUSER (or a role
-- with BYPASSRLS) — not merely as the table owner. packages/db/drizzle/0001_tenancy_rls.sql (and
-- 0003_invoice_series.sql for invoice_series) apply FORCE ROW LEVEL SECURITY to every table this
-- script writes, which denies the owner its usual RLS exemption.
--
-- That is a property of THIS FILE's approach, not a property of the schema. An earlier version of
-- this header claimed superuser was unavoidable, on the grounds that "the first INSERT creates the
-- very tenant whose id app.tenant_id would need to be set to — there is no tenant scope yet to
-- adopt". That is false, and the error was letting the DATABASE choose the id: `tenants.id` merely
-- DEFAULTS to gen_random_uuid(), and `tenants_tenant_isolation` is
-- `WITH CHECK (id = current_tenant_id())`. A caller that picks the uuid itself, sets
-- `app.tenant_id` to it, and then inserts that id satisfies the check — it adopts the scope of the
-- tenant it is about to create, and there is no circularity.
--
-- Proven on PostgreSQL 18 against the real migrations, as a LOGIN role with `rolsuper = f` and
-- `rolbypassrls = f`: the four tenant-scoped inserts below succeed. The only privilege needed
-- beyond `app_user` membership is INSERT on `tenants`, which `app_user` deliberately does not
-- hold (0001 grants it SELECT only) — so the deployment role cannot create tenants, and a
-- provisioning role must.
--
-- This file nonetheless keeps the superuser requirement, and not for a psql limitation. An
-- earlier version of this note claimed psql "cannot generate a uuid into a variable before the
-- INSERT that uses it" — that is also false (Copilot, PR #4), and this script already uses `\gset`
-- four times below, one per `returning id` clause (:104, :108, :112, :116 — counted, not recalled;
-- the note this replaces said three); `select gen_random_uuid() as tid \gset` works and the
-- variable is usable in `set_config` before any INSERT.
--
-- THE REASON, and there is only one. This script lets `tenants.id` DEFAULT rather than choosing it,
-- so there is no id to set `app.tenant_id` to and no scope to adopt before the INSERT that needs
-- one. `tenants_tenant_isolation`'s WITH CHECK (id = current_tenant_id()) therefore refuses the
-- row — and because 0001 applies FORCE ROW LEVEL SECURITY, it refuses it for the TABLE OWNER too,
-- which is why the header above says superuser or BYPASSRLS rather than "the owner is enough".
-- Verified live on PostgreSQL 18.4 against the real migrations, running THIS file with psql as a
-- LOGIN role with `rolsuper = f` and `rolbypassrls = f` that OWNS all 12 public tables: the
-- `deployment` statement reported `INSERT 0 1` and the `tenants` statement then failed with
-- `ERROR:  new row violates row-level security policy for table "tenants"`.
--
-- That one thing is also the whole fix. The SAME owner role, running a copy of this script whose
-- only change is `select gen_random_uuid() as tid \gset` and
-- `select set_config('app.tenant_id', :'tid', true)` ahead of an explicit `id` in the `tenants`
-- INSERT, ran every statement in the file — the `deployment` stamp included — and COMMITted.
-- Changeable in three lines; not a property of the schema.
--
-- WHAT THE `deployment` STAMP REQUIRES, since an earlier version of this note got it wrong twice
-- over. It claimed "no non-superuser role holds INSERT on `deployment`", and made that a SECOND,
-- independent blocker that had to be fixed together with the RLS one. Both halves are false, and
-- the shape of the role is what the claim was missing:
--
--   * A MERE GRANTEE really is blocked here, and it is the script's FIRST statement, so it never
--     reaches `tenants` at all. No migration in this repository GRANTs INSERT on `deployment` to
--     anything — 0010_deployment_stamp.sql grants `app_user` SELECT only, and `tenant_provisioner`
--     (packages/db/drizzle/0011_provisioner_role.sql) grants INSERT on `tenants` alone. Verified
--     live on 18.4: as a LOGIN role holding `app_user` + `tenant_provisioner` membership and
--     owning nothing, this file fails on its `insert into deployment` (:98) with
--     `ERROR:  permission denied for table deployment`.
--
--   * THE TABLE OWNER is not. Ownership carries INSERT implicitly, with no GRANT involved — and
--     unlike every other table this script writes, `deployment` carries no row-level security at
--     all (`relrowsecurity = f`, `relforcerowsecurity = f`, confirmed on the migrated database;
--     see 0010's own schema comment for why), so there is no FORCE RLS to strip the owner of its
--     usual exemption either. The `INSERT 0 1` in the owner run above is that receipt, from a
--     role with `rolsuper = f` and `rolbypassrls = f`.
--
-- So which statement stops you depends on the role you use: a mere grantee stops at `deployment`,
-- the table owner gets past it and stops at `tenants`, and only superuser or BYPASSRLS gets
-- through the file AS WRITTEN. The programmatic provisioning path (not this script) picks the uuid
-- itself and so needs neither.
--
-- Two of the receipts above this line predate the role they now sit beside, so read them in order:
-- the `\gset` correction is PR #4 (`d3bfb9e`) and the `app_user`-holds-SELECT-only finding is
-- PR #5 (`4fb3db0`), both written before `tenant_provisioner` existed (`02c5f5e`) and so neither
-- used it. Keeping the requirement narrow matters beyond tidiness: managed Postgres (Neon,
-- Supabase, RDS) grants CREATEDB/CREATEROLE but never true superuser, so a blanket "superuser
-- required" would have read as "not deployable there".
--
-- Deliberately NOT the test seeds: packages/db/src/testing/seed.ts writes 'Test SL' and a NIF from
-- a counter. Those values would become part of a fiscal record the Agencia Tributaria keeps.
--
-- Usage:
--   psql "$DATABASE_URL" \
--     -v nif="B12345678" -v legal_name="Deli SL" -v location_name="Mostrador" \
--     -v operation_description="Venta en establecimiento" -v till_name="Caja 1" \
--     -v series_code="A" -v locale="es-ES" -v environment="production" \
--     -f apps/server/sql/bootstrap-tenant.sql
--
-- `environment` must be "production" or "preproduction" — the SAME value this database's
-- `WAITRON_ENV` is (or will be) set to. It stamps the `deployment` table's one singleton row via
-- `on conflict (id) do nothing`, which makes this INSERT safe to re-run for a SECOND (or Nth)
-- tenant bootstrapped against an ALREADY-STAMPED database: the first tenant's value wins and this
-- statement becomes a no-op. That silence cuts both ways — this does NOT detect or refuse a
-- DISAGREEING `environment` argument against an already-stamped database; it simply keeps the
-- first stamp and says nothing. Passing the wrong value here for a second tenant does not corrupt
-- anything (the stamp itself does not change), but it also gets no error telling you so.
\set ON_ERROR_STOP on

begin;

insert into deployment (id, environment)
values (1, :'environment')
on conflict (id) do nothing;

insert into tenants (nif, legal_name)
values (:'nif', :'legal_name')
returning id as tenant_id \gset

insert into locations (tenant_id, name, invoice_locales, operation_description)
values (:'tenant_id', :'location_name', array[:'locale'], :'operation_description')
returning id as location_id \gset

insert into tills (tenant_id, location_id, name)
values (:'tenant_id', :'location_id', :'till_name')
returning id as till_id \gset

insert into invoice_series (tenant_id, till_id, code)
values (:'tenant_id', :'till_id', :'series_code')
returning id as series_id \gset

commit;

\echo 'tenant_id:' :tenant_id
\echo 'till_id:  ' :till_id
\echo 'series_id:' :series_id
