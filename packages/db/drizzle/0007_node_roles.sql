CREATE TABLE `node_roles` (
	`node_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'primary' NOT NULL,
	`singleton_role` text DEFAULT 'primary' NOT NULL,
	`break_glass_verifier` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "node_roles_mode_ck" CHECK("node_roles"."mode" in ('primary', 'mirror')),
	CONSTRAINT "node_roles_singleton_role_ck" CHECK("node_roles"."singleton_role" in ('primary', 'secondary')),
	CONSTRAINT "node_roles_role_valid_ck" CHECK(not ("node_roles"."mode" = 'mirror' and "node_roles"."singleton_role" = 'primary'))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deployment` (
	`id` integer PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`stamped_at` text NOT NULL,
	CONSTRAINT "deployment_singleton_ck" CHECK("__new_deployment"."id" = 1),
	CONSTRAINT "deployment_environment_ck" CHECK("__new_deployment"."environment" in ('production', 'preproduction'))
);
--> statement-breakpoint
INSERT INTO `__new_deployment`("id", "environment", "stamped_at") SELECT "id", "environment", "stamped_at" FROM `deployment`;--> statement-breakpoint
DROP TABLE `deployment`;--> statement-breakpoint
ALTER TABLE `__new_deployment` RENAME TO `deployment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `join_requests` ADD `node_id` text;--> statement-breakpoint
ALTER TABLE `mirror_config` ADD `node_id` text;