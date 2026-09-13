ALTER TABLE "working_order_lines" ADD COLUMN "modifier_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "option_group_items" ADD COLUMN "default_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "option_groups" ADD COLUMN "type" text DEFAULT 'extras' NOT NULL;--> statement-breakpoint
ALTER TABLE "option_groups" ADD COLUMN "max_total_quantity" integer;--> statement-breakpoint
ALTER TABLE "option_groups" ADD COLUMN "default_choice_id" uuid;--> statement-breakpoint
ALTER TABLE "option_groups" ADD COLUMN "yes_label" jsonb;--> statement-breakpoint
ALTER TABLE "option_groups" ADD COLUMN "no_label" jsonb;--> statement-breakpoint
ALTER TABLE "option_groups" ADD COLUMN "default_value" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "modifier_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "option_group_items" ADD CONSTRAINT "option_group_items_default_qty_ck" CHECK ("option_group_items"."default_quantity" >= 0 and "option_group_items"."default_quantity" <= "option_group_items"."max_quantity");--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_type_ck" CHECK ("option_groups"."type" in ('text','extras','options','yes-no'));--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_total_ck" CHECK ("option_groups"."max_total_quantity" is null or "option_groups"."max_total_quantity" >= 1);