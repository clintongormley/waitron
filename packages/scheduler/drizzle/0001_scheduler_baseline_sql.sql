-- Custom SQL migration file, put your code below! --
REVOKE ALL ON "scheduled_runs" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "scheduled_runs" TO app_user;
