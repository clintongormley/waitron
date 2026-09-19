CREATE TABLE "menu_item_extra_items" (
	"menu_item_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price" numeric(12, 2),
	"available" boolean DEFAULT true NOT NULL,
	CONSTRAINT "menu_item_extra_items_pk" PRIMARY KEY("menu_item_id","list_id","product_id"),
	CONSTRAINT "menu_item_extra_items_price_ck" CHECK ("menu_item_extra_items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_item_extra_lists" (
	"menu_item_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_item_extra_lists_pk" PRIMARY KEY("menu_item_id","list_id")
);
--> statement-breakpoint
ALTER TABLE "menu_item_extra_items" ADD CONSTRAINT "menu_item_extra_items_list_fk" FOREIGN KEY ("menu_item_id","list_id") REFERENCES "public"."menu_item_extra_lists"("menu_item_id","list_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_extra_items" ADD CONSTRAINT "menu_item_extra_items_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_extra_lists" ADD CONSTRAINT "menu_item_extra_lists_item_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_extra_lists" ADD CONSTRAINT "menu_item_extra_lists_list_fk" FOREIGN KEY ("list_id") REFERENCES "public"."extra_lists"("id") ON DELETE cascade ON UPDATE no action;