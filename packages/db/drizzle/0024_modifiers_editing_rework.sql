ALTER TABLE "option_group_items" DROP CONSTRAINT "option_group_items_default_qty_ck";--> statement-breakpoint
ALTER TABLE "option_group_items" ADD COLUMN "preselected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "option_group_items" DROP COLUMN "default_quantity";--> statement-breakpoint
ALTER TABLE "option_groups" DROP COLUMN "yes_label";--> statement-breakpoint
ALTER TABLE "option_groups" DROP COLUMN "no_label";