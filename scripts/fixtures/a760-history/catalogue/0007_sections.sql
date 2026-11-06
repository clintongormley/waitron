CREATE TABLE `section_members` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`position` integer NOT NULL,
	`product_id` text,
	`child_section_id` text,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "section_members_one_ref_ck" CHECK(("section_members"."product_id" is null) <> ("section_members"."child_section_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `section_members_product_uq` ON `section_members` (`section_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `section_members_child_uq` ON `section_members` (`section_id`,`child_section_id`);--> statement-breakpoint
CREATE INDEX `section_members_order_idx` ON `section_members` (`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `section_members_child_idx` ON `section_members` (`child_section_id`);--> statement-breakpoint
CREATE INDEX `section_members_product_idx` ON `section_members` (`product_id`);--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`internal_name` text NOT NULL,
	`names` text DEFAULT '{}' NOT NULL,
	`role` text DEFAULT 'library' NOT NULL,
	`owner_menu_id` text,
	`image` text,
	`color` text,
	FOREIGN KEY (`owner_menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sections_role_ck" CHECK("sections"."role" in ('library', 'menu_root', 'home_layout')),
	CONSTRAINT "sections_owner_ck" CHECK(("sections"."role" = 'library') = ("sections"."owner_menu_id" is null))
);
--> statement-breakpoint
CREATE INDEX `sections_owner_menu_idx` ON `sections` (`owner_menu_id`);