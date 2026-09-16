CREATE TABLE "media_image_data" (
	"image_id" uuid NOT NULL,
	"bytes" "bytea" NOT NULL,
	CONSTRAINT "media_image_data_image_id_pk" PRIMARY KEY("image_id")
);
--> statement-breakpoint
CREATE TABLE "media_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"names" jsonb NOT NULL,
	"alt_text" jsonb NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_images_filename_key" UNIQUE("filename"),
	CONSTRAINT "media_images_filename_ck" CHECK ("media_images"."filename" ~ '^[a-f0-9]{64}[.](jpg|png|webp)$'),
	CONSTRAINT "media_images_names_ck" CHECK (jsonb_typeof("media_images"."names") = 'object' and jsonb_typeof("media_images"."alt_text") = 'object')
);
--> statement-breakpoint
ALTER TABLE "media_image_data" ADD CONSTRAINT "media_image_data_image_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_images_date_idx" ON "media_images" USING btree ("created_at","id");