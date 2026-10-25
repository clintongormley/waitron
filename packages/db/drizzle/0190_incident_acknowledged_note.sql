ALTER TABLE `incidents` ADD `acknowledged_note` text;--> statement-breakpoint
CREATE INDEX `incidents_code_detected_idx` ON `incidents` (`code`,`detected_at`);