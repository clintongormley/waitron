CREATE TYPE "public"."workforce_entry_kind" AS ENUM('in', 'out', 'break_start', 'break_end');--> statement-breakpoint
CREATE TABLE "employments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"contracted_minutes_per_week" integer NOT NULL,
	"contract_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"pay_rate" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employments_contracted_minutes_ck" CHECK ("employments"."contracted_minutes_per_week" >= 0),
	CONSTRAINT "employments_dates_ck" CHECK ("employments"."end_date" is null or "employments"."end_date" >= "employments"."start_date")
);
--> statement-breakpoint
ALTER TABLE "employments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"entry_kind" "workforce_entry_kind" NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"event_offset_minutes" integer NOT NULL,
	"captured_by_till_id" uuid,
	"recorded_by_person_id" uuid NOT NULL,
	"ingest_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "time_entries_ingest_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "time_entries_event_offset_ck" CHECK ("time_entries"."event_offset_minutes" between -840 and 840)
);
--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_captured_by_till_fk" FOREIGN KEY ("captured_by_till_id") REFERENCES "public"."tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_recorded_by_person_fk" FOREIGN KEY ("recorded_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employments_tenant_id_idx" ON "employments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employments_tenant_person_idx" ON "employments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "time_entries_tenant_id_idx" ON "time_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "time_entries_tenant_person_event_idx" ON "time_entries" USING btree ("tenant_id","person_id","event_at");