-- KDS-1 Mode-P collect fix: surgically relax `working_orders_enforce_transition` so a settled order's
-- order-level kitchen-handover marker (`collected_at`, KDS-1 §3e) can be stamped after settlement.
--
-- HAND-WRITTEN (--custom): a function body change only, no schema change — `drizzle-kit generate`
-- reports "No schema changes" against this tree, so it emits nothing and there is no snapshot for this
-- migration (mirroring 0055_kds1_stations_tickets_rls.sql, which is likewise snapshot-less). Registered
-- in meta/_journal.json by hand the way 0055 was. `CREATE OR REPLACE FUNCTION` re-defines the trigger
-- function in place; the trigger binding created in 0004/0030 is unchanged.
--
-- WHY. A Mode-P walk-up (prepay) settles BEFORE it is fired to the kitchen (open → settled directly,
-- design §3/§5), so — unlike Modes I/T, whose `collectOrder` stamps `collected_at` in the one legal
-- placed → settled transition — it has no transition left to carry the stamp. The 0030 body makes a
-- settled order FULLY immutable (any UPDATE of a settled row RAISEs), so `listStationQueue` (which drops
-- a collected order, §3e) could never lose a fired Mode-P order: its tickets lingered on the station
-- display forever. The owner approved this surgical relaxation.
--
-- The added branch permits a settled → settled UPDATE ONLY when the `collected_at` marker goes
-- NULL → non-null and EVERY OTHER working_orders column is unchanged (each pinned with IS NOT DISTINCT
-- FROM). So the ONLY settled-state write it opens is the handover marker; the fiscal-relevant identity
-- and `settled_at` fields stay frozen, and a re-stamp of an already-collected order (non-null → non-null)
-- is NOT permitted (the OLD.collected_at IS NULL guard). Proven by deletion of the branch, both
-- directions, in orders.transition.test.ts (the collected_at-stamp test fails without it; the
-- other-column and re-stamp rejections keep RAISEing P0001 with it).
CREATE OR REPLACE FUNCTION working_orders_enforce_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'open' THEN
    -- An open order may change freely (a label edit keeps status open) or move to any next state.
    RETURN NEW;
  ELSIF OLD.status = 'placed' AND NEW.status IN ('settled', 'abandoned') THEN
    -- A placed order may only be settled (collect) or abandoned (cancel).
    RETURN NEW;
  ELSIF OLD.status = 'settled' AND NEW.status = 'settled'
        AND OLD.collected_at IS NULL AND NEW.collected_at IS NOT NULL
        AND NEW.id IS NOT DISTINCT FROM OLD.id
        AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
        AND NEW.till_id IS NOT DISTINCT FROM OLD.till_id
        AND NEW.node_id IS NOT DISTINCT FROM OLD.node_id
        AND NEW.order_number IS NOT DISTINCT FROM OLD.order_number
        AND NEW.label IS NOT DISTINCT FROM OLD.label
        AND NEW.opened_at IS NOT DISTINCT FROM OLD.opened_at
        AND NEW.settled_at IS NOT DISTINCT FROM OLD.settled_at
        AND NEW.delivery_table_id IS NOT DISTINCT FROM OLD.delivery_table_id THEN
    -- The order-level kitchen-handover marker (KDS-1 §3e) is the ONLY field that may be written on an
    -- already-settled order (a Mode-P walk-up settles before it is fired, so it has no placed → settled
    -- transition to carry the stamp). Nothing else about a settled order may change — the fiscal record
    -- was filed at settle and is untouched here.
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'working order % cannot transition from % to %', OLD.id, OLD.status, NEW.status;
END;
$$;
