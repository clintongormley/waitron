CREATE TYPE "public"."person_role" AS ENUM('staff', 'supervisor', 'manager', 'admin');--> statement-breakpoint
CREATE TYPE "public"."person_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TABLE "google_oidc_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
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
CREATE TABLE "management_account_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"target_email" text,
	"token_hash" text NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "management_account_actions_purpose_ck" CHECK ("management_account_actions"."purpose" in ('invitation', 'password_reset', 'email_change')),
	CONSTRAINT "management_account_actions_target_email_ck" CHECK (("management_account_actions"."purpose" = 'email_change') = ("management_account_actions"."target_email" is not null)),
	CONSTRAINT "management_account_actions_token_hash_ck" CHECK (length("management_account_actions"."token_hash") = 64),
	CONSTRAINT "management_account_actions_code_hash_ck" CHECK ("management_account_actions"."code_hash" is null or length("management_account_actions"."code_hash") = 64),
	CONSTRAINT "management_account_actions_code_attempts_ck" CHECK ("management_account_actions"."code_attempts" >= 0),
	CONSTRAINT "management_account_actions_expiry_ck" CHECK ("management_account_actions"."expires_at" > "management_account_actions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "management_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"first_names" text,
	"last_names" text,
	"telephone" text,
	"pin_hash" text,
	"password_hash" text,
	"totp_secret" text,
	"locale" text,
	"passkey_offered_at" timestamp with time zone,
	"email" text,
	"pending_email" text,
	"email_verified_at" timestamp with time zone,
	"google_subject" text,
	"role" "person_role" DEFAULT 'staff' NOT NULL,
	"status" "person_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_display_name_ck" CHECK (length("persons"."display_name") > 0),
	CONSTRAINT "persons_first_names_ck" CHECK ("persons"."first_names" is null or length("persons"."first_names") > 0),
	CONSTRAINT "persons_last_names_ck" CHECK ("persons"."last_names" is null or length("persons"."last_names") > 0),
	CONSTRAINT "persons_telephone_ck" CHECK ("persons"."telephone" is null or length("persons"."telephone") > 0),
	CONSTRAINT "persons_pin_hash_ck" CHECK ("persons"."pin_hash" is null or length("persons"."pin_hash") > 0),
	CONSTRAINT "persons_password_hash_ck" CHECK ("persons"."password_hash" is null or length("persons"."password_hash") > 0),
	CONSTRAINT "persons_totp_secret_ck" CHECK ("persons"."totp_secret" is null or length("persons"."totp_secret") > 0),
	CONSTRAINT "persons_locale_ck" CHECK ("persons"."locale" is null or length("persons"."locale") > 0),
	CONSTRAINT "persons_pending_email_ck" CHECK ("persons"."pending_email" is null or length("persons"."pending_email") > 0)
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "recovery_codes_hash_ck" CHECK (length("recovery_codes"."code_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "totp_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"encrypted_secret" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "totp_enrollments_secret_ck" CHECK (length("totp_enrollments"."encrypted_secret") > 0)
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"challenge" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credentials_credential_id_uq" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "google_oidc_states" ADD CONSTRAINT "google_oidc_states_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_account_actions" ADD CONSTRAINT "management_account_actions_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_sessions" ADD CONSTRAINT "management_sessions_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_till_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_enrollments" ADD CONSTRAINT "totp_enrollments_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_account_actions_token_hash_uq" ON "management_account_actions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "management_account_actions_person_idx" ON "management_account_actions" USING btree ("person_id","purpose");--> statement-breakpoint
CREATE INDEX "management_sessions_open_idx" ON "management_sessions" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_tenant_google_subject_uq" ON "persons" USING btree ("google_subject") WHERE "persons"."google_subject" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "persons_tenant_pending_email_uq" ON "persons" USING btree (lower("pending_email")) WHERE "persons"."pending_email" is not null;--> statement-breakpoint
CREATE INDEX "recovery_codes_person_idx" ON "recovery_codes" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "sessions_open_idx" ON "sessions" USING btree ("till_id");--> statement-breakpoint
CREATE INDEX "totp_enrollments_person_idx" ON "totp_enrollments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_person_idx" ON "webauthn_credentials" USING btree ("person_id");