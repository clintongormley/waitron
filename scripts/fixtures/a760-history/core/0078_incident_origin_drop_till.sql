PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_incidents` (
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
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "incidents_severity_ck" CHECK("__new_incidents"."severity" in ('warning', 'error')),
	CONSTRAINT "incidents_code_ck" CHECK("__new_incidents"."code" <> ''),
	CONSTRAINT "incidents_source_ck" CHECK("__new_incidents"."source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test')),
	CONSTRAINT "incidents_source_device_ck" CHECK(("__new_incidents"."source" = 'device') = ("__new_incidents"."device_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_incidents`("id", "source", "device_id", "sale_id", "code", "params", "severity", "detected_at", "acknowledged_at", "acknowledged_by") SELECT "id", "source", "device_id", "sale_id", "code", "params", "severity", "detected_at", "acknowledged_at", "acknowledged_by" FROM `incidents`;--> statement-breakpoint
DROP TABLE `incidents`;--> statement-breakpoint
ALTER TABLE `__new_incidents` RENAME TO `incidents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `incidents_origin_open_idx` ON `incidents` (`source`,`device_id`,`detected_at`);--> statement-breakpoint
CREATE INDEX `incidents_handled_idx` ON `incidents` (`acknowledged_at`);