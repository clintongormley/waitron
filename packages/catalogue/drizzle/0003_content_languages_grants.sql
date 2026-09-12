REVOKE ALL ON "content_languages" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "content_languages" TO app_user;
