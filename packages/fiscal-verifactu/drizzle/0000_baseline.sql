CREATE TABLE `acks` (
	`registro_id` text PRIMARY KEY NOT NULL,
	`submitted_at` text NOT NULL,
	`csv` text,
	`state` text NOT NULL,
	`delivered_at` text,
	FOREIGN KEY (`registro_id`) REFERENCES `verifactu_records`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "acks_state_ck" CHECK("acks"."state" in ('accepted', 'accepted_with_errors', 'rejected', 'halted'))
);
--> statement-breakpoint
CREATE TABLE `declaraciones_responsables` (
	`version` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`first_started_at` text NOT NULL,
	CONSTRAINT "declaraciones_responsables_version_ck" CHECK(instr("declaraciones_responsables"."version", char(0)) = 0
          and length("declaraciones_responsables"."version") <= 50
          and substr("declaraciones_responsables"."version", 1, instr("declaraciones_responsables"."version" || '-', '-') - 1) glob '[0-9]*.[0-9]*.[0-9]*'
          and substr("declaraciones_responsables"."version", 1, instr("declaraciones_responsables"."version" || '-', '-') - 1) not glob '*[^0-9.]*'
          and length(substr("declaraciones_responsables"."version", 1, instr("declaraciones_responsables"."version" || '-', '-') - 1)) - length(replace(substr("declaraciones_responsables"."version", 1, instr("declaraciones_responsables"."version" || '-', '-') - 1), '.', '')) = 2
          and substr("declaraciones_responsables"."version", 1, instr("declaraciones_responsables"."version" || '-', '-') - 1) not glob '0[0-9]*'
          and substr("declaraciones_responsables"."version", 1, instr("declaraciones_responsables"."version" || '-', '-') - 1) not glob '*.0[0-9]*'
          and (instr("declaraciones_responsables"."version", '-') = 0 or (
            substr(substr("declaraciones_responsables"."version", instr("declaraciones_responsables"."version", '-') + 1), 1, instr(substr("declaraciones_responsables"."version", instr("declaraciones_responsables"."version", '-') + 1), '.') - 1) in ('alpha', 'beta', 'rc')
            and substr(substr("declaraciones_responsables"."version", instr("declaraciones_responsables"."version", '-') + 1), instr(substr("declaraciones_responsables"."version", instr("declaraciones_responsables"."version", '-') + 1), '.') + 1) glob '[0-9]*'
            and substr(substr("declaraciones_responsables"."version", instr("declaraciones_responsables"."version", '-') + 1), instr(substr("declaraciones_responsables"."version", instr("declaraciones_responsables"."version", '-') + 1), '.') + 1) not glob '*[^0-9]*'
            and substr(substr("declaraciones_responsables"."version", instr("declaraciones_responsables"."version", '-') + 1), instr(substr("declaraciones_responsables"."version", instr("declaraciones_responsables"."version", '-') + 1), '.') + 1) not glob '0[0-9]*'
          )))
);
--> statement-breakpoint
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
	FOREIGN KEY (`remedy_registro_id`) REFERENCES `verifactu_records`(`id`) ON UPDATE no action ON DELETE no action,
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
	FOREIGN KEY (`registro_id`) REFERENCES `verifactu_records`(`id`) ON UPDATE no action ON DELETE no action,
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
	FOREIGN KEY (`sif_id`) REFERENCES `verifactu_identities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_allocations_allocation_uq` ON `fiscal_allocations` (`allocation_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_allocations_identity_uq` ON `fiscal_allocations` (`taxpayer_nif`,`software_id`,`environment`,`installation_identity`);--> statement-breakpoint
CREATE TABLE `fiscal_certificate_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`install_id` text NOT NULL,
	`stage` text NOT NULL,
	`person_id` text NOT NULL,
	`status` text NOT NULL,
	`claimed_at` text NOT NULL,
	`reported_at` text,
	FOREIGN KEY (`install_id`) REFERENCES `verifactu_certificates`(`id`) ON UPDATE no action ON DELETE no action,
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
	FOREIGN KEY (`registro_id`) REFERENCES `verifactu_records`(`id`) ON UPDATE no action ON DELETE no action,
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
	FOREIGN KEY (`registro_id`) REFERENCES `verifactu_records`(`id`) ON UPDATE no action ON DELETE no action,
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
CREATE TABLE `returned_invoice_records` (
	`record_id` text PRIMARY KEY NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `verifactu_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `verifactu_certificates` (
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
	CONSTRAINT "verifactu_certificates_source_ck" CHECK("verifactu_certificates"."source" in ('setup', 'dashboard')),
	CONSTRAINT "verifactu_certificates_kind_ck" CHECK("verifactu_certificates"."kind" in ('sello', 'representante')),
	CONSTRAINT "verifactu_certificates_dashboard_ck" CHECK("verifactu_certificates"."source" = 'setup' or ("verifactu_certificates"."person_id" is not null and "verifactu_certificates"."checked_at" is not null and "verifactu_certificates"."checked_endpoint" is not null))
);
--> statement-breakpoint
CREATE INDEX `verifactu_certificates_node_idx` ON `verifactu_certificates` (`node_id`,`installed_at`);--> statement-breakpoint
CREATE TABLE `verifactu_history` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`node_id` text NOT NULL,
	`person_id` text,
	`at` text NOT NULL,
	`data` text NOT NULL,
	`event_key` text,
	`registro_id` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`registro_id`) REFERENCES `verifactu_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "verifactu_history_data_ck" CHECK(case when json_valid("verifactu_history"."data") then json_type("verifactu_history"."data") = 'object' else 0 end),
	CONSTRAINT "verifactu_history_kind_ck" CHECK("verifactu_history"."kind" in ('clock.confirmed', 'conflict.observed', 'conflict.lookup')),
	CONSTRAINT "verifactu_history_confirmed_source_ck" CHECK("verifactu_history"."kind" <> 'clock.confirmed' or coalesce(json_extract("verifactu_history"."data", '$.source') in ('admin', 'staff'), 0)),
	CONSTRAINT "verifactu_history_confirmed_reason_ck" CHECK("verifactu_history"."kind" <> 'clock.confirmed' or coalesce(json_extract("verifactu_history"."data", '$.reason') in ('start', 'unusable'), 0)),
	CONSTRAINT "verifactu_history_confirmed_person_ck" CHECK("verifactu_history"."kind" <> 'clock.confirmed' or coalesce(length("verifactu_history"."person_id") > 0, 0)),
	CONSTRAINT "verifactu_history_confirmed_shape_ck" CHECK("verifactu_history"."kind" <> 'clock.confirmed' or coalesce(
        json_type("verifactu_history"."data", '$.confirmedAt') = 'text'
        and json_type("verifactu_history"."data", '$.stepMs') = 'integer'
        and json_type("verifactu_history"."data", '$.proof') = 'object',
        0
      )),
	CONSTRAINT "verifactu_history_confirmed_links_ck" CHECK("verifactu_history"."kind" <> 'clock.confirmed' or coalesce(
        "verifactu_history"."event_key" is null and "verifactu_history"."registro_id" is null, 0
      )),
	CONSTRAINT "verifactu_history_observed_ck" CHECK("verifactu_history"."kind" <> 'conflict.observed' or coalesce(
        "verifactu_history"."registro_id" is not null
        and json_type("verifactu_history"."data", '$.attempt') = 'integer'
        and json_extract("verifactu_history"."data", '$.attempt') > 0
        and json_extract("verifactu_history"."data", '$.cause') in ('fiscal.huella_divergente', 'fiscal.duplicado_anulado')
        and json_type("verifactu_history"."data", '$.evidence') is not null
        and "verifactu_history"."person_id" is null
        and "verifactu_history"."event_key" = 'conflict:' || "verifactu_history"."registro_id" || ':' || json_extract("verifactu_history"."data", '$.attempt') || ':' || json_extract("verifactu_history"."data", '$.cause'),
        0
      )),
	CONSTRAINT "verifactu_history_lookup_ck" CHECK("verifactu_history"."kind" <> 'conflict.lookup' or coalesce(
        "verifactu_history"."registro_id" is not null
        and json_type("verifactu_history"."data", '$.evidence') is not null
        and "verifactu_history"."person_id" is null
        and "verifactu_history"."event_key" = 'lookup:' || "verifactu_history"."registro_id",
        0
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verifactu_history_seq_uq` ON `verifactu_history` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `verifactu_history_event_key_uq` ON `verifactu_history` (`event_key`);--> statement-breakpoint
CREATE INDEX `verifactu_history_registro_kind_seq_idx` ON `verifactu_history` (`registro_id`,`kind`,`seq`);--> statement-breakpoint
CREATE TABLE `verifactu_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`nif` text NOT NULL,
	`id_sistema_informatico` text NOT NULL,
	`numero_instalacion` text NOT NULL,
	`registrado_en` text NOT NULL,
	`revocado_en` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "verifactu_identities_numero_ck" CHECK(length("verifactu_identities"."numero_instalacion") between 1 and 30)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verifactu_identities_instalacion_uq` ON `verifactu_identities` (`nif`,`id_sistema_informatico`,`numero_instalacion`);--> statement-breakpoint
