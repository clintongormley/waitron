-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as this
-- package's 0001_workforce_rls.sql and 0003_workforce_d1a_rls.sql: drizzle-kit has no concept of
-- policies, FORCE, privileges or triggers, which is exactly why this survives every later `generate`
-- run instead of being reverted by one.
--
-- current_tenant_id() is NOT redefined here — it is the shared function packages/db's
-- 0001_tenancy_rls.sql installs, already in `public` by the time this runs (core migrations are
-- ordered first; packages/migrations/src/manifest.test.ts proves it), and it already fails closed.
--
-- This migration covers ONLY workforce_chains (the Slice-4 chain head). The chain COLUMNS added to
-- time_entries in 0005 need no new DDL here: time_entries already REVOKEs UPDATE/DELETE from app_user
-- and carries the reject_mutation trigger (0003_workforce_d1a_rls.sql), and those cover every column
-- of the row, the new chain columns included — a chain value is written once at INSERT and can never
-- be rewritten. immutability.test.ts pins that the new columns are immutable as the app role.

--> statement-breakpoint
ALTER TABLE "workforce_chains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "workforce_chains_tenant_isolation" ON "workforce_chains"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- workforce_chains is MUTABLE — the head advances on every append (sequence_no, last_entry_id,
-- last_entry_hash), the same shape fiscal's `cadenas` carries. So SELECT, INSERT, UPDATE and NO
-- append-only trigger; it is the mutable bookkeeping the IMMUTABLE time_entries chain hangs from, not
-- part of the ledger itself. REVOKE ALL first so a prior provisioning GRANT ALL cannot survive the
-- withheld privileges, then the targeted grant.
REVOKE ALL ON "workforce_chains" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workforce_chains" TO app_user;
