PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_section_members` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text,
	`child_section_id` text,
	`missing_name` text,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "section_members_one_ref_ck" CHECK(("__new_section_members"."product_id" is null or "__new_section_members"."child_section_id" is null) and (("__new_section_members"."product_id" is null and "__new_section_members"."child_section_id" is null) = ("__new_section_members"."missing_name" is not null)))
);
--> statement-breakpoint
INSERT INTO `__new_section_members`("id", "section_id", "position", "product_id", "child_section_id", "missing_name") SELECT "id", "section_id", "position", "product_id", "child_section_id", "missing_name" FROM `section_members`;--> statement-breakpoint
DROP TABLE `section_members`;--> statement-breakpoint
ALTER TABLE `__new_section_members` RENAME TO `section_members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `section_members_product_uq` ON `section_members` (`section_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `section_members_child_uq` ON `section_members` (`section_id`,`child_section_id`);--> statement-breakpoint
CREATE INDEX `section_members_order_idx` ON `section_members` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `section_members_child_idx` ON `section_members` (`child_section_id`);--> statement-breakpoint
CREATE INDEX `section_members_product_idx` ON `section_members` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`internal_name` text NOT NULL,
	`names` text DEFAULT '{}' NOT NULL,
	`role` text DEFAULT 'section' NOT NULL,
	`owner_menu_id` text NOT NULL,
	`image` text,
	`color` text,
	FOREIGN KEY (`owner_menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sections_role_ck" CHECK("__new_sections"."role" in ('section', 'menu_root', 'home_layout'))
);
--> statement-breakpoint
INSERT INTO `__new_sections`("id", "internal_name", "names", "role", "owner_menu_id", "image", "color") SELECT "id", "internal_name", "names", "role", "owner_menu_id", "image", "color" FROM `sections`;--> statement-breakpoint
DROP TABLE `sections`;--> statement-breakpoint
ALTER TABLE `__new_sections` RENAME TO `sections`;--> statement-breakpoint
CREATE INDEX `sections_owner_menu_idx` ON `sections` (`owner_menu_id`);