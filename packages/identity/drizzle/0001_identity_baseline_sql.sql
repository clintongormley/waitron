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
CREATE UNIQUE INDEX "persons_tenant_email_uq"
  ON "persons" ("tenant_id", lower("email"))
  WHERE "email" IS NOT NULL;
