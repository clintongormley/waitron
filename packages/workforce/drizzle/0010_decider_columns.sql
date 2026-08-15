ALTER TABLE "absences" ADD COLUMN "decided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "absences" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD COLUMN "decided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_decided_by_person_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_decided_by_person_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;