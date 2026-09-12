CREATE TABLE "category_details" (
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"parent_id" uuid,
	"image" text,
	CONSTRAINT "category_details_tenant_id_category_id_pk" PRIMARY KEY("tenant_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "product_categories_tenant_id_product_id_category_id_pk" PRIMARY KEY("tenant_id","product_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "category_details" ADD CONSTRAINT "category_details_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_details" ADD CONSTRAINT "category_details_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_details_parent_idx" ON "category_details" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "product_categories_category_idx" ON "product_categories" USING btree ("tenant_id","category_id");