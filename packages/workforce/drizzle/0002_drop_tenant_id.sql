ALTER TABLE "absences" DROP CONSTRAINT "absences_tenant_fk";
--> statement-breakpoint
ALTER TABLE "availability" DROP CONSTRAINT "availability_tenant_fk";
--> statement-breakpoint
ALTER TABLE "employments" DROP CONSTRAINT "employments_tenant_fk";
--> statement-breakpoint
ALTER TABLE "roster_versions" DROP CONSTRAINT "roster_versions_tenant_fk";
--> statement-breakpoint
ALTER TABLE "shift_swaps" DROP CONSTRAINT "shift_swaps_tenant_fk";
--> statement-breakpoint
ALTER TABLE "shift_templates" DROP CONSTRAINT "shift_templates_tenant_fk";
--> statement-breakpoint
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_tenant_fk";
--> statement-breakpoint
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_tenant_fk";
--> statement-breakpoint
ALTER TABLE "workforce_chains" DROP CONSTRAINT "workforce_chains_tenant_id_tenants_id_fk";
--> statement-breakpoint
DROP INDEX "absences_tenant_id_idx";--> statement-breakpoint
DROP INDEX "absences_tenant_person_idx";--> statement-breakpoint
DROP INDEX "availability_tenant_id_idx";--> statement-breakpoint
DROP INDEX "availability_tenant_person_idx";--> statement-breakpoint
DROP INDEX "employments_tenant_id_idx";--> statement-breakpoint
DROP INDEX "employments_tenant_person_idx";--> statement-breakpoint
DROP INDEX "roster_versions_tenant_id_idx";--> statement-breakpoint
DROP INDEX "roster_versions_tenant_location_idx";--> statement-breakpoint
DROP INDEX "shift_swaps_tenant_id_idx";--> statement-breakpoint
DROP INDEX "shift_swaps_tenant_from_shift_idx";--> statement-breakpoint
DROP INDEX "shift_templates_tenant_id_idx";--> statement-breakpoint
DROP INDEX "shift_templates_tenant_location_idx";--> statement-breakpoint
DROP INDEX "shifts_tenant_id_idx";--> statement-breakpoint
DROP INDEX "shifts_tenant_person_starts_idx";--> statement-breakpoint
DROP INDEX "time_entries_tenant_id_idx";--> statement-breakpoint
DROP INDEX "time_entries_tenant_person_event_idx";--> statement-breakpoint
DROP INDEX "roster_versions_published_period_uq";--> statement-breakpoint
DROP INDEX "time_entries_chain_position_uq";--> statement-breakpoint
ALTER TABLE "workforce_chains" DROP CONSTRAINT "workforce_chains_tenant_id_node_id_location_id_pk";--> statement-breakpoint
ALTER TABLE "workforce_chains" ADD CONSTRAINT "workforce_chains_node_id_location_id_pk" PRIMARY KEY("node_id","location_id");--> statement-breakpoint
CREATE INDEX "absences_person_idx" ON "absences" USING btree ("person_id","starts_on");--> statement-breakpoint
CREATE INDEX "availability_person_idx" ON "availability" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "employments_person_idx" ON "employments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "roster_versions_location_idx" ON "roster_versions" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "shift_swaps_from_shift_idx" ON "shift_swaps" USING btree ("from_shift_id");--> statement-breakpoint
CREATE INDEX "shift_templates_location_idx" ON "shift_templates" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "shifts_person_starts_idx" ON "shifts" USING btree ("person_id","starts_at");--> statement-breakpoint
CREATE INDEX "time_entries_person_event_idx" ON "time_entries" USING btree ("person_id","event_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_versions_published_period_uq" ON "roster_versions" USING btree ("location_id","period_start","period_end") WHERE "roster_versions"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_chain_position_uq" ON "time_entries" USING btree ("node_id","location_id","sequence_no");--> statement-breakpoint
ALTER TABLE "absences" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "availability" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "employments" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "roster_versions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "shift_swaps" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "shift_templates" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "shifts" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "time_entries" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "workforce_chains" DROP COLUMN "tenant_id";