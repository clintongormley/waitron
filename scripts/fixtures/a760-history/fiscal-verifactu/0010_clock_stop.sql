CREATE TABLE `clock_stop_restarts` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`person_id` text NOT NULL,
	`restarted_at` text NOT NULL,
	`clock_at` text NOT NULL,
	`registro_id` text NOT NULL,
	`record_at` text NOT NULL,
	`proof` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clock_stop_restarts_registro_uq` ON `clock_stop_restarts` (`registro_id`);--> statement-breakpoint
CREATE INDEX `registros_generado_idx` ON `registros_facturacion` (`fecha_hora_huso_gen_registro`);