PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_envios` (
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
	CONSTRAINT "envios_estado_ck" CHECK("__new_envios"."estado" in ('pendiente', 'enviando', 'aceptado', 'aceptado_con_errores', 'rechazado', 'detenido', 'retenido'))
);
--> statement-breakpoint
INSERT INTO `__new_envios`("registro_id", "estado", "intentos", "proximo_intento_en", "incidencia", "csv", "codigo_error", "mensaje_error", "enviado_en", "confirmado_en", "reconciled_resubmit_at") SELECT "registro_id", "estado", "intentos", "proximo_intento_en", "incidencia", "csv", "codigo_error", "mensaje_error", "enviado_en", "confirmado_en", "reconciled_resubmit_at" FROM `envios`;--> statement-breakpoint
DROP TABLE `envios`;--> statement-breakpoint
ALTER TABLE `__new_envios` RENAME TO `envios`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `envios_drenaje_idx` ON `envios` (`estado`,`proximo_intento_en`);