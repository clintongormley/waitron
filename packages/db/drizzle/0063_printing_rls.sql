-- Hand-written (--custom; drizzle-kit models no policies, FORCE, privileges, the tenant-consistent
-- composite FKs, or CHECK constraints spanning enum values), same shape as 0061_devices_rls.sql /
-- 0055_kds1_stations_tickets_rls.sql. current_tenant_id() and app_user already exist
-- (0001_tenancy_rls.sql); current_tenant_id() fails closed — an unset app.tenant_id returns NULL,
-- filtering every row. The inmutabilidad scan (packages/fiscal-verifactu) requires FORCE ROW LEVEL
-- SECURITY on every tenant_id-bearing table, so all four new tables get it here (0062 emitted only
-- ENABLE from .enableRLS()).
--> statement-breakpoint

-- print_agents — a durable agent IDENTITY, MUTABLE, no DELETE (revoke via `active = false`; printers
-- and print_jobs reference an agent, mirroring devices' deactivate-never-delete). FORCE applies RLS to
-- the table OWNER too, so a deployment connecting as the non-superuser migration owner is still
-- isolated. FOR ALL, not FOR SELECT: USING filters reads, WITH CHECK filters writes, so a tenant
-- cannot INSERT/UPDATE a row it will never read back. REVOKE ALL first so a prior provisioning
-- GRANT ALL cannot survive, then the targeted grant.
ALTER TABLE "print_agents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "print_agents_tenant_isolation" ON "print_agents"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "print_agents" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "print_agents" TO app_user;--> statement-breakpoint

-- print_agent_pairing_codes — a single-use, short-lived code. DELETE IS granted here (the DELETE
-- precedent is 0039/0042/0061): redemption consumes the row via a locking DELETE … RETURNING, the
-- WebAuthn-challenge pattern. No UPDATE — a code is consumed, never edited.
ALTER TABLE "print_agent_pairing_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "print_agent_pairing_codes_tenant_isolation" ON "print_agent_pairing_codes"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "print_agent_pairing_codes" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "print_agent_pairing_codes" TO app_user;--> statement-breakpoint

-- printers — managed config, MUTABLE, no DELETE (deactivate via `active = false`; print_jobs reference
-- a printer). Same FORCE + FOR ALL + REVOKE-then-GRANT shape.
ALTER TABLE "printers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "printers_tenant_isolation" ON "printers"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "printers" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "printers" TO app_user;--> statement-breakpoint

-- print_jobs — the outbox. MUTABLE (the agent transitions queued→printing→done/failed), no DELETE (a
-- job is a durable delivery record). Same shape.
ALTER TABLE "print_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "print_jobs_tenant_isolation" ON "print_jobs"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "print_jobs" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "print_jobs" TO app_user;--> statement-breakpoint

-- Tenant-consistent composite FKs, hand-written (a bare column carries no FK): each cannot point at a
-- parent row of another tenant, independently of whether RLS is in force on this connection.
-- printers.agent_id → print_agents_tenant_id_key (tenant_id, id); print_jobs.printer_id →
-- printers_tenant_id_key (tenant_id, id). MATCH SIMPLE (the default) means a NULL agent_id skips the
-- check, so a cloud_poll printer's optional (agent-less) binding stays valid. No ON DELETE path is
-- exercised — print_agents/printers deactivate rather than delete.
ALTER TABLE "printers"
  ADD CONSTRAINT "printers_agent_fk"
  FOREIGN KEY ("tenant_id", "agent_id") REFERENCES "print_agents" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "print_jobs"
  ADD CONSTRAINT "print_jobs_printer_fk"
  FOREIGN KEY ("tenant_id", "printer_id") REFERENCES "printers" ("tenant_id", "id");--> statement-breakpoint

-- Transport-fields CHECK (§2b): the columns are nullable at the column level, so this enforces that
-- each transport carries the fields its adapter needs — usb needs an agent + a device path;
-- network_tcp needs an agent + a host (port defaults to 9100); cloud_poll needs a poll id (no agent —
-- it self-polls). It asserts the REQUIRED fields are present, not that the others are absent, matching
-- §2b ("the transport's required fields are present"). A row whose transport is none of the three is
-- already unrepresentable — `transport` is the print_transport enum.
ALTER TABLE "printers"
  ADD CONSTRAINT "printers_transport_fields_ck" CHECK (
    (transport = 'usb' AND agent_id IS NOT NULL AND usb_path IS NOT NULL)
    OR (transport = 'network_tcp' AND agent_id IS NOT NULL AND host IS NOT NULL)
    OR (transport = 'cloud_poll' AND poll_id IS NOT NULL)
  );
