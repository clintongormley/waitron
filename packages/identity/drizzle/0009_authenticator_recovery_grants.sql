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
