CREATE TABLE "product_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"extra_list_id" uuid,
	"option_list_id" uuid,
	CONSTRAINT "product_modifiers_one_reference_ck" CHECK (("product_modifiers"."extra_list_id" is null) <> ("product_modifiers"."option_list_id" is null))
);
--> statement-breakpoint
ALTER TABLE "product_modifiers" ADD CONSTRAINT "product_modifiers_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifiers" ADD CONSTRAINT "product_modifiers_extra_list_fk" FOREIGN KEY ("extra_list_id") REFERENCES "public"."extra_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifiers" ADD CONSTRAINT "product_modifiers_option_list_fk" FOREIGN KEY ("option_list_id") REFERENCES "public"."option_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_modifiers_product_sort_idx" ON "product_modifiers" USING btree ("product_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "product_modifiers_product_extra_uq" ON "product_modifiers" USING btree ("product_id","extra_list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_modifiers_product_option_uq" ON "product_modifiers" USING btree ("product_id","option_list_id");