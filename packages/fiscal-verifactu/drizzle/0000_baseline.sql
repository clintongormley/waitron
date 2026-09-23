CREATE TABLE `acks` (
	`registro_id` text PRIMARY KEY NOT NULL,
	`submitted_at` text NOT NULL,
	`csv` text,
	`state` text NOT NULL,
	`delivered_at` text,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "acks_state_ck" CHECK("acks"."state" in ('accepted', 'accepted_with_errors', 'rejected', 'halted'))
);
--> statement-breakpoint
CREATE TABLE `cadenas` (
	`node_id` text PRIMARY KEY NOT NULL,
	`secuencia` integer DEFAULT 0 NOT NULL,
	`ultimo_registro_id` text,
	`ultima_huella` text,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ultimo_registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cadenas_puntero_ck" CHECK(("cadenas"."ultimo_registro_id" is null) = ("cadenas"."ultima_huella" is null))
);
--> statement-breakpoint
CREATE TABLE `contadores_instalacion` (
	`nif` text NOT NULL,
	`id_sistema_informatico` text NOT NULL,
	`proximo_numero` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`nif`, `id_sistema_informatico`)
);
--> statement-breakpoint
CREATE TABLE `envio_flujo` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`proximo_envio_en` text NOT NULL,
	`tiempo_espera_seg` integer NOT NULL,
	CONSTRAINT "envio_flujo_singleton_ck" CHECK("envio_flujo"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `envios` (
	`registro_id` text PRIMARY KEY NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`intentos` integer DEFAULT 0 NOT NULL,
	`proximo_intento_en` text NOT NULL,
	`incidencia` integer DEFAULT false NOT NULL,
	`csv` text,
	`codigo_error` text,
	`mensaje_error` text,
	`enviado_en` text,
	`confirmado_en` text,
	`reconciled_resubmit_at` text,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "envios_estado_ck" CHECK("envios"."estado" in ('pendiente', 'enviando', 'aceptado', 'aceptado_con_errores', 'rechazado', 'detenido'))
);
--> statement-breakpoint
CREATE INDEX `envios_drenaje_idx` ON `envios` (`estado`,`proximo_intento_en`);--> statement-breakpoint
CREATE TABLE `registro_sif` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`nif` text NOT NULL,
	`id_sistema_informatico` text NOT NULL,
	`numero_instalacion` integer NOT NULL,
	`registrado_en` text NOT NULL,
	`revocado_en` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "registro_sif_numero_ck" CHECK("registro_sif"."numero_instalacion" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registro_sif_instalacion_uq` ON `registro_sif` (`nif`,`id_sistema_informatico`,`numero_instalacion`);--> statement-breakpoint
CREATE UNIQUE INDEX `registro_sif_activo_uq` ON `registro_sif` (`node_id`) WHERE "registro_sif"."revocado_en" is null;--> statement-breakpoint
CREATE TABLE `registros_facturacion` (
	`id` text PRIMARY KEY NOT NULL,
	`till_id` text NOT NULL,
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
	FOREIGN KEY (`till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sif_id`) REFERENCES `registro_sif`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "registros_tipo_registro_ck" CHECK("registros_facturacion"."tipo_registro" in ('alta', 'anulacion')),
	CONSTRAINT "registros_tipo_huella_ck" CHECK("registros_facturacion"."tipo_huella" = '01'),
	CONSTRAINT "registros_huella_ck" CHECK(length("registros_facturacion"."huella") = 64 and "registros_facturacion"."huella" not glob '*[^0-9A-F]*'),
	CONSTRAINT "registros_secuencia_ck" CHECK("registros_facturacion"."secuencia" > 0),
	CONSTRAINT "registros_entorno_ck" CHECK("registros_facturacion"."entorno" is null or "registros_facturacion"."entorno" in ('production', 'preproduction')),
	CONSTRAINT "registros_tipo_rectificativa_ck" CHECK("registros_facturacion"."tipo_rectificativa" is null or "registros_facturacion"."tipo_rectificativa" in ('S', 'I')),
	CONSTRAINT "registros_tipo_factura_rectificativa_ck" CHECK("registros_facturacion"."tipo_rectificativa" is null or ("registros_facturacion"."tipo_factura" is not null and "registros_facturacion"."tipo_factura" glob 'R[1-5]')),
	CONSTRAINT "registros_facturas_sustituidas_f3_ck" CHECK("registros_facturacion"."facturas_sustituidas" is null or ("registros_facturacion"."tipo_factura" is not null and "registros_facturacion"."tipo_factura" = 'F3')),
	CONSTRAINT "registros_encadenamiento_ck" CHECK(("registros_facturacion"."primer_registro"
             and "registros_facturacion"."anterior_id_emisor_factura" is null
             and "registros_facturacion"."anterior_num_serie_factura" is null
             and "registros_facturacion"."anterior_fecha_expedicion_factura" is null
             and "registros_facturacion"."anterior_huella" is null)
           or (not "registros_facturacion"."primer_registro"
             and "registros_facturacion"."anterior_id_emisor_factura" is not null
             and "registros_facturacion"."anterior_num_serie_factura" is not null
             and "registros_facturacion"."anterior_fecha_expedicion_factura" is not null
             and "registros_facturacion"."anterior_huella" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registros_tenant_node_secuencia_uq` ON `registros_facturacion` (`node_id`,`secuencia`);--> statement-breakpoint
CREATE UNIQUE INDEX `registros_identidad_uq` ON `registros_facturacion` (`id_emisor_factura`,`num_serie_factura`,`fecha_expedicion_factura`,`tipo_registro`);--> statement-breakpoint
CREATE INDEX `registros_sale_idx` ON `registros_facturacion` (`sale_id`);--> statement-breakpoint
CREATE INDEX `registros_node_secuencia_idx` ON `registros_facturacion` (`node_id`,`secuencia`);