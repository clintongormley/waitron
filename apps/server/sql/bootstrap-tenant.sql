-- The deli's own rows. Run ONCE, by hand, against a migrated database, as a role that can write
-- these tables (the migration owner or a superuser — RLS is bypassed for the owner, which is what
-- makes this pure setup).
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
