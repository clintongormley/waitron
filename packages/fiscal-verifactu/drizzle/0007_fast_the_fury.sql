DROP TABLE `contadores_instalacion`;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_registro_sif` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`nif` text NOT NULL,
	`id_sistema_informatico` text NOT NULL,
	`numero_instalacion` text NOT NULL,
	`registrado_en` text NOT NULL,
	`revocado_en` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "registro_sif_numero_ck" CHECK(length("__new_registro_sif"."numero_instalacion") between 1 and 30)
);
--> statement-breakpoint
INSERT INTO `__new_registro_sif`("id", "node_id", "nif", "id_sistema_informatico", "numero_instalacion", "registrado_en", "revocado_en") SELECT "id", "node_id", "nif", "id_sistema_informatico", "numero_instalacion", "registrado_en", "revocado_en" FROM `registro_sif`;--> statement-breakpoint
DROP TABLE `registro_sif`;--> statement-breakpoint
ALTER TABLE `__new_registro_sif` RENAME TO `registro_sif`;--> statement-breakpoint
CREATE TEMP TABLE `w41_fk_assertion` (
  `violations` integer NOT NULL CHECK (`violations` = 0)
);--> statement-breakpoint
INSERT INTO `w41_fk_assertion` SELECT count(*) FROM pragma_foreign_key_check;--> statement-breakpoint
DROP TABLE `w41_fk_assertion`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `registro_sif_instalacion_uq` ON `registro_sif` (`nif`,`id_sistema_informatico`,`numero_instalacion`);--> statement-breakpoint
CREATE UNIQUE INDEX `registro_sif_activo_uq` ON `registro_sif` (`node_id`) WHERE "registro_sif"."revocado_en" is null;