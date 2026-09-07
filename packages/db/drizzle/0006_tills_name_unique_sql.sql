-- A till's name is unique within its venue (device-enrolment §2.2/§9). Enrolling a `till`-form-factor
-- device auto-creates the till's cash register named after the device (`enrolDevice`, apps/server
-- device.ts); this index makes a duplicate register name at one location UNREPRESENTABLE, so the
-- create fails 23505 and the operator renames the device rather than silently ending up with two
-- indistinguishable "Caja 1" registers. `tills` is a `state` table, so a unique index is the whole
-- guard — no reject_mutation trigger (that idiom is for the append-only ledger tables). Hand-written
-- as a --custom migration (snapshot-less): the schema in tenants.ts carries the drizzle-managed
-- `tills_tenant_id_key` / `tills_tenant_id_idx`, and this venue-scoped name uniqueness lives here.
CREATE UNIQUE INDEX "tills_tenant_location_name_key" ON "tills" ("tenant_id", "location_id", "name");