CREATE UNIQUE INDEX `verifactu_identities_activo_uq` ON `verifactu_identities` (`node_id`) WHERE "verifactu_identities"."revocado_en" is null;--> statement-breakpoint
CREATE TABLE `verifactu_records` (
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
	`fecha_operacion` text,
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
	FOREIGN KEY (`corrects_registro_id`) REFERENCES `verifactu_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sif_id`) REFERENCES `verifactu_identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "verifactu_records_source_ck" CHECK("verifactu_records"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script', 'business_day_close')),
	CONSTRAINT "verifactu_records_source_device_ck" CHECK(("verifactu_records"."source" = 'device') = ("verifactu_records"."device_id" is not null)),
	CONSTRAINT "verifactu_records_tipo_registro_ck" CHECK("verifactu_records"."tipo_registro" in ('alta', 'anulacion')),
	CONSTRAINT "verifactu_records_tipo_huella_ck" CHECK("verifactu_records"."tipo_huella" = '01'),
	CONSTRAINT "verifactu_records_huella_ck" CHECK(length("verifactu_records"."huella") = 64 and "verifactu_records"."huella" not glob '*[^0-9A-F]*'),
	CONSTRAINT "verifactu_records_secuencia_ck" CHECK("verifactu_records"."secuencia" > 0),
	CONSTRAINT "verifactu_records_entorno_ck" CHECK("verifactu_records"."entorno" is null or "verifactu_records"."entorno" in ('production', 'preproduction')),
	CONSTRAINT "verifactu_records_tipo_rectificativa_ck" CHECK("verifactu_records"."tipo_rectificativa" is null or "verifactu_records"."tipo_rectificativa" in ('S', 'I')),
	CONSTRAINT "verifactu_records_tipo_factura_rectificativa_ck" CHECK("verifactu_records"."tipo_rectificativa" is null or ("verifactu_records"."tipo_factura" is not null and "verifactu_records"."tipo_factura" glob 'R[1-5]')),
	CONSTRAINT "verifactu_records_facturas_sustituidas_f3_ck" CHECK("verifactu_records"."facturas_sustituidas" is null or ("verifactu_records"."tipo_factura" is not null and "verifactu_records"."tipo_factura" = 'F3')),
	CONSTRAINT "verifactu_records_encadenamiento_ck" CHECK(("verifactu_records"."primer_registro"
             and "verifactu_records"."anterior_id_emisor_factura" is null
             and "verifactu_records"."anterior_num_serie_factura" is null
             and "verifactu_records"."anterior_fecha_expedicion_factura" is null
             and "verifactu_records"."anterior_huella" is null)
           or (not "verifactu_records"."primer_registro"
             and "verifactu_records"."anterior_id_emisor_factura" is not null
             and "verifactu_records"."anterior_num_serie_factura" is not null
             and "verifactu_records"."anterior_fecha_expedicion_factura" is not null
             and "verifactu_records"."anterior_huella" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verifactu_records_node_secuencia_uq` ON `verifactu_records` (`node_id`,`secuencia`);--> statement-breakpoint
