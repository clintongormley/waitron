-- Identity's hand-written objects, consolidated: the grants each table needs, and the two
-- functional partial unique indexes drizzle-kit does not model. The generated baseline runs first.

REVOKE ALL ON "persons" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "persons" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "sessions" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sessions" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "management_sessions" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "management_sessions" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "webauthn_credentials" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "webauthn_credentials" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "webauthn_challenges" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "webauthn_challenges" TO app_user;
--> statement-breakpoint
-- Account actions are mutable state: the app issues them, consumes them, and invalidates older ones.
REVOKE ALL ON TABLE management_account_actions FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE management_account_actions TO app_user;
--> statement-breakpoint
REVOKE ALL ON TABLE "recovery_codes" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "recovery_codes" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "recovery_codes" TO app_user;
--> statement-breakpoint
REVOKE ALL ON TABLE "totp_enrollments" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "totp_enrollments" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "totp_enrollments" TO app_user;
--> statement-breakpoint
REVOKE ALL ON TABLE "google_oidc_states" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "google_oidc_states" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "google_oidc_states" TO app_user;
--> statement-breakpoint
-- One login address, case-insensitively, across the people who have one.
CREATE UNIQUE INDEX "persons_tenant_email_uq"
  ON "persons" (lower("email"))
  WHERE "email" IS NOT NULL;
--> statement-breakpoint
-- One live display name, case- and whitespace-insensitively, across the people who can still log in.
CREATE UNIQUE INDEX "persons_tenant_live_display_name_uq"
  ON "persons" (lower(btrim("display_name")))
  WHERE "status" <> 'suspended';
