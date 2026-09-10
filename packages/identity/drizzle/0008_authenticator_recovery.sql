CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "recovery_codes_hash_ck" CHECK (length("recovery_codes"."code_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "totp_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"encrypted_secret" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "totp_enrollments_secret_ck" CHECK (length("totp_enrollments"."encrypted_secret") > 0)
);
--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_enrollments" ADD CONSTRAINT "totp_enrollments_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_enrollments" ADD CONSTRAINT "totp_enrollments_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_codes_person_idx" ON "recovery_codes" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "totp_enrollments_person_idx" ON "totp_enrollments" USING btree ("tenant_id","person_id");