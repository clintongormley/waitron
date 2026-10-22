ALTER TABLE `adjustments` ADD `charge_kept` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `adjustments` ADD `preparation_started` integer;--> statement-breakpoint
ALTER TABLE `adjustments` ADD `refund_handoff` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `adjustments` ADD `refund_value` integer;