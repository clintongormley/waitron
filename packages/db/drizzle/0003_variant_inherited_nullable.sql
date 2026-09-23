PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`catalogue_id` text NOT NULL,
	`parent_id` text,
	`variant_order` integer DEFAULT 0 NOT NULL,
	`category_id` text,
	`station_id` text,
	`course_id` text,
	`name` text NOT NULL,
	`customer_name` text,
	`description` text,
	`kitchen_name` text,
	`dietary_declarations` text DEFAULT '[]',
	`pricing_unit` text,
	`unit_price` integer,
	`vat_class` text,
	`active` integer DEFAULT true NOT NULL,
	`sold_alone` integer DEFAULT true NOT NULL,
	`image` text,
	`allergens` text,
	`manual_allergens` text,
	`recipe_derivation` text,
	`diet_derivation` text,
	`diet_override` text,
	`diet` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`catalogue_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`,`catalogue_id`) REFERENCES `products`(`id`,`catalogue_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "products_top_level_owns_ck" CHECK("__new_products"."parent_id" is not null or ("__new_products"."vat_class" is not null and "__new_products"."pricing_unit" is not null and "__new_products"."unit_price" is not null and "__new_products"."dietary_declarations" is not null)),
	CONSTRAINT "products_pricing_unit_ck" CHECK("__new_products"."pricing_unit" in ('each','weight')),
	CONSTRAINT "products_vat_class_ck" CHECK("__new_products"."vat_class" in ('general','reduced','super_reduced','zero'))
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "catalogue_id", "parent_id", "variant_order", "category_id", "station_id", "course_id", "name", "customer_name", "description", "kitchen_name", "dietary_declarations", "pricing_unit", "unit_price", "vat_class", "active", "sold_alone", "image", "allergens", "manual_allergens", "recipe_derivation", "diet_derivation", "diet_override", "diet", "created_at", "updated_at") SELECT "id", "catalogue_id", "parent_id", "variant_order", "category_id", "station_id", "course_id", "name", "customer_name", "description", "kitchen_name", "dietary_declarations", "pricing_unit", "unit_price", "vat_class", "active", "sold_alone", "image", "allergens", "manual_allergens", "recipe_derivation", "diet_derivation", "diet_override", "diet", "created_at", "updated_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `products_catalogue_id_idx` ON `products` (`catalogue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_id_catalogue_key` ON `products` (`id`,`catalogue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_parent_id_key` ON `products` (`parent_id`,`id`);