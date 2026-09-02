-- Hand-written custom migration for @waitron/sync (this package has NO drizzle.config.ts — its
-- journal + snapshots are hand-maintained and drizzle-kit never diffs it). Runs LAST in
-- migrations.manifest.json's `sync` set, AFTER the `identity` set (manifest orders identity 2nd,
-- sync last), so `persons` and `webauthn_credentials` already exist when these triggers attach.
--
-- WHAT THIS BUILDS. Identity-config flow-down (spec
-- docs/superpowers/specs/2026-08-16-identity-config-flow-down-design.md §2/§3): two capture triggers
-- enrolling the identity CONFIG tables into the commercial ORDERED outbox, reusing the existing
-- generic sync_capture() function (0000_sync_outbox.sql:126). The ephemeral auth tables — sessions,
-- management_sessions, webauthn_challenges — are DELIBERATELY not enrolled: they must NOT replicate
-- (session write-amplification + single-writer-per-row conflict + no origin column; spec §2). No grant
-- or RLS change: persons/webauthn_credentials already carry FORCE RLS + a tenant-isolation policy + the
-- app_user grants (packages/identity/drizzle/0001_identity_rls.sql, 0008_silent_mauler.sql), and
-- app_user already holds INSERT on sync_log (0000_sync_outbox.sql:62), which is the whole grant the
-- capture path needs — the trigger runs as the WRITING app role (not SECURITY DEFINER), so the sync_log
-- WITH CHECK (tenant_id = current_tenant_id()) is satisfied by construction.
--
-- The WHEN clause reads app.sync_apply so a replicated write is NOT re-captured (no A->B->A echo loop;
-- 0000_sync_outbox.sql:149-156). `IS DISTINCT FROM` so an unset GUC still fires the capture.

-- persons — mutable CONFIG (SELECT, INSERT, UPDATE; NO delete grant): AFTER INSERT OR UPDATE.
CREATE TRIGGER persons_capture AFTER INSERT OR UPDATE ON persons
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- webauthn_credentials — mutable + DELETABLE CONFIG (SELECT, INSERT, UPDATE, DELETE): AFTER INSERT OR
-- UPDATE OR DELETE, so a revoked passkey's DELETE propagates to the secondary (a revoked credential
-- must not stay valid on a failover target).
CREATE TRIGGER webauthn_credentials_capture AFTER INSERT OR UPDATE OR DELETE ON webauthn_credentials
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
