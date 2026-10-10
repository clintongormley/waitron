CREATE TABLE `floor_plan_join_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`join_id` text NOT NULL,
	`plan_table_id` text NOT NULL,
	FOREIGN KEY (`join_id`) REFERENCES `floor_plan_joins`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_join_tables_join_table_key` ON `floor_plan_join_tables` (`join_id`,`plan_table_id`);--> statement-breakpoint
CREATE TABLE `floor_plan_joins` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`seats` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `floor_plans`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_joins_seats_ck" CHECK("floor_plan_joins"."seats" >= 1)
);
--> statement-breakpoint
CREATE TABLE `floor_plan_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`label` text NOT NULL,
	`seats` integer,
	`fixed` integer DEFAULT false NOT NULL,
	`x` integer,
	`y` integer,
	`width` integer,
	`height` integer,
	`shape` text,
	`rotation` integer,
	FOREIGN KEY (`plan_id`) REFERENCES `floor_plans`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_tables_seats_ck" CHECK("floor_plan_tables"."seats" is null or "floor_plan_tables"."seats" between 0 and 999),
	CONSTRAINT "floor_plan_tables_x_ck" CHECK("floor_plan_tables"."x" is null or "floor_plan_tables"."x" between 0 and 999),
	CONSTRAINT "floor_plan_tables_y_ck" CHECK("floor_plan_tables"."y" is null or "floor_plan_tables"."y" between 0 and 999),
	CONSTRAINT "floor_plan_tables_width_ck" CHECK("floor_plan_tables"."width" is null or "floor_plan_tables"."width" between 1 and 99),
	CONSTRAINT "floor_plan_tables_height_ck" CHECK("floor_plan_tables"."height" is null or "floor_plan_tables"."height" between 1 and 99),
	CONSTRAINT "floor_plan_tables_rotation_ck" CHECK("floor_plan_tables"."rotation" is null or ("floor_plan_tables"."rotation" between 0 and 345 and "floor_plan_tables"."rotation" % 15 = 0)),
	CONSTRAINT "floor_plan_tables_shape_ck" CHECK("floor_plan_tables"."shape" in ('rect', 'round')),
	CONSTRAINT "floor_plan_tables_placement_ck" CHECK(("floor_plan_tables"."x" is null and "floor_plan_tables"."y" is null and "floor_plan_tables"."width" is null and "floor_plan_tables"."height" is null and "floor_plan_tables"."shape" is null and "floor_plan_tables"."rotation" is null) or ("floor_plan_tables"."x" is not null and "floor_plan_tables"."y" is not null and "floor_plan_tables"."width" is not null and "floor_plan_tables"."height" is not null and "floor_plan_tables"."shape" is not null and "floor_plan_tables"."rotation" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_tables_plan_label_key` ON `floor_plan_tables` (`plan_id`,`label`);--> statement-breakpoint
CREATE TABLE `floor_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plans_zone_key` ON `floor_plans` (`zone_id`);--> statement-breakpoint
CREATE TABLE `floor_reset_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`table_id` text,
	`label` text NOT NULL,
	`seats` integer,
	`fixed` integer DEFAULT false NOT NULL,
	`x` integer,
	`y` integer,
	`width` integer,
	`height` integer,
	`shape` text,
	`rotation` integer,
	`remove` integer DEFAULT false NOT NULL,
	`pending` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_reset_tables_seats_ck" CHECK("floor_reset_tables"."seats" is null or "floor_reset_tables"."seats" between 0 and 999),
	CONSTRAINT "floor_reset_tables_x_ck" CHECK("floor_reset_tables"."x" is null or "floor_reset_tables"."x" between 0 and 999),
	CONSTRAINT "floor_reset_tables_y_ck" CHECK("floor_reset_tables"."y" is null or "floor_reset_tables"."y" between 0 and 999),
	CONSTRAINT "floor_reset_tables_width_ck" CHECK("floor_reset_tables"."width" is null or "floor_reset_tables"."width" between 1 and 99),
	CONSTRAINT "floor_reset_tables_height_ck" CHECK("floor_reset_tables"."height" is null or "floor_reset_tables"."height" between 1 and 99),
	CONSTRAINT "floor_reset_tables_rotation_ck" CHECK("floor_reset_tables"."rotation" is null or ("floor_reset_tables"."rotation" between 0 and 345 and "floor_reset_tables"."rotation" % 15 = 0)),
	CONSTRAINT "floor_reset_tables_shape_ck" CHECK("floor_reset_tables"."shape" in ('rect', 'round')),
	CONSTRAINT "floor_reset_tables_placement_ck" CHECK(("floor_reset_tables"."x" is null and "floor_reset_tables"."y" is null and "floor_reset_tables"."width" is null and "floor_reset_tables"."height" is null and "floor_reset_tables"."shape" is null and "floor_reset_tables"."rotation" is null) or ("floor_reset_tables"."x" is not null and "floor_reset_tables"."y" is not null and "floor_reset_tables"."width" is not null and "floor_reset_tables"."height" is not null and "floor_reset_tables"."shape" is not null and "floor_reset_tables"."rotation" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_reset_tables_table_key` ON `floor_reset_tables` (`table_id`);--> statement-breakpoint
