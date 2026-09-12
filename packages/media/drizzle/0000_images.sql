CREATE TABLE "media_image_data" (
	"tenant_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	"bytes" "bytea" NOT NULL,
	CONSTRAINT "media_image_data_tenant_id_image_id_pk" PRIMARY KEY("tenant_id","image_id")
);
--> statement-breakpoint
CREATE TABLE "media_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"names" jsonb NOT NULL,
	"alt_text" jsonb NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_images_tenant_filename_key" UNIQUE("tenant_id","filename"),
	CONSTRAINT "media_images_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "media_images_filename_ck" CHECK ("media_images"."filename" ~ '^[a-f0-9]{64}[.](jpg|png|webp)$'),
	CONSTRAINT "media_images_names_ck" CHECK (jsonb_typeof("media_images"."names") = 'object' and jsonb_typeof("media_images"."alt_text") = 'object')
);
--> statement-breakpoint
ALTER TABLE "media_image_data" ADD CONSTRAINT "media_image_data_image_fk" FOREIGN KEY ("tenant_id","image_id") REFERENCES "public"."media_images"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_images" ADD CONSTRAINT "media_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_images_tenant_date_idx" ON "media_images" USING btree ("tenant_id","created_at","id");