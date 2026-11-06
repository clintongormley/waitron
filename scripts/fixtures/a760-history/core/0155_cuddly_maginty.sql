ALTER TABLE `devices` ADD `invoice_printer_id` text REFERENCES printers(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `devices` ADD `invoice_page_printer_id` text REFERENCES page_printers(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `device_profile_printers` ADD `page_printer_id` text REFERENCES page_printers(id) ON DELETE restrict;