-- Restores the trigger removed by 0137 before dining_tables was rebuilt.
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