CREATE TABLE `floor_today_join_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`join_id` text NOT NULL,
	`table_id` text NOT NULL,
	`before_x` integer NOT NULL,
	`before_y` integer NOT NULL,
	`before_rotation` integer NOT NULL,
	FOREIGN KEY (`join_id`) REFERENCES `floor_today_joins`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_today_join_tables_before_x_ck" CHECK("floor_today_join_tables"."before_x" is null or "floor_today_join_tables"."before_x" between 0 and 999),
	CONSTRAINT "floor_today_join_tables_before_y_ck" CHECK("floor_today_join_tables"."before_y" is null or "floor_today_join_tables"."before_y" between 0 and 999),
	CONSTRAINT "floor_today_join_tables_before_rotation_ck" CHECK("floor_today_join_tables"."before_rotation" is null or ("floor_today_join_tables"."before_rotation" between 0 and 345 and "floor_today_join_tables"."before_rotation" % 15 = 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_today_join_tables_table_key` ON `floor_today_join_tables` (`table_id`);--> statement-breakpoint
CREATE TABLE `floor_today_joins` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`seats` integer NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_today_joins_seats_ck" CHECK("floor_today_joins"."seats" >= 1)
);
--> statement-breakpoint
CREATE TABLE `floor_today_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`seats` integer,
	`fixed` integer DEFAULT false NOT NULL,
	`x` integer,
	`y` integer,
	`width` integer,
	`height` integer,
	`shape` text,
	`rotation` integer,
	`taken_off` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_today_tables_seats_ck" CHECK("floor_today_tables"."seats" is null or "floor_today_tables"."seats" between 0 and 999),
	CONSTRAINT "floor_today_tables_x_ck" CHECK("floor_today_tables"."x" is null or "floor_today_tables"."x" between 0 and 999),
	CONSTRAINT "floor_today_tables_y_ck" CHECK("floor_today_tables"."y" is null or "floor_today_tables"."y" between 0 and 999),
	CONSTRAINT "floor_today_tables_width_ck" CHECK("floor_today_tables"."width" is null or "floor_today_tables"."width" between 1 and 99),
	CONSTRAINT "floor_today_tables_height_ck" CHECK("floor_today_tables"."height" is null or "floor_today_tables"."height" between 1 and 99),
	CONSTRAINT "floor_today_tables_rotation_ck" CHECK("floor_today_tables"."rotation" is null or ("floor_today_tables"."rotation" between 0 and 345 and "floor_today_tables"."rotation" % 15 = 0)),
	CONSTRAINT "floor_today_tables_shape_ck" CHECK("floor_today_tables"."shape" in ('rect', 'round')),
	CONSTRAINT "floor_today_tables_placement_ck" CHECK(("floor_today_tables"."x" is null and "floor_today_tables"."y" is null and "floor_today_tables"."width" is null and "floor_today_tables"."height" is null and "floor_today_tables"."shape" is null and "floor_today_tables"."rotation" is null) or ("floor_today_tables"."x" is not null and "floor_today_tables"."y" is not null and "floor_today_tables"."width" is not null and "floor_today_tables"."height" is not null and "floor_today_tables"."shape" is not null and "floor_today_tables"."rotation" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_today_tables_table_key` ON `floor_today_tables` (`table_id`);--> statement-breakpoint
CREATE TABLE `floor_today_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`business_day` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_today_zones_zone_key` ON `floor_today_zones` (`zone_id`);--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `plan_table_id` text REFERENCES floor_plan_tables(id);--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `planned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `parties` ADD `table_names` text;