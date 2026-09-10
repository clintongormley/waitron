REVOKE ALL ON TABLE "google_oidc_states" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "google_oidc_states" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "google_oidc_states" TO app_user;
