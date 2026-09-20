ALTER TABLE "working_order_lines" ADD COLUMN "option_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "working_order_lines" DROP COLUMN "modifier_snapshots";--> statement-breakpoint
ALTER TABLE "working_order_lines" DROP COLUMN "option_group_item_id";