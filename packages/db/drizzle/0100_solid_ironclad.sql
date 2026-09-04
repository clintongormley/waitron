-- Structural rename layout_profiles → canvases (SP-B3.2 Phase A). drizzle-kit generated the table +
-- column renames; the three constraint statements it emitted as DROP+ADD were rewritten to RENAME
-- CONSTRAINT here because layout_profiles_tenant_id_key is the (tenant_id, id) UNIQUE that the two
-- composite FKs from 0095 (devices_layout_profile_fk, device_pairing_codes_layout_profile_fk) depend
-- on — DROPping it errors ("cannot drop ... other objects depend on it"). RENAME reaches the identical
-- end state the generated 0100 snapshot records (same constraint names + definitions) without severing
-- the FK dependency. The policy, FORCE RLS, grants and the composite FKs all survive the table rename;
-- their name changes are in the paired --custom migration 0101.
ALTER TABLE "layout_profiles" RENAME TO "canvases";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" RENAME COLUMN "layout_profile_id" TO "canvas_id";--> statement-breakpoint
ALTER TABLE "devices" RENAME COLUMN "layout_profile_id" TO "canvas_id";--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "layout_profiles_tenant_id_key" TO "canvases_tenant_id_key";--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "layout_profiles_tenant_name_key" TO "canvases_tenant_name_key";--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "layout_profiles_tenant_id_tenants_id_fk" TO "canvases_tenant_id_tenants_id_fk";
