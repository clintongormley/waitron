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
CREATE TABLE `clock_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`node_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`reason` text NOT NULL,
	`detail` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clock_checks_reason_ck" CHECK("clock_checks"."reason" in ('start', 'change', 'behind_chain', 'disagrees'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clock_checks_seq_uq` ON `clock_checks` (`seq`);--> statement-breakpoint
CREATE TABLE `clock_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`node_id` text NOT NULL,
	`box_clock_at` text NOT NULL,
	`confirmed_at` text NOT NULL,
	`step_ms` integer NOT NULL,
	`source` text NOT NULL,
	`person_id` text,
	`reason` text NOT NULL,
	`proof` text NOT NULL,
	`check_id` text,
	`registro_id` text,
	`record_at` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`check_id`) REFERENCES `clock_checks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clock_confirmations_source_ck" CHECK("clock_confirmations"."source" in ('authority', 'devices', 'admin', 'staff', 'elapsed')),
	CONSTRAINT "clock_confirmations_reason_ck" CHECK("clock_confirmations"."reason" in ('start', 'change', 'behind_chain', 'disagrees', 'unusable')),
	CONSTRAINT "clock_confirmations_person_ck" CHECK(("clock_confirmations"."source" in ('admin', 'staff')) = ("clock_confirmations"."person_id" is not null) and ("clock_confirmations"."person_id" is null or length("clock_confirmations"."person_id") > 0)),
	CONSTRAINT "clock_confirmations_record_ck" CHECK(("clock_confirmations"."registro_id" is null) = ("clock_confirmations"."record_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clock_confirmations_seq_uq` ON `clock_confirmations` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `clock_confirmations_check_uq` ON `clock_confirmations` (`check_id`);--> statement-breakpoint
CREATE INDEX `clock_confirmations_registro_idx` ON `clock_confirmations` (`registro_id`);--> statement-breakpoint
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
CREATE TABLE `envio_flujo` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`proximo_envio_en` text NOT NULL,
	`tiempo_espera_seg` integer NOT NULL,
	`technical_incident_token` text,
	CONSTRAINT "envio_flujo_singleton_ck" CHECK("envio_flujo"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `envios` (
	`registro_id` text PRIMARY KEY NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`intentos` integer DEFAULT 0 NOT NULL,
	`proximo_intento_en` text NOT NULL,
	`incidencia` integer DEFAULT false NOT NULL,
	`technical_incidence` integer DEFAULT false NOT NULL,
	`csv` text,
	`codigo_error` text,
	`mensaje_error` text,
	`enviado_en` text,
	`confirmado_en` text,
	`reconciled_resubmit_at` text,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "envios_estado_ck" CHECK("envios"."estado" in ('pendiente', 'enviando', 'aceptado', 'aceptado_con_errores', 'rechazado', 'detenido', 'retenido'))
);
--> statement-breakpoint
CREATE INDEX `envios_drenaje_idx` ON `envios` (`estado`,`proximo_intento_en`);--> statement-breakpoint
CREATE INDEX `envios_confirmado_idx` ON `envios` (`confirmado_en`);--> statement-breakpoint
CREATE TABLE `filing_case_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`action_key` text NOT NULL,
	`kind` text NOT NULL,
	`person_id` text NOT NULL,
	`action` text NOT NULL,
	`remedy_registro_id` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `filing_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`remedy_registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "filing_case_events_kind_ck" CHECK("filing_case_events"."kind" in ('note', 'resolved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filing_case_events_action_key_uq` ON `filing_case_events` (`action_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `filing_case_events_one_resolution_uq` ON `filing_case_events` (`case_id`) WHERE "filing_case_events"."kind" = 'resolved';--> statement-breakpoint
CREATE INDEX `filing_case_events_case_idx` ON `filing_case_events` (`case_id`);--> statement-breakpoint
CREATE TABLE `filing_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`registro_id` text NOT NULL,
	`cause` text NOT NULL,
	`evidence` text NOT NULL,
	`opened_at` text NOT NULL,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "filing_cases_cause_ck" CHECK("filing_cases"."cause" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filing_cases_registro_uq` ON `filing_cases` (`registro_id`);--> statement-breakpoint
CREATE TABLE `fiscal_allocations` (
	`event_key` text PRIMARY KEY NOT NULL,
	`allocation_key` text NOT NULL,
	`node_id` text NOT NULL,
	`sif_id` text NOT NULL,
	`taxpayer_nif` text NOT NULL,
	`software_id` text NOT NULL,
	`environment` text NOT NULL,
	`installation_identity` text NOT NULL,
	`allocation` text NOT NULL,
	`approval` text NOT NULL,
	`bases` text NOT NULL,
	`result` text NOT NULL,
	`activated_at` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sif_id`) REFERENCES `registro_sif`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_allocations_allocation_uq` ON `fiscal_allocations` (`allocation_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_allocations_identity_uq` ON `fiscal_allocations` (`taxpayer_nif`,`software_id`,`environment`,`installation_identity`);--> statement-breakpoint
CREATE TABLE `fiscal_certificate_installs` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`installed_at` text NOT NULL,
	`source` text NOT NULL,
	`person_id` text,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`organisation` text,
	`tax_id` text,
	`issuer` text,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`checked_endpoint` text,
	`checked_at` text,
	CONSTRAINT "fiscal_certificate_installs_source_ck" CHECK("fiscal_certificate_installs"."source" in ('setup', 'dashboard')),
	CONSTRAINT "fiscal_certificate_installs_kind_ck" CHECK("fiscal_certificate_installs"."kind" in ('sello', 'representante')),
	CONSTRAINT "fiscal_certificate_installs_dashboard_ck" CHECK("fiscal_certificate_installs"."source" = 'setup' or ("fiscal_certificate_installs"."person_id" is not null and "fiscal_certificate_installs"."checked_at" is not null and "fiscal_certificate_installs"."checked_endpoint" is not null))
);
--> statement-breakpoint
CREATE INDEX `fiscal_certificate_installs_node_idx` ON `fiscal_certificate_installs` (`node_id`,`installed_at`);--> statement-breakpoint
CREATE TABLE `fiscal_certificate_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`install_id` text NOT NULL,
	`stage` text NOT NULL,
	`person_id` text NOT NULL,
	`status` text NOT NULL,
	`claimed_at` text NOT NULL,
	`reported_at` text,
	FOREIGN KEY (`install_id`) REFERENCES `fiscal_certificate_installs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fiscal_certificate_reminders_stage_ck" CHECK("fiscal_certificate_reminders"."stage" in ('warning', 'urgent', 'expired')),
	CONSTRAINT "fiscal_certificate_reminders_status_ck" CHECK("fiscal_certificate_reminders"."status" in ('claimed', 'sent', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_certificate_reminders_uq` ON `fiscal_certificate_reminders` (`install_id`,`stage`,`person_id`);--> statement-breakpoint
CREATE TABLE `fiscal_conflict_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`registro_id` text NOT NULL,
	`case_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`cause` text NOT NULL,
	`evidence` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `filing_cases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fiscal_conflict_evidence_attempt_ck" CHECK("fiscal_conflict_evidence"."attempt" > 0),
	CONSTRAINT "fiscal_conflict_evidence_cause_ck" CHECK("fiscal_conflict_evidence"."cause" in ('fiscal.huella_divergente', 'fiscal.duplicado_anulado'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_conflict_evidence_attempt_uq` ON `fiscal_conflict_evidence` (`registro_id`,`attempt`,`cause`);--> statement-breakpoint
CREATE TABLE `fiscal_lookup_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`registro_id` text NOT NULL,
	`case_id` text NOT NULL,
	`evidence` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `filing_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_lookup_conflicts_registro_uq` ON `fiscal_lookup_conflicts` (`registro_id`);--> statement-breakpoint
CREATE TABLE `fiscal_reservations` (
	`event_key` text PRIMARY KEY NOT NULL,
	`allocation_key` text NOT NULL,
	`node_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`taxpayer_nif` text NOT NULL,
	`software_id` text NOT NULL,
	`environment` text NOT NULL,
	`installation_identity` text NOT NULL,
	`evidence` text NOT NULL,
	`bases` text NOT NULL,
	`established_at` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_reservations_allocation_uq` ON `fiscal_reservations` (`allocation_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_reservations_identity_uq` ON `fiscal_reservations` (`taxpayer_nif`,`software_id`,`environment`,`installation_identity`);--> statement-breakpoint
CREATE TABLE `fiscal_series_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`sif_id` text NOT NULL,
	`series_id` text NOT NULL,
	`invoice_identity` text NOT NULL,
	`evidence` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`sif_id`) REFERENCES `registro_sif`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `invoice_series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_series_conflicts_invoice_uq` ON `fiscal_series_conflicts` (`sif_id`,`invoice_identity`);--> statement-breakpoint
CREATE TABLE `registro_sif` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`nif` text NOT NULL,
	`id_sistema_informatico` text NOT NULL,
	`numero_instalacion` text NOT NULL,
	`registrado_en` text NOT NULL,
	`revocado_en` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "registro_sif_numero_ck" CHECK(length("registro_sif"."numero_instalacion") between 1 and 30)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registro_sif_instalacion_uq` ON `registro_sif` (`nif`,`id_sistema_informatico`,`numero_instalacion`);--> statement-breakpoint
CREATE UNIQUE INDEX `registro_sif_activo_uq` ON `registro_sif` (`node_id`) WHERE "registro_sif"."revocado_en" is null;--> statement-breakpoint
CREATE TABLE `registros_facturacion` (
	`id` text PRIMARY KEY NOT NULL,
	`corrects_registro_id` text,
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
	`subsanacion` text,
	`rechazo_previo` text,
	`sin_registro_previo` text,
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
	FOREIGN KEY (`corrects_registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sif_id`) REFERENCES `registro_sif`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "registros_facturacion_source_ck" CHECK("registros_facturacion"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "registros_facturacion_source_device_ck" CHECK(("registros_facturacion"."source" = 'device') = ("registros_facturacion"."device_id" is not null)),
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
CREATE UNIQUE INDEX `registros_corrects_registro_uq` ON `registros_facturacion` (`corrects_registro_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `registros_identidad_uq` ON `registros_facturacion` (`id_emisor_factura`,`num_serie_factura`,`fecha_expedicion_factura`,`tipo_registro`) WHERE "registros_facturacion"."corrects_registro_id" is null;--> statement-breakpoint
CREATE INDEX `registros_sale_idx` ON `registros_facturacion` (`sale_id`);--> statement-breakpoint
CREATE INDEX `registros_node_secuencia_idx` ON `registros_facturacion` (`node_id`,`secuencia`);--> statement-breakpoint
CREATE INDEX `registros_generado_idx` ON `registros_facturacion` (`fecha_hora_huso_gen_registro`);