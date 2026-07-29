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
-- `rolbypassrls = f`: all four inserts below succeed. The only privilege needed beyond `app_user`
-- membership is INSERT on `tenants`, which `app_user` deliberately does not hold (0001 grants it
-- SELECT only) — so the deployment role cannot create tenants, and a provisioning role must.
--
-- This file nonetheless keeps the superuser requirement, for two reasons, NEITHER of which is a
-- psql limitation. An earlier version of this note claimed psql "cannot generate a uuid into a
-- variable before the INSERT that uses it" — that is also false (Copilot, PR #4), and this script
-- already uses `\gset` three times; `select gen_random_uuid() as tid \gset` works and the variable
-- is usable in `set_config` before any INSERT. The real reasons:
--
--   1. This script lets `tenants.id` DEFAULT rather than choosing it, so there is no id to adopt as
--      the scope. That is this file's choice, changeable in three lines.
--   2. No non-superuser role in this repository holds INSERT on `tenants` today. Fixing (1) alone
--      would just move the failure from the RLS check to the grant.
--
-- So the rewrite only pays off together with a provisioning role that holds that grant, which is
-- what the programmatic provisioning path introduces. The distinction matters beyond tidiness:
-- managed Postgres (Neon, Supabase, RDS) grants CREATEDB/CREATEROLE but never true superuser, so
-- "superuser required" would have read as "not deployable there".
--
-- Deliberately NOT the test seeds: packages/db/src/testing/seed.ts writes 'Test SL' and a NIF from
-- a counter. Those values would become part of a fiscal record the Agencia Tributaria keeps.
--
-- Usage:
--   psql "$DATABASE_URL" \
--     -v nif="B12345678" -v legal_name="Deli SL" -v location_name="Mostrador" \
--     -v operation_description="Venta en establecimiento" -v till_name="Caja 1" \
--     -v series_code="A" -v locale="es-ES" \
--     -f apps/server/sql/bootstrap-tenant.sql
\set ON_ERROR_STOP on

begin;

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
