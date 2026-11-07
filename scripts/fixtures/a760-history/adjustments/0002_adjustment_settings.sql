CREATE TABLE `adjustment_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`max_bill_discount` integer,
	`updated_at` text NOT NULL,
	CONSTRAINT "adjustment_settings_singleton_ck" CHECK("adjustment_settings"."id" = 1),
	CONSTRAINT "adjustment_settings_max_bill_discount_ck" CHECK("adjustment_settings"."max_bill_discount" is null or "adjustment_settings"."max_bill_discount" between 1 and 10000)
);
