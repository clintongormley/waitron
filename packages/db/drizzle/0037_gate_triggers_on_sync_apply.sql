-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no triggers, so
-- this does not survive a later `generate` and 0037_snapshot.json is a copy of 0036's (no
-- table/column change) — the 0001_sync_retention.sql idiom.
--
-- WHAT THIS BUILDS. Gate the THREE STATE-DEPENDENT business BEFORE-triggers on the enrolled
-- commercial tables so the sync apply path (which sets app.sync_apply='on') applies a source's
-- already-validated write VERBATIM instead of RE-VALIDATING it against local state (spec §4d(A);
-- apply.ts:99-112). "State-dependent" is the load-bearing word: each of these three rejects a write
-- that was valid in the SOURCE's commit order but is not valid against the mirror's LATER state, so
-- an at-least-once redelivery of an already-applied write raises a NON-23503 error applyBatch cannot
-- park -> the stream wedges. They are NOT all of the business triggers on these tables (see below):
--   * tenders_reject_post_settlement (BEFORE INSERT ON tenders, 0012) — re-inserting a tender after
--     its sale_settlements row committed -> WT002;
--   * working_orders_enforce_transition (BEFORE UPDATE ON working_orders, latest def 0030) — a
--     redelivered update onto an already-settled order -> a plain RAISE ('cannot transition');
--   * working_order_lines_require_open_parent (BEFORE INSERT OR UPDATE OR DELETE ON
--     working_order_lines, 0004) — a redelivered line op after the parent left 'open' -> a plain
--     RAISE ('order is open').
-- Only the TRIGGERS change (WHEN clause added); each referenced FUNCTION keeps its current body —
-- working_orders_enforce_transition's is the 0030 rewrite, the other two are their 0004/0012
-- originals.
--
-- WHAT IS DELIBERATELY LEFT UNGATED, and why it is idempotent-safe. Two other business BEFORE-
-- triggers on enrolled tables still FIRE on the apply path, on purpose — they are DATA-VALIDITY
-- checks, not state-machine gates, so they read the ROW being written, not the mirror's evolving
-- state, and a row that was valid when the source captured it re-validates to the SAME answer when
-- the mirror re-applies it:
--   * sale_settlements_check_coverage (BEFORE INSERT ON sale_settlements, 0012) — asserts the sale's
--     tenders cover total+tips. A BEFORE INSERT trigger FIRES on a redelivered insert even under
--     ON CONFLICT DO NOTHING (the trigger runs before the conflict is resolved; the row is then
--     discarded, but the check has already run — verified on postgres:18-alpine: the trigger fired
--     twice while the second insert added no row). So the coverage check DOES re-run on every
--     redelivery — it just re-validates to the SAME answer, because the sale and its tenders arrive
--     first in seq order, so the coverage a source already satisfied is satisfied identically on the
--     mirror. Correctness rests on that idempotent re-validation, not on the check "not running", so it
--     can never wedge the apply path.
--   * working_order_lines_check_locales (BEFORE INSERT OR UPDATE ON working_order_lines, 0004) —
--     asserts the line's descriptions keys equal the venue's invoice_locales. That is a property of
--     the row against its location config, never of order state, so a redelivered line re-validates
--     to the same answer (proven: redelivery.gate.test.ts keeps THIS trigger ungated and the
--     redelivery still passes on line 431-445).
-- The registros_facturacion immutability + TRUNCATE-blocking triggers never fire on this path either:
-- apply is INSERT/UPDATE/DELETE on the fourteen enrolled COMMERCIAL tables, and registros is the
-- fiscal lane, deliberately NOT enrolled (spec §1) — so nothing here touches it.
--
-- ASSUMPTION the two ungated checks rest on: the venue configuration they read (a location's
-- invoice_locales; the coverage a sale was built under) is STABLE and CONSISTENT across the nodes
-- that replicate to each other — the same-venue, same-config shape this slice targets. True
-- active-active with DIVERGENT config per node (e.g. a locale added on one node but not another, so a
-- source row fails the SUBSCRIBER's own check) is out of this slice's scope; if that lands, these two
-- either join the gated set or move to an apply-time reconciliation.
--
-- `IS DISTINCT FROM` (not `<> 'on'`): current_setting(..., true) is NULL when the GUC is unset, and
-- NULL IS DISTINCT FROM 'on' is TRUE, so a LOCAL write (GUC unset) still fires the business trigger.
-- Only an apply write (GUC = 'on') skips it. Same clause the sync_capture triggers already use
-- (packages/sync/drizzle/0000_sync_outbox.sql:159).

DROP TRIGGER tenders_reject_post_settlement ON tenders;
--> statement-breakpoint
CREATE TRIGGER tenders_reject_post_settlement
  BEFORE INSERT ON tenders
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION tenders_reject_post_settlement();
--> statement-breakpoint

DROP TRIGGER working_orders_enforce_transition ON working_orders;
--> statement-breakpoint
CREATE TRIGGER working_orders_enforce_transition
  BEFORE UPDATE ON working_orders
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION working_orders_enforce_transition();
--> statement-breakpoint

DROP TRIGGER working_order_lines_require_open_parent ON working_order_lines;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent
  BEFORE INSERT OR UPDATE OR DELETE ON working_order_lines
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION working_order_lines_require_open_parent();
