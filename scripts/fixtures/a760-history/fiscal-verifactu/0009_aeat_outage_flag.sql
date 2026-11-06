ALTER TABLE `envio_flujo` ADD `technical_incident_token` text;--> statement-breakpoint
ALTER TABLE `envios` ADD `technical_incidence` integer DEFAULT false NOT NULL;