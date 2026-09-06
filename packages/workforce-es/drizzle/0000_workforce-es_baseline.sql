CREATE TYPE "public"."overtime_model" AS ENUM('daily_accrual', 'period_net');--> statement-breakpoint
CREATE TABLE "convenio_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"working_days_per_week" integer DEFAULT 5 NOT NULL,
	"overtime_model" "overtime_model" DEFAULT 'daily_accrual' NOT NULL,
	"reference_period_days" integer,
	"compensation_window_days" integer,
	"daily_target_minutes" integer,
	"max_weekly_minutes" integer DEFAULT 2400 NOT NULL,
	"min_inter_shift_rest_minutes" integer DEFAULT 720 NOT NULL,
	"max_ordinary_daily_minutes" integer DEFAULT 540 NOT NULL,
	"break_threshold_minutes" integer DEFAULT 360 NOT NULL,
	"min_break_minutes" integer DEFAULT 15 NOT NULL,
	"weekly_rest_minutes" integer DEFAULT 2160 NOT NULL,
	"annual_overtime_cap_hours" integer DEFAULT 80 NOT NULL,
	"night_window_start_minute" integer DEFAULT 1320 NOT NULL,
	"night_window_end_minute" integer DEFAULT 360 NOT NULL,
	"night_premium_pct" numeric(5, 2),
	"split_shift_premium" numeric(12, 2),
	"breaks_count_as_worked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "convenio_config_tenant_location_uq" UNIQUE("tenant_id","location_id"),
	CONSTRAINT "convenio_config_working_days_ck" CHECK ("convenio_config"."working_days_per_week" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "convenio_config" ADD CONSTRAINT "convenio_config_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convenio_config" ADD CONSTRAINT "convenio_config_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "convenio_config_tenant_id_idx" ON "convenio_config" USING btree ("tenant_id");