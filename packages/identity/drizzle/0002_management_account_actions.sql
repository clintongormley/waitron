CREATE TABLE "management_account_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "management_account_actions_purpose_ck" CHECK ("management_account_actions"."purpose" in ('invitation', 'password_reset')),
	CONSTRAINT "management_account_actions_token_hash_ck" CHECK (length("management_account_actions"."token_hash") = 64),
	CONSTRAINT "management_account_actions_expiry_ck" CHECK ("management_account_actions"."expires_at" > "management_account_actions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "management_account_actions" ADD CONSTRAINT "management_account_actions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_account_actions" ADD CONSTRAINT "management_account_actions_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_account_actions_token_hash_uq" ON "management_account_actions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "management_account_actions_person_idx" ON "management_account_actions" USING btree ("tenant_id","person_id","purpose");