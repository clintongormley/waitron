CREATE TABLE `convenio_config` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`working_days_per_week` integer DEFAULT 5 NOT NULL,
	`overtime_model` text DEFAULT 'daily_accrual' NOT NULL,
	`reference_period_days` integer,
	`compensation_window_days` integer,
	`daily_target_minutes` integer,
	`max_weekly_minutes` integer DEFAULT 2400 NOT NULL,
	`min_inter_shift_rest_minutes` integer DEFAULT 720 NOT NULL,
	`max_ordinary_daily_minutes` integer DEFAULT 540 NOT NULL,
	`break_threshold_minutes` integer DEFAULT 360 NOT NULL,
	`min_break_minutes` integer DEFAULT 15 NOT NULL,
	`weekly_rest_minutes` integer DEFAULT 2160 NOT NULL,
	`annual_overtime_cap_hours` integer DEFAULT 80 NOT NULL,
	`night_window_start_minute` integer DEFAULT 1320 NOT NULL,
	`night_window_end_minute` integer DEFAULT 360 NOT NULL,
	`night_premium_pct` integer,
	`split_shift_premium` integer,
	`breaks_count_as_worked` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "convenio_config_working_days_ck" CHECK("convenio_config"."working_days_per_week" between 1 and 7),
	CONSTRAINT "convenio_config_overtime_model_ck" CHECK("convenio_config"."overtime_model" in ('daily_accrual', 'period_net'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `convenio_config_location_uq` ON `convenio_config` (`location_id`);