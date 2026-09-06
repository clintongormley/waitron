CREATE TYPE "public"."absence_kind" AS ENUM('holiday', 'sick_leave', 'leave', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."absence_status" AS ENUM('requested', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."roster_version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."shift_swap_status" AS ENUM('requested', 'accepted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."workforce_correction_status" AS ENUM('requested', 'approved');--> statement-breakpoint
CREATE TYPE "public"."workforce_entry_kind" AS ENUM('in', 'out', 'break_start', 'break_end', 'correction');--> statement-breakpoint
CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"absence_kind" "absence_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "absence_status" DEFAULT 'requested' NOT NULL,
	"note" text,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absences_range_ck" CHECK ("absences"."ends_on" >= "absences"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"available_from_minute" integer NOT NULL,
	"available_to_minute" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_weekday_ck" CHECK ("availability"."weekday" between 0 and 6),
	CONSTRAINT "availability_from_minute_ck" CHECK ("availability"."available_from_minute" between 0 and 1440),
	CONSTRAINT "availability_to_minute_ck" CHECK ("availability"."available_to_minute" between 0 and 1440),
	CONSTRAINT "availability_window_ck" CHECK ("availability"."available_to_minute" > "availability"."available_from_minute"),
	CONSTRAINT "availability_effective_ck" CHECK ("availability"."effective_to" is null or "availability"."effective_to" >= "availability"."effective_from")
);
--> statement-breakpoint
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
CREATE TABLE "roster_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_person_id" uuid,
	"status" "roster_version_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_versions_period_ck" CHECK ("roster_versions"."period_end" >= "roster_versions"."period_start"),
	CONSTRAINT "roster_versions_publish_shape_ck" CHECK (("roster_versions"."status" = 'draft') = ("roster_versions"."published_at" is null))
);
--> statement-breakpoint
CREATE TABLE "shift_swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"from_shift_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"to_shift_id" uuid,
	"status" "shift_swap_status" DEFAULT 'requested' NOT NULL,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"label" text NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_minute" integer NOT NULL,
	"ends_minute" integer NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_templates_label_ck" CHECK (length("shift_templates"."label") > 0),
	CONSTRAINT "shift_templates_weekday_ck" CHECK ("shift_templates"."weekday" between 0 and 6),
	CONSTRAINT "shift_templates_starts_minute_ck" CHECK ("shift_templates"."starts_minute" between 0 and 1440),
	CONSTRAINT "shift_templates_ends_minute_ck" CHECK ("shift_templates"."ends_minute" between 0 and 1440)
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"starts_offset_minutes" integer NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ends_offset_minutes" integer NOT NULL,
	"role" text,
	"roster_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_starts_offset_ck" CHECK ("shifts"."starts_offset_minutes" between -840 and 840),
	CONSTRAINT "shifts_ends_offset_ck" CHECK ("shifts"."ends_offset_minutes" between -840 and 840),
	CONSTRAINT "shifts_interval_ck" CHECK ("shifts"."ends_at" > "shifts"."starts_at")
);
--> statement-breakpoint
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
	"corrects_entry_id" uuid,
	"correction_reason" text,
	"correction_status" "workforce_correction_status",
	"correction_actor_id" uuid,
	"entry_hash" text NOT NULL,
	"prev_entry_hash" text,
	"sequence_no" integer NOT NULL,
	"is_first_entry" boolean NOT NULL,
	CONSTRAINT "time_entries_event_offset_ck" CHECK ("time_entries"."event_offset_minutes" between -840 and 840),
	CONSTRAINT "time_entries_correction_shape_ck" CHECK (("time_entries"."corrects_entry_id" is null and "time_entries"."correction_reason" is null
             and "time_entries"."correction_status" is null and "time_entries"."correction_actor_id" is null)
          or ("time_entries"."corrects_entry_id" is not null and "time_entries"."correction_reason" is not null
             and "time_entries"."correction_status" is not null and "time_entries"."correction_actor_id" is not null)),
	CONSTRAINT "time_entries_entry_hash_ck" CHECK ("time_entries"."entry_hash" ~ '^[0-9A-F]{64}$'),
	CONSTRAINT "time_entries_sequence_no_ck" CHECK ("time_entries"."sequence_no" > 0),
	CONSTRAINT "time_entries_chaining_ck" CHECK (("time_entries"."is_first_entry" and "time_entries"."prev_entry_hash" is null)
          or (not "time_entries"."is_first_entry" and "time_entries"."prev_entry_hash" is not null)),
	CONSTRAINT "time_entries_event_at_second_ck" CHECK (date_trunc('second', "time_entries"."event_at") = "time_entries"."event_at")
);
--> statement-breakpoint
CREATE TABLE "workforce_chains" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"sequence_no" integer DEFAULT 0 NOT NULL,
	"last_entry_id" uuid,
	"last_entry_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workforce_chains_tenant_id_location_id_pk" PRIMARY KEY("tenant_id","location_id"),
	CONSTRAINT "workforce_chains_pointer_ck" CHECK (("workforce_chains"."last_entry_id" is null) = ("workforce_chains"."last_entry_hash" is null))
);
--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_decided_by_person_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employments" ADD CONSTRAINT "employments_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_versions" ADD CONSTRAINT "roster_versions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_versions" ADD CONSTRAINT "roster_versions_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_versions" ADD CONSTRAINT "roster_versions_published_by_person_fk" FOREIGN KEY ("published_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_requested_by_person_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_to_person_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_from_shift_fk" FOREIGN KEY ("from_shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_to_shift_fk" FOREIGN KEY ("to_shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_decided_by_person_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_roster_version_fk" FOREIGN KEY ("roster_version_id") REFERENCES "public"."roster_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_captured_by_till_fk" FOREIGN KEY ("captured_by_till_id") REFERENCES "public"."tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_recorded_by_person_fk" FOREIGN KEY ("recorded_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_corrects_entry_fk" FOREIGN KEY ("corrects_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_correction_actor_fk" FOREIGN KEY ("correction_actor_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_chains" ADD CONSTRAINT "workforce_chains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_chains" ADD CONSTRAINT "workforce_chains_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_chains" ADD CONSTRAINT "workforce_chains_last_entry_id_time_entries_id_fk" FOREIGN KEY ("last_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_tenant_id_idx" ON "absences" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "absences_tenant_person_idx" ON "absences" USING btree ("tenant_id","person_id","starts_on");--> statement-breakpoint
CREATE INDEX "availability_tenant_id_idx" ON "availability" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "availability_tenant_person_idx" ON "availability" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "employments_tenant_id_idx" ON "employments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employments_tenant_person_idx" ON "employments" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "roster_versions_tenant_id_idx" ON "roster_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "roster_versions_tenant_location_idx" ON "roster_versions" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_versions_published_period_uq" ON "roster_versions" USING btree ("tenant_id","location_id","period_start","period_end") WHERE "roster_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "shift_swaps_tenant_id_idx" ON "shift_swaps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shift_swaps_tenant_from_shift_idx" ON "shift_swaps" USING btree ("tenant_id","from_shift_id");--> statement-breakpoint
CREATE INDEX "shift_templates_tenant_id_idx" ON "shift_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shift_templates_tenant_location_idx" ON "shift_templates" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE INDEX "shifts_tenant_id_idx" ON "shifts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shifts_tenant_person_starts_idx" ON "shifts" USING btree ("tenant_id","person_id","starts_at");--> statement-breakpoint
CREATE INDEX "shifts_roster_version_idx" ON "shifts" USING btree ("roster_version_id");--> statement-breakpoint
CREATE INDEX "time_entries_tenant_id_idx" ON "time_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "time_entries_tenant_person_event_idx" ON "time_entries" USING btree ("tenant_id","person_id","event_at");--> statement-breakpoint
CREATE INDEX "time_entries_corrects_entry_idx" ON "time_entries" USING btree ("corrects_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_chain_position_uq" ON "time_entries" USING btree ("tenant_id","location_id","sequence_no");