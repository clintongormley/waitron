-- Hand-written (--custom; drizzle-kit models no triggers), the working_orders_enforce_transition idiom
-- (0004 / 0030). Reset-on-turnover (design §3b): when a tab settles or is abandoned, clear the MANUAL
-- status on EVERY table that tab covered — one normally, several if the tab was joined across tables
-- (TS-3) — since the link is the dining_tables.tab_id back-pointer (TS-1 §2b). So "Bill requested"
-- clears the instant the tab settles, without payWorkingOrder / recordSale changing at all (H2).
--
-- AFTER UPDATE, not BEFORE: the transition is already validated by working_orders_enforce_transition
-- (0030, a BEFORE UPDATE trigger permitting open → {open,placed,settled,abandoned} and
-- placed → {settled,abandoned}) by the time this fires. WHEN
-- (OLD.status IN ('open','placed') AND NEW.status IN ('settled','abandoned')) so it fires on EITHER
-- turnover path to a terminal state: the walk-up open → settled|abandoned, AND the placed → settled|
-- abandoned collect/cancel — because open → placed → settled is STRUCTURALLY REACHABLE for a tab
-- (placeOrder(tabId) carries no guard that the order is not a tab; hardening that guard is a separate
-- follow-up), so a WHEN gated on open→terminal alone would leave a stale service status ("Bill
-- requested") lingering past turnover on that path. Broadening the WHEN to cover placed→terminal is
-- PURE HARDENING, changing no existing behaviour: the body clears WHERE tab_id = NEW.id, and a placed
-- order that is NOT a tab (a counter order) has no dining_tables row pointing back at it, so the
-- UPDATE matches zero rows and is a no-op. The status is therefore cleared regardless of HOW the tab
-- reached a terminal state. It still never fires on an open → open label edit (NEW.status is not
-- terminal there).
--
-- SECURITY INVOKER (the plpgsql default; not stated): it runs as the CALLER (app_user), and the UPDATE
-- is same-tenant (tenant_id = NEW.tenant_id), so the dining_tables tenant-isolation policy + the TS-1
-- SELECT/INSERT/UPDATE grant permit it (proven under app_user, same-tenant, in
-- apps/server/src/clear-table-status.rls.test.ts). It clears ONLY status_id, never tab_id — TS-1 leaves
-- a settled tab's back-pointer stale on purpose (the occupancy read counts a tab_id only while its order
-- is open).
--
-- NOT gated on app.sync_apply (contrast the THREE BEFORE-triggers 0037 gates): this is an idempotent,
-- data-validity-shaped cascade, not a state-machine gate. A zero-match UPDATE is a no-op and a
-- same-tenant one is RLS-permitted, so it CANNOT raise and cannot wedge the apply path — exactly the
-- class 0037 deliberately leaves ungated. dining_tables sync-enrollment is out of TS-2's scope; a future
-- replication slice revisits this deliberately (Plan note 6).
CREATE FUNCTION working_orders_clear_table_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE dining_tables
     SET status_id = NULL
   WHERE tenant_id = NEW.tenant_id
     AND tab_id = NEW.id;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER working_orders_clear_table_status
  AFTER UPDATE ON working_orders
  FOR EACH ROW
  WHEN (OLD.status IN ('open', 'placed') AND NEW.status IN ('settled', 'abandoned'))
  EXECUTE FUNCTION working_orders_clear_table_status();
