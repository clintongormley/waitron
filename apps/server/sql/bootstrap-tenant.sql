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
-- provisioning role must. The `deployment` stamp INSERT added below is NOT the identical shape,
-- as it first appeared to be: 0010_deployment_stamp.sql grants `app_user` only SELECT on
-- `deployment`, so INSERT on it needs a privilege beyond `app_user` too — but unlike `tenants` as
-- of commit 02c5f5e, no role in this repository grants that one. `tenant_provisioner`
-- (packages/db/drizzle/0011_provisioner_role.sql) grants INSERT on `tenants` only; nothing in
-- either package grants INSERT on `deployment`. Nothing about `deployment` is RLS (it carries
-- none at all; see its own schema comment), so this fails purely on the grant — verified live
-- below, reason 1.
--
-- This file nonetheless keeps the superuser requirement, and not for a psql limitation. An
-- earlier version of this note claimed psql "cannot generate a uuid into a variable before the
-- INSERT that uses it" — that is also false (Copilot, PR #4), and this script already uses
-- `\gset` three times; `select gen_random_uuid() as tid \gset` works and the variable is usable
-- in `set_config` before any INSERT. The real reasons — two independent ones:
--
--   1. No non-superuser role holds INSERT on `deployment` (:19-22 above). This is the script's
--      FIRST statement, so it is also the first thing that fails — the script never reaches
--      `tenants` at all. Verified live: as `provisioner_login` (a LOGIN role in both `app_user`
--      and `tenant_provisioner`), running only that one statement —
--      `insert into deployment (id, environment) values (1, 'production') on conflict (id) do
--      nothing` — fails with "permission denied for table deployment".
--
--   2. This script also lets `tenants.id` DEFAULT rather than choosing it, so there is no id to
--      adopt as the scope. That is this file's choice, changeable in three lines. Verified live:
--      granting INSERT on `deployment` to `tenant_provisioner` by hand (nothing does so today,
--      per (1)) and re-running as `provisioner_login`, the deployment statement then succeeds —
--      but the tenants statement, still with no id chosen and no `app.tenant_id` set, fails with
--      "new row violates row-level security policy for table tenants", not a grant error.
--
-- The two are independent, and fixing only one leaves the script blocked by the other: fixing (2)
-- alone would still die on (1)'s grant failure before ever reaching the RLS check it fixes;
-- fixing (1) alone lands on (2)'s RLS failure instead. Both have to be fixed together before this
-- script can run as anything but a superuser (or a BYPASSRLS role) — which is what the
-- programmatic provisioning path (not this script) does.
--
-- As of commit 02c5f5e, `tenant_provisioner` resolves half of this: it grants INSERT on
-- `tenants`, which nothing did when the proof at :15 above (PR #4, `d3bfb9e`) and :16-18 (PR #5,
-- `4fb3db0`) was written — both predate `tenant_provisioner` and so cannot have used it. That
-- grant does not extend to `deployment`. The distinction matters beyond tidiness: managed
-- Postgres (Neon, Supabase, RDS) grants CREATEDB/CREATEROLE but never true superuser, so
-- "superuser required" would have read as "not deployable there".
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
