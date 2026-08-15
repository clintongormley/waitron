-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no triggers, so
-- this does not survive a later `generate` and 0037_snapshot.json is a copy of 0036's (no
-- table/column change) — the 0001_sync_retention.sql idiom.
--
-- WHAT THIS BUILDS. Gate the three un-gated business BEFORE-triggers on the enrolled commercial
-- tables so the sync apply path (which sets app.sync_apply='on') applies a source's already-validated
-- write VERBATIM instead of re-validating it (spec §4d(A); apply.ts:99-112). Without this, at-least-
-- once redelivery re-runs a validated write after a later row committed and raises a NON-23503 error
-- (tenders_reject_post_settlement -> WT002; the state-machine triggers -> a plain RAISE) that
-- applyBatch cannot park, wedging the stream. Only the TRIGGERS change (WHEN clause added); each
-- referenced FUNCTION keeps its current body — working_orders_enforce_transition's is the 0030
-- rewrite, the other two are their 0004/0012 originals.
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
