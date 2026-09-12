CREATE TABLE "content_languages" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"default_language" text NOT NULL,
	"languages" text[] NOT NULL,
	CONSTRAINT "content_languages_default_ck" CHECK ("content_languages"."default_language" = any("content_languages"."languages")),
	CONSTRAINT "content_languages_list_ck" CHECK (cardinality("content_languages"."languages") between 1 and 200 and array_position("content_languages"."languages", null) is null)
);
--> statement-breakpoint
ALTER TABLE "content_languages" ADD CONSTRAINT "content_languages_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;