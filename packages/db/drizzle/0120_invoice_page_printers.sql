CREATE TABLE `page_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`resource_path` text NOT NULL,
	`document_format` text NOT NULL,
	`supported_formats` text NOT NULL,
	`media` text NOT NULL,
	`resolution_dpi` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "page_printers_format_ck" CHECK("page_printers"."document_format" in ('application/pdf', 'image/pwg-raster', 'image/urf')),
	CONSTRAINT "page_printers_media_ck" CHECK("page_printers"."media" in ('iso_a4_210x297mm', 'na_letter_8.5x11in')),
	CONSTRAINT "page_printers_port_ck" CHECK("page_printers"."port" between 1 and 65535),
	CONSTRAINT "page_printers_resolution_ck" CHECK("page_printers"."resolution_dpi" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_printers_endpoint_uq` ON `page_printers` (`location_id`,`host`,`port`,`resource_path`);--> statement-breakpoint
ALTER TABLE `invoice_deliveries` ADD `page_printer_id` text;