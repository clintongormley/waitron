-- FORCE ROW LEVEL SECURITY + tenant-isolation policies + app-role grants for the three
-- modifier-authoring tables (`option_groups`, `option_group_items`, `product_option_groups`), plus
-- the tenant-consistent composite FKs for the modifier link columns — all added by 0081.
--
-- 0081 emitted `ENABLE ROW LEVEL SECURITY` from `.enableRLS()` and nothing more — Drizzle does not
-- emit FORCE, CREATE POLICY or GRANT. This hand-written custom migration adds them, exactly as
-- 0027 did for `catalogues`/`categories`/`products` and 0001_tenancy_rls.sql for
-- `tenants`/`locations`/`tills`. The `current_tenant_id()` function and the `app_user` role already
-- exist from 0001 and are NOT recreated here. The fiscal `inmutabilidad` guard scans every
-- `tenant_id`-bearing table for FORCE and fails if any of these lines is missing.
--
-- The GRANT is SELECT, INSERT, UPDATE, DELETE — unlike catalogues/products (no DELETE, they sit
-- behind historical sale-line snapshots), these are discardable AUTHORING data (a modifier group,
-- an item, or a product↔group attachment is genuinely removed while editing a menu), the same
-- regime 0006's `shifts`/`roster_versions` planning tables use. The tenant-consistent FKs cascade,
-- so deleting a group removes its items and its product links.
ALTER TABLE "option_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "option_groups_tenant_isolation" ON "option_groups"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "option_groups" TO app_user;--> statement-breakpoint
ALTER TABLE "option_group_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "option_group_items_tenant_isolation" ON "option_group_items"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "option_group_items" TO app_user;--> statement-breakpoint
ALTER TABLE "product_option_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "product_option_groups_tenant_isolation" ON "product_option_groups"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_option_groups" TO app_user;--> statement-breakpoint

-- The tenant-consistent composite FKs for the modifier link columns added in 0081. They are here,
-- not in the schema, for the same reason kitchen_courses' FKs are in 0058_kds2_courses_fire_rls.sql
-- and sales_corrects_fk is in 0013: drizzle-kit does not emit a SELF-REFERENTIAL composite FK
-- (parent_line_id → the same table), so the two parent_fk constraints must be hand-written; the
-- option-item FK is grouped here because those columns are declared BARE in the schema. No
-- FORCE/policy/grant DDL: parent_line_id and option_group_item_id are ADDITIVE NULLABLE columns on
-- tables that already carry FORCE ROW LEVEL SECURITY + a tenant-isolation policy + app_user grants
-- (working_order_lines from TS-1, sale_lines from 0005), all table-wide, so the new columns are
-- covered with no privilege DDL here. All FKs are MATCH SIMPLE (the default), so a NULL link column
-- skips the check and a top-level line is unaffected.

-- working_order_lines.parent_line_id — the parent DISH line a child MODIFIER line points at. No ON
-- DELETE clause (NO ACTION): the draft is mutable and the pricing pipeline owns removing a dish with
-- its children.
ALTER TABLE "working_order_lines"
  ADD CONSTRAINT "working_order_lines_parent_fk"
  FOREIGN KEY ("tenant_id", "parent_line_id")
  REFERENCES "working_order_lines" ("tenant_id", "id");--> statement-breakpoint

-- working_order_lines.option_group_item_id — authoring TRACEABILITY only. ON DELETE SET NULL (NOT
-- RESTRICT): the option's price/name/VAT are snapshotted onto the line by value, so a catalogue
-- DELETE of an option item must not be blocked and must not strip the line's snapshot columns.
-- The COLUMN LIST `(option_group_item_id)` is load-bearing: a bare SET NULL on a COMPOSITE FK nulls
-- EVERY referencing column incl. tenant_id (NOT NULL) → 23502; the column-list form (PG 15+/PGlite)
-- nulls only option_group_item_id. tenant_id must NOT be in the list — it keeps the FK tenant-consistent.
ALTER TABLE "working_order_lines"
  ADD CONSTRAINT "working_order_lines_option_item_fk"
  FOREIGN KEY ("tenant_id", "option_group_item_id")
  REFERENCES "option_group_items" ("tenant_id", "id")
  ON DELETE SET NULL ("option_group_item_id");--> statement-breakpoint

-- sale_lines.parent_line_id — the filed MODIFIER child line's link to its dish. sale_lines is
-- immutable/append-only, so no ON DELETE path is reachable. This link is presentation metadata and
-- NEVER reaches the huella (the fiscal record is built from total + vat_breakdown).
ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_parent_fk"
  FOREIGN KEY ("tenant_id", "parent_line_id")
  REFERENCES "sale_lines" ("tenant_id", "id");
