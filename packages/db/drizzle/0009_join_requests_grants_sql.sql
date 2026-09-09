-- `join_requests` is written by the app role on an UNAUTHENTICATED knock and deleted on accept or deny,
-- so app_user holds SELECT, INSERT and DELETE — and deliberately NOT UPDATE: a request is never edited,
-- only created and consumed, so an UPDATE grant would be a privilege with no caller (CLAUDE.md §3,
-- "never widen a grant"). The same SID shape `device_pairing_codes` held, which this table replaces.
REVOKE ALL ON "join_requests" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "join_requests" TO app_user;
