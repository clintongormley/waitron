CREATE TABLE "google_oidc_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid,
	"mode" text NOT NULL,
	"state_hash" text NOT NULL,
	"nonce" text NOT NULL,
	"verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "google_oidc_states_mode_ck" CHECK ("google_oidc_states"."mode" in ('login', 'link')),
	CONSTRAINT "google_oidc_states_state_hash_ck" CHECK (length("google_oidc_states"."state_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "google_subject" text;--> statement-breakpoint
ALTER TABLE "google_oidc_states" ADD CONSTRAINT "google_oidc_states_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_oidc_states" ADD CONSTRAINT "google_oidc_states_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_oidc_states_tenant_idx" ON "google_oidc_states" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_tenant_google_subject_uq" ON "persons" USING btree ("tenant_id","google_subject") WHERE "persons"."google_subject" is not null;