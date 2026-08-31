CREATE TABLE "option_group_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"price_delta" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vat_class" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "option_group_items_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "option_group_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "option_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "option_groups_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "option_groups_select_ck" CHECK ("option_groups"."max_select" >= "option_groups"."min_select" and "option_groups"."min_select" >= 0),
	CONSTRAINT "option_groups_required_ck" CHECK ("option_groups"."required" = false or "option_groups"."min_select" >= 1)
);
--> statement-breakpoint
ALTER TABLE "option_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_option_groups" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_option_groups_pk" PRIMARY KEY("tenant_id","product_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "product_option_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "working_order_lines" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "parent_line_id" uuid;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "option_group_item_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "parent_line_id" uuid;--> statement-breakpoint
ALTER TABLE "option_group_items" ADD CONSTRAINT "option_group_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_group_items" ADD CONSTRAINT "option_group_items_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."option_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."option_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "option_group_items_group_idx" ON "option_group_items" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "option_groups_tenant_id_idx" ON "option_groups" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_tenant_id_key" UNIQUE("tenant_id","id");