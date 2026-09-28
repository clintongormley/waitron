-- `parties.main_bill_id` names an open bill of that party (spec decision 15). These two triggers
-- clear it when that bill leaves `open` (paid, presented or abandoned) or moves to another party.
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
