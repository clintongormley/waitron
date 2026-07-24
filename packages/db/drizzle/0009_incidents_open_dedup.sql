-- Hand-written (a --custom migration drizzle-kit will never regenerate): a PARTIAL unique index with
-- NULLS NOT DISTINCT cannot be expressed by drizzle-orm 0.45's schema builder — its index builder has
-- .where() but no .nullsNotDistinct() (that lives only on the non-partial unique-CONSTRAINT builder).
-- So it is added here as raw SQL, exactly the way policies/grants are (0008_incidents_privileges.sql).
-- Because it is not in the drizzle schema snapshot, drizzle-kit does not diff it and will never
-- propose dropping it.
--
-- The table-wide invariant: at most ONE open incident per (tenant, till, code, sale). This is what
-- makes recordIncident / recordIncidentOnce's ON CONFLICT DO NOTHING race-free under a concurrent
-- caller (payments Cycle B's on-device forward). NULLS NOT DISTINCT (PG15+; the server is PG18) makes
-- two orphan declines (sale_id IS NULL) on one till collapse to a single open incident, matching
-- recordIncidentOnce's `sale_id IS NOT DISTINCT FROM` dedup semantics. The partial predicate frees the
-- key once an incident is acknowledged, so a genuinely-recurring condition resurfaces.
CREATE UNIQUE INDEX "incidents_open_dedup"
  ON "incidents" ("tenant_id", "till_id", "code", "sale_id")
  NULLS NOT DISTINCT
  WHERE "acknowledged_at" IS NULL;
