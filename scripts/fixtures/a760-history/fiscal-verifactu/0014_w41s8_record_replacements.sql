DROP INDEX `registros_identidad_uq`;--> statement-breakpoint
ALTER TABLE `registros_facturacion` ADD `corrects_registro_id` text REFERENCES registros_facturacion(id);--> statement-breakpoint
CREATE UNIQUE INDEX `registros_corrects_registro_uq` ON `registros_facturacion` (`corrects_registro_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `registros_identidad_uq` ON `registros_facturacion` (`id_emisor_factura`,`num_serie_factura`,`fecha_expedicion_factura`,`tipo_registro`) WHERE "registros_facturacion"."corrects_registro_id" is null;