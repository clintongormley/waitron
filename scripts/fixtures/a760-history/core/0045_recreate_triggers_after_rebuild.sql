-- The three triggers `0043_drop_triggers_before_rebuild.sql` dropped, re-created unchanged:
-- `parties_clear_table_status` from `0036_party_rename.sql`, and the two
-- `working_orders_release_main_bill` triggers from `0038_main_bill_release.sql`.
CREATE TRIGGER parties_clear_table_status
AFTER UPDATE ON parties
FOR EACH ROW
WHEN old.state = 'open' AND new.state <> 'open'
BEGIN
  UPDATE dining_tables SET status_id = NULL
   WHERE id IN (
     SELECT table_id FROM party_tables WHERE party_id = new.id AND left_at IS NULL
   );
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_release_main_bill
AFTER UPDATE OF status ON working_orders
FOR EACH ROW
WHEN old.status = 'open' AND new.status <> 'open'
BEGIN
  UPDATE parties SET main_bill_id = NULL WHERE main_bill_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_release_main_bill_on_move
AFTER UPDATE OF party_id ON working_orders
FOR EACH ROW
WHEN old.party_id IS NOT new.party_id
BEGIN
  UPDATE parties SET main_bill_id = NULL WHERE id = old.party_id AND main_bill_id = new.id;
END;
