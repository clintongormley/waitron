PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_registros_facturacion` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`node_id` text NOT NULL,
	`sif_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`secuencia` integer NOT NULL,
	`tipo_registro` text NOT NULL,
	`id_emisor_factura` text NOT NULL,
	`num_serie_factura` text NOT NULL,
	`fecha_expedicion_factura` text NOT NULL,
	`nombre_razon_emisor` text NOT NULL,
	`tipo_factura` text,
	`tipo_rectificativa` text,
	`facturas_rectificadas` text,
	`facturas_sustituidas` text,
	`importe_rectificacion` text,
	`destinatarios` text,
	`descripcion_operacion` text,
	`desglose` text,
	`cuota_total` text,
	`importe_total` text,
	`primer_registro` integer NOT NULL,
	`anterior_id_emisor_factura` text,
	`anterior_num_serie_factura` text,
	`anterior_fecha_expedicion_factura` text,
	`anterior_huella` text,
	`sistema_informatico` text NOT NULL,
	`fecha_hora_huso_gen_registro` text NOT NULL,
	`offset_minutos` integer NOT NULL,
	`tipo_huella` text NOT NULL,
	`huella` text NOT NULL,
	`entorno` text,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sif_id`) REFERENCES `registro_sif`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "registros_facturacion_source_ck" CHECK("__new_registros_facturacion"."source" in ('device', 'demo_seed', 'readiness_test')),
	CONSTRAINT "registros_facturacion_source_device_ck" CHECK(("__new_registros_facturacion"."source" = 'device') = ("__new_registros_facturacion"."device_id" is not null)),
	CONSTRAINT "registros_tipo_registro_ck" CHECK("__new_registros_facturacion"."tipo_registro" in ('alta', 'anulacion')),
	CONSTRAINT "registros_tipo_huella_ck" CHECK("__new_registros_facturacion"."tipo_huella" = '01'),
	CONSTRAINT "registros_huella_ck" CHECK(length("__new_registros_facturacion"."huella") = 64 and "__new_registros_facturacion"."huella" not glob '*[^0-9A-F]*'),
	CONSTRAINT "registros_secuencia_ck" CHECK("__new_registros_facturacion"."secuencia" > 0),
	CONSTRAINT "registros_entorno_ck" CHECK("__new_registros_facturacion"."entorno" is null or "__new_registros_facturacion"."entorno" in ('production', 'preproduction')),
	CONSTRAINT "registros_tipo_rectificativa_ck" CHECK("__new_registros_facturacion"."tipo_rectificativa" is null or "__new_registros_facturacion"."tipo_rectificativa" in ('S', 'I')),
	CONSTRAINT "registros_tipo_factura_rectificativa_ck" CHECK("__new_registros_facturacion"."tipo_rectificativa" is null or ("__new_registros_facturacion"."tipo_factura" is not null and "__new_registros_facturacion"."tipo_factura" glob 'R[1-5]')),
	CONSTRAINT "registros_facturas_sustituidas_f3_ck" CHECK("__new_registros_facturacion"."facturas_sustituidas" is null or ("__new_registros_facturacion"."tipo_factura" is not null and "__new_registros_facturacion"."tipo_factura" = 'F3')),
	CONSTRAINT "registros_encadenamiento_ck" CHECK(("__new_registros_facturacion"."primer_registro"
             and "__new_registros_facturacion"."anterior_id_emisor_factura" is null
             and "__new_registros_facturacion"."anterior_num_serie_factura" is null
             and "__new_registros_facturacion"."anterior_fecha_expedicion_factura" is null
             and "__new_registros_facturacion"."anterior_huella" is null)
           or (not "__new_registros_facturacion"."primer_registro"
             and "__new_registros_facturacion"."anterior_id_emisor_factura" is not null
             and "__new_registros_facturacion"."anterior_num_serie_factura" is not null
             and "__new_registros_facturacion"."anterior_fecha_expedicion_factura" is not null
             and "__new_registros_facturacion"."anterior_huella" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_registros_facturacion`("id", "source", "device_id", "node_id", "sif_id", "sale_id", "secuencia", "tipo_registro", "id_emisor_factura", "num_serie_factura", "fecha_expedicion_factura", "nombre_razon_emisor", "tipo_factura", "tipo_rectificativa", "facturas_rectificadas", "facturas_sustituidas", "importe_rectificacion", "destinatarios", "descripcion_operacion", "desglose", "cuota_total", "importe_total", "primer_registro", "anterior_id_emisor_factura", "anterior_num_serie_factura", "anterior_fecha_expedicion_factura", "anterior_huella", "sistema_informatico", "fecha_hora_huso_gen_registro", "offset_minutos", "tipo_huella", "huella", "entorno", "creado_en") SELECT "id", "source", "device_id", "node_id", "sif_id", "sale_id", "secuencia", "tipo_registro", "id_emisor_factura", "num_serie_factura", "fecha_expedicion_factura", "nombre_razon_emisor", "tipo_factura", "tipo_rectificativa", "facturas_rectificadas", "facturas_sustituidas", "importe_rectificacion", "destinatarios", "descripcion_operacion", "desglose", "cuota_total", "importe_total", "primer_registro", "anterior_id_emisor_factura", "anterior_num_serie_factura", "anterior_fecha_expedicion_factura", "anterior_huella", "sistema_informatico", "fecha_hora_huso_gen_registro", "offset_minutos", "tipo_huella", "huella", "entorno", "creado_en" FROM `registros_facturacion`;--> statement-breakpoint
DROP TABLE `registros_facturacion`;--> statement-breakpoint
ALTER TABLE `__new_registros_facturacion` RENAME TO `registros_facturacion`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `registros_tenant_node_secuencia_uq` ON `registros_facturacion` (`node_id`,`secuencia`);--> statement-breakpoint
CREATE UNIQUE INDEX `registros_identidad_uq` ON `registros_facturacion` (`id_emisor_factura`,`num_serie_factura`,`fecha_expedicion_factura`,`tipo_registro`);--> statement-breakpoint
CREATE INDEX `registros_sale_idx` ON `registros_facturacion` (`sale_id`);--> statement-breakpoint
CREATE INDEX `registros_node_secuencia_idx` ON `registros_facturacion` (`node_id`,`secuencia`);