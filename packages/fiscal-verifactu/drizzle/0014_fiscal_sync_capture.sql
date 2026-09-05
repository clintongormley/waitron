-- Fiscal-record sync lane capture triggers (SP-3a). Hand-filled custom migration for
-- @waitron/fiscal-verifactu. Installs the six sync_capture() triggers on fiscal's OWN tables,
-- enrolling the immutable ledger + chain identity + submission state onto the ordered outbox.
--
-- WHY HERE, NOT IN packages/sync (owner principle, 2026-09-05): the fiscal module is independent
-- and interfaces via API. sync_capture() (packages/sync/drizzle/0000_sync_outbox.sql) is sync's SPI;
-- fiscal owns its capture triggers and calls it. This creates a fiscal -> sync module edge (fiscal's
-- descriptor declares requires.modules.sync), so this migration runs AFTER sync's 0000 defines
-- sync_capture() — guaranteed by the manifest order (fiscal migrates last) and the topo resolver.
--
-- NO GRANT / RLS CHANGE. All six tables already carry FORCE RLS + a tenant-isolation policy + the
-- app_user grants each mode needs (0001/0003/0006/0008), and app_user already holds INSERT on
-- sync_log (0000_sync_outbox.sql). sync_capture() is NOT SECURITY DEFINER — it runs as the writing
-- app role, so the sync_log WITH CHECK (tenant_id = current_tenant_id()) is satisfied by
-- construction, and the REVOKE ALL on registros_facturacion does not block capture (the writer
-- already holds INSERT on the table; capture needs only INSERT on sync_log).
--
-- The WHEN clause reads app.sync_apply so a replicated (apply-path) write is NOT re-captured (no
-- A->B->A echo). IS DISTINCT FROM so an unset GUC still fires the capture.

-- registros_facturacion — INSERT-ONLY immutable ledger: AFTER INSERT only.
CREATE TRIGGER registros_facturacion_capture AFTER INSERT ON registros_facturacion
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- registro_sif — append-mostly identity, revocation-in-place: AFTER INSERT OR UPDATE.
CREATE TRIGGER registro_sif_capture AFTER INSERT OR UPDATE ON registro_sif
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- cadenas — mutable chain head: AFTER INSERT OR UPDATE.
CREATE TRIGGER cadenas_capture AFTER INSERT OR UPDATE ON cadenas
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- envios — mutable submission sidecar: AFTER INSERT OR UPDATE.
CREATE TRIGGER envios_capture AFTER INSERT OR UPDATE ON envios
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- envio_flujo — per-tenant flow control: AFTER INSERT OR UPDATE.
CREATE TRIGGER envio_flujo_capture AFTER INSERT OR UPDATE ON envio_flujo
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- acks — the one fiscal table that DELETES (a delivered ack is pruned): AFTER INSERT OR UPDATE OR
-- DELETE, so a prune propagates.
CREATE TRIGGER acks_capture AFTER INSERT OR UPDATE OR DELETE ON acks
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
