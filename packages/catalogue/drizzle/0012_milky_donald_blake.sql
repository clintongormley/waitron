ALTER TABLE "menu_item_option_groups" DROP CONSTRAINT "menu_item_option_groups_group_fk";
--> statement-breakpoint
ALTER TABLE "menu_item_options" DROP CONSTRAINT "menu_item_options_option_fk";
--> statement-breakpoint
ALTER TABLE "menu_item_option_groups" ADD CONSTRAINT "menu_item_option_groups_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."option_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_options" ADD CONSTRAINT "menu_item_options_option_fk" FOREIGN KEY ("tenant_id","option_id") REFERENCES "public"."option_group_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;