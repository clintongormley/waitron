CREATE TYPE "public"."absence_kind" AS ENUM('holiday', 'sick_leave', 'leave', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."absence_status" AS ENUM('requested', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."shift_swap_status" AS ENUM('requested', 'accepted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"absence_kind" "absence_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "absence_status" DEFAULT 'requested' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absences_range_ck" CHECK ("absences"."ends_on" >= "absences"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "absences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"from_shift_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"to_shift_id" uuid,
	"status" "shift_swap_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_swaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "shift_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_requested_by_person_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_to_person_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_from_shift_fk" FOREIGN KEY ("from_shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_to_shift_fk" FOREIGN KEY ("to_shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_tenant_id_idx" ON "absences" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "absences_tenant_person_idx" ON "absences" USING btree ("tenant_id","person_id","starts_on");--> statement-breakpoint
CREATE INDEX "availability_tenant_id_idx" ON "availability" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "availability_tenant_person_idx" ON "availability" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "shift_swaps_tenant_id_idx" ON "shift_swaps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shift_swaps_tenant_from_shift_idx" ON "shift_swaps" USING btree ("tenant_id","from_shift_id");--> statement-breakpoint
CREATE INDEX "shift_templates_tenant_id_idx" ON "shift_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shift_templates_tenant_location_idx" ON "shift_templates" USING btree ("tenant_id","location_id");