-- Account actions are mutable state: the app issues them, consumes them, and invalidates older ones.
REVOKE ALL ON TABLE management_account_actions FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE management_account_actions TO app_user;
