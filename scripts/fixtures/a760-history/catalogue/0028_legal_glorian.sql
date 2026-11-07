CREATE TABLE `catalogue_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`default_product_vat_class` text DEFAULT 'general' NOT NULL,
	CONSTRAINT "catalogue_settings_singleton_ck" CHECK("catalogue_settings"."id" = 1),
	CONSTRAINT "catalogue_settings_vat_class_ck" CHECK("catalogue_settings"."default_product_vat_class" in ('general', 'reduced', 'super_reduced', 'zero'))
);
