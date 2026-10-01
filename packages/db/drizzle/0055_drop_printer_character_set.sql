PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
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
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "printers_transport_ck" CHECK("__new_printers"."transport" in ('usb', 'network_tcp', 'bluetooth', 'cloud_poll')),
	CONSTRAINT "printers_ticket_scope_ck" CHECK("__new_printers"."ticket_scope" in ('station', 'order')),
	CONSTRAINT "printers_paper_width_ck" CHECK("__new_printers"."paper_width" in ('58mm', '80mm')),
	CONSTRAINT "printers_resolution_ck" CHECK("__new_printers"."resolution" in ('180dpi', '203dpi')),
	CONSTRAINT "printers_transport_fields_ck" CHECK(("__new_printers"."transport" = 'usb' and "__new_printers"."local_key" is not null)
          or ("__new_printers"."transport" = 'bluetooth' and "__new_printers"."local_key" is not null)
          or ("__new_printers"."transport" = 'network_tcp' and "__new_printers"."host" is not null)
          or ("__new_printers"."transport" = 'cloud_poll' and "__new_printers"."poll_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_printers`("id", "location_id", "name", "transport", "local_key", "host", "port", "poll_id", "poll_token_hash", "ticket_scope", "paper_width", "resolution", "has_cash_drawer", "active") SELECT "id", "location_id", "name", "transport", "local_key", "host", "port", "poll_id", "poll_token_hash", "ticket_scope", "paper_width", "resolution", "has_cash_drawer", "active" FROM `printers`;--> statement-breakpoint
DROP TABLE `printers`;--> statement-breakpoint
ALTER TABLE `__new_printers` RENAME TO `printers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `printers_local_key_key` ON `printers` (`location_id`,`local_key`) WHERE "printers"."local_key" is not null;