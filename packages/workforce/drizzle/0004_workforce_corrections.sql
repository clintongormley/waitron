CREATE TYPE "public"."workforce_correction_status" AS ENUM('requested', 'approved');--> statement-breakpoint
ALTER TYPE "public"."workforce_entry_kind" ADD VALUE 'correction';--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "corrects_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "correction_status" "workforce_correction_status";--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "correction_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_corrects_entry_fk" FOREIGN KEY ("corrects_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_correction_actor_fk" FOREIGN KEY ("correction_actor_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_corrects_entry_idx" ON "time_entries" USING btree ("corrects_entry_id");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_correction_shape_ck" CHECK (("time_entries"."corrects_entry_id" is null and "time_entries"."correction_reason" is null
             and "time_entries"."correction_status" is null and "time_entries"."correction_actor_id" is null)
          or ("time_entries"."corrects_entry_id" is not null and "time_entries"."correction_reason" is not null
             and "time_entries"."correction_status" is not null and "time_entries"."correction_actor_id" is not null));