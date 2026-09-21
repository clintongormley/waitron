-- `change_log` is written by the change trigger, which runs as whoever did the write — the
-- application role on every ordinary request — and is emptied again by `drainChangeLog`, which runs
-- in that same transaction and is therefore also the application role. So app_user needs three
-- letters and only three:
--   INSERT, because the trigger puts the row there;
--   DELETE, because the drain takes it away with `delete from change_log returning payload`;
--   SELECT, because `returning payload` reads a column back, which is a SELECT privilege on it.
-- Deliberately NOT UPDATE: a change row is written and consumed, never edited, so an UPDATE grant
-- would be a privilege with no caller (CLAUDE.md §3, "never widen a grant"). Same three letters, for
-- the same write-then-consume reason, as `join_requests` in 0009.
REVOKE ALL ON "change_log" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "change_log" TO app_user;
