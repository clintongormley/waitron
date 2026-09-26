-- A table's service status belongs to the party seated at it, so it comes off when the party's
-- visit leaves `open` (Finish table, or a merge that closes it), on every table still a member of
-- the visit. It replaces `working_orders_clear_table_status` from `0001_behavioural_triggers.sql`,
-- which cleared it when a tab settled: paying a bill no longer frees the table.
DROP TRIGGER working_orders_clear_table_status;
--> statement-breakpoint
CREATE TRIGGER visits_clear_table_status
AFTER UPDATE ON visits
FOR EACH ROW
WHEN old.state = 'open' AND new.state <> 'open'
BEGIN
  UPDATE dining_tables SET status_id = NULL
   WHERE id IN (
     SELECT table_id FROM visit_tables WHERE visit_id = new.id AND left_at IS NULL
   );
END;
