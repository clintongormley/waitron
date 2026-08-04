CREATE TYPE "public"."roster_version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
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
ALTER TABLE "roster_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster_versions" ADD CONSTRAINT "roster_versions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_versions" ADD CONSTRAINT "roster_versions_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_versions" ADD CONSTRAINT "roster_versions_published_by_person_fk" FOREIGN KEY ("published_by_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_roster_version_fk" FOREIGN KEY ("roster_version_id") REFERENCES "public"."roster_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_versions_tenant_id_idx" ON "roster_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "roster_versions_tenant_location_idx" ON "roster_versions" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE INDEX "shifts_tenant_id_idx" ON "shifts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shifts_tenant_person_starts_idx" ON "shifts" USING btree ("tenant_id","person_id","starts_at");--> statement-breakpoint
CREATE INDEX "shifts_roster_version_idx" ON "shifts" USING btree ("roster_version_id");