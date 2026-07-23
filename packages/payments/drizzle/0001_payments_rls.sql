-- Hand-written, same reason as fiscal-verifactu/drizzle/0006_acks_rls.sql's header: drizzle-kit
-- diffs against its own snapshot and has no concept of policies, FORCE or privileges, so none of
-- this would survive a later `generate` run if it lived in a generated file — and it need not,
-- because a generated migration never touches it again.
--
-- current_tenant_id() is NOT redefined here: it is a shared function created once by
-- packages/db's 0001_tenancy_rls.sql and already lives in `public` by the time this package's
-- migrations run (core runs first — migrations.test.ts proves it).

--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "payments_tenant_isolation" ON "payments"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "payment_refunds_tenant_isolation" ON "payment_refunds"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- payments/payment_refunds are MUTABLE (state advances as the payment lifecycle progresses), so
-- they get tenant isolation only, not append-only triggers — the same shape as acks/envio_flujo.
--
-- REVOKE ALL first, not just DELETE: a provisioning script that ran GRANT ALL before this migration
-- would otherwise hand back the privileges being withheld. No DELETE is granted: nothing in the 4a
-- write path removes a row (a reversal is a new refund row + a state change, never a delete).
REVOKE ALL ON "payments" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payments" TO app_user;--> statement-breakpoint
REVOKE ALL ON "payment_refunds" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_refunds" TO app_user;
