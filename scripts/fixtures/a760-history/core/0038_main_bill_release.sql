-- `setMainBill` (apps/server/src/parties.ts) is the only writer of `parties.main_bill_id` in
-- apps/server. The database checks only that it names an existing order; nothing checks that the
-- bill is open or the party's. These two triggers only clear it, when that bill leaves `open`
-- (paid, presented or abandoned) or leaves the party (to another party or to the counter).
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
