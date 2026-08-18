-- Hand-written (--custom): the mutual composite FK between dining_tables and working_orders. Both are
-- declared in Drizzle as BARE columns because a schema-level foreignKey() on each side would make the
-- two schema modules import one another and eagerly reference each other's columns at load time — an
-- import cycle (see packages/db/src/schema/dining-tables.ts). Both tables already exist and both columns
-- are nullable, so the two ALTERs have no create/insert ordering problem (design §2c). No partial-unique
-- and no CHECK: a single nullable tab_id gives one-open-tab-per-table structurally, and openTab's
-- per-table FOR UPDATE lock is the concurrency guard (design §2b, §3a).
--> statement-breakpoint
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_tab_fk"
  FOREIGN KEY ("tenant_id", "tab_id")
  REFERENCES "working_orders" ("tenant_id", "id");--> statement-breakpoint

ALTER TABLE "working_orders"
  ADD CONSTRAINT "working_orders_delivery_table_fk"
  FOREIGN KEY ("tenant_id", "delivery_table_id")
  REFERENCES "dining_tables" ("tenant_id", "id");
