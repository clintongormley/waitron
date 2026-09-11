REVOKE ALL ON "card_readers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "card_readers" TO app_user;
