-- Rename the RLS + FK objects that rode along with the layout_profiles → canvases table rename
-- (SP-B3.2 Phase A). This is the paired --custom migration for 0101; drizzle-kit emits none of FORCE,
-- CREATE/ALTER POLICY, GRANT or the composite bare-column FKs, so they are hand-written here.
--
-- Because 0101 RENAMEd the table (rather than dropping and recreating it), the tenant-isolation policy,
-- FORCE ROW LEVEL SECURITY, the app_user grant (all from 0089) and the two composite FKs (from 0095)
-- ALL SURVIVED the rename — they are attached to the same table object, now named "canvases". So this
-- migration only updates their NAMES to match the token map, and re-asserts FORCE + the app_user grant
-- defensively (idempotent) so the canvases RLS posture is explicit in Phase A. This is why the policy
-- is ALTER ... RENAMEd, NOT CREATEd as in 0089: the layout_profiles_tenant_isolation policy still
-- exists on the renamed table, and a fresh CREATE would leave two overlapping FOR ALL policies.
--
-- FORCE isolates the table owner too (inmutabilidad asserts relforcerowsecurity on every
-- tenant_id-bearing table). REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the
-- targeted grant. Canvases are mutable AND deletable config — the editor creates, edits and removes
-- named canvases — so app_user holds SELECT, INSERT, UPDATE, DELETE.
ALTER TABLE "canvases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER POLICY "layout_profiles_tenant_isolation" ON "canvases" RENAME TO "canvases_tenant_isolation";--> statement-breakpoint
REVOKE ALL ON "canvases" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "canvases" TO app_user;--> statement-breakpoint
ALTER TABLE "devices" RENAME CONSTRAINT "devices_layout_profile_fk" TO "devices_canvas_fk";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" RENAME CONSTRAINT "device_pairing_codes_layout_profile_fk" TO "device_pairing_codes_canvas_fk";
