ALTER TABLE "google_oidc_states" DROP CONSTRAINT "google_oidc_states_person_fk";
--> statement-breakpoint
ALTER TABLE "management_sessions" DROP CONSTRAINT "management_sessions_person_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_person_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_till_fk";
--> statement-breakpoint
ALTER TABLE "totp_enrollments" DROP CONSTRAINT "totp_enrollments_person_fk";
