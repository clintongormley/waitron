-- Hand-written (--custom; drizzle-kit does not model tenant-consistent composite FKs — the same reason
-- location_catalogues' FKs are hand-written in 0074). 0077 dropped the original single-column FK
-- `locations.catalogue_id → catalogues(id)` (global, not tenant-scoped): it let a location take ANOTHER
-- tenant's catalogue as its default menu, since PostgreSQL enforces a FK independently of RLS. This adds
-- the tenant-consistent replacement, mirroring location_catalogues.catalogue_id → catalogues(tenant_id,id).
--
-- `catalogue_id` is NULLABLE (a location may have no default menu), so this is MATCH SIMPLE: the FK is
-- skipped when catalogue_id is NULL and enforced when it is set. `catalogues_tenant_id_key`
-- (tenant_id, id) UNIQUE (0073) is the target. No ON DELETE path — catalogues deactivate, never delete.
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_catalogue_fk"
  FOREIGN KEY ("tenant_id", "catalogue_id") REFERENCES "catalogues" ("tenant_id", "id");
