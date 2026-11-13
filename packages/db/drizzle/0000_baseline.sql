CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`person_id` text,
	`device_id` text,
	`data` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `activity_log_subject_idx` ON `activity_log` (`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `activity_log_kind_at_idx` ON `activity_log` (`kind`,`at`);--> statement-breakpoint
CREATE INDEX `activity_log_at_idx` ON `activity_log` (`at`);--> statement-breakpoint
CREATE INDEX `activity_log_person_at_idx` ON `activity_log` (`person_id`,`at`);--> statement-breakpoint
CREATE TABLE `day_cutover_changes` (
	`effective_business_day` text PRIMARY KEY NOT NULL,
	`day_cutover` text NOT NULL,
	CONSTRAINT "day_cutover_changes_date_ck" CHECK(length("day_cutover_changes"."effective_business_day") = 10 and "day_cutover_changes"."effective_business_day" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "day_cutover_changes_time_ck" CHECK(length("day_cutover_changes"."day_cutover") = 8 and "day_cutover_changes"."day_cutover" glob '[0-2][0-9]:[0-5][0-9]:00' and substr("day_cutover_changes"."day_cutover", 1, 2) <= '23')
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`module` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`revision` integer NOT NULL,
	`doc` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "settings_module_ck" CHECK("settings"."module" glob '[a-z]*' and "settings"."module" not glob '*[^a-z0-9_]*'),
	CONSTRAINT "settings_version_ck" CHECK("settings"."version" >= 1),
	CONSTRAINT "settings_revision_ck" CHECK("settings"."revision" >= 1),
	CONSTRAINT "settings_doc_ck" CHECK(case when json_valid("settings"."doc") then json_type("settings"."doc") = 'object' else 0 end)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`bump_mode` text DEFAULT 'line' NOT NULL,
	`fire_control` text DEFAULT 'waiter' NOT NULL,
	CONSTRAINT "locations_bump_mode_ck" CHECK("locations"."bump_mode" in ('line', 'ticket')),
	CONSTRAINT "locations_fire_control_ck" CHECK("locations"."fire_control" in ('waiter', 'kitchen', 'expo'))
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` integer PRIMARY KEY NOT NULL,
	`country` text NOT NULL,
	`tax_id` text NOT NULL,
	`legal_name` text NOT NULL,
	`taxpayer_domicile` text,
	`privacy_notice_url` text,
	`privacy_email` text,
	`created_at` text NOT NULL,
	CONSTRAINT "tenants_singleton_ck" CHECK("tenants"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_country_tax_id_key` ON `tenants` (`country`,`tax_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`filing_module` text,
	`tax_module` text,
	`public_key` text,
	`endorsement` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_series` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`code` text NOT NULL,
	`purpose` text DEFAULT 'standard' NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`retired_at` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_series_purpose_ck" CHECK("invoice_series"."purpose" in ('standard', 'full', 'rectificative')),
	CONSTRAINT "invoice_series_next_number_ck" CHECK("invoice_series"."next_number" >= 1),
	CONSTRAINT "invoice_series_code_ck" CHECK("invoice_series"."code" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_series_node_code_key` ON `invoice_series` (`node_id`,`code`);--> statement-breakpoint
CREATE TABLE `working_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`name` text NOT NULL,
	`product_id` text,
	`variant_name` text,
	`variant_descriptions` text,
	`variant_kitchen_name` text,
	`kitchen_name` text,
	`descriptions` text NOT NULL,
	`option_snapshots` text DEFAULT '[]' NOT NULL,
	`unit_name` text,
	`unit_precision` integer,
	`quantity` integer NOT NULL,
	`price_quantity` integer DEFAULT 1000 NOT NULL,
	`unit_price_gross` integer NOT NULL,
	`vat_class` text NOT NULL,
	`line_total` integer NOT NULL,
	`category` text,
	`served_at` text,
	`served_quantity` integer DEFAULT 0 NOT NULL,
	`course_id` text,
	`make_at_station_id` text,
	`parent_line_id` text,
	`note` text,
	`sent_at` text,
	`extra_list_id` text,
	`classification` text,
	`group_id` text,
	`credited_to` text,
	`list_unit_price_gross` integer,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`make_at_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "working_order_lines_unit_precision_ck" CHECK("working_order_lines"."unit_precision" is null or "working_order_lines"."unit_precision" between 0 and 3),
	CONSTRAINT "working_order_lines_quantity_ck" CHECK("working_order_lines"."quantity" <> 0),
	CONSTRAINT "working_order_lines_price_quantity_ck" CHECK("working_order_lines"."price_quantity" > 0),
	CONSTRAINT "working_order_lines_vat_class_ck" CHECK("working_order_lines"."vat_class" in ('general','reduced','super_reduced','zero')),
	CONSTRAINT "working_order_lines_line_no_ck" CHECK("working_order_lines"."line_no" >= 1)
);
--> statement-breakpoint
CREATE INDEX `working_order_lines_group_idx` ON `working_order_lines` (`group_id`);--> statement-breakpoint
CREATE INDEX `working_order_lines_parent_idx` ON `working_order_lines` (`parent_line_id`);--> statement-breakpoint
CREATE INDEX `working_order_lines_order_idx` ON `working_order_lines` (`working_order_id`);--> statement-breakpoint
CREATE INDEX `working_order_lines_course_idx` ON `working_order_lines` (`course_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `working_order_lines_line_no_key` ON `working_order_lines` (`working_order_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `working_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`node_id` text,
	`order_number` integer NOT NULL,
	`label` text,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` text NOT NULL,
	`settled_at` text,
	`delivery_table_id` text,
	`delivery_table_label` text,
	`collected_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`invoice_type` text DEFAULT 'F2' NOT NULL,
	`recipient_tax_id` text,
	`recipient_legal_name` text,
	`recipient_address` text,
	`recipient_country_code` text,
	`recipient_identifier_type` text,
	`recipient_identifier_country_code` text,
	`invoice_delivery` text,
	`receipt_locale` text,
	`payment_attempt_at` text,
	`party_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`delivery_table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "working_orders_status_ck" CHECK("working_orders"."status" in ('open', 'placed', 'settled', 'abandoned')),
	CONSTRAINT "working_orders_source_ck" CHECK("working_orders"."source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "working_orders_source_device_ck" CHECK(("working_orders"."source" = 'device') = ("working_orders"."device_id" is not null)),
	CONSTRAINT "working_orders_settled_at_ck" CHECK(("working_orders"."status" = 'settled') = ("working_orders"."settled_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `working_orders_tenant_status_idx` ON `working_orders` (`status`);--> statement-breakpoint
CREATE INDEX `working_orders_opened_at_idx` ON `working_orders` (`opened_at`);--> statement-breakpoint
CREATE INDEX `working_orders_party_idx` ON `working_orders` (`party_id`);--> statement-breakpoint
CREATE TABLE `order_amendments` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text,
	`captured_by_source` text NOT NULL,
	`captured_by_device_id` text,
	`captured_by_node_id` text NOT NULL,
	`event_at` text NOT NULL,
	`event_offset_minutes` integer NOT NULL,
	`entry_hash` text NOT NULL,
	`prev_entry_hash` text,
	`is_first_entry` integer NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`captured_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`captured_by_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_amendments_sequence_no_ck" CHECK("order_amendments"."sequence_no" > 0),
	CONSTRAINT "order_amendments_kind_ck" CHECK("order_amendments"."kind" in ('order_placed', 'order_cancelled')),
	CONSTRAINT "order_amendments_captured_by_source_ck" CHECK("order_amendments"."captured_by_source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "order_amendments_captured_by_source_device_ck" CHECK(("order_amendments"."captured_by_source" = 'device') = ("order_amendments"."captured_by_device_id" is not null)),
	CONSTRAINT "order_amendments_entry_hash_ck" CHECK(length("order_amendments"."entry_hash") = 64 and "order_amendments"."entry_hash" not glob '*[^0-9A-F]*'),
	CONSTRAINT "order_amendments_event_offset_ck" CHECK("order_amendments"."event_offset_minutes" between -840 and 840),
	CONSTRAINT "order_amendments_event_at_second_ck" CHECK("order_amendments"."event_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "order_amendments_chaining_ck" CHECK(("order_amendments"."is_first_entry" and "order_amendments"."prev_entry_hash" is null)
          or (not "order_amendments"."is_first_entry" and "order_amendments"."prev_entry_hash" is not null))
);
--> statement-breakpoint
CREATE INDEX `order_amendments_order_idx` ON `order_amendments` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_amendments_chain_position_key` ON `order_amendments` (`working_order_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `order_portion_events` (
	`id` text PRIMARY KEY NOT NULL,
	`portion_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_order_id` text NOT NULL,
	`to_order_id` text,
	`actor_id` text,
	`at` text NOT NULL,
	FOREIGN KEY (`portion_id`) REFERENCES `order_portions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_portion_events_kind_ck" CHECK("order_portion_events"."kind" in ('moved', 'cancelled')),
	CONSTRAINT "order_portion_events_destination_ck" CHECK(("order_portion_events"."kind" = 'moved' and "order_portion_events"."to_order_id" is not null and "order_portion_events"."to_order_id" <> "order_portion_events"."from_order_id") or ("order_portion_events"."kind" = 'cancelled' and "order_portion_events"."to_order_id" is null))
);
--> statement-breakpoint
CREATE TABLE `order_portions` (
	`id` text PRIMARY KEY NOT NULL,
	`cohort_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`measured` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "order_portions_ordinal_ck" CHECK("order_portions"."ordinal" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_portions_cohort_ordinal_key` ON `order_portions` (`cohort_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `sale_line_portions` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_line_id` text NOT NULL,
	`portion_id` text NOT NULL,
	FOREIGN KEY (`sale_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`portion_id`) REFERENCES `order_portions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sale_line_portions_portion_idx` ON `sale_line_portions` (`portion_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_line_portions_sale_line_portion_key` ON `sale_line_portions` (`sale_line_id`,`portion_id`);--> statement-breakpoint
CREATE TABLE `working_line_portions` (
	`working_order_line_id` text PRIMARY KEY NOT NULL,
	`portion_id` text NOT NULL,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`portion_id`) REFERENCES `order_portions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `working_line_portions_portion_key` ON `working_line_portions` (`portion_id`);--> statement-breakpoint
CREATE TABLE `dining_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`short_name` text,
	`short_name_key` text,
	`zone_id` text NOT NULL,
	`created_at` text NOT NULL,
	`needs_clearing_since` text,
	`plan_table_id` text,
	`on_floor` integer DEFAULT false NOT NULL,
	`today_seats` integer,
	`today_fixed` integer DEFAULT false NOT NULL,
	`today_x` integer,
	`today_y` integer,
	`today_width` integer,
	`today_height` integer,
	`today_shape` text,
	`today_rotation` integer,
	`taken_off` integer DEFAULT false NOT NULL,
	`today_name` text,
	`merge_id` text,
	`merge_before_x` integer,
	`merge_before_y` integer,
	`merge_before_rotation` integer,
	FOREIGN KEY (`plan_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merge_id`) REFERENCES `table_merges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dining_tables_merge_before_x_ck" CHECK("dining_tables"."merge_before_x" is null or "dining_tables"."merge_before_x" between 0 and 999),
	CONSTRAINT "dining_tables_merge_before_y_ck" CHECK("dining_tables"."merge_before_y" is null or "dining_tables"."merge_before_y" between 0 and 999),
	CONSTRAINT "dining_tables_merge_before_rotation_ck" CHECK("dining_tables"."merge_before_rotation" is null or ("dining_tables"."merge_before_rotation" between 0 and 345 and "dining_tables"."merge_before_rotation" % 15 = 0)),
	CONSTRAINT "dining_tables_merge_before_ck" CHECK(("dining_tables"."merge_id" is null) = ("dining_tables"."merge_before_x" is null) and ("dining_tables"."merge_id" is null) = ("dining_tables"."merge_before_y" is null) and ("dining_tables"."merge_id" is null) = ("dining_tables"."merge_before_rotation" is null)),
	CONSTRAINT "dining_tables_today_seats_ck" CHECK("dining_tables"."today_seats" is null or "dining_tables"."today_seats" between 0 and 999),
	CONSTRAINT "dining_tables_today_x_ck" CHECK("dining_tables"."today_x" is null or "dining_tables"."today_x" between 0 and 999),
	CONSTRAINT "dining_tables_today_y_ck" CHECK("dining_tables"."today_y" is null or "dining_tables"."today_y" between 0 and 999),
	CONSTRAINT "dining_tables_today_width_ck" CHECK("dining_tables"."today_width" is null or "dining_tables"."today_width" between 1 and 99),
	CONSTRAINT "dining_tables_today_height_ck" CHECK("dining_tables"."today_height" is null or "dining_tables"."today_height" between 1 and 99),
	CONSTRAINT "dining_tables_today_rotation_ck" CHECK("dining_tables"."today_rotation" is null or ("dining_tables"."today_rotation" between 0 and 345 and "dining_tables"."today_rotation" % 15 = 0)),
	CONSTRAINT "dining_tables_today_shape_ck" CHECK("dining_tables"."today_shape" in ('rect', 'round')),
	CONSTRAINT "dining_tables_today_placement_ck" CHECK(("dining_tables"."today_x" is null and "dining_tables"."today_y" is null and "dining_tables"."today_width" is null and "dining_tables"."today_height" is null and "dining_tables"."today_shape" is null and "dining_tables"."today_rotation" is null) or ("dining_tables"."today_x" is not null and "dining_tables"."today_y" is not null and "dining_tables"."today_width" is not null and "dining_tables"."today_height" is not null and "dining_tables"."today_shape" is not null and "dining_tables"."today_rotation" is not null)),
	CONSTRAINT "dining_tables_off_floor_ck" CHECK("dining_tables"."on_floor" = 1 or ("dining_tables"."today_seats" is null and "dining_tables"."today_fixed" = 0 and "dining_tables"."today_x" is null and "dining_tables"."today_y" is null and "dining_tables"."today_width" is null and "dining_tables"."today_height" is null and "dining_tables"."today_shape" is null and "dining_tables"."today_rotation" is null and "dining_tables"."taken_off" = 0 and "dining_tables"."today_name" is null and "dining_tables"."merge_id" is null))
);
--> statement-breakpoint
CREATE INDEX `dining_tables_merge_idx` ON `dining_tables` (`merge_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_short_name_key_uq` ON `dining_tables` (`short_name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_label_key` ON `dining_tables` (`label`);--> statement-breakpoint
CREATE TABLE `floor_plan_placements` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`plan_table_id` text NOT NULL,
	`x` integer,
	`y` integer,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`shape` text,
	`rotation` integer,
	FOREIGN KEY (`plan_id`) REFERENCES `floor_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_placements_x_ck" CHECK("floor_plan_placements"."x" is null or "floor_plan_placements"."x" between 0 and 999),
	CONSTRAINT "floor_plan_placements_y_ck" CHECK("floor_plan_placements"."y" is null or "floor_plan_placements"."y" between 0 and 999),
	CONSTRAINT "floor_plan_placements_width_ck" CHECK("floor_plan_placements"."width" is null or "floor_plan_placements"."width" between 1 and 99),
	CONSTRAINT "floor_plan_placements_height_ck" CHECK("floor_plan_placements"."height" is null or "floor_plan_placements"."height" between 1 and 99),
	CONSTRAINT "floor_plan_placements_rotation_ck" CHECK("floor_plan_placements"."rotation" is null or ("floor_plan_placements"."rotation" between 0 and 345 and "floor_plan_placements"."rotation" % 15 = 0)),
	CONSTRAINT "floor_plan_placements_shape_ck" CHECK("floor_plan_placements"."shape" in ('rect', 'round')),
	CONSTRAINT "floor_plan_placements_placement_ck" CHECK(("floor_plan_placements"."x" is null and "floor_plan_placements"."y" is null and "floor_plan_placements"."shape" is null and "floor_plan_placements"."rotation" is null) or ("floor_plan_placements"."x" is not null and "floor_plan_placements"."y" is not null and "floor_plan_placements"."shape" is not null and "floor_plan_placements"."rotation" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_placements_table_key` ON `floor_plan_placements` (`plan_id`,`plan_table_id`);--> statement-breakpoint
CREATE TABLE `floor_plan_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_sets_name_ck" CHECK(trim("floor_plan_sets"."name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_sets_name_key` ON `floor_plan_sets` (`department_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_sets_one_default_key` ON `floor_plan_sets` (`department_id`) WHERE "floor_plan_sets"."is_default";--> statement-breakpoint
CREATE TABLE `floor_plan_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`label` text NOT NULL,
	`short_name` text,
	`seats` integer,
	`fixed` integer DEFAULT false NOT NULL,
	`part_of_table_id` text,
	FOREIGN KEY (`part_of_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_tables_seats_ck" CHECK("floor_plan_tables"."seats" is null or "floor_plan_tables"."seats" between 0 and 999),
	CONSTRAINT "floor_plan_tables_part_of_not_self_ck" CHECK("floor_plan_tables"."part_of_table_id" <> "floor_plan_tables"."id")
);
--> statement-breakpoint
CREATE INDEX `floor_plan_tables_part_of_idx` ON `floor_plan_tables` (`part_of_table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_tables_zone_label_key` ON `floor_plan_tables` (`zone_id`,`label`);--> statement-breakpoint
CREATE TABLE `floor_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`set_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`set_id`) REFERENCES `floor_plan_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plans_set_zone_key` ON `floor_plans` (`set_id`,`zone_id`);--> statement-breakpoint
CREATE TABLE `floor_reset_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`table_id` text,
	`label` text NOT NULL,
	`short_name` text,
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
	`plan_table_id` text,
	`placed` integer DEFAULT false NOT NULL,
	`ready_to_move` integer DEFAULT false NOT NULL,
	`taken_off` integer DEFAULT false NOT NULL,
	`part_of_reset_table_id` text,
	FOREIGN KEY (`plan_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_of_reset_table_id`) REFERENCES `floor_reset_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_reset_tables_seats_ck" CHECK("floor_reset_tables"."seats" is null or "floor_reset_tables"."seats" between 0 and 999),
	CONSTRAINT "floor_reset_tables_part_of_not_self_ck" CHECK("floor_reset_tables"."part_of_reset_table_id" <> "floor_reset_tables"."id"),
	CONSTRAINT "floor_reset_tables_x_ck" CHECK("floor_reset_tables"."x" is null or "floor_reset_tables"."x" between 0 and 999),
	CONSTRAINT "floor_reset_tables_y_ck" CHECK("floor_reset_tables"."y" is null or "floor_reset_tables"."y" between 0 and 999),
	CONSTRAINT "floor_reset_tables_width_ck" CHECK("floor_reset_tables"."width" is null or "floor_reset_tables"."width" between 1 and 99),
	CONSTRAINT "floor_reset_tables_height_ck" CHECK("floor_reset_tables"."height" is null or "floor_reset_tables"."height" between 1 and 99),
	CONSTRAINT "floor_reset_tables_rotation_ck" CHECK("floor_reset_tables"."rotation" is null or ("floor_reset_tables"."rotation" between 0 and 345 and "floor_reset_tables"."rotation" % 15 = 0)),
	CONSTRAINT "floor_reset_tables_shape_ck" CHECK("floor_reset_tables"."shape" in ('rect', 'round')),
	CONSTRAINT "floor_reset_tables_placement_ck" CHECK(("floor_reset_tables"."x" is null and "floor_reset_tables"."y" is null and "floor_reset_tables"."width" is null and "floor_reset_tables"."height" is null and "floor_reset_tables"."shape" is null and "floor_reset_tables"."rotation" is null) or ("floor_reset_tables"."x" is not null and "floor_reset_tables"."y" is not null and "floor_reset_tables"."width" is not null and "floor_reset_tables"."height" is not null and "floor_reset_tables"."shape" is not null and "floor_reset_tables"."rotation" is not null))
);
--> statement-breakpoint
CREATE INDEX `floor_reset_tables_zone_pending_idx` ON `floor_reset_tables` (`zone_id`,`pending`);--> statement-breakpoint
CREATE INDEX `floor_reset_tables_part_of_idx` ON `floor_reset_tables` (`part_of_reset_table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_reset_tables_table_key` ON `floor_reset_tables` (`table_id`);--> statement-breakpoint
CREATE TABLE `table_merges` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`seats` integer NOT NULL,
	`name` text,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "table_merges_seats_ck" CHECK("table_merges"."seats" >= 1)
);
--> statement-breakpoint
CREATE INDEX `table_merges_zone_idx` ON `table_merges` (`zone_id`);--> statement-breakpoint
CREATE TABLE `parties` (
	`id` text PRIMARY KEY NOT NULL,
	`guest_count` integer,
	`state` text DEFAULT 'open' NOT NULL,
	`opened_at` text NOT NULL,
	`opened_by` text NOT NULL,
	`closed_at` text,
	`closed_by` text,
	`merged_into_party_id` text,
	`bill_requested_at` text,
	`name` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`table_names` text,
	`allergy_answer` text,
	`allergy_answered_by` text,
	`allergy_answered_at` text,
	FOREIGN KEY (`merged_into_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`closed_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`allergy_answered_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "parties_allergy_answer_ck" CHECK("parties"."allergy_answer" in ('none', 'allergies')),
	CONSTRAINT "parties_allergy_answered_ck" CHECK(("parties"."allergy_answer" is null and "parties"."allergy_answered_by" is null and "parties"."allergy_answered_at" is null) or ("parties"."allergy_answer" is not null and "parties"."allergy_answered_by" is not null and "parties"."allergy_answered_at" is not null)),
	CONSTRAINT "parties_state_ck" CHECK("parties"."state" in ('open', 'closed')),
	CONSTRAINT "parties_guest_count_ck" CHECK("parties"."guest_count" is null or "parties"."guest_count" >= 1),
	CONSTRAINT "parties_closed_at_ck" CHECK(("parties"."state" = 'open') = ("parties"."closed_at" is null)),
	CONSTRAINT "parties_merged_into_ck" CHECK("parties"."merged_into_party_id" is null or ("parties"."merged_into_party_id" <> "parties"."id" and "parties"."state" = 'closed'))
);
--> statement-breakpoint
CREATE INDEX `parties_merged_into_idx` ON `parties` (`merged_into_party_id`);--> statement-breakpoint
CREATE TABLE `party_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`table_id` text NOT NULL,
	`joined_at` text NOT NULL,
	`left_at` text,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `party_tables_active_table_uq` ON `party_tables` (`table_id`) WHERE "party_tables"."left_at" is null;--> statement-breakpoint
CREATE INDEX `party_tables_party_idx` ON `party_tables` (`party_id`);--> statement-breakpoint
CREATE TABLE `service_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "service_commands_scope_kind_ck" CHECK("service_commands"."scope_kind" in ('party', 'bill'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_commands_scope_submission_key` ON `service_commands` (`scope_kind`,`scope_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `order_group_events` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`group_id` text,
	`kind` text NOT NULL,
	`actor_id` text,
	`actor_device_id` text,
	`detail` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_group_events_kind_ck" CHECK("order_group_events"."kind" in ('submitted', 'joined', 'fired', 'reordered', 'lines_moved', 'removed')),
	CONSTRAINT "order_group_events_actor_ck" CHECK(("order_group_events"."actor_id" is null) <> ("order_group_events"."actor_device_id" is null))
);
--> statement-breakpoint
CREATE INDEX `order_group_events_party_idx` ON `order_group_events` (`party_id`);--> statement-breakpoint
CREATE INDEX `order_group_events_group_idx` ON `order_group_events` (`group_id`);--> statement-breakpoint
CREATE TABLE `order_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`position` integer NOT NULL,
	`display_number` integer DEFAULT 0 NOT NULL,
	`number_party_id` text,
	`state` text NOT NULL,
	`fired_at` text,
	`fired_by` text,
	`fired_by_device_id` text,
	`submitted_by` text NOT NULL,
	`remind_at` text,
	`hold_printed_at` text,
	`request_kind` text DEFAULT 'new_order' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`number_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fired_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_groups_state_ck" CHECK("order_groups"."state" in ('held', 'fired', 'removed')),
	CONSTRAINT "order_groups_fired_at_ck" CHECK(("order_groups"."state" = 'fired') = ("order_groups"."fired_at" is not null)),
	CONSTRAINT "order_groups_firer_ck" CHECK("order_groups"."fired_by" is null or "order_groups"."fired_by_device_id" is null)
);
--> statement-breakpoint
CREATE INDEX `order_groups_party_idx` ON `order_groups` (`party_id`);--> statement-breakpoint
CREATE INDEX `order_groups_number_party_idx` ON `order_groups` (`number_party_id`);--> statement-breakpoint
CREATE TABLE `order_group_hold_stations` (
	`group_id` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `station_id`),
	FOREIGN KEY (`group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_draft_events` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_person` text,
	`to_person` text NOT NULL,
	`actor_id` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `order_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_draft_events_kind_ck" CHECK("order_draft_events"."kind" in ('created', 'taken_over', 'submitted', 'discarded'))
);
--> statement-breakpoint
CREATE INDEX `order_draft_events_draft_idx` ON `order_draft_events` (`draft_id`);--> statement-breakpoint
CREATE TABLE `order_draft_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`position` integer NOT NULL,
	`menu_item_id` text NOT NULL,
	`variant_id` text,
	`menu_version_id` text,
	`options` text NOT NULL,
	`extras` text NOT NULL,
	`note` text,
	`quantity` integer NOT NULL,
	`course_id` text,
	`make_at_station_id` text,
	`slot` integer DEFAULT 0 NOT NULL,
	`join_group_id` text,
	`after_group_id` text,
	`no_merge` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `order_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`make_at_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`join_group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`after_group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_draft_lines_quantity_ck" CHECK("order_draft_lines"."quantity" > 0),
	CONSTRAINT "order_draft_lines_slot_ck" CHECK("order_draft_lines"."slot" >= 0),
	CONSTRAINT "order_draft_lines_place_ck" CHECK("order_draft_lines"."join_group_id" is null or "order_draft_lines"."slot" = 0),
	CONSTRAINT "order_draft_lines_after_ck" CHECK("order_draft_lines"."after_group_id" is null or "order_draft_lines"."slot" >= 1)
);
--> statement-breakpoint
CREATE INDEX `order_draft_lines_draft_idx` ON `order_draft_lines` (`draft_id`);--> statement-breakpoint
CREATE INDEX `order_draft_lines_course_idx` ON `order_draft_lines` (`course_id`);--> statement-breakpoint
CREATE TABLE `order_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`bill_id` text,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_drafts_state_ck" CHECK("order_drafts"."state" in ('open', 'submitted', 'discarded'))
);
--> statement-breakpoint
CREATE INDEX `order_drafts_party_idx` ON `order_drafts` (`party_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_drafts_open_owner_uq` ON `order_drafts` (`bill_id`) WHERE "order_drafts"."state" = 'open';--> statement-breakpoint
CREATE TABLE `line_service_cancellations` (
	`line_id` text PRIMARY KEY NOT NULL,
	`quantity` integer NOT NULL,
	`cancelled_at` text NOT NULL,
	`was_started` integer NOT NULL,
	`actor_id` text NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "line_service_cancellations_quantity_ck" CHECK("line_service_cancellations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE `floor_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`department_id` text NOT NULL,
	`is_counter_default` integer DEFAULT false NOT NULL,
	`order_start` text,
	`paid_when` text,
	`collection_number` text,
	`today_business_day` text,
	`today_revision` integer DEFAULT 0 NOT NULL,
	`today_set_id` text,
	`today_layout_revision` integer DEFAULT 0 NOT NULL,
	`today_occurrence` text,
	`kept_open_day` text,
	`kept_open_from` text,
	`kept_open_until` text,
	FOREIGN KEY (`today_set_id`) REFERENCES `floor_plan_sets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_zones_kept_open_ck" CHECK(("floor_zones"."kept_open_day" is null and "floor_zones"."kept_open_from" is null and "floor_zones"."kept_open_until" is null) or ("floor_zones"."kept_open_day" is not null and "floor_zones"."kept_open_from" is not null and "floor_zones"."kept_open_until" is not null)),
	CONSTRAINT "floor_zones_kept_open_step_ck" CHECK(substr("floor_zones"."kept_open_from", 4, 2) in ('00', '15', '30', '45') and substr("floor_zones"."kept_open_until", 4, 2) in ('00', '15', '30', '45')),
	CONSTRAINT "floor_zones_order_start_ck" CHECK("floor_zones"."order_start" in ('table', 'counter')),
	CONSTRAINT "floor_zones_paid_when_ck" CHECK("floor_zones"."paid_when" in ('prepay', 'ticket_then_pay')),
	CONSTRAINT "floor_zones_collection_number_ck" CHECK("floor_zones"."collection_number" in ('none', 'numbered'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_zones_one_counter_default_key` ON `floor_zones` (`is_counter_default`) WHERE "floor_zones"."is_counter_default" = 1 and "floor_zones"."active" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `floor_zones_name_key` ON `floor_zones` (`name`) WHERE "floor_zones"."active" = 1;--> statement-breakpoint
CREATE TABLE `kitchen_stations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`warm_after_minutes` integer DEFAULT 5 NOT NULL,
	`overdue_after_minutes` integer DEFAULT 10 NOT NULL,
	`forgotten_after_minutes` integer DEFAULT 15 NOT NULL,
	`ready_warning_after_minutes` integer DEFAULT 3 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`shows_rest_of_order` integer DEFAULT false NOT NULL,
	`print_moved_slips` integer,
	`colour` text DEFAULT 'red' NOT NULL,
	`ticket_grouping` text DEFAULT 'combined' NOT NULL,
	`print_held_work` integer DEFAULT false NOT NULL,
	`bump_mode` text DEFAULT 'line' NOT NULL,
	`changes_after_sending` text DEFAULT 'held-or-waiting' NOT NULL,
	`waits_for_pass` integer DEFAULT false NOT NULL,
	`printer_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`closed_on_day` text,
	`closed_sends_to_station_id` text,
	`when_closed_sends_to_station_id` text,
	FOREIGN KEY (`closed_sends_to_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`when_closed_sends_to_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kitchen_stations_printer_ids_ck" CHECK(json_valid("kitchen_stations"."printer_ids") and json_type("kitchen_stations"."printer_ids") = 'array'),
	CONSTRAINT "kitchen_stations_closed_sends_to_ck" CHECK("kitchen_stations"."closed_sends_to_station_id" is null or "kitchen_stations"."closed_on_day" is not null),
	CONSTRAINT "kitchen_stations_closed_sends_to_not_self_ck" CHECK("kitchen_stations"."closed_sends_to_station_id" <> "kitchen_stations"."id"),
	CONSTRAINT "kitchen_stations_when_closed_sends_to_not_self_ck" CHECK("kitchen_stations"."when_closed_sends_to_station_id" <> "kitchen_stations"."id"),
	CONSTRAINT "kitchen_stations_warm_after_ck" CHECK("kitchen_stations"."warm_after_minutes" >= 1),
	CONSTRAINT "kitchen_stations_ready_warning_after_ck" CHECK("kitchen_stations"."ready_warning_after_minutes" >= 1),
	CONSTRAINT "kitchen_stations_colour_ck" CHECK("kitchen_stations"."colour" in ('red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'purple', 'magenta', 'pink', 'brown', 'grey')),
	CONSTRAINT "kitchen_stations_ticket_grouping_ck" CHECK("kitchen_stations"."ticket_grouping" in ('combined', 'separate')),
	CONSTRAINT "kitchen_stations_bump_mode_ck" CHECK("kitchen_stations"."bump_mode" in ('line', 'ticket')),
	CONSTRAINT "kitchen_stations_changes_after_sending_ck" CHECK("kitchen_stations"."changes_after_sending" in ('never', 'held', 'held-or-waiting')),
	CONSTRAINT "kitchen_stations_thresholds_ordered" CHECK("kitchen_stations"."warm_after_minutes" < "kitchen_stations"."overdue_after_minutes" and "kitchen_stations"."overdue_after_minutes" < "kitchen_stations"."forgotten_after_minutes")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_stations_name_key` ON `kitchen_stations` (`name`) WHERE "kitchen_stations"."active" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_stations_default_key` ON `kitchen_stations` (`is_default`) WHERE "kitchen_stations"."is_default";--> statement-breakpoint
CREATE TABLE `kitchen_courses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`held_until_fired` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_courses_name_key` ON `kitchen_courses` (`name`) WHERE "kitchen_courses"."active" = 1;--> statement-breakpoint
CREATE TABLE `ticket_items` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`working_order_line_id` text NOT NULL,
	`station_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`queued_at` text NOT NULL,
	`preparing_at` text,
	`ready_at` text,
	`course_id` text,
	`fired_at` text,
	`requested_at` text,
	`pass_controlled` integer DEFAULT false NOT NULL,
	`station_chosen_at` text,
	`station_retained_at_release` integer DEFAULT false NOT NULL,
	`note` text,
	`quantity` integer,
	`made_here` integer DEFAULT false NOT NULL,
	`sent_order_number` integer,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ticket_items_state_ck" CHECK("ticket_items"."state" in ('queued', 'preparing', 'ready'))
);
--> statement-breakpoint
CREATE INDEX `ticket_items_queue_idx` ON `ticket_items` (`station_id`,`state`);--> statement-breakpoint
CREATE INDEX `ticket_items_order_idx` ON `ticket_items` (`working_order_id`);--> statement-breakpoint
CREATE INDEX `ticket_items_course_idx` ON `ticket_items` (`course_id`);--> statement-breakpoint
CREATE INDEX `ticket_items_waiting_idx` ON `ticket_items` (`station_id`,`state`,`fired_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_items_working_order_line_id_key` ON `ticket_items` (`working_order_line_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`device_profile_id` text NOT NULL,
	`receipt_printer_id` text,
	`payment_slip_printer_id` text,
	`cash_drawer_printer_id` text,
	`invoice_printer_id` text,
	`invoice_page_printer_id` text,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deleted_at` text,
	`last_seen_at` text,
	`battery_level` integer,
	`battery_charging` integer,
	`battery_reported_at` text,
	`enrolled_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`receipt_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`payment_slip_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cash_drawer_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_page_printer_id`) REFERENCES `page_printers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_label_active_key` ON `devices` (`label`) WHERE "devices"."active" = 1;--> statement-breakpoint
CREATE TABLE `device_made_here_stations` (
	`device_id` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `station_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_approved_profiles` (
	`device_id` text NOT NULL,
	`device_profile_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `device_profile_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`verification_number` text NOT NULL,
	`decoy_numbers` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "join_requests_kind_ck" CHECK("join_requests"."kind" in ('device', 'print_agent'))
);
--> statement-breakpoint
CREATE TABLE `print_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text,
	`setup_url` text,
	`setup_port` integer,
	`node_id` text,
	`token_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_seen_at` text,
	`enrolled_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `print_agents_tenant_node_key` ON `print_agents` (`node_id`);--> statement-breakpoint
CREATE TABLE `printers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`local_key` text,
	`host` text,
	`port` integer DEFAULT 9100,
	`poll_id` text,
	`poll_token_hash` text,
	`ticket_scope` text DEFAULT 'station' NOT NULL,
	`paper_width` text DEFAULT '80mm' NOT NULL,
	`resolution` text DEFAULT '180dpi' NOT NULL,
	`has_cash_drawer` integer DEFAULT false NOT NULL,
	`portable` integer DEFAULT false NOT NULL,
	`pickup_roles` text DEFAULT '["receipt","payment_slip"]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deleted_at` text,
	CONSTRAINT "printers_transport_ck" CHECK("printers"."transport" in ('usb', 'network_tcp', 'bluetooth', 'cloud_poll')),
	CONSTRAINT "printers_ticket_scope_ck" CHECK("printers"."ticket_scope" in ('station', 'order')),
	CONSTRAINT "printers_paper_width_ck" CHECK("printers"."paper_width" in ('58mm', '80mm')),
	CONSTRAINT "printers_resolution_ck" CHECK("printers"."resolution" in ('180dpi', '203dpi')),
	CONSTRAINT "printers_transport_fields_ck" CHECK(("printers"."transport" = 'usb' and "printers"."local_key" is not null)
          or ("printers"."transport" = 'bluetooth' and "printers"."local_key" is not null)
          or ("printers"."transport" = 'network_tcp' and "printers"."host" is not null)
          or ("printers"."transport" = 'cloud_poll' and "printers"."poll_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printers_local_key_key` ON `printers` (`local_key`) WHERE "printers"."local_key" is not null and "printers"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text NOT NULL,
	`claimed_by` text,
	`payload` blob NOT NULL,
	`kind` text DEFAULT 'document' NOT NULL,
	`receipt_copy` integer,
	`receipt_handover` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`claimed_at` text,
	`delivered_at` text,
	`resend_of` text,
	`sale_id` text,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claimed_by`) REFERENCES `print_agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resend_of`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "print_jobs_kind_ck" CHECK("print_jobs"."kind" in ('document', 'drawer')),
	CONSTRAINT "print_jobs_status_ck" CHECK("print_jobs"."status" in ('queued', 'printing', 'done', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `print_jobs_pull_idx` ON `print_jobs` (`printer_id`,`status`);--> statement-breakpoint
CREATE INDEX `print_jobs_printer_kind_idx` ON `print_jobs` (`printer_id`,`kind`);--> statement-breakpoint
CREATE INDEX `print_jobs_resend_of_idx` ON `print_jobs` (`resend_of`);--> statement-breakpoint
CREATE INDEX `print_jobs_sale_id_idx` ON `print_jobs` (`sale_id`);--> statement-breakpoint
CREATE TABLE `receipt_reprints` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`print_job_id` text NOT NULL,
	`person_id` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`print_job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `receipt_reprints_sale_idx` ON `receipt_reprints` (`sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_reprints_job_uq` ON `receipt_reprints` (`print_job_id`);--> statement-breakpoint
CREATE TABLE `sale_receipt_guests` (
	`sale_id` text PRIMARY KEY NOT NULL,
	`guest_count` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sale_receipt_guests_guest_count_ck" CHECK("sale_receipt_guests"."guest_count" is null or (typeof("sale_receipt_guests"."guest_count") = 'integer' and "sale_receipt_guests"."guest_count" between 1 and 999))
);
--> statement-breakpoint
CREATE TABLE `invoice_pdf_downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`person_id` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `invoice_pdf_downloads_sale_idx` ON `invoice_pdf_downloads` (`sale_id`);--> statement-breakpoint
CREATE TABLE `invoice_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`original_sale_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`gross` integer NOT NULL,
	`line_ids` text,
	`reason` text NOT NULL,
	`requested_by` text NOT NULL,
	`authorized_by` text NOT NULL,
	`via_override` integer NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`node_id` text NOT NULL,
	`state` text NOT NULL,
	`corrective_sale_id` text,
	`created_at` text NOT NULL,
	`ended_at` text,
	`ended_by` text,
	FOREIGN KEY (`original_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`corrective_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invoice_corrections_source_ck" CHECK("invoice_corrections"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "invoice_corrections_source_device_ck" CHECK(("invoice_corrections"."source" = 'device') = ("invoice_corrections"."device_id" is not null)),
	CONSTRAINT "invoice_corrections_state_ck" CHECK("invoice_corrections"."state" in ('open', 'filed', 'discarded', 'closed')),
	CONSTRAINT "invoice_corrections_gross_ck" CHECK(typeof("invoice_corrections"."gross") = 'integer' and "invoice_corrections"."gross" > 0),
	CONSTRAINT "invoice_corrections_filed_ck" CHECK(("invoice_corrections"."state" = 'filed') = ("invoice_corrections"."corrective_sale_id" is not null)),
	CONSTRAINT "invoice_corrections_ended_ck" CHECK(("invoice_corrections"."state" = 'open') = ("invoice_corrections"."ended_at" is null)),
	CONSTRAINT "invoice_corrections_ended_by_ck" CHECK(("invoice_corrections"."state" <> 'open' or "invoice_corrections"."ended_by" is null) and ("invoice_corrections"."state" not in ('discarded', 'closed') or "invoice_corrections"."ended_by" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_corrections_open_key` ON `invoice_corrections` (`original_sale_id`) WHERE "invoice_corrections"."state" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_corrections_submission_key` ON `invoice_corrections` (`original_sale_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `invoice_correction_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_correction_id` text NOT NULL,
	`tender_refund_id` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_correction_id`) REFERENCES `invoice_corrections`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tender_refund_id`) REFERENCES `tender_refunds`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `invoice_correction_refunds_request_idx` ON `invoice_correction_refunds` (`invoice_correction_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_correction_refunds_tender_refund_key` ON `invoice_correction_refunds` (`tender_refund_id`);--> statement-breakpoint
CREATE TABLE `kitchen_print_job_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`print_job_id` text NOT NULL,
	`working_order_line_id` text NOT NULL,
	FOREIGN KEY (`print_job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kitchen_print_job_lines_line_idx` ON `kitchen_print_job_lines` (`working_order_line_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_print_job_lines_job_line_key` ON `kitchen_print_job_lines` (`print_job_id`,`working_order_line_id`);--> statement-breakpoint
CREATE TABLE `kitchen_print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`print_job_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`station_id` text NOT NULL,
	`reprint` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`print_job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kitchen_print_jobs_order_station_idx` ON `kitchen_print_jobs` (`working_order_id`,`station_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_print_jobs_job_order_station_key` ON `kitchen_print_jobs` (`print_job_id`,`working_order_id`,`station_id`);--> statement-breakpoint
CREATE TABLE `ticket_item_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_line_id` text NOT NULL,
	`from_station_id` text NOT NULL,
	`to_station_id` text NOT NULL,
	`moved_at` text NOT NULL,
	`moved_by_device_id` text,
	`moved_by_person_id` text,
	FOREIGN KEY (`moved_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moved_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ticket_item_moves_actor_ck" CHECK("ticket_item_moves"."moved_by_device_id" is not null or "ticket_item_moves"."moved_by_person_id" is not null)
);
--> statement-breakpoint
CREATE INDEX `ticket_item_moves_line_idx` ON `ticket_item_moves` (`working_order_line_id`);--> statement-breakpoint
CREATE TABLE `drawer_opens` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text,
	`printer_id` text,
	`person_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`reason` text NOT NULL,
	`sale_id` text,
	`bill_payment_id` text,
	`tender_refund_id` text,
	`authorized_by` text,
	`via_override` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tender_refund_id`) REFERENCES `tender_refunds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "drawer_opens_reason_ck" CHECK("drawer_opens"."reason" in ('cash_sale', 'manual', 'calibration', 'bill_payment', 'bill_refund', 'card_slip', 'tender_refund')),
	CONSTRAINT "drawer_opens_target_ck" CHECK((
        "drawer_opens"."tender_refund_id" is null and (
          ("drawer_opens"."reason" = 'calibration' and "drawer_opens"."printer_id" is not null and "drawer_opens"."device_id" is null and "drawer_opens"."sale_id" is null and "drawer_opens"."bill_payment_id" is null)
          or ("drawer_opens"."reason" in ('bill_payment', 'bill_refund') and "drawer_opens"."device_id" is not null and "drawer_opens"."bill_payment_id" is not null and "drawer_opens"."sale_id" is null)
          or ("drawer_opens"."reason" in ('cash_sale', 'manual') and "drawer_opens"."device_id" is not null and "drawer_opens"."bill_payment_id" is null)
          or ("drawer_opens"."reason" = 'card_slip' and "drawer_opens"."device_id" is not null and ("drawer_opens"."sale_id" is null) <> ("drawer_opens"."bill_payment_id" is null))
        )
      ) or (
        "drawer_opens"."reason" = 'tender_refund' and "drawer_opens"."device_id" is not null and "drawer_opens"."sale_id" is not null
        and "drawer_opens"."tender_refund_id" is not null and "drawer_opens"."bill_payment_id" is null
      ))
);
--> statement-breakpoint
CREATE TABLE `catalogues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalogues_one_default_uq` ON `catalogues` (`is_default`) WHERE "catalogues"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`catalogue_id` text NOT NULL,
	`parent_id` text,
	`variant_order` integer DEFAULT 0 NOT NULL,
	`set_lunch` integer DEFAULT false NOT NULL,
	`category_id` text,
	`course_id` text,
	`name` text NOT NULL,
	`name_key` text,
	`customer_name` text,
	`description` text,
	`kitchen_name` text,
	`dietary_declarations` text DEFAULT '[]',
	`pricing_unit` text,
	`unit_price` integer,
	`vat_class` text,
	`active` integer DEFAULT true NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`ordering` text DEFAULT 'public' NOT NULL,
	`image` text,
	`color` text,
	`allergens` text,
	`manual_allergens` text,
	`diet_override` text,
	`diet` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`catalogue_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`,`catalogue_id`) REFERENCES `products`(`id`,`catalogue_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "products_top_level_owns_ck" CHECK("products"."parent_id" is not null or ("products"."vat_class" is not null and "products"."pricing_unit" is not null and "products"."unit_price" is not null and "products"."dietary_declarations" is not null)),
	CONSTRAINT "products_pricing_unit_ck" CHECK("products"."pricing_unit" in ('each','weight')),
	CONSTRAINT "products_vat_class_ck" CHECK("products"."vat_class" in ('general','reduced','super_reduced','zero'))
);
--> statement-breakpoint
CREATE INDEX `products_catalogue_id_idx` ON `products` (`catalogue_id`);--> statement-breakpoint
CREATE INDEX `products_name_key_idx` ON `products` (`name_key`);--> statement-breakpoint
CREATE INDEX `products_course_idx` ON `products` (`course_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_id_catalogue_key` ON `products` (`id`,`catalogue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_parent_id_key` ON `products` (`parent_id`,`id`);--> statement-breakpoint
CREATE TABLE `purchase_invoice_vat` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_invoice_id` text NOT NULL,
	`rate` integer NOT NULL,
	`base` integer NOT NULL,
	`tax` integer NOT NULL,
	`kind` text DEFAULT 'ordinary' NOT NULL,
	FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "purchase_invoice_vat_rate_ck" CHECK("purchase_invoice_vat"."rate" >= 0 and "purchase_invoice_vat"."rate" <= 10000),
	CONSTRAINT "purchase_invoice_vat_kind_ck" CHECK("purchase_invoice_vat"."kind" in ('ordinary', 'capital'))
);
--> statement-breakpoint
CREATE INDEX `purchase_invoice_vat_invoice_idx` ON `purchase_invoice_vat` (`purchase_invoice_id`);--> statement-breakpoint
CREATE TABLE `purchase_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_tax_id` text NOT NULL,
	`supplier_name` text NOT NULL,
	`supplier_invoice_number` text NOT NULL,
	`issued_on` text NOT NULL,
	`received_on` text NOT NULL,
	`total` integer NOT NULL,
	`regime` text DEFAULT 'general' NOT NULL,
	`deductible_proportion` integer DEFAULT 10000 NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "purchase_invoices_regime_ck" CHECK("purchase_invoices"."regime" in ('general', 'equivalence_surcharge')),
	CONSTRAINT "purchase_invoices_deductible_proportion_ck" CHECK("purchase_invoices"."deductible_proportion" >= 0 and "purchase_invoices"."deductible_proportion" <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_invoices_supplier_number_key` ON `purchase_invoices` (`supplier_tax_id`,`supplier_invoice_number`,cast("issued_on" as integer));--> statement-breakpoint
CREATE INDEX `purchase_invoices_tenant_received_idx` ON `purchase_invoices` (`received_on`);--> statement-breakpoint
CREATE TABLE `device_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`form_factor` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`inactivity_timeout_seconds` integer,
	`starting_screen` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`retired_at` text,
	CONSTRAINT "device_profiles_form_factor_ck" CHECK("device_profiles"."form_factor" in ('till', 'phone-portrait', 'tablet-landscape', 'kds'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_profiles_live_name_key` ON `device_profiles` (`name`) WHERE "device_profiles"."retired_at" is null;--> statement-breakpoint
CREATE TABLE `device_profile_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`device_profile_id` text NOT NULL,
	`printer_id` text,
	`page_printer_id` text,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_printer_id`) REFERENCES `page_printers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "device_profile_printers_role_ck" CHECK("device_profile_printers"."role" in ('receipt', 'payment_slip', 'cash_drawer', 'invoice')),
	CONSTRAINT "device_profile_printers_target_ck" CHECK(("device_profile_printers"."printer_id" is null) <> ("device_profile_printers"."page_printer_id" is null) and ("device_profile_printers"."page_printer_id" is null or "device_profile_printers"."role" = 'invoice'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_printers_profile_role_default_key` ON `device_profile_printers` (`device_profile_id`,`role`) WHERE "device_profile_printers"."is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_printers_profile_role_page_printer_key` ON `device_profile_printers` (`device_profile_id`,`role`,`page_printer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_printers_profile_role_printer_key` ON `device_profile_printers` (`device_profile_id`,`role`,`printer_id`);--> statement-breakpoint
CREATE TABLE `printer_holders` (
	`printer_id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`held_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `custom_themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`in_use` integer,
	`theme` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "custom_themes_in_use_ck" CHECK("custom_themes"."in_use" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_themes_name_key_uq` ON `custom_themes` (`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_themes_in_use_uq` ON `custom_themes` (`in_use`);--> statement-breakpoint
CREATE TABLE `working_order_counters` (
	`node_id` text PRIMARY KEY NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bill_payment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_payment_id` text NOT NULL,
	`line_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "bill_payment_lines_quantity_ck" CHECK("bill_payment_lines"."quantity" > 0),
	CONSTRAINT "bill_payment_lines_amount_ck" CHECK("bill_payment_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `bill_payment_lines_payment_idx` ON `bill_payment_lines` (`bill_payment_id`);--> statement-breakpoint
CREATE TABLE `bill_payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_payment_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`applied_amount` integer NOT NULL,
	`tip_amount` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`authorized_by` text NOT NULL,
	`requested_by` text NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`state` text NOT NULL,
	`sent_at` text,
	`send_count` integer DEFAULT 0 NOT NULL,
	`provider_refund_ref` text,
	`refs_before_send` text,
	`attested_by` text,
	`attestation_note` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`failed_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "bill_payment_refunds_state_ck" CHECK("bill_payment_refunds"."state" in ('pending', 'completed', 'failed')),
	CONSTRAINT "bill_payment_refunds_source_ck" CHECK("bill_payment_refunds"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "bill_payment_refunds_source_device_ck" CHECK(("bill_payment_refunds"."source" = 'device') = ("bill_payment_refunds"."device_id" is not null)),
	CONSTRAINT "bill_payment_refunds_amounts_ck" CHECK("bill_payment_refunds"."applied_amount" >= 0 and "bill_payment_refunds"."tip_amount" >= 0 and "bill_payment_refunds"."applied_amount" + "bill_payment_refunds"."tip_amount" > 0),
	CONSTRAINT "bill_payment_refunds_sent_ck" CHECK(("bill_payment_refunds"."send_count" = 0) = ("bill_payment_refunds"."sent_at" is null) and "bill_payment_refunds"."send_count" >= 0),
	CONSTRAINT "bill_payment_refunds_completed_at_ck" CHECK(("bill_payment_refunds"."state" = 'completed') = ("bill_payment_refunds"."completed_at" is not null)),
	CONSTRAINT "bill_payment_refunds_failed_at_ck" CHECK(("bill_payment_refunds"."state" = 'failed') = ("bill_payment_refunds"."failed_at" is not null)),
	CONSTRAINT "bill_payment_refunds_attestation_ck" CHECK(("bill_payment_refunds"."attested_by" is null) = ("bill_payment_refunds"."attestation_note" is null) and ("bill_payment_refunds"."attested_by" is null or ("bill_payment_refunds"."state" <> 'pending' and coalesce(length(trim("bill_payment_refunds"."attestation_note")), 0) > 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_payment_refunds_submission_key` ON `bill_payment_refunds` (`bill_payment_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `bill_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`share_of` integer,
	`method` text NOT NULL,
	`applied` integer NOT NULL,
	`tip` integer DEFAULT 0 NOT NULL,
	`tendered` integer,
	`remaining_after` integer,
	`state` text NOT NULL,
	`requested_by` text NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`created_at` text NOT NULL,
	`received_at` text,
	`failed_at` text,
	`attested_by` text,
	`attestation_note` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "bill_payments_kind_ck" CHECK("bill_payments"."kind" in ('items', 'contribution', 'share')),
	CONSTRAINT "bill_payments_source_ck" CHECK("bill_payments"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "bill_payments_source_device_ck" CHECK(("bill_payments"."source" = 'device') = ("bill_payments"."device_id" is not null)),
	CONSTRAINT "bill_payments_method_ck" CHECK("bill_payments"."method" in ('cash', 'card')),
	CONSTRAINT "bill_payments_state_ck" CHECK("bill_payments"."state" in ('pending', 'received', 'failed', 'declined')),
	CONSTRAINT "bill_payments_share_of_ck" CHECK(("bill_payments"."kind" = 'share') = ("bill_payments"."share_of" is not null) and ("bill_payments"."share_of" is null or "bill_payments"."share_of" >= 1)),
	CONSTRAINT "bill_payments_amounts_ck" CHECK("bill_payments"."applied" >= 0 and "bill_payments"."tip" >= 0 and "bill_payments"."applied" + "bill_payments"."tip" > 0),
	CONSTRAINT "bill_payments_tendered_ck" CHECK(("bill_payments"."method" = 'cash') = ("bill_payments"."tendered" is not null) and ("bill_payments"."tendered" is null or "bill_payments"."tendered" >= "bill_payments"."applied" + "bill_payments"."tip")),
	CONSTRAINT "bill_payments_received_at_ck" CHECK(("bill_payments"."state" in ('received', 'declined')) = ("bill_payments"."received_at" is not null)),
	CONSTRAINT "bill_payments_failed_at_ck" CHECK(("bill_payments"."state" = 'failed') = ("bill_payments"."failed_at" is not null)),
	CONSTRAINT "bill_payments_attestation_ck" CHECK(("bill_payments"."attested_by" is null) = ("bill_payments"."attestation_note" is null) and ("bill_payments"."attested_by" is null or ("bill_payments"."state" <> 'pending' and coalesce(length(trim("bill_payments"."attestation_note")), 0) > 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_payments_submission_key` ON `bill_payments` (`working_order_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`name` text NOT NULL,
	`descriptions` text NOT NULL,
	`variant_name` text,
	`variant_descriptions` text,
	`variant_kitchen_name` text,
	`kitchen_name` text,
	`option_snapshots` text DEFAULT '[]' NOT NULL,
	`unit_name` text,
	`unit_precision` integer,
	`quantity` integer NOT NULL,
	`price_quantity` integer DEFAULT 1000 NOT NULL,
	`unit_price` integer NOT NULL,
	`vat_rate` integer NOT NULL,
	`line_total` integer NOT NULL,
	`category` text,
	`parent_line_id` text,
	`product_id` text,
	`parent_product_id` text,
	`menu_id` text,
	`menu_version_id` text,
	`line_gross` integer,
	`list_gross` integer,
	`list_unit_price_gross` integer,
	`classification` text,
	`corrects_line_id` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`corrects_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_lines_unit_precision_ck" CHECK("sale_lines"."unit_precision" is null or "sale_lines"."unit_precision" between 0 and 3),
	CONSTRAINT "sale_lines_quantity_ck" CHECK("sale_lines"."quantity" <> 0),
	CONSTRAINT "sale_lines_price_quantity_ck" CHECK("sale_lines"."price_quantity" > 0),
	CONSTRAINT "sale_lines_vat_rate_ck" CHECK("sale_lines"."vat_rate" >= 0 and "sale_lines"."vat_rate" <= 10000),
	CONSTRAINT "sale_lines_line_no_ck" CHECK("sale_lines"."line_no" >= 1)
);
--> statement-breakpoint
CREATE INDEX `sale_lines_sale_idx` ON `sale_lines` (`sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_lines_line_no_key` ON `sale_lines` (`sale_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `sale_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`settled_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_settlements_sale_key` ON `sale_settlements` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_substitutions` (
	`id` text PRIMARY KEY NOT NULL,
	`substitution_sale_id` text NOT NULL,
	`substituted_sale_id` text NOT NULL,
	FOREIGN KEY (`substitution_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`substituted_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sale_substitutions_substitution_idx` ON `sale_substitutions` (`substitution_sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_substitutions_substituted_key` ON `sale_substitutions` (`substituted_sale_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`series_id` text NOT NULL,
	`node_id` text NOT NULL,
	`invoice_number` integer NOT NULL,
	`issued_at` text NOT NULL,
	`issued_offset_minutes` integer NOT NULL,
	`total` integer NOT NULL,
	`vat_breakdown` text NOT NULL,
	`locale` text NOT NULL,
	`invoice_locales` text NOT NULL,
	`fiscal_backend` text NOT NULL,
	`fiscal_state` text NOT NULL,
	`corrects_sale_id` text,
	`counterparty_tax_id` text,
	`counterparty_legal_name` text,
	`counterparty_country_code` text,
	`counterparty_identifier_type` text,
	`counterparty_identifier_country_code` text,
	`counterparty_address` text,
	`taxpayer_domicile` text,
	`authorized_by` text,
	`operator_id` text,
	`working_order_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`series_id`) REFERENCES `invoice_series`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`corrects_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sales_total_ck" CHECK("sales"."total" >= 0 or "sales"."corrects_sale_id" is not null),
	CONSTRAINT "sales_invoice_number_ck" CHECK("sales"."invoice_number" >= 1),
	CONSTRAINT "sales_invoice_locales_ck" CHECK(json_array_length("sales"."invoice_locales") between 1 and 2),
	CONSTRAINT "sales_locale_member_ck" CHECK(instr("sales"."invoice_locales", '"' || "sales"."locale" || '"') > 0),
	CONSTRAINT "sales_issued_offset_ck" CHECK("sales"."issued_offset_minutes" between -840 and 840),
	CONSTRAINT "sales_fiscal_state_ck" CHECK("sales"."fiscal_state" in ('recorded', 'not_applicable')),
	CONSTRAINT "sales_source_ck" CHECK("sales"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "sales_source_device_ck" CHECK(("sales"."source" = 'device') = ("sales"."device_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `sales_tenant_issued_idx` ON `sales` (`issued_at`);--> statement-breakpoint
CREATE INDEX `sales_fiscal_state_idx` ON `sales` (`fiscal_state`);--> statement-breakpoint
CREATE INDEX `sales_corrects_idx` ON `sales` (`corrects_sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_series_invoice_number_key` ON `sales` (`series_id`,`invoice_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_working_order_id_key` ON `sales` (`working_order_id`);--> statement-breakpoint
CREATE TABLE `tenders` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`cash_tendered` integer,
	`tip_amount` integer DEFAULT 0 NOT NULL,
	`settled_at` text NOT NULL,
	`bill_payment_id` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tenders_amount_ck" CHECK("tenders"."amount" > 0),
	CONSTRAINT "tenders_cash_tendered_ck" CHECK("tenders"."cash_tendered" is null or ("tenders"."method" = 'cash' and "tenders"."cash_tendered" >= "tenders"."amount")),
	CONSTRAINT "tenders_tip_amount_ck" CHECK("tenders"."tip_amount" >= 0 and "tenders"."tip_amount" <= "tenders"."amount"),
	CONSTRAINT "tenders_method_ck" CHECK("tenders"."method" in ('cash', 'card', 'voucher', 'deferred', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenders_bill_payment_key` ON `tenders` (`bill_payment_id`) WHERE "tenders"."bill_payment_id" is not null;--> statement-breakpoint
CREATE INDEX `tenders_sale_idx` ON `tenders` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_voids` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`reason` text NOT NULL,
	`voided_at` text NOT NULL,
	`voided_by` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sale_voids_voided_at_idx` ON `sale_voids` (`voided_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_voids_sale_id_key` ON `sale_voids` (`sale_id`);--> statement-breakpoint
CREATE TABLE `unpaid_departures` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`recorded_by` text NOT NULL,
	`authorized_by` text NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "unpaid_departures_amount_ck" CHECK("unpaid_departures"."amount" > 0),
	CONSTRAINT "unpaid_departures_source_ck" CHECK("unpaid_departures"."source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "unpaid_departures_source_device_ck" CHECK(("unpaid_departures"."source" = 'device') = ("unpaid_departures"."device_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unpaid_departures_working_order_key` ON `unpaid_departures` (`working_order_id`);--> statement-breakpoint
CREATE TABLE `deferred_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`actor_id` text NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`node_id` text NOT NULL,
	`closed_at` text NOT NULL,
	`business_day` text NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "deferred_closures_business_day_ck" CHECK(length("deferred_closures"."business_day") = 10 and "deferred_closures"."business_day" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "deferred_closures_source_ck" CHECK("deferred_closures"."source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "deferred_closures_source_device_ck" CHECK(("deferred_closures"."source" = 'device') = ("deferred_closures"."device_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `deferred_closures_node_day_idx` ON `deferred_closures` (`node_id`,`business_day`,`closed_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deferred_closures_working_order_key` ON `deferred_closures` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deferred_closures_sale_key` ON `deferred_closures` (`sale_id`);--> statement-breakpoint
CREATE TABLE `daily_close_chain` (
	`node_id` text PRIMARY KEY NOT NULL,
	`sequence_no` integer DEFAULT 0 NOT NULL,
	`last_entry_hash` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `daily_closes` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`business_day` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`prev_entry_hash` text NOT NULL,
	`entry_hash` text NOT NULL,
	`closed_at` text NOT NULL,
	`closed_by` text NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_closes_business_day_key` ON `daily_closes` (`node_id`,`business_day`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_closes_sequence_key` ON `daily_closes` (`node_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`sale_id` text,
	`code` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`severity` text NOT NULL,
	`detected_at` text NOT NULL,
	`acknowledged_at` text,
	`acknowledged_by` text,
	`acknowledged_note` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "incidents_severity_ck" CHECK("incidents"."severity" in ('warning', 'error')),
	CONSTRAINT "incidents_code_ck" CHECK("incidents"."code" <> ''),
	CONSTRAINT "incidents_source_ck" CHECK("incidents"."source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script', 'backup')),
	CONSTRAINT "incidents_source_device_ck" CHECK(("incidents"."source" = 'device') = ("incidents"."device_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `incidents_origin_open_idx` ON `incidents` (`source`,`device_id`,`detected_at`);--> statement-breakpoint
CREATE INDEX `incidents_handled_idx` ON `incidents` (`acknowledged_at`);--> statement-breakpoint
CREATE INDEX `incidents_code_detected_idx` ON `incidents` (`code`,`detected_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `incidents_open_dedup` ON `incidents` (`source`,case when "device_id" is null then '' else "device_id" end,`code`,case when "sale_id" is null then '' else "sale_id" end) WHERE "incidents"."acknowledged_at" is null;--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deployment` (
	`id` integer PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`stamped_at` text NOT NULL,
	CONSTRAINT "deployment_singleton_ck" CHECK("deployment"."id" = 1),
	CONSTRAINT "deployment_environment_ck" CHECK("deployment"."environment" in ('production', 'preproduction'))
);
--> statement-breakpoint
CREATE TABLE `node_membership` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`term` integer NOT NULL,
	`document` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "node_membership_singleton_ck" CHECK("node_membership"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `node_sealed_state` (
	`node_id` text PRIMARY KEY NOT NULL,
	`sealed` blob NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recovery_packs` (
	`node_id` text NOT NULL,
	`number` integer NOT NULL,
	`made_at` text NOT NULL,
	`made_by` text,
	`received_at` text,
	`parts` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_packs_node_number_uq` ON `recovery_packs` (`node_id`,`number`);--> statement-breakpoint
CREATE TABLE `invoice_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`print_job_id` text,
	`page_printer_id` text,
	`request_key` text NOT NULL,
	`medium` text NOT NULL,
	`designation` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`generation` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`recipient` text,
	`made_by_retry` integer DEFAULT false NOT NULL,
	`printer_chosen` integer DEFAULT false NOT NULL,
	`person_id` text,
	`created_at` text NOT NULL,
	`next_attempt_at` text NOT NULL,
	`completed_at` text,
	`claim_token_hash` text,
	`claimed_by` text,
	`claimed_agent_id` text,
	`claimed_at` text,
	`expired_at` text,
	`failure_code` text,
	`reported_outcome` text,
	`reported_at` text,
	`reported_failure_code` text,
	`printer_hold` text,
	FOREIGN KEY (`print_job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_printer_id`) REFERENCES `page_printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`claimed_agent_id`) REFERENCES `print_agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invoice_deliveries_medium_ck" CHECK("invoice_deliveries"."medium" in ('email', 'a4', 'receipt')),
	CONSTRAINT "invoice_deliveries_designation_ck" CHECK("invoice_deliveries"."designation" in ('original', 'duplicate')),
	CONSTRAINT "invoice_deliveries_status_ck" CHECK("invoice_deliveries"."status" in ('queued', 'sending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "invoice_deliveries_generation_ck" CHECK("invoice_deliveries"."generation" > 0),
	CONSTRAINT "invoice_deliveries_attempts_ck" CHECK("invoice_deliveries"."attempts" >= 0),
	CONSTRAINT "invoice_deliveries_person_ck" CHECK("invoice_deliveries"."person_id" is not null or "invoice_deliveries"."medium" = 'receipt'),
	CONSTRAINT "invoice_deliveries_email_ck" CHECK(("invoice_deliveries"."medium" = 'email') = ("invoice_deliveries"."recipient" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_print_job_uq` ON `invoice_deliveries` (`print_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_request_uq` ON `invoice_deliveries` (`sale_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_generation_uq` ON `invoice_deliveries` (`sale_id`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_active_uq` ON `invoice_deliveries` (`sale_id`) WHERE "invoice_deliveries"."status" in ('queued', 'sending');--> statement-breakpoint
CREATE TABLE `page_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`resource_path` text NOT NULL,
	`document_format` text NOT NULL,
	`supported_formats` text NOT NULL,
	`media` text NOT NULL,
	`resolution_dpi` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`agent_id` text,
	FOREIGN KEY (`agent_id`) REFERENCES `print_agents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "page_printers_format_ck" CHECK("page_printers"."document_format" in ('application/pdf', 'image/pwg-raster', 'image/urf')),
	CONSTRAINT "page_printers_media_ck" CHECK("page_printers"."media" in ('iso_a4_210x297mm', 'na_letter_8.5x11in')),
	CONSTRAINT "page_printers_port_ck" CHECK("page_printers"."port" between 1 and 65535),
	CONSTRAINT "page_printers_resolution_ck" CHECK("page_printers"."resolution_dpi" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_printers_endpoint_uq` ON `page_printers` (`host`,`port`,`resource_path`);--> statement-breakpoint
CREATE TABLE `tender_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`tender_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`applied_amount` integer NOT NULL,
	`tip_amount` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`authorized_by` text NOT NULL,
	`requested_by` text NOT NULL,
	`attested_by` text,
	`attestation_note` text,
	`source` text NOT NULL,
	`device_id` text,
	`node_id` text NOT NULL,
	`method` text NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`provider` text,
	`provider_payment_ref` text,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`failed_at` text,
	`sent_at` text,
	`send_count` integer DEFAULT 0 NOT NULL,
	`refs_before_send` text,
	`provider_refund_ref` text,
	`provider_status` text,
	`last_lookup_at` text,
	`next_retry_at` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tender_refunds_source_ck" CHECK("tender_refunds"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "tender_refunds_source_device_ck" CHECK(("tender_refunds"."source" = 'device') = ("tender_refunds"."device_id" is not null)),
	CONSTRAINT "tender_refunds_state_ck" CHECK("tender_refunds"."state" in ('pending', 'completed', 'failed')),
	CONSTRAINT "tender_refunds_method_ck" CHECK("tender_refunds"."method" in ('cash', 'card')),
	CONSTRAINT "tender_refunds_amounts_ck" CHECK(typeof("tender_refunds"."applied_amount") = 'integer' and typeof("tender_refunds"."tip_amount") = 'integer' and "tender_refunds"."applied_amount" >= 0 and "tender_refunds"."tip_amount" >= 0 and "tender_refunds"."applied_amount" + "tender_refunds"."tip_amount" between 1 and 99999999999999),
	CONSTRAINT "tender_refunds_reason_ck" CHECK(length(trim("tender_refunds"."reason")) > 0),
	CONSTRAINT "tender_refunds_completed_at_ck" CHECK(("tender_refunds"."state" = 'completed') = ("tender_refunds"."completed_at" is not null)),
	CONSTRAINT "tender_refunds_failed_at_ck" CHECK(("tender_refunds"."state" = 'failed') = ("tender_refunds"."failed_at" is not null)),
	CONSTRAINT "tender_refunds_sent_ck" CHECK(typeof("tender_refunds"."send_count") = 'integer' and "tender_refunds"."send_count" >= 0 and ("tender_refunds"."send_count" = 0) = ("tender_refunds"."sent_at" is null)),
	CONSTRAINT "tender_refunds_provider_ck" CHECK(("tender_refunds"."manual" in (0, 1)) and ("tender_refunds"."method" = 'card' or "tender_refunds"."manual" = 0) and (("tender_refunds"."method" = 'card' and "tender_refunds"."manual" = 0 and coalesce(length(trim("tender_refunds"."provider")), 0) > 0 and coalesce(length(trim("tender_refunds"."provider_payment_ref")), 0) > 0) or (("tender_refunds"."method" = 'cash' or "tender_refunds"."manual" = 1) and "tender_refunds"."provider" is null and "tender_refunds"."provider_payment_ref" is null))),
	CONSTRAINT "tender_refunds_provider_status_ck" CHECK("tender_refunds"."provider_status" in ('pending', 'completed', 'failed')),
	CONSTRAINT "tender_refunds_refs_ck" CHECK(case when "tender_refunds"."refs_before_send" is null then 1 when json_valid("tender_refunds"."refs_before_send") then json_type("tender_refunds"."refs_before_send") = 'array' else 0 end),
	CONSTRAINT "tender_refunds_attestation_ck" CHECK(("tender_refunds"."attested_by" is null) = ("tender_refunds"."attestation_note" is null) and ("tender_refunds"."attested_by" is null or ("tender_refunds"."state" <> 'pending' and length(trim("tender_refunds"."attestation_note")) > 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tender_refunds_pending_tender_key` ON `tender_refunds` (`tender_id`) WHERE "tender_refunds"."state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX `tender_refunds_pending_capture_key` ON `tender_refunds` (`provider`,`provider_payment_ref`) WHERE "tender_refunds"."state" = 'pending' and "tender_refunds"."provider" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `tender_refunds_provider_event_key` ON `tender_refunds` (`provider`,`provider_payment_ref`,`provider_refund_ref`) WHERE "tender_refunds"."provider_refund_ref" is not null;--> statement-breakpoint
CREATE INDEX `tender_refunds_recovery_idx` ON `tender_refunds` (`state`,`next_retry_at`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tender_refunds_submission_key` ON `tender_refunds` (`sale_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `bill_edit_states` (
	`bill_id` text PRIMARY KEY NOT NULL,
	`editor_id` text,
	`editor_version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bill_edit_states_version_ck" CHECK("bill_edit_states"."editor_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE `tenant_credentials` (
	`purpose` text PRIMARY KEY NOT NULL,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`auth_tag` blob NOT NULL,
	`key_version` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tenant_credentials_key_version_ck" CHECK("tenant_credentials"."key_version" >= 1),
	CONSTRAINT "tenant_credentials_iv_len_ck" CHECK(octet_length("tenant_credentials"."iv") = 12),
	CONSTRAINT "tenant_credentials_auth_tag_len_ck" CHECK(octet_length("tenant_credentials"."auth_tag") = 16),
	CONSTRAINT "tenant_credentials_purpose_ck" CHECK(length("tenant_credentials"."purpose") > 0)
);
--> statement-breakpoint
CREATE TABLE `media_image_blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	CONSTRAINT "media_image_blobs_hash_ck" CHECK(length("media_image_blobs"."hash") = 64 and "media_image_blobs"."hash" not glob '*[^0-9a-f]*' and instr("media_image_blobs"."hash", char(0)) = 0)
);
--> statement-breakpoint
CREATE TABLE `media_image_data` (
	`image_id` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `media_images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `media_image_edits` (
	`image_id` text PRIMARY KEY NOT NULL,
	`source_hash` text,
	`focus_x` integer DEFAULT 5000 NOT NULL,
	`focus_y` integer DEFAULT 5000 NOT NULL,
	`zoom` integer DEFAULT 100 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`original_filename` text,
	FOREIGN KEY (`image_id`) REFERENCES `media_images`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_hash`) REFERENCES `media_image_blobs`(`hash`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_image_edits_focus_x_ck" CHECK(typeof("media_image_edits"."focus_x") = 'integer' and "media_image_edits"."focus_x" between 0 and 10000),
	CONSTRAINT "media_image_edits_focus_y_ck" CHECK(typeof("media_image_edits"."focus_y") = 'integer' and "media_image_edits"."focus_y" between 0 and 10000),
	CONSTRAINT "media_image_edits_zoom_ck" CHECK(typeof("media_image_edits"."zoom") = 'integer' and "media_image_edits"."zoom" between 100 and 400),
	CONSTRAINT "media_image_edits_revision_ck" CHECK(typeof("media_image_edits"."revision") = 'integer' and "media_image_edits"."revision" between 1 and 9007199254740991),
	CONSTRAINT "media_image_edits_filename_ck" CHECK("media_image_edits"."original_filename" is null or (length("media_image_edits"."original_filename") <= 255 and instr("media_image_edits"."original_filename", char(0)) = 0 and instr("media_image_edits"."original_filename", char(10)) = 0 and instr("media_image_edits"."original_filename", char(13)) = 0))
);
--> statement-breakpoint
CREATE TABLE `media_images` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`names` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "media_images_filename_ck" CHECK(substr("media_images"."filename", 1, 64) not glob '*[^0-9a-f]*' and (substr("media_images"."filename", 65) glob '.jpg' or substr("media_images"."filename", 65) glob '.png' or substr("media_images"."filename", 65) glob '.webp')),
	CONSTRAINT "media_images_names_ck" CHECK(json_type("media_images"."names") = 'object')
);
--> statement-breakpoint
CREATE INDEX `media_images_date_idx` ON `media_images` (`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_images_filename_key` ON `media_images` (`filename`);--> statement-breakpoint
CREATE TABLE `handover_activations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`scenario` text NOT NULL,
	`source_node_id` text NOT NULL,
	`destination_node_id` text NOT NULL,
	`evidence` text NOT NULL,
	`person_id` text NOT NULL,
	`activated_at` text NOT NULL,
	FOREIGN KEY (`source_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "handover_activations_scenario_ck" CHECK("handover_activations"."scenario" in ('controlled', 'emergency'))
);
--> statement-breakpoint
CREATE INDEX `handover_activations_destination_idx` ON `handover_activations` (`destination_node_id`);--> statement-breakpoint
CREATE TABLE `handover_return_batches` (
	`operation_id` text NOT NULL,
	`inventory` text NOT NULL,
	`batch_index` integer NOT NULL,
	`batch_count` integer NOT NULL,
	`batch_digest` text NOT NULL,
	PRIMARY KEY(`operation_id`, `inventory`, `batch_index`),
	FOREIGN KEY (`operation_id`) REFERENCES `handover_activations`(`operation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "handover_return_batches_bounds_ck" CHECK(typeof("handover_return_batches"."batch_index") = 'integer' and typeof("handover_return_batches"."batch_count") = 'integer' and "handover_return_batches"."batch_index" >= 0 and "handover_return_batches"."batch_index" < "handover_return_batches"."batch_count" and "handover_return_batches"."batch_count" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `device_profile_admission_roles` (
	`device_profile_id` text NOT NULL,
	`staff_role_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `staff_role_id`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_role_id`) REFERENCES `staff_roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `google_oidc_states` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`mode` text NOT NULL,
	`state_hash` text NOT NULL,
	`nonce` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "google_oidc_states_mode_ck" CHECK("google_oidc_states"."mode" in ('login', 'link')),
	CONSTRAINT "google_oidc_states_state_hash_ck" CHECK(length("google_oidc_states"."state_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE `management_account_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`purpose` text NOT NULL,
	`target_email` text,
	`token_hash` text NOT NULL,
	`code_hash` text,
	`code_expires_at` text,
	`code_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "management_account_actions_purpose_ck" CHECK("management_account_actions"."purpose" in ('invitation', 'password_reset', 'email_change')),
	CONSTRAINT "management_account_actions_target_email_ck" CHECK(("management_account_actions"."purpose" = 'email_change') = ("management_account_actions"."target_email" is not null)),
	CONSTRAINT "management_account_actions_token_hash_ck" CHECK(length("management_account_actions"."token_hash") = 64),
	CONSTRAINT "management_account_actions_code_hash_ck" CHECK("management_account_actions"."code_hash" is null or length("management_account_actions"."code_hash") = 64),
	CONSTRAINT "management_account_actions_code_attempts_ck" CHECK("management_account_actions"."code_attempts" >= 0),
	CONSTRAINT "management_account_actions_expiry_ck" CHECK("management_account_actions"."expires_at" > "management_account_actions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_account_actions_token_hash_uq` ON `management_account_actions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `management_account_actions_person_idx` ON `management_account_actions` (`person_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `management_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`ended_at` text,
	`proved_at` text,
	`proof_method` text,
	CONSTRAINT "management_sessions_token_hash_ck" CHECK(length("management_sessions"."token_hash") = 64),
	CONSTRAINT "management_sessions_proof_method_ck" CHECK("management_sessions"."proof_method" in ('password', 'passkey', 'recovery-code'))
);
--> statement-breakpoint
CREATE INDEX `management_sessions_open_idx` ON `management_sessions` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `management_sessions_token_hash_uq` ON `management_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `person_staff_roles` (
	`person_id` text NOT NULL,
	`staff_role_id` text NOT NULL,
	PRIMARY KEY(`person_id`, `staff_role_id`),
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_role_id`) REFERENCES `staff_roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`display_name_folded` text,
	`first_names` text,
	`last_names` text,
	`telephone` text,
	`pin_hash` text,
	`password_hash` text,
	`totp_secret` text,
	`locale` text,
	`passkey_offered_at` text,
	`email` text,
	`email_folded` text,
	`pending_email` text,
	`pending_email_folded` text,
	`email_verified_at` text,
	`google_subject` text,
	`role` text DEFAULT 'staff' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "persons_display_name_ck" CHECK(length("persons"."display_name") > 0),
	CONSTRAINT "persons_first_names_ck" CHECK("persons"."first_names" is null or length("persons"."first_names") > 0),
	CONSTRAINT "persons_last_names_ck" CHECK("persons"."last_names" is null or length("persons"."last_names") > 0),
	CONSTRAINT "persons_telephone_ck" CHECK("persons"."telephone" is null or length("persons"."telephone") > 0),
	CONSTRAINT "persons_pin_hash_ck" CHECK("persons"."pin_hash" is null or length("persons"."pin_hash") > 0),
	CONSTRAINT "persons_password_hash_ck" CHECK("persons"."password_hash" is null or length("persons"."password_hash") > 0),
	CONSTRAINT "persons_totp_secret_ck" CHECK("persons"."totp_secret" is null or length("persons"."totp_secret") > 0),
	CONSTRAINT "persons_locale_ck" CHECK("persons"."locale" is null or length("persons"."locale") > 0),
	CONSTRAINT "persons_pending_email_ck" CHECK("persons"."pending_email" is null or length("persons"."pending_email") > 0),
	CONSTRAINT "persons_role_ck" CHECK("persons"."role" in ('staff', 'supervisor', 'manager', 'admin')),
	CONSTRAINT "persons_status_ck" CHECK("persons"."status" in ('pending', 'active', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_email_uq` ON `persons` (case when "email_folded" is null then lower("email") else "email_folded" end) WHERE "persons"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_live_display_name_uq` ON `persons` (case when "display_name_folded" is null then lower(trim("display_name")) else "display_name_folded" end) WHERE "persons"."status" <> 'suspended';--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_google_subject_uq` ON `persons` (`google_subject`) WHERE "persons"."google_subject" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_pending_email_uq` ON `persons` (case when "pending_email_folded" is null then lower("pending_email") else "pending_email_folded" end) WHERE "persons"."pending_email" is not null;--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recovery_codes_hash_ck" CHECK(length("recovery_codes"."code_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX `recovery_codes_person_idx` ON `recovery_codes` (`person_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`person_id` text NOT NULL,
	`device_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sessions_token_hash_ck" CHECK(length("sessions"."token_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX `sessions_open_idx` ON `sessions` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `staff_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'grey' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`hidden_at` text,
	CONSTRAINT "staff_roles_name_ck" CHECK(trim("staff_roles"."name") <> ''),
	CONSTRAINT "staff_roles_colour_ck" CHECK("staff_roles"."colour" in ('red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'purple', 'magenta', 'pink', 'brown', 'grey'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_roles_name_key` ON `staff_roles` (`name`) WHERE "staff_roles"."hidden_at" is null;--> statement-breakpoint
CREATE TABLE `totp_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "totp_enrollments_secret_ck" CHECK(length("totp_enrollments"."encrypted_secret") > 0)
);
--> statement-breakpoint
CREATE INDEX `totp_enrollments_person_idx` ON `totp_enrollments` (`person_id`);--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`challenge` text NOT NULL,
	`created_at` text NOT NULL,
	`purpose` text NOT NULL,
	CONSTRAINT "webauthn_challenges_purpose_ck" CHECK("webauthn_challenges"."purpose" in ('registration', 'login', 'check'))
);
--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`aaguid` text,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `webauthn_credentials_person_idx` ON `webauthn_credentials` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `webauthn_credentials_credential_id_uq` ON `webauthn_credentials` (`credential_id`);--> statement-breakpoint
CREATE TABLE `menu_details` (
	`menu_id` text PRIMARY KEY NOT NULL,
	`root_section_id` text NOT NULL,
	`default_home_layout_id` text NOT NULL,
	`handheld_columns` integer DEFAULT 3 NOT NULL,
	`handheld_tiles` text DEFAULT 'colours' NOT NULL,
	`handheld_order` text DEFAULT 'home_first' NOT NULL,
	`till_columns` integer DEFAULT 6 NOT NULL,
	`till_tiles` text DEFAULT 'colours' NOT NULL,
	`till_order` text DEFAULT 'home_first' NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`root_section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_home_layout_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_details_root_uq` ON `menu_details` (`root_section_id`);--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`product_id` text NOT NULL,
	`gross_price` integer,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_items_gross_price_ck" CHECK("menu_items"."gross_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_id_product_key` ON `menu_items` (`id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_menu_product_key` ON `menu_items` (`menu_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `category_details` (
	`category_id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`color` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `category_details_parent_idx` ON `category_details` (`parent_id`);--> statement-breakpoint
CREATE TABLE `product_units` (
	`product_id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `product_units_unit_idx` ON `product_units` (`unit_id`);--> statement-breakpoint
CREATE TABLE `unit_seed_states` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	CONSTRAINT "unit_seed_states_singleton_ck" CHECK("unit_seed_states"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`seed_key` text,
	`staff_name` text NOT NULL,
	`staff_abbreviation` text NOT NULL,
	`name` text NOT NULL,
	`abbreviation` text NOT NULL,
	`precision` integer NOT NULL,
	`hardware_unit` text,
	`measure` integer DEFAULT false NOT NULL,
	CONSTRAINT "units_precision_ck" CHECK("units"."precision" between 0 and 3),
	CONSTRAINT "units_hardware_unit_ck" CHECK("units"."hardware_unit" in ('kg', 'g', 'mg'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_seed_key_key` ON `units` (`seed_key`);--> statement-breakpoint
CREATE TABLE `menu_item_variant_overrides` (
	`menu_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`price` integer,
	PRIMARY KEY(`menu_item_id`, `variant_id`),
	FOREIGN KEY (`menu_item_id`,`product_id`) REFERENCES `menu_items`(`id`,`product_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`,`variant_id`) REFERENCES `products`(`parent_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_item_variant_overrides_price_ck" CHECK("menu_item_variant_overrides"."price" >= 0),
	CONSTRAINT "menu_item_variant_overrides_overrides_ck" CHECK("menu_item_variant_overrides"."price" is not null)
);
--> statement-breakpoint
CREATE TABLE `option_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`customer_name` text,
	`kitchen_name` text,
	`available` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `option_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `option_labels_list_sort_idx` ON `option_labels` (`list_id`,`sort`);--> statement-breakpoint
CREATE TABLE `option_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`customer_name` text,
	`kitchen_name` text,
	`default_label_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `extra_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`max_quantity` integer DEFAULT 1,
	`preselected` integer DEFAULT false NOT NULL,
	`price` integer,
	`portion` integer DEFAULT 1000 NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `extra_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "extra_list_items_qty_ck" CHECK("extra_list_items"."max_quantity" >= 1),
	CONSTRAINT "extra_list_items_price_ck" CHECK("extra_list_items"."price" >= 0),
	CONSTRAINT "extra_list_items_portion_ck" CHECK("extra_list_items"."portion" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extra_list_items_list_product_uq` ON `extra_list_items` (`list_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `extra_list_items_list_sort_idx` ON `extra_list_items` (`list_id`,`sort`);--> statement-breakpoint
CREATE TABLE `extra_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`customer_name` text,
	`kitchen_name` text,
	`min_picks` integer DEFAULT 0 NOT NULL,
	`max_picks` integer,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT "extra_lists_picks_ck" CHECK("extra_lists"."min_picks" >= 0 and ("extra_lists"."max_picks" is null or "extra_lists"."max_picks" >= "extra_lists"."min_picks"))
);
--> statement-breakpoint
CREATE TABLE `product_modifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`extra_list_id` text,
	`option_list_id` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`extra_list_id`) REFERENCES `extra_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_list_id`) REFERENCES `option_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_modifiers_one_reference_ck" CHECK(("product_modifiers"."extra_list_id" is null) <> ("product_modifiers"."option_list_id" is null))
);
--> statement-breakpoint
CREATE INDEX `product_modifiers_product_sort_idx` ON `product_modifiers` (`product_id`,`sort`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_modifiers_product_extra_uq` ON `product_modifiers` (`product_id`,`extra_list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_modifiers_product_option_uq` ON `product_modifiers` (`product_id`,`option_list_id`);--> statement-breakpoint
CREATE TABLE `section_members` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text,
	`child_section_id` text,
	`missing_name` text,
	`show_as_folder` integer DEFAULT true NOT NULL,
	`folder_overrides` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "section_members_one_ref_ck" CHECK(("section_members"."product_id" is null or "section_members"."child_section_id" is null) and (("section_members"."product_id" is null and "section_members"."child_section_id" is null) = ("section_members"."missing_name" is not null)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `section_members_product_uq` ON `section_members` (`section_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `section_members_child_uq` ON `section_members` (`section_id`,`child_section_id`);--> statement-breakpoint
CREATE INDEX `section_members_order_idx` ON `section_members` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `section_members_child_idx` ON `section_members` (`child_section_id`);--> statement-breakpoint
CREATE INDEX `section_members_product_idx` ON `section_members` (`product_id`);--> statement-breakpoint
CREATE INDEX `section_members_folder_image_idx` ON `section_members` ("folder_overrides" ->> '$.image') WHERE "section_members"."folder_overrides" ->> '$.image' is not null;--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`internal_name` text NOT NULL,
	`names` text DEFAULT '{}' NOT NULL,
	`role` text DEFAULT 'section' NOT NULL,
	`owner_menu_id` text NOT NULL,
	`image` text,
	`color` text,
	FOREIGN KEY (`owner_menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sections_role_ck" CHECK("sections"."role" in ('section', 'menu_root', 'home_layout'))
);
--> statement-breakpoint
CREATE INDEX `sections_owner_menu_idx` ON `sections` (`owner_menu_id`);--> statement-breakpoint
CREATE TABLE `menu_publications` (
	`menu_id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`published_at` text NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`,`menu_id`) REFERENCES `menu_versions`(`id`,`menu_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `menu_scheduled_publications` (
	`version_id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`activates_at` text NOT NULL,
	`queued_at` text NOT NULL,
	`queued_by` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`activated_at` text,
	`cancelled_at` text,
	`cancelled_by` text,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`,`menu_id`) REFERENCES `menu_versions`(`id`,`menu_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_scheduled_publications_state_ck" CHECK("menu_scheduled_publications"."state" in ('queued', 'activated', 'cancelled')),
	CONSTRAINT "menu_scheduled_publications_settled_ck" CHECK(("menu_scheduled_publications"."state" = 'queued' and "menu_scheduled_publications"."activated_at" is null and "menu_scheduled_publications"."cancelled_at" is null and "menu_scheduled_publications"."cancelled_by" is null) or ("menu_scheduled_publications"."state" = 'activated' and "menu_scheduled_publications"."activated_at" is not null and "menu_scheduled_publications"."cancelled_at" is null and "menu_scheduled_publications"."cancelled_by" is null) or ("menu_scheduled_publications"."state" = 'cancelled' and "menu_scheduled_publications"."cancelled_at" is not null and "menu_scheduled_publications"."cancelled_by" is not null and "menu_scheduled_publications"."activated_at" is null)),
	CONSTRAINT "menu_scheduled_publications_after_queue_ck" CHECK("menu_scheduled_publications"."activates_at" > "menu_scheduled_publications"."queued_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_scheduled_publications_queued_time_uq` ON `menu_scheduled_publications` (`menu_id`,`activates_at`) WHERE "menu_scheduled_publications"."state" = 'queued';--> statement-breakpoint
CREATE TABLE `menu_version_images` (
	`version_id` text NOT NULL,
	`filename` text NOT NULL,
	PRIMARY KEY(`version_id`, `filename`),
	FOREIGN KEY (`version_id`) REFERENCES `menu_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `menu_version_images_filename_idx` ON `menu_version_images` (`filename`);--> statement-breakpoint
CREATE TABLE `menu_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`number` integer NOT NULL,
	`document` text NOT NULL,
	`content_hash` text NOT NULL,
	`published_at` text NOT NULL,
	`published_by` text NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_versions_number_ck" CHECK("menu_versions"."number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_versions_menu_number_uq` ON `menu_versions` (`menu_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_versions_id_menu_key` ON `menu_versions` (`id`,`menu_id`);--> statement-breakpoint
CREATE TABLE `catalogue_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`default_product_vat_class` text DEFAULT 'general' NOT NULL,
	`default_color` text,
	CONSTRAINT "catalogue_settings_singleton_ck" CHECK("catalogue_settings"."id" = 1),
	CONSTRAINT "catalogue_settings_vat_class_ck" CHECK("catalogue_settings"."default_product_vat_class" in ('general', 'reduced', 'super_reduced', 'zero'))
);
--> statement-breakpoint
CREATE TABLE `content_suggestion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`position` integer NOT NULL,
	`state` text NOT NULL,
	`refusal` text,
	`fits` integer,
	`failure` text,
	`cloud_job_id` text,
	`body` text,
	`sent` text NOT NULL,
	`run_total` integer NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`dropped` integer DEFAULT 0 NOT NULL,
	`failed_refs` text NOT NULL,
	`released` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	`opened_at` text,
	`collect_cursor` integer,
	`collected_refs` text DEFAULT '[]' NOT NULL,
	CONSTRAINT "content_suggestion_jobs_state_ck" CHECK("content_suggestion_jobs"."state" in ('submitting', 'running', 'done', 'partly_done', 'failed', 'expired', 'refused')),
	CONSTRAINT "content_suggestion_jobs_refusal_ck" CHECK("content_suggestion_jobs"."refusal" in ('consent', 'limit', 'job_running')),
	CONSTRAINT "content_suggestion_jobs_failure_ck" CHECK("content_suggestion_jobs"."failure" in ('provider', 'not_connected', 'rejected', 'consent', 'limit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_suggestion_jobs_run_position_key` ON `content_suggestion_jobs` (`run_id`,`position`);--> statement-breakpoint
CREATE TABLE `content_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`language` text,
	`text` text,
	`expected` text,
	`fix_field` text,
	`fix_wrong` text,
	`fix_right` text,
	`placeholder` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `content_suggestion_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "content_suggestions_kind_ck" CHECK("content_suggestions"."kind" in ('product', 'variant', 'option_list', 'option_label', 'extra_list', 'menu', 'section', 'included_menu', 'unit')),
	CONSTRAINT "content_suggestions_name_ck" CHECK("content_suggestions"."text" is null or "content_suggestions"."expected" is not null),
	CONSTRAINT "content_suggestions_fix_ck" CHECK(("content_suggestions"."fix_field" is null) = ("content_suggestions"."fix_wrong" is null) and ("content_suggestions"."fix_field" is null) = ("content_suggestions"."fix_right" is null)),
	CONSTRAINT "content_suggestions_text_language_ck" CHECK("content_suggestions"."text" is null or "content_suggestions"."language" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_suggestions_item_row_key` ON `content_suggestions` (`kind`,`item_id`) WHERE "content_suggestions"."language" is null;--> statement-breakpoint
CREATE INDEX `content_suggestions_language_idx` ON `content_suggestions` (`language`);--> statement-breakpoint
CREATE INDEX `content_suggestions_job_idx` ON `content_suggestions` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_suggestions_item_language_key` ON `content_suggestions` (`kind`,`item_id`,`language`);--> statement-breakpoint
CREATE TABLE `adjustment_reasons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`names` text NOT NULL,
	`kind` text NOT NULL,
	`actions` text NOT NULL,
	`max_percent` integer,
	`max_amount` integer,
	`note_required` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "adjustment_reasons_name_ck" CHECK(length(trim("adjustment_reasons"."name")) > 0),
	CONSTRAINT "adjustment_reasons_actions_ck" CHECK(json_array_length("adjustment_reasons"."actions") > 0),
	CONSTRAINT "adjustment_reasons_max_percent_ck" CHECK("adjustment_reasons"."max_percent" is null or "adjustment_reasons"."max_percent" between 0 and 10000),
	CONSTRAINT "adjustment_reasons_max_amount_ck" CHECK("adjustment_reasons"."max_amount" is null or "adjustment_reasons"."max_amount" >= 0),
	CONSTRAINT "adjustment_reasons_kind_ck" CHECK("adjustment_reasons"."kind" in ('void', 'comp')),
	CONSTRAINT "adjustment_reasons_kind_fields_ck" CHECK(("adjustment_reasons"."kind" = 'void' and "adjustment_reasons"."max_percent" is null and "adjustment_reasons"."max_amount" is null) or "adjustment_reasons"."kind" = 'comp'),
	CONSTRAINT "adjustment_reasons_position_ck" CHECK("adjustment_reasons"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_reasons_name_key` ON `adjustment_reasons` (`name`);--> statement-breakpoint
CREATE TABLE `adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`line_id` text,
	`splits` text NOT NULL,
	`comped_extras` text DEFAULT '[]' NOT NULL,
	`line_name` text,
	`line_quantity` integer,
	`line_list_unit_price` integer,
	`credited_to` text,
	`reason_id` text NOT NULL,
	`reason_name` text NOT NULL,
	`policy_snapshot` text NOT NULL,
	`action` text NOT NULL,
	`quantity` integer,
	`percent_bp` integer,
	`before_amount` integer NOT NULL,
	`after_amount` integer NOT NULL,
	`reduction` integer NOT NULL,
	`nominal_value` integer NOT NULL,
	`requested_by` text NOT NULL,
	`approved_by` text,
	`note` text,
	`stage` text,
	`by_guest` integer DEFAULT false NOT NULL,
	`charge_kept` integer DEFAULT false NOT NULL,
	`preparation_started` integer,
	`refund_handoff` integer DEFAULT false NOT NULL,
	`refund_value` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "adjustments_action_ck" CHECK("adjustments"."action" in ('cancel', 'comp', 'discount_percent', 'discount_amount')),
	CONSTRAINT "adjustments_stage_ck" CHECK("adjustments"."stage" in ('unsent', 'held', 'fired', 'served')),
	CONSTRAINT "adjustments_reason_name_ck" CHECK(length(trim("adjustments"."reason_name")) > 0),
	CONSTRAINT "adjustments_amounts_ck" CHECK("adjustments"."after_amount" >= 0 and "adjustments"."after_amount" <= "adjustments"."before_amount"
          and "adjustments"."reduction" = "adjustments"."before_amount" - "adjustments"."after_amount" and "adjustments"."nominal_value" >= 0),
	CONSTRAINT "adjustments_percent_ck" CHECK(("adjustments"."action" = 'discount_percent') = ("adjustments"."percent_bp" is not null)
          and ("adjustments"."percent_bp" is null or "adjustments"."percent_bp" between 1 and 10000)),
	CONSTRAINT "adjustments_line_level_ck" CHECK("adjustments"."line_id" is null or ("adjustments"."line_name" is not null and "adjustments"."stage" is not null
          and "adjustments"."line_quantity" is not null and "adjustments"."line_quantity" > 0
          and "adjustments"."line_list_unit_price" is not null and "adjustments"."line_list_unit_price" >= 0
          and "adjustments"."quantity" is not null and "adjustments"."quantity" > 0
          and "adjustments"."quantity" <= "adjustments"."line_quantity")),
	CONSTRAINT "adjustments_bill_level_ck" CHECK("adjustments"."line_id" is not null or ("adjustments"."line_name" is null and "adjustments"."line_quantity" is null
          and "adjustments"."line_list_unit_price" is null and "adjustments"."credited_to" is null and "adjustments"."quantity" is null
          and "adjustments"."stage" is null and "adjustments"."action" in ('discount_percent', 'discount_amount')))
);
--> statement-breakpoint
CREATE INDEX `adjustments_order_reason_idx` ON `adjustments` (`working_order_id`,`reason_id`);--> statement-breakpoint
CREATE INDEX `adjustments_requested_by_idx` ON `adjustments` (`requested_by`);--> statement-breakpoint
CREATE INDEX `adjustments_approved_by_idx` ON `adjustments` (`approved_by`);--> statement-breakpoint
CREATE TABLE `adjustment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`adjustment_id` text NOT NULL,
	`tender_refund_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`adjustment_id`) REFERENCES `adjustments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tender_refund_id`) REFERENCES `tender_refunds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "adjustment_refunds_amount_ck" CHECK("adjustment_refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_refunds_adjustment_refund_key` ON `adjustment_refunds` (`adjustment_id`,`tender_refund_id`);--> statement-breakpoint
CREATE INDEX `adjustment_refunds_tender_refund_idx` ON `adjustment_refunds` (`tender_refund_id`);--> statement-breakpoint
CREATE TABLE `adjustment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`adjustment_id` text NOT NULL,
	`line_id` text NOT NULL,
	`reduction` integer NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`adjustment_id`) REFERENCES `adjustments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_lines_adjustment_line_key` ON `adjustment_lines` (`adjustment_id`,`line_id`);--> statement-breakpoint
CREATE INDEX `adjustment_lines_line_idx` ON `adjustment_lines` (`line_id`);--> statement-breakpoint
CREATE TABLE `department_sale_policies` (
	`department_id` text PRIMARY KEY NOT NULL,
	`order_start` text DEFAULT 'counter' NOT NULL,
	`paid_when` text DEFAULT 'prepay' NOT NULL,
	`collection_number` text DEFAULT 'none' NOT NULL,
	`print_trading_name` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_sale_policies_order_start_ck" CHECK("department_sale_policies"."order_start" in ('table', 'counter')),
	CONSTRAINT "department_sale_policies_paid_when_ck" CHECK("department_sale_policies"."paid_when" in ('prepay', 'ticket_then_pay')),
	CONSTRAINT "department_sale_policies_collection_number_ck" CHECK("department_sale_policies"."collection_number" in ('none', 'numbered'))
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`trading_name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`needs_clearing` integer DEFAULT false NOT NULL,
	`late_send_needs_manager` integer DEFAULT false NOT NULL,
	`release_reminder_minutes` integer DEFAULT 10,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_name_key` ON `departments` (`name`) WHERE "departments"."active" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `departments_one_default_key` ON `departments` (`is_default`) WHERE "departments"."is_default";--> statement-breakpoint
CREATE TABLE `device_profile_service_access` (
	`device_profile_id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`every_zone` integer DEFAULT false NOT NULL,
	`starting_zone_id` text NOT NULL,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`starting_zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_profile_zones` (
	`device_profile_id` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `zone_id`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profile_service_access`(`device_profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_service_contexts` (
	`working_order_id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`department_id` text NOT NULL,
	`service_mode` text NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_service_contexts_mode_ck" CHECK("order_service_contexts"."service_mode" in ('table_tab','prepay','ticket_then_pay'))
);
--> statement-breakpoint
CREATE TABLE `sale_receipt_headers` (
	`sale_id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`trading_name` text NOT NULL,
	`print_trading_name` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `working_line_contexts` (
	`working_order_line_id` text PRIMARY KEY NOT NULL,
	`menu_item_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`menu_version_id` text,
	`menu_name` text NOT NULL,
	`department_id` text NOT NULL,
	`department_name` text NOT NULL,
	`category_name` text NOT NULL,
	`unit_id` text NOT NULL,
	`unit_name` text NOT NULL,
	`unit_precision` integer NOT NULL,
	`sold_in_each` integer DEFAULT false NOT NULL,
	`hardware_unit` text,
	`vat_class` text NOT NULL,
	`allergens` text,
	`sent_nutrition` text,
	`diet` text,
	`diet_override` text,
	`late_period_name` text,
	`late_confirmed_by` text,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_version_id`) REFERENCES `menu_versions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "working_line_contexts_unit_precision_ck" CHECK("working_line_contexts"."unit_precision" between 0 and 3),
	CONSTRAINT "working_line_contexts_hardware_unit_ck" CHECK("working_line_contexts"."hardware_unit" is null or "working_line_contexts"."hardware_unit" in ('kg','g','mg')),
	CONSTRAINT "working_line_contexts_vat_class_ck" CHECK("working_line_contexts"."vat_class" in ('general','reduced','super_reduced','zero'))
);
--> statement-breakpoint
CREATE TABLE `kitchen_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`station_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`order_label` text NOT NULL,
	`kind` text NOT NULL,
	`line_name` text NOT NULL,
	`unit_name` text,
	`sold_in_each` integer DEFAULT false NOT NULL,
	`quantity` integer NOT NULL,
	`note` text,
	`was_started` integer DEFAULT false NOT NULL,
	`moved_to` text,
	`direction` text,
	`cancelled_extra` text,
	`order_note_change` text,
	`allergy_block` text,
	`rerouted_to` text,
	`created_at` text NOT NULL,
	`acknowledged_at` text,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kitchen_notices_kind_ck" CHECK("kitchen_notices"."kind" in ('recalled', 'void', 'changed', 'moved', 'rerouted', 'allergy_changed', 'allergy_removed')),
	CONSTRAINT "kitchen_notices_allergy_block_ck" CHECK(case when "kitchen_notices"."allergy_block" is null then 1
    when not json_valid("kitchen_notices"."allergy_block") then 0
    else json_type("kitchen_notices"."allergy_block") is 'object'
      and json_type("kitchen_notices"."allergy_block", '$.who') is 'text'
      and length(trim(json_extract("kitchen_notices"."allergy_block", '$.who'))) between 1 and 40
      and json_type("kitchen_notices"."allergy_block", '$.allergens') is 'object'
      and json_extract("kitchen_notices"."allergy_block", '$.allergens') <> '{}'
      and json_type("kitchen_notices"."allergy_block", '$.clashes') is 'object'
      and (json_type("kitchen_notices"."allergy_block", '$.note') is 'null'
        or (json_type("kitchen_notices"."allergy_block", '$.note') is 'text'
          and length(json_extract("kitchen_notices"."allergy_block", '$.note')) <= 2000))
      and json_type("kitchen_notices"."allergy_block", '$.labels.en.avoids') is 'array'
      and json_type("kitchen_notices"."allergy_block", '$.labels.en.clashes') is 'array'
      and json_type("kitchen_notices"."allergy_block", '$.labels.es.avoids') is 'array'
      and json_type("kitchen_notices"."allergy_block", '$.labels.es.clashes') is 'array'
    end),
	CONSTRAINT "kitchen_notices_allergy_kind_ck" CHECK(("kitchen_notices"."kind" = 'allergy_changed' and "kitchen_notices"."allergy_block" is not null)
        or ("kitchen_notices"."kind" <> 'allergy_changed' and "kitchen_notices"."allergy_block" is null)),
	CONSTRAINT "kitchen_notices_allergy_options_ck" CHECK("kitchen_notices"."kind" not in ('allergy_changed', 'allergy_removed') or "kitchen_notices"."order_note_change" is null),
	CONSTRAINT "kitchen_notices_quantity_ck" CHECK("kitchen_notices"."quantity" > 0),
	CONSTRAINT "kitchen_notices_moved_to_ck" CHECK("kitchen_notices"."kind" = 'moved' or "kitchen_notices"."moved_to" is null),
	CONSTRAINT "kitchen_notices_rerouted_to_ck" CHECK(("kitchen_notices"."kind" = 'rerouted' and "kitchen_notices"."rerouted_to" is not null) or ("kitchen_notices"."kind" <> 'rerouted' and "kitchen_notices"."rerouted_to" is null)),
	CONSTRAINT "kitchen_notices_direction_ck" CHECK("kitchen_notices"."direction" in ('added', 'removed')),
	CONSTRAINT "kitchen_notices_direction_kind_ck" CHECK("kitchen_notices"."kind" = 'changed' or "kitchen_notices"."direction" is null),
	CONSTRAINT "kitchen_notices_cancelled_extra_kind_ck" CHECK("kitchen_notices"."kind" = 'changed' or "kitchen_notices"."cancelled_extra" is null)
);
--> statement-breakpoint
CREATE INDEX `kitchen_notices_open_idx` ON `kitchen_notices` (`station_id`,`created_at`) WHERE "kitchen_notices"."acknowledged_at" is null;--> statement-breakpoint
CREATE TABLE `routing_cell_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`cell_id` text NOT NULL,
	`period_id` text NOT NULL,
	`department_id` text NOT NULL,
	`station_id` text,
	`no_preparation` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`cell_id`) REFERENCES `routing_cells`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "routing_cell_periods_target_ck" CHECK(("routing_cell_periods"."station_id" is not null and "routing_cell_periods"."no_preparation" = 0) or ("routing_cell_periods"."station_id" is null and "routing_cell_periods"."no_preparation" = 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cell_periods_cell_period_key` ON `routing_cell_periods` (`cell_id`,`period_id`);--> statement-breakpoint
CREATE TABLE `routing_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text,
	`product_id` text,
	`zone_id` text,
	`station_id` text,
	`no_preparation` integer DEFAULT false NOT NULL,
	`no_category` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "routing_cells_subject_ck" CHECK(not ("routing_cells"."category_id" is not null and "routing_cells"."product_id" is not null)),
	CONSTRAINT "routing_cells_coordinate_ck" CHECK(not ("routing_cells"."category_id" is null and "routing_cells"."product_id" is null and "routing_cells"."no_category" = 0 and "routing_cells"."zone_id" is null)),
	CONSTRAINT "routing_cells_target_ck" CHECK(("routing_cells"."station_id" is not null and "routing_cells"."no_preparation" = 0) or ("routing_cells"."station_id" is null and "routing_cells"."no_preparation" = 1)),
	CONSTRAINT "routing_cells_no_category_ck" CHECK("routing_cells"."no_category" = 0 or ("routing_cells"."no_category" = 1 and "routing_cells"."category_id" is null and "routing_cells"."product_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_category_every_zone_key` ON `routing_cells` (`category_id`) WHERE "routing_cells"."category_id" is not null and "routing_cells"."zone_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_category_zone_key` ON `routing_cells` (`category_id`,`zone_id`) WHERE "routing_cells"."category_id" is not null and "routing_cells"."zone_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_product_every_zone_key` ON `routing_cells` (`product_id`) WHERE "routing_cells"."product_id" is not null and "routing_cells"."zone_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_product_zone_key` ON `routing_cells` (`product_id`,`zone_id`) WHERE "routing_cells"."product_id" is not null and "routing_cells"."zone_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_all_zone_key` ON `routing_cells` (`zone_id`) WHERE "routing_cells"."category_id" is null and "routing_cells"."product_id" is null and "routing_cells"."no_category" = 0 and "routing_cells"."zone_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_no_category_every_zone_key` ON `routing_cells` (`no_category`) WHERE "routing_cells"."no_category" = 1 and "routing_cells"."zone_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_no_category_zone_key` ON `routing_cells` (`no_category`,`zone_id`) WHERE "routing_cells"."no_category" = 1 and "routing_cells"."zone_id" is not null;--> statement-breakpoint
CREATE TABLE `menu_period_staff_menus` (
	`period_id` text NOT NULL,
	`department_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`period_id`, `menu_id`),
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `menu_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'grey' NOT NULL,
	`menu_id` text NOT NULL,
	`floor_plan_set_id` text,
	FOREIGN KEY (`floor_plan_set_id`) REFERENCES `floor_plan_sets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_periods_name_ck" CHECK(trim("menu_periods"."name") <> ''),
	CONSTRAINT "menu_periods_colour_ck" CHECK("menu_periods"."colour" in ('red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'purple', 'magenta', 'pink', 'brown', 'grey'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_periods_department_name_key` ON `menu_periods` (`department_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_periods_department_key` ON `menu_periods` (`id`,`department_id`);--> statement-breakpoint
CREATE TABLE `department_transfer_desks` (
	`department_id` text PRIMARY KEY NOT NULL,
	`receiving_profile_id` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receiving_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `department_transfer_destinations` (
	`source_department_id` text NOT NULL,
	`destination_department_id` text NOT NULL,
	PRIMARY KEY(`source_department_id`, `destination_department_id`),
	FOREIGN KEY (`source_department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_transfer_destinations_different_ck" CHECK("department_transfer_destinations"."source_department_id" <> "department_transfer_destinations"."destination_department_id")
);
--> statement-breakpoint
CREATE TABLE `department_transfer_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tab_id` text NOT NULL,
	`source_department_id` text NOT NULL,
	`destination_department_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`resolved_by` text,
	`destination_zone_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tab_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_transfer_requests_status_ck" CHECK("department_transfer_requests"."status" in ('pending', 'accepted', 'declined', 'withdrawn')),
	CONSTRAINT "department_transfer_requests_different_ck" CHECK("department_transfer_requests"."source_department_id" <> "department_transfer_requests"."destination_department_id"),
	CONSTRAINT "department_transfer_requests_resolved_ck" CHECK(("department_transfer_requests"."status" = 'pending') = ("department_transfer_requests"."resolved_at" is null)),
	CONSTRAINT "department_transfer_requests_decline_reason_ck" CHECK("department_transfer_requests"."status" <> 'declined' or ("department_transfer_requests"."reason" is not null and length(trim("department_transfer_requests"."reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_transfer_requests_one_pending_key` ON `department_transfer_requests` (`tab_id`) WHERE "department_transfer_requests"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `device_kitchen_screen_removals` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`screen` text NOT NULL,
	`station_id` text,
	`zone_id` text,
	`removed_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_kitchen_screen_removals_screen_ck" CHECK("device_kitchen_screen_removals"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_kitchen_screen_removals_one_target_ck" CHECK("device_kitchen_screen_removals"."station_id" is null or "device_kitchen_screen_removals"."zone_id" is null)
);
--> statement-breakpoint
CREATE INDEX `device_kitchen_screen_removals_device_idx` ON `device_kitchen_screen_removals` (`device_id`);--> statement-breakpoint
CREATE TABLE `device_kitchen_screen_stations` (
	`device_id` text NOT NULL,
	`screen` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `screen`, `station_id`),
	FOREIGN KEY (`device_id`,`screen`) REFERENCES `device_kitchen_screens`(`device_id`,`screen`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_kitchen_screen_stations_screen_ck" CHECK("device_kitchen_screen_stations"."screen" in ('station', 'pass', 'pass_monitor'))
);
--> statement-breakpoint
CREATE TABLE `device_kitchen_screen_zones` (
	`device_id` text NOT NULL,
	`screen` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `screen`, `zone_id`),
	FOREIGN KEY (`device_id`,`screen`) REFERENCES `device_kitchen_screens`(`device_id`,`screen`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_kitchen_screen_zones_screen_ck" CHECK("device_kitchen_screen_zones"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_kitchen_screen_zones_not_station_ck" CHECK("device_kitchen_screen_zones"."screen" <> 'station')
);
--> statement-breakpoint
CREATE TABLE `device_kitchen_screens` (
	`device_id` text NOT NULL,
	`screen` text NOT NULL,
	`every_station` integer DEFAULT false NOT NULL,
	`every_zone` integer DEFAULT false NOT NULL,
	`show_non_pass_stations` integer,
	PRIMARY KEY(`device_id`, `screen`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_kitchen_screens_screen_ck" CHECK("device_kitchen_screens"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_kitchen_screens_station_zones_ck" CHECK("device_kitchen_screens"."screen" <> 'station' or "device_kitchen_screens"."every_zone" = 0)
);
--> statement-breakpoint
CREATE TABLE `device_profile_kitchen_screen_stations` (
	`device_profile_id` text NOT NULL,
	`screen` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `screen`, `station_id`),
	FOREIGN KEY (`device_profile_id`,`screen`) REFERENCES `device_profile_kitchen_screens`(`device_profile_id`,`screen`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_profile_kitchen_screen_stations_screen_ck" CHECK("device_profile_kitchen_screen_stations"."screen" in ('station', 'pass', 'pass_monitor'))
);
--> statement-breakpoint
CREATE TABLE `device_profile_kitchen_screen_zones` (
	`device_profile_id` text NOT NULL,
	`screen` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `screen`, `zone_id`),
	FOREIGN KEY (`device_profile_id`,`screen`) REFERENCES `device_profile_kitchen_screens`(`device_profile_id`,`screen`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_profile_kitchen_screen_zones_screen_ck" CHECK("device_profile_kitchen_screen_zones"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_profile_kitchen_screen_zones_not_station_ck" CHECK("device_profile_kitchen_screen_zones"."screen" <> 'station')
);
--> statement-breakpoint
CREATE TABLE `device_profile_kitchen_screens` (
	`device_profile_id` text NOT NULL,
	`screen` text NOT NULL,
	`every_station` integer DEFAULT false NOT NULL,
	`every_zone` integer DEFAULT false NOT NULL,
	`show_non_pass_stations` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`device_profile_id`, `screen`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "device_profile_kitchen_screens_screen_ck" CHECK("device_profile_kitchen_screens"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_profile_kitchen_screens_station_zones_ck" CHECK("device_profile_kitchen_screens"."screen" <> 'station' or "device_profile_kitchen_screens"."every_zone" = 0)
);
--> statement-breakpoint
CREATE TABLE `department_receipts` (
	`department_id` text PRIMARY KEY NOT NULL,
	`receipt` text NOT NULL,
	`logo_rasters` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `department_day_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`day_id` text NOT NULL,
	`department_id` text NOT NULL,
	`period_id` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`day_id`,`department_id`) REFERENCES `department_days`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_day_ranges_step_ck" CHECK(substr("department_day_ranges"."starts_at", 4, 2) in ('00', '15', '30', '45') and substr("department_day_ranges"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
CREATE INDEX `department_day_ranges_day_idx` ON `department_day_ranges` (`day_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `department_days` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`season_id` text,
	`weekday` integer,
	`special_day_date_id` text,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`special_day_date_id`) REFERENCES `special_day_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "department_days_one_day_ck" CHECK(("department_days"."season_id" is null) <> ("department_days"."special_day_date_id" is null) and ("department_days"."season_id" is null) = ("department_days"."weekday" is null)),
	CONSTRAINT "department_days_weekday_ck" CHECK("department_days"."weekday" is null or "department_days"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_days_season_key` ON `department_days` (`department_id`,`season_id`,`weekday`) WHERE "department_days"."season_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `department_days_date_key` ON `department_days` (`department_id`,`special_day_date_id`) WHERE "department_days"."special_day_date_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `department_days_department_key` ON `department_days` (`id`,`department_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`colour` text DEFAULT 'grey' NOT NULL,
	CONSTRAINT "seasons_name_ck" CHECK(trim("seasons"."name") <> ''),
	CONSTRAINT "seasons_starts_on_ck" CHECK("seasons"."starts_on" glob '[01][0-9]-[0-3][0-9]' and "seasons"."starts_on" <> '02-29')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_starts_key` ON `seasons` (`starts_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_name_key` ON `seasons` (`name`);--> statement-breakpoint
CREATE TABLE `special_day_dates` (
	`id` text PRIMARY KEY NOT NULL,
	`special_day_id` text NOT NULL,
	`date` text NOT NULL,
	`closed_all_day` integer DEFAULT false NOT NULL,
	`holiday_name` text,
	FOREIGN KEY (`special_day_id`) REFERENCES `special_days`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "special_day_dates_date_ck" CHECK("special_day_dates"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `special_day_dates_date_key` ON `special_day_dates` (`date`);--> statement-breakpoint
CREATE TABLE `special_days` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repeats_yearly` integer DEFAULT false NOT NULL,
	CONSTRAINT "special_days_name_ck" CHECK(trim("special_days"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE `zone_day_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`day_id` text NOT NULL,
	`kind` text DEFAULT 'closed' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`day_id`) REFERENCES `zone_days`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "zone_day_ranges_kind_ck" CHECK("zone_day_ranges"."kind" in ('closed', 'open')),
	CONSTRAINT "zone_day_ranges_step_ck" CHECK(substr("zone_day_ranges"."starts_at", 4, 2) in ('00', '15', '30', '45') and substr("zone_day_ranges"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
CREATE INDEX `zone_day_ranges_day_idx` ON `zone_day_ranges` (`day_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `zone_days` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`season_id` text,
	`weekday` integer,
	`special_day_date_id` text,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`special_day_date_id`) REFERENCES `special_day_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "zone_days_one_day_ck" CHECK(("zone_days"."season_id" is null) <> ("zone_days"."special_day_date_id" is null) and ("zone_days"."season_id" is null) = ("zone_days"."weekday" is null)),
	CONSTRAINT "zone_days_weekday_ck" CHECK("zone_days"."weekday" is null or "zone_days"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zone_days_season_key` ON `zone_days` (`zone_id`,`season_id`,`weekday`) WHERE "zone_days"."season_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `zone_days_date_key` ON `zone_days` (`zone_id`,`special_day_date_id`) WHERE "zone_days"."special_day_date_id" is not null;--> statement-breakpoint
CREATE TABLE `order_kitchen_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text,
	`party_id` text,
	`note` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_kitchen_notes_owner_ck" CHECK(("order_kitchen_notes"."working_order_id" is null) <> ("order_kitchen_notes"."party_id" is null)),
	CONSTRAINT "order_kitchen_notes_revision_ck" CHECK(typeof("order_kitchen_notes"."revision") = 'integer' and "order_kitchen_notes"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_kitchen_notes_order_key` ON `order_kitchen_notes` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_kitchen_notes_party_key` ON `order_kitchen_notes` (`party_id`);--> statement-breakpoint
CREATE TABLE `allergy_line_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`guest_id` text NOT NULL,
	`draft_line_id` text,
	`working_line_id` text,
	FOREIGN KEY (`guest_id`) REFERENCES `party_allergy_guests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_line_id`) REFERENCES `order_draft_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`working_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "allergy_line_ticks_target_ck" CHECK(("allergy_line_ticks"."draft_line_id" is null) <> ("allergy_line_ticks"."working_line_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allergy_line_ticks_draft_key` ON `allergy_line_ticks` (`draft_line_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `allergy_line_ticks_working_key` ON `allergy_line_ticks` (`working_line_id`);--> statement-breakpoint
CREATE TABLE `party_allergy_guests` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`position` integer NOT NULL,
	`who` text NOT NULL,
	`allergens` text NOT NULL,
	`note` text,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "party_allergy_guests_position_ck" CHECK(typeof("party_allergy_guests"."position") = 'integer' and "party_allergy_guests"."position" >= 0),
	CONSTRAINT "party_allergy_guests_who_ck" CHECK(length(trim("party_allergy_guests"."who")) between 1 and 40),
	CONSTRAINT "party_allergy_guests_allergens_ck" CHECK(json_valid("party_allergy_guests"."allergens") and json_type("party_allergy_guests"."allergens") = 'object' and "party_allergy_guests"."allergens" <> '{}'),
	CONSTRAINT "party_allergy_guests_note_ck" CHECK("party_allergy_guests"."note" is null or length("party_allergy_guests"."note") <= 2000)
);
--> statement-breakpoint
CREATE TABLE `ticket_item_allergies` (
	`ticket_item_id` text PRIMARY KEY NOT NULL,
	`original_block` text,
	`current_block` text,
	FOREIGN KEY (`ticket_item_id`) REFERENCES `ticket_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ticket_item_allergies_original_ck" CHECK(case when "ticket_item_allergies"."original_block" is null then 1
    when not json_valid("ticket_item_allergies"."original_block") then 0
    else json_type("ticket_item_allergies"."original_block") is 'object'
      and json_type("ticket_item_allergies"."original_block", '$.who') is 'text'
      and length(trim(json_extract("ticket_item_allergies"."original_block", '$.who'))) between 1 and 40
      and json_type("ticket_item_allergies"."original_block", '$.allergens') is 'object'
      and json_extract("ticket_item_allergies"."original_block", '$.allergens') <> '{}'
      and json_type("ticket_item_allergies"."original_block", '$.clashes') is 'object'
      and (json_type("ticket_item_allergies"."original_block", '$.note') is 'null'
        or (json_type("ticket_item_allergies"."original_block", '$.note') is 'text'
          and length(json_extract("ticket_item_allergies"."original_block", '$.note')) <= 2000))
      and json_type("ticket_item_allergies"."original_block", '$.labels.en.avoids') is 'array'
      and json_type("ticket_item_allergies"."original_block", '$.labels.en.clashes') is 'array'
      and json_type("ticket_item_allergies"."original_block", '$.labels.es.avoids') is 'array'
      and json_type("ticket_item_allergies"."original_block", '$.labels.es.clashes') is 'array'
    end),
	CONSTRAINT "ticket_item_allergies_current_ck" CHECK(case when "ticket_item_allergies"."current_block" is null then 1
    when not json_valid("ticket_item_allergies"."current_block") then 0
    else json_type("ticket_item_allergies"."current_block") is 'object'
      and json_type("ticket_item_allergies"."current_block", '$.who') is 'text'
      and length(trim(json_extract("ticket_item_allergies"."current_block", '$.who'))) between 1 and 40
      and json_type("ticket_item_allergies"."current_block", '$.allergens') is 'object'
      and json_extract("ticket_item_allergies"."current_block", '$.allergens') <> '{}'
      and json_type("ticket_item_allergies"."current_block", '$.clashes') is 'object'
      and (json_type("ticket_item_allergies"."current_block", '$.note') is 'null'
        or (json_type("ticket_item_allergies"."current_block", '$.note') is 'text'
          and length(json_extract("ticket_item_allergies"."current_block", '$.note')) <= 2000))
      and json_type("ticket_item_allergies"."current_block", '$.labels.en.avoids') is 'array'
      and json_type("ticket_item_allergies"."current_block", '$.labels.en.clashes') is 'array'
      and json_type("ticket_item_allergies"."current_block", '$.labels.es.avoids') is 'array'
      and json_type("ticket_item_allergies"."current_block", '$.labels.es.clashes') is 'array'
    end)
);
--> statement-breakpoint
CREATE TABLE `device_zone_selection_zones` (
	`device_id` text NOT NULL,
	`device_profile_id` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `device_profile_id`, `zone_id`),
	FOREIGN KEY (`device_id`,`device_profile_id`) REFERENCES `device_zone_selections`(`device_id`,`device_profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_zone_selections` (
	`device_id` text NOT NULL,
	`device_profile_id` text NOT NULL,
	`starting_zone_id` text,
	PRIMARY KEY(`device_id`, `device_profile_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`starting_zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `service_step_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`step_id` text NOT NULL,
	`done_at` text NOT NULL,
	`done_by` text NOT NULL,
	FOREIGN KEY (`done_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `service_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_step_completions_party_idx` ON `service_step_completions` (`party_id`,`step_id`);--> statement-breakpoint
CREATE INDEX `service_step_completions_step_idx` ON `service_step_completions` (`step_id`);--> statement-breakpoint
CREATE TABLE `service_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`start` text NOT NULL,
	`course_id` text,
	`minutes` integer NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_steps_start_ck" CHECK("service_steps"."start" in ('seated', 'after_previous', 'course_served', 'all_served', 'since_last_order')),
	CONSTRAINT "service_steps_course_ck" CHECK(("service_steps"."start" = 'course_served') = ("service_steps"."course_id" is not null)),
	CONSTRAINT "service_steps_minutes_ck" CHECK("service_steps"."minutes" between 0 and 120 and ("service_steps"."start" <> 'since_last_order' or "service_steps"."minutes" >= 1))
);
--> statement-breakpoint
CREATE INDEX `service_steps_department_position_idx` ON `service_steps` (`department_id`,`position`);--> statement-breakpoint
CREATE INDEX `service_steps_course_idx` ON `service_steps` (`course_id`);--> statement-breakpoint
CREATE TABLE `bill_identities` (
	`working_order_id` text PRIMARY KEY NOT NULL,
	`party_id` text,
	`number` integer,
	`name` text,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_identities_scope_ck" CHECK(("bill_identities"."party_id" is null) = ("bill_identities"."number" is null)),
	CONSTRAINT "bill_identities_number_ck" CHECK("bill_identities"."number" is null or (typeof("bill_identities"."number") = 'integer' and "bill_identities"."number" >= 1)),
	CONSTRAINT "bill_identities_name_ck" CHECK("bill_identities"."name" is null or (length("bill_identities"."name") between 1 and 40 and "bill_identities"."name" = trim("bill_identities"."name")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_identities_party_number_key` ON `bill_identities` (`party_id`,`number`);--> statement-breakpoint
CREATE TABLE `bill_number_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`number` integer NOT NULL,
	`working_order_id` text NOT NULL,
	`allocated_at` text NOT NULL,
	CONSTRAINT "bill_number_allocations_number_ck" CHECK(typeof("bill_number_allocations"."number") = 'integer' and "bill_number_allocations"."number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_number_allocations_party_number_key` ON `bill_number_allocations` (`party_id`,`number`);--> statement-breakpoint
CREATE TABLE `document_delivery_requests` (
	`node_id` text NOT NULL,
	`recovery_epoch` text NOT NULL,
	`request_key` text NOT NULL,
	`sale_id` text NOT NULL,
	`person_id` text NOT NULL,
	`session_id` text NOT NULL,
	`document` text NOT NULL,
	`context` text NOT NULL,
	`canonical_intent` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`accepted_result` text,
	`acceptance_order` integer,
	`refusal_code` text,
	`acknowledged` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`node_id`, `recovery_epoch`, `request_key`),
	CONSTRAINT "document_delivery_requests_status_ck" CHECK("document_delivery_requests"."status" in ('prepared', 'accepted', 'refused', 'fenced')),
	CONSTRAINT "document_delivery_requests_document_ck" CHECK("document_delivery_requests"."document" in ('receipt', 'invoice')),
	CONSTRAINT "document_delivery_requests_outcome_ck" CHECK(("document_delivery_requests"."status" = 'accepted' and "document_delivery_requests"."accepted_result" is not null and "document_delivery_requests"."acceptance_order" is not null) or ("document_delivery_requests"."status" <> 'accepted' and "document_delivery_requests"."accepted_result" is null and "document_delivery_requests"."acceptance_order" is null)),
	CONSTRAINT "document_delivery_requests_order_ck" CHECK("document_delivery_requests"."acceptance_order" is null or ("document_delivery_requests"."acceptance_order" between 1 and 9007199254740991 and "document_delivery_requests"."acceptance_order" = cast("document_delivery_requests"."acceptance_order" as integer)))
);
--> statement-breakpoint
CREATE INDEX `document_delivery_requests_recovery_idx` ON `document_delivery_requests` (`node_id`,`recovery_epoch`,`sale_id`,`acknowledged`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_delivery_requests_acceptance_order_idx` ON `document_delivery_requests` (`node_id`,`recovery_epoch`,`acceptance_order`);--> statement-breakpoint
CREATE TABLE `document_delivery_sequences` (
	`node_id` text NOT NULL,
	`recovery_epoch` text NOT NULL,
	`next_acceptance_order` integer NOT NULL,
	PRIMARY KEY(`node_id`, `recovery_epoch`),
	CONSTRAINT "document_delivery_sequences_order_ck" CHECK("document_delivery_sequences"."next_acceptance_order" between 1 and 9007199254740991 and "document_delivery_sequences"."next_acceptance_order" = cast("document_delivery_sequences"."next_acceptance_order" as integer))
);
--> statement-breakpoint
CREATE TABLE `device_invoice_save_operations` (
	`node_id` text NOT NULL,
	`recovery_epoch` text NOT NULL,
	`save_id` text NOT NULL,
	`device_id` text NOT NULL,
	`person_id` text NOT NULL,
	`session_id` text NOT NULL,
	`context` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`selection` text NOT NULL,
	`management_edit` text,
	`canonical_intent` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`saved_result` text,
	`refusal_code` text,
	`acknowledged` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`node_id`, `recovery_epoch`, `save_id`),
	CONSTRAINT "device_invoice_save_operations_status_ck" CHECK("device_invoice_save_operations"."status" in ('prepared', 'saved', 'refused', 'fenced')),
	CONSTRAINT "device_invoice_save_operations_revision_ck" CHECK("device_invoice_save_operations"."expected_revision" between 0 and 9007199254740991 and "device_invoice_save_operations"."expected_revision" = cast("device_invoice_save_operations"."expected_revision" as integer))
);
--> statement-breakpoint
CREATE INDEX `device_invoice_save_operations_recovery_idx` ON `device_invoice_save_operations` (`node_id`,`recovery_epoch`,`device_id`,`acknowledged`);--> statement-breakpoint
CREATE TABLE `device_invoice_revisions` (
	`device_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "device_invoice_revisions_revision_ck" CHECK("device_invoice_revisions"."revision" between 0 and 9007199254740991 and "device_invoice_revisions"."revision" = cast("device_invoice_revisions"."revision" as integer))
);
--> statement-breakpoint
CREATE TABLE `document_page_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`page_printer_id` text NOT NULL,
	`language` text NOT NULL,
	`designation` text NOT NULL,
	`person_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`claim_token_hash` text,
	`claimed_by` text,
	`claimed_agent_id` text,
	`claimed_at` text,
	`expired_at` text,
	`failure_code` text,
	`reported_outcome` text,
	`reported_at` text,
	`reported_failure_code` text,
	`printer_hold` text,
	`receipt_handover` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_printer_id`) REFERENCES `page_printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`claimed_agent_id`) REFERENCES `print_agents`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "document_page_jobs_status_ck" CHECK("document_page_jobs"."status" in ('queued', 'sending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "document_page_jobs_designation_ck" CHECK("document_page_jobs"."designation" in ('original', 'duplicate')),
	CONSTRAINT "document_page_jobs_outcome_ck" CHECK("document_page_jobs"."reported_outcome" in ('sent', 'failed', 'unknown')),
	CONSTRAINT "document_page_jobs_generation_ck" CHECK("document_page_jobs"."generation" between 1 and 9007199254740991 and "document_page_jobs"."generation" = cast("document_page_jobs"."generation" as integer)),
	CONSTRAINT "document_page_jobs_attempts_ck" CHECK("document_page_jobs"."attempts" between 0 and 9007199254740991 and "document_page_jobs"."attempts" = cast("document_page_jobs"."attempts" as integer))
);
--> statement-breakpoint
CREATE INDEX `document_page_jobs_claim_idx` ON `document_page_jobs` (`page_printer_id`,`status`);--> statement-breakpoint
CREATE INDEX `document_page_jobs_sale_idx` ON `document_page_jobs` (`sale_id`);--> statement-breakpoint
CREATE TABLE `document_page_reprints` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`page_job_id` text NOT NULL,
	`person_id` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_job_id`) REFERENCES `document_page_jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_page_reprints_job_uq` ON `document_page_reprints` (`page_job_id`);--> statement-breakpoint
CREATE INDEX `document_page_reprints_sale_idx` ON `document_page_reprints` (`sale_id`);--> statement-breakpoint
CREATE TABLE `outgoing_mail` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`subject_id` text,
	`person_id` text,
	`requested_by` text,
	`recipient` text,
	`params` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`not_after` text NOT NULL,
	`queued_at` text NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`finished_at` text,
	`failure_code` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "outgoing_mail_kind_ck" CHECK("outgoing_mail"."kind" in ('invoice', 'attendance_question', 'certificate_reminder', 'box_alert', 'account_action', 'role_membership_changed')),
	CONSTRAINT "outgoing_mail_status_ck" CHECK("outgoing_mail"."status" in ('pending', 'sending', 'sent', 'rejected', 'unknown', 'expired', 'cancelled')),
	CONSTRAINT "outgoing_mail_failure_ck" CHECK("outgoing_mail"."failure_code" in ('email.test_host_not_found', 'email.test_connection_refused', 'email.test_starttls_refused', 'email.test_tls_refused', 'email.test_certificate_untrusted', 'email.test_login_refused', 'email.test_login_required', 'email.test_timeout', 'email.test_refused', 'mail.compose_failed', 'mail.claim_failed', 'mail.claim_abandoned')),
	CONSTRAINT "outgoing_mail_attempts_ck" CHECK("outgoing_mail"."attempts" >= 0),
	CONSTRAINT "outgoing_mail_not_after_ck" CHECK("outgoing_mail"."not_after" > "outgoing_mail"."queued_at"),
	CONSTRAINT "outgoing_mail_claim_ck" CHECK(("outgoing_mail"."claim_token" is null) = ("outgoing_mail"."claimed_at" is null)),
	CONSTRAINT "outgoing_mail_sending_ck" CHECK("outgoing_mail"."status" <> 'sending' or ("outgoing_mail"."claim_token" is not null and "outgoing_mail"."recipient" is not null)),
	CONSTRAINT "outgoing_mail_finished_ck" CHECK("outgoing_mail"."status" = 'rejected' or ("outgoing_mail"."status" in ('pending', 'sending') and "outgoing_mail"."finished_at" is null) or ("outgoing_mail"."status" in ('sent', 'unknown', 'expired', 'cancelled') and "outgoing_mail"."finished_at" is not null)),
	CONSTRAINT "outgoing_mail_person_ck" CHECK("outgoing_mail"."person_id" is not null or "outgoing_mail"."kind" = 'invoice')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outgoing_mail_key_uq` ON `outgoing_mail` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `outgoing_mail_seq_uq` ON `outgoing_mail` (`seq`);--> statement-breakpoint
CREATE INDEX `outgoing_mail_due_idx` ON `outgoing_mail` (`status`,`next_attempt_at`,`queued_at`,`seq`);
--> statement-breakpoint
CREATE TRIGGER tenders_reject_post_settlement
BEFORE INSERT ON tenders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'tender rejected: the sale is already settled')
  WHERE exists (SELECT 1 FROM sale_settlements WHERE sale_id = new.sale_id);
END;
--> statement-breakpoint
CREATE TRIGGER products_variant_one_level_insert
BEFORE INSERT ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a variant''s parent must be a product with no parent, and a variant cannot have variants of its own')
  WHERE new.parent_id IS NOT NULL
    AND (new.parent_id = new.id
      OR (SELECT parent_id FROM products WHERE id = new.parent_id) IS NOT NULL
      OR exists (SELECT 1 FROM products WHERE parent_id = new.id));
  SELECT raise(abort, 'a variant''s parent is fixed when it is created')
  WHERE exists (SELECT 1 FROM products WHERE id = new.id AND parent_id IS NOT new.parent_id);
END;
--> statement-breakpoint
CREATE TRIGGER products_variant_parent_fixed_update
BEFORE UPDATE OF parent_id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a variant''s parent is fixed when it is created')
  WHERE new.parent_id IS NOT old.parent_id;
END;
--> statement-breakpoint
CREATE TRIGGER products_id_fixed_update
BEFORE UPDATE OF id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a product''s id never changes')
  WHERE new.id IS NOT old.id;
END;
--> statement-breakpoint
CREATE TRIGGER products_ordering_check_insert
BEFORE INSERT ON products
FOR EACH ROW
WHEN new.ordering NOT IN ('public', 'staff_only', 'not_sold_separately')
BEGIN
  SELECT raise(abort, 'a product''s ordering must be public, staff_only or not_sold_separately');
END;
--> statement-breakpoint
CREATE TRIGGER products_ordering_check_update
BEFORE UPDATE OF ordering ON products
FOR EACH ROW
WHEN new.ordering NOT IN ('public', 'staff_only', 'not_sold_separately')
BEGIN
  SELECT raise(abort, 'a product''s ordering must be public, staff_only or not_sold_separately');
END;
--> statement-breakpoint
CREATE TRIGGER bill_payment_refunds_guard_update
BEFORE UPDATE ON bill_payment_refunds
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'bill payment refund cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.bill_payment_id IS old.bill_payment_id
    AND new.submission_id IS old.submission_id
    AND new.fingerprint IS old.fingerprint
    AND new.applied_amount IS old.applied_amount
    AND new.tip_amount IS old.tip_amount
    AND new.reason IS old.reason
    AND new.authorized_by IS old.authorized_by
    AND new.requested_by IS old.requested_by
    AND new.source IS old.source
    AND new.device_id IS old.device_id
    AND new.created_at IS old.created_at
    AND (
      (new.state IS old.state
        AND new.sent_at IS old.sent_at
        AND new.send_count IS old.send_count
        AND new.provider_refund_ref IS old.provider_refund_ref
        AND new.refs_before_send IS old.refs_before_send
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note
        AND new.completed_at IS old.completed_at
        AND new.failed_at IS old.failed_at)
      OR (old.state = 'pending'
        AND (old.sent_at IS NULL OR new.sent_at IS old.sent_at)
        AND (old.sent_at IS NULL OR new.refs_before_send IS old.refs_before_send)
        AND new.send_count IN (old.send_count, old.send_count + 1)
        AND (old.provider_refund_ref IS NULL OR new.provider_refund_ref IS old.provider_refund_ref))
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER bill_payment_refunds_no_delete
BEFORE DELETE ON bill_payment_refunds
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a bill payment refund is never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER bill_payments_guard_update
BEFORE UPDATE ON bill_payments
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'bill payment cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.working_order_id IS old.working_order_id
    AND new.submission_id IS old.submission_id
    AND new.fingerprint IS old.fingerprint
    AND new.kind IS old.kind
    AND new.share_of IS old.share_of
    AND new.method IS old.method
    AND ((new.applied IS old.applied AND new.tip IS old.tip)
      OR (old.state = 'pending' AND new.state = 'received' AND old.method = 'card'))
    AND (new.remaining_after IS old.remaining_after
      OR (old.state = 'pending' AND new.state = 'received' AND old.method = 'card'))
    AND new.tendered IS old.tendered
    AND new.requested_by IS old.requested_by
    AND new.source IS old.source
    AND new.device_id IS old.device_id
    AND new.created_at IS old.created_at
    AND (
      (new.state IS old.state
        AND new.received_at IS old.received_at
        AND new.failed_at IS old.failed_at
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note)
      OR (old.state = 'pending' AND new.state IN ('received', 'failed'))
      OR (old.state = 'received' AND new.state = 'declined'
        AND new.received_at IS old.received_at
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note
        AND NOT exists (SELECT 1 FROM tenders WHERE bill_payment_id = old.id))
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER bill_payments_no_delete
BEFORE DELETE ON bill_payments
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a bill payment is never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER sale_settlements_check_coverage
BEFORE INSERT ON sale_settlements
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'tenders do not cover the sale')
  WHERE exists (SELECT 1 FROM sales WHERE id = new.sale_id)
    AND (SELECT coalesce(sum(amount), 0) FROM tenders WHERE sale_id = new.sale_id)
        <> (SELECT total FROM sales WHERE id = new.sale_id)
           + (SELECT coalesce(sum(total), 0) FROM sales WHERE corrects_sale_id = new.sale_id)
           + (SELECT coalesce(sum(tip_amount), 0) FROM tenders WHERE sale_id = new.sale_id);
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_delete
BEFORE DELETE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = old.working_order_id AND status = 'open'
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = new.working_order_id AND status = 'open'
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_invoice_type_insert
BEFORE INSERT ON working_orders
FOR EACH ROW
WHEN new.invoice_type NOT IN ('F1', 'F2')
BEGIN
  SELECT raise(abort, 'invoice type must be F1 or F2');
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_invoice_type_update
BEFORE UPDATE OF invoice_type ON working_orders
FOR EACH ROW
WHEN old.status = 'open' AND new.invoice_type NOT IN ('F1', 'F2')
BEGIN
  SELECT raise(abort, 'invoice type must be F1 or F2');
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_locales_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'descriptions must carry exactly the venue locales')
  WHERE NOT exists (
      SELECT 1 FROM settings WHERE module = 'venue'
    )
    OR exists (
      SELECT 1 FROM json_each(new.descriptions) supplied
       WHERE supplied."key" NOT IN (
         SELECT configured.value FROM json_each((SELECT doc FROM settings WHERE module = 'venue'), '$.invoiceLocales') configured
       )
    )
    OR exists (
      SELECT 1 FROM json_each((SELECT doc FROM settings WHERE module = 'venue'), '$.invoiceLocales') configured WHERE configured.value NOT IN (SELECT supplied."key" FROM json_each(new.descriptions) supplied)
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_locales_update
BEFORE UPDATE OF descriptions, working_order_id ON working_order_lines
FOR EACH ROW
WHEN new.descriptions IS NOT old.descriptions OR new.working_order_id IS NOT old.working_order_id
BEGIN
  SELECT raise(abort, 'descriptions must carry exactly the venue locales')
  WHERE NOT exists (
      SELECT 1 FROM settings WHERE module = 'venue'
    )
    OR exists (
      SELECT 1 FROM json_each(new.descriptions) supplied
       WHERE supplied."key" NOT IN (
         SELECT configured.value FROM json_each((SELECT doc FROM settings WHERE module = 'venue'), '$.invoiceLocales') configured
       )
    )
    OR exists (
      SELECT 1 FROM json_each((SELECT doc FROM settings WHERE module = 'venue'), '$.invoiceLocales') configured WHERE configured.value NOT IN (SELECT supplied."key" FROM json_each(new.descriptions) supplied)
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_variant_locales_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'variant_descriptions must carry exactly the venue locales')
  WHERE new.variant_descriptions IS NOT NULL
    AND (
      NOT exists (
        SELECT 1 FROM settings WHERE module = 'venue'
      )
      OR exists (
        SELECT 1 FROM json_each(new.variant_descriptions) supplied
         WHERE supplied."key" NOT IN (
           SELECT configured.value FROM json_each((SELECT doc FROM settings WHERE module = 'venue'), '$.invoiceLocales') configured
         )
      )
      OR exists (
        SELECT 1 FROM json_each((SELECT doc FROM settings WHERE module = 'venue'), '$.invoiceLocales') configured WHERE configured.value NOT IN (
             SELECT supplied."key" FROM json_each(new.variant_descriptions) supplied
           )
      )
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_variant_locales_update
BEFORE UPDATE OF variant_descriptions, working_order_id ON working_order_lines
FOR EACH ROW
WHEN new.variant_descriptions IS NOT old.variant_descriptions OR new.working_order_id IS NOT old.working_order_id
BEGIN
  SELECT raise(abort, 'variant_descriptions must carry exactly the venue locales')
  WHERE new.variant_descriptions IS NOT NULL
    AND (
      NOT exists (
        SELECT 1 FROM settings WHERE module = 'venue'
      )
      OR exists (
        SELECT 1 FROM json_each(new.variant_descriptions) supplied
         WHERE supplied."key" NOT IN (
           SELECT configured.value FROM json_each((SELECT doc FROM settings WHERE module = 'venue'), '$.invoiceLocales') configured
         )
      )
      OR exists (
        SELECT 1 FROM json_each((SELECT doc FROM settings WHERE module = 'venue'), '$.invoiceLocales') configured WHERE configured.value NOT IN (
             SELECT supplied."key" FROM json_each(new.variant_descriptions) supplied
           )
      )
    );
END;
--> statement-breakpoint
CREATE TRIGGER device_profile_form_factor_locked
BEFORE UPDATE ON device_profiles
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'cannot change form factor of a profile in use by an active device')
  WHERE new.form_factor <> old.form_factor
    AND exists (
      SELECT 1 FROM devices d WHERE d.device_profile_id = new.id AND d.active <> 0
    );
END;
--> statement-breakpoint
CREATE TRIGGER tender_refunds_guard_update
BEFORE UPDATE ON tender_refunds
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'tender refund cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.sale_id IS old.sale_id
    AND new.tender_id IS old.tender_id
    AND new.submission_id IS old.submission_id
    AND new.fingerprint IS old.fingerprint
    AND new.applied_amount IS old.applied_amount
    AND new.tip_amount IS old.tip_amount
    AND new.reason IS old.reason
    AND new.authorized_by IS old.authorized_by
    AND new.requested_by IS old.requested_by
    AND new.source IS old.source
    AND new.device_id IS old.device_id
    AND new.node_id IS old.node_id
    AND new.method IS old.method
    AND new.manual IS old.manual
    AND new.provider IS old.provider
    AND new.provider_payment_ref IS old.provider_payment_ref
    AND new.created_at IS old.created_at
    AND (
      (new.state IS old.state
        AND new.sent_at IS old.sent_at
        AND new.send_count IS old.send_count
        AND new.refs_before_send IS old.refs_before_send
        AND new.provider_refund_ref IS old.provider_refund_ref
        AND new.provider_status IS old.provider_status
        AND new.last_lookup_at IS old.last_lookup_at
        AND new.next_retry_at IS old.next_retry_at
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note
        AND new.completed_at IS old.completed_at
        AND new.failed_at IS old.failed_at)
      OR (old.state = 'pending'
        AND (old.sent_at IS NULL OR new.sent_at IS old.sent_at)
        AND (old.sent_at IS NULL OR new.refs_before_send IS old.refs_before_send)
        AND new.send_count IN (old.send_count, old.send_count + 1)
        AND (old.provider_refund_ref IS NULL OR new.provider_refund_ref IS old.provider_refund_ref))
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER tender_refunds_no_delete
BEFORE DELETE ON tender_refunds
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a tender refund is never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER invoice_corrections_guard_update
BEFORE UPDATE ON invoice_corrections
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'invoice correction cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.original_sale_id IS old.original_sale_id
    AND new.submission_id IS old.submission_id
    AND new.fingerprint IS old.fingerprint
    AND new.gross IS old.gross
    AND new.line_ids IS old.line_ids
    AND new.reason IS old.reason
    AND new.requested_by IS old.requested_by
    AND new.authorized_by IS old.authorized_by
    AND new.via_override IS old.via_override
    AND new.source IS old.source
    AND new.device_id IS old.device_id
    AND new.node_id IS old.node_id
    AND new.created_at IS old.created_at
    AND old.state = 'open'
    AND new.state IN ('filed', 'discarded', 'closed')
  );
END;
--> statement-breakpoint
CREATE TRIGGER invoice_corrections_no_delete
BEFORE DELETE ON invoice_corrections
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'an invoice correction is never deleted');
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_update
BEFORE UPDATE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT (
    (
      exists (SELECT 1 FROM working_orders WHERE id = new.working_order_id AND status = 'open')
      AND exists (SELECT 1 FROM working_orders WHERE id = old.working_order_id AND status = 'open')
    )
    OR (
      exists (SELECT 1 FROM working_orders WHERE id = old.working_order_id)
      AND NOT (new.served_quantity IS old.served_quantity AND new.served_at IS old.served_at)
      AND new.id IS old.id
      AND new.working_order_id IS old.working_order_id
      AND new.line_no IS old.line_no
      AND new.name IS old.name
      AND new.product_id IS old.product_id
      AND new.variant_name IS old.variant_name
      AND new.variant_descriptions IS old.variant_descriptions
      AND new.variant_kitchen_name IS old.variant_kitchen_name
      AND new.kitchen_name IS old.kitchen_name
      AND new.descriptions IS old.descriptions
      AND new.option_snapshots IS old.option_snapshots
      AND new.unit_name IS old.unit_name
      AND new.unit_precision IS old.unit_precision
      AND new.quantity IS old.quantity
      AND new.price_quantity IS old.price_quantity
      AND new.unit_price_gross IS old.unit_price_gross
      AND new.vat_class IS old.vat_class
      AND new.line_total IS old.line_total
      AND new.category IS old.category
      AND new.course_id IS old.course_id
      AND new.make_at_station_id IS old.make_at_station_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.sent_at IS old.sent_at
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.group_id IS old.group_id
      AND new.credited_to IS old.credited_to
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
    OR (
      exists (
        SELECT 1 FROM working_orders
        WHERE id = old.working_order_id
          AND (status = 'placed' OR (status = 'settled' AND new.group_id IS NOT old.group_id))
      )
      AND new.id IS old.id
      AND new.working_order_id IS old.working_order_id
      AND new.line_no IS old.line_no
      AND new.name IS old.name
      AND new.product_id IS old.product_id
      AND new.variant_name IS old.variant_name
      AND new.variant_descriptions IS old.variant_descriptions
      AND new.variant_kitchen_name IS old.variant_kitchen_name
      AND new.kitchen_name IS old.kitchen_name
      AND new.descriptions IS old.descriptions
      AND new.option_snapshots IS old.option_snapshots
      AND new.unit_name IS old.unit_name
      AND new.unit_precision IS old.unit_precision
      AND new.quantity IS old.quantity
      AND new.price_quantity IS old.price_quantity
      AND new.unit_price_gross IS old.unit_price_gross
      AND new.vat_class IS old.vat_class
      AND new.line_total IS old.line_total
      AND new.category IS old.category
      AND new.served_at IS old.served_at
      AND new.course_id IS old.course_id
      AND new.make_at_station_id IS old.make_at_station_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.sent_at IS old.sent_at
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.credited_to IS old.credited_to
      AND new.served_quantity IS old.served_quantity
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
    OR (
      exists (
        SELECT 1 FROM working_orders
        WHERE id = old.working_order_id AND status IN ('placed', 'settled')
      )
      AND old.sent_at IS NULL
      AND new.sent_at IS NOT NULL
      AND new.id IS old.id
      AND new.working_order_id IS old.working_order_id
      AND new.line_no IS old.line_no
      AND new.name IS old.name
      AND new.product_id IS old.product_id
      AND new.variant_name IS old.variant_name
      AND new.variant_descriptions IS old.variant_descriptions
      AND new.variant_kitchen_name IS old.variant_kitchen_name
      AND new.kitchen_name IS old.kitchen_name
      AND new.descriptions IS old.descriptions
      AND new.option_snapshots IS old.option_snapshots
      AND new.unit_name IS old.unit_name
      AND new.unit_precision IS old.unit_precision
      AND new.quantity IS old.quantity
      AND new.price_quantity IS old.price_quantity
      AND new.unit_price_gross IS old.unit_price_gross
      AND new.vat_class IS old.vat_class
      AND new.line_total IS old.line_total
      AND new.category IS old.category
      AND new.served_at IS old.served_at
      AND new.served_quantity IS old.served_quantity
      AND new.course_id IS old.course_id
      AND new.make_at_station_id IS old.make_at_station_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.group_id IS old.group_id
      AND new.credited_to IS old.credited_to
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_recipient_identity_insert
BEFORE INSERT ON working_orders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'recipient identity is incomplete')
  WHERE NOT (
    (new.recipient_identifier_type IS NULL AND new.recipient_identifier_country_code IS NULL)
    OR (new.recipient_identifier_type IS NOT NULL AND new.recipient_identifier_country_code IS NOT NULL
      AND new.recipient_identifier_type IN ('vat-number', 'passport', 'residence-country-id', 'residence-certificate', 'other-document')
      AND new.recipient_identifier_country_code GLOB '[A-Z][A-Z]'
      AND new.recipient_tax_id IS NOT NULL
      AND length(trim(new.recipient_tax_id, char(9, 10, 11, 12, 13, 32))) > 0
      AND new.invoice_type = 'F1')
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_recipient_identity_update
BEFORE UPDATE ON working_orders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'recipient identity is incomplete')
  WHERE NOT (
    (new.recipient_identifier_type IS NULL AND new.recipient_identifier_country_code IS NULL)
    OR (new.recipient_identifier_type IS NOT NULL AND new.recipient_identifier_country_code IS NOT NULL
      AND new.recipient_identifier_type IN ('vat-number', 'passport', 'residence-country-id', 'residence-certificate', 'other-document')
      AND new.recipient_identifier_country_code GLOB '[A-Z][A-Z]'
      AND new.recipient_tax_id IS NOT NULL
      AND length(trim(new.recipient_tax_id, char(9, 10, 11, 12, 13, 32))) > 0
      AND new.invoice_type = 'F1')
  );
END;
--> statement-breakpoint
CREATE TRIGGER sales_recipient_identity_insert
BEFORE INSERT ON sales
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'recipient identity is incomplete')
  WHERE NOT (
    (new.counterparty_identifier_type IS NULL AND new.counterparty_identifier_country_code IS NULL)
    OR (new.counterparty_identifier_type IS NOT NULL AND new.counterparty_identifier_country_code IS NOT NULL
      AND new.counterparty_identifier_type IN ('vat-number', 'passport', 'residence-country-id', 'residence-certificate', 'other-document')
      AND new.counterparty_identifier_country_code GLOB '[A-Z][A-Z]'
      AND new.counterparty_tax_id IS NOT NULL
      AND length(trim(new.counterparty_tax_id, char(9, 10, 11, 12, 13, 32))) > 0)
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_enforce_transition
BEFORE UPDATE ON working_orders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'working order cannot make that transition')
  WHERE NOT (
    old.status = 'open'
    OR (old.status = 'placed' AND new.status IN ('settled', 'abandoned')
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale)
    OR (old.status = 'placed' AND new.status = 'placed'
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.collected_at IS old.collected_at
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND ((new.invoice_type IS old.invoice_type
          AND new.recipient_tax_id IS old.recipient_tax_id
          AND new.recipient_legal_name IS old.recipient_legal_name
          AND new.recipient_address IS old.recipient_address
          AND new.recipient_country_code IS old.recipient_country_code
          AND new.recipient_identifier_type IS old.recipient_identifier_type
          AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
          AND new.invoice_delivery IS old.invoice_delivery
          AND new.receipt_locale IS old.receipt_locale)
          OR (new.revision = old.revision + 1
               AND new.invoice_type IN ('F1', 'F2')
               AND NOT EXISTS (SELECT 1 FROM sales WHERE working_order_id = old.id)))
        AND new.delivery_table_label IS old.delivery_table_label)
    OR (old.status = 'placed' AND new.status = 'placed'
        AND old.collected_at IS NULL AND new.collected_at IS NOT NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.delivery_table_id IS old.delivery_table_id
        AND new.revision IS old.revision
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale
        AND new."party_id" IS old."party_id"
        AND new.delivery_table_label IS old.delivery_table_label)
    OR (old.status = 'settled' AND new.status = 'settled'
        AND old.collected_at IS NULL AND new.collected_at IS NOT NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.delivery_table_id IS old.delivery_table_id
        AND new.revision IS old.revision
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale
        AND new."party_id" IS old."party_id"
        AND new.delivery_table_label IS old.delivery_table_label)
    -- A paid bill not yet handed over may leave its party, once; only the server limits this to Finish table's counter collection (A758-7).
    OR (old.status = 'settled' AND new.status = 'settled'
        AND old.collected_at IS NULL AND new.collected_at IS NULL
        AND old.party_id IS NOT NULL AND new.party_id IS NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.status IS old.status
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.collected_at IS old.collected_at
        AND new.delivery_table_id IS old.delivery_table_id
        AND new.delivery_table_label IS old.delivery_table_label
        AND new.revision IS old.revision
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale)
    OR (old.delivery_table_id IS NOT NULL AND new.delivery_table_id IS NULL
        AND old.delivery_table_label IS NULL AND new.delivery_table_label IS NOT NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.status IS old.status
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.collected_at IS old.collected_at
        AND new.revision IS old.revision
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new.party_id IS old.party_id)
  );
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_insert
BEFORE INSERT ON sections
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_update
BEFORE UPDATE OF image ON sections
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE exists (SELECT 1 FROM sections WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (SELECT 1 FROM sections WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_insert
BEFORE INSERT ON menu_version_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE NOT exists (SELECT 1 FROM media_images WHERE filename = new.filename);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_insert
BEFORE INSERT ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_update
BEFORE UPDATE OF image ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE exists (SELECT 1 FROM products WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (SELECT 1 FROM products WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE exists (
    SELECT 1 FROM menu_version_images
    JOIN menu_publications ON menu_publications.version_id = menu_version_images.version_id
    WHERE menu_version_images.filename = old.filename
  )
  OR exists (
    SELECT 1 FROM menu_version_images
    JOIN menu_scheduled_publications ON menu_scheduled_publications.version_id = menu_version_images.version_id
    WHERE menu_version_images.filename = old.filename AND menu_scheduled_publications.state = 'queued'
  );
END;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND (
      exists (
        SELECT 1 FROM menu_version_images
        JOIN menu_publications ON menu_publications.version_id = menu_version_images.version_id
        WHERE menu_version_images.filename = old.filename
      )
      OR exists (
        SELECT 1 FROM menu_version_images
        JOIN menu_scheduled_publications ON menu_scheduled_publications.version_id = menu_version_images.version_id
        WHERE menu_version_images.filename = old.filename AND menu_scheduled_publications.state = 'queued'
      )
    );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_insert
BEFORE INSERT ON section_members
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE json_extract(new.folder_overrides, '$.image') IS NOT NULL
    AND NOT exists (
      SELECT 1 FROM media_images WHERE filename = json_extract(new.folder_overrides, '$.image')
    );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_update
BEFORE UPDATE OF folder_overrides ON section_members
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE json_extract(new.folder_overrides, '$.image') IS NOT NULL
    AND NOT exists (
      SELECT 1 FROM media_images WHERE filename = json_extract(new.folder_overrides, '$.image')
    );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE exists (
    SELECT 1 FROM section_members WHERE folder_overrides ->> '$.image' = old.filename
  );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (
      SELECT 1 FROM section_members WHERE folder_overrides ->> '$.image' = old.filename
    );
END;

--> statement-breakpoint
CREATE TRIGGER settings_venue_invoice_locales_insert
BEFORE INSERT ON settings
FOR EACH ROW
WHEN new.module = 'venue'
  AND (json_type(new.doc, '$.invoiceLocales') IS NOT 'array'
       OR json_array_length(new.doc, '$.invoiceLocales') NOT BETWEEN 1 AND 2)
BEGIN
  SELECT raise(abort, 'settings.invalid');
END;
--> statement-breakpoint
CREATE TRIGGER settings_venue_invoice_locales_update
BEFORE UPDATE OF doc ON settings
FOR EACH ROW
WHEN new.module = 'venue'
  AND (json_type(new.doc, '$.invoiceLocales') IS NOT 'array'
       OR json_array_length(new.doc, '$.invoiceLocales') NOT BETWEEN 1 AND 2)
BEGIN
  SELECT raise(abort, 'settings.invalid');
END;

--> statement-breakpoint
CREATE TRIGGER day_cutover_changes_no_update
BEFORE UPDATE ON day_cutover_changes
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'day start history cannot change');
END;

--> statement-breakpoint
-- Weaker than its name: without a daily close, code protects past days using the venue's zone.
-- A1325 replaces daily_closes and changes this trigger in the same pull request.
CREATE TRIGGER day_cutover_changes_keep_closed
BEFORE DELETE ON day_cutover_changes
FOR EACH ROW
WHEN exists (SELECT 1 FROM daily_closes c
             WHERE c.business_day >= date(old.effective_business_day, '-1 day'))
BEGIN
  SELECT raise(abort, 'day start history cannot change');
END;

--> statement-breakpoint
CREATE TRIGGER party_allergy_guests_need_answer_insert
BEFORE INSERT ON party_allergy_guests
WHEN (SELECT allergy_answer FROM parties WHERE id = NEW.party_id) IS NULL
BEGIN SELECT RAISE(ABORT, 'an allergic guest needs the party''s answer first'); END;
--> statement-breakpoint
CREATE TRIGGER party_allergy_guests_need_answer_update
BEFORE UPDATE OF party_id ON party_allergy_guests
WHEN (SELECT allergy_answer FROM parties WHERE id = NEW.party_id) IS NULL
BEGIN SELECT RAISE(ABORT, 'an allergic guest needs the party''s answer first'); END;