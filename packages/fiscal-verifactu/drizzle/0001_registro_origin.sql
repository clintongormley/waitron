ALTER TABLE `registros_facturacion` ADD `source` text;--> statement-breakpoint
ALTER TABLE `registros_facturacion` ADD `device_id` text REFERENCES devices(id);