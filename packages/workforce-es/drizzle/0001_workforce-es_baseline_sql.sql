-- Custom SQL migration file, put your code below! --
REVOKE ALL ON "convenio_config" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "convenio_config" TO app_user;
