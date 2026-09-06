REVOKE ALL ON "employments" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "employments" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "time_entries" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "time_entries" TO app_user;
--> statement-breakpoint
CREATE TRIGGER "time_entries_enforce_immutability"
  BEFORE UPDATE OR DELETE ON "time_entries"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "time_entries_block_truncate"
  BEFORE TRUNCATE ON "time_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "workforce_chains" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workforce_chains" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "roster_versions" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "roster_versions" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "shifts" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shifts" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "absences" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "absences" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "availability" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "availability" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "shift_templates" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shift_templates" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "shift_swaps" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shift_swaps" TO app_user;
--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ALWAYS TRIGGER "time_entries_enforce_immutability";
--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ALWAYS TRIGGER "time_entries_block_truncate";
