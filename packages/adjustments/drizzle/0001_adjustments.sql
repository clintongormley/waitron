CREATE TABLE `adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`line_id` text,
	`split_line_ids` text NOT NULL,
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
	`created_at` text NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reason_id`) REFERENCES `adjustment_reasons`(`id`) ON UPDATE no action ON DELETE restrict,
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
          and "adjustments"."stage" is null and json_array_length("adjustments"."split_line_ids") = 0
          and "adjustments"."action" in ('discount_percent', 'discount_amount')))
);
--> statement-breakpoint
CREATE INDEX `adjustments_order_reason_idx` ON `adjustments` (`working_order_id`,`reason_id`);