CREATE UNIQUE INDEX `verifactu_records_corrects_registro_uq` ON `verifactu_records` (`corrects_registro_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `verifactu_records_identidad_uq` ON `verifactu_records` (`id_emisor_factura`,`num_serie_factura`,`fecha_expedicion_factura`,`tipo_registro`) WHERE "verifactu_records"."corrects_registro_id" is null;--> statement-breakpoint
CREATE INDEX `verifactu_records_sale_idx` ON `verifactu_records` (`sale_id`);--> statement-breakpoint
CREATE INDEX `verifactu_records_generado_idx` ON `verifactu_records` (`fecha_hora_huso_gen_registro`);--> statement-breakpoint
CREATE TABLE `verifactu_sending_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`proximo_envio_en` text NOT NULL,
	`tiempo_espera_seg` integer NOT NULL,
	`technical_incident_token` text,
	CONSTRAINT "verifactu_sending_state_singleton_ck" CHECK("verifactu_sending_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `verifactu_series_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`sif_id` text NOT NULL,
	`series_id` text NOT NULL,
	`invoice_identity` text NOT NULL,
	`evidence` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`sif_id`) REFERENCES `verifactu_identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `invoice_series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verifactu_series_conflicts_invoice_uq` ON `verifactu_series_conflicts` (`sif_id`,`invoice_identity`);--> statement-breakpoint
CREATE TABLE `verifactu_submissions` (
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
	FOREIGN KEY (`registro_id`) REFERENCES `verifactu_records`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "verifactu_submissions_estado_ck" CHECK("verifactu_submissions"."estado" in ('pendiente', 'enviando', 'aceptado', 'aceptado_con_errores', 'rechazado', 'detenido', 'retenido'))
);
--> statement-breakpoint
CREATE INDEX `verifactu_submissions_drenaje_idx` ON `verifactu_submissions` (`estado`,`proximo_intento_en`);--> statement-breakpoint
CREATE INDEX `verifactu_submissions_confirmado_idx` ON `verifactu_submissions` (`confirmado_en`);