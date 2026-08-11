-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no roles,
-- policies or grants, so none of this survives a later `generate` — there is nothing to diff
-- against, and 0001_snapshot.json is a copy of 0000's (this set adds no table/column). Runs LAST in
-- migrations.manifest.json's `sync` set, after 0000_sync_outbox.sql, so sync_log already exists.
--
-- WHAT THIS BUILDS. Cross-tenant OPERATIONAL access for sync_log retention (packages/sync/src/
-- retention.ts). Retention is a whole-log job: pruneSyncLog() deletes every tenant's already-applied
-- rows and lagFor() reads max(seq) per origin across every tenant — neither has, or wants, a tenant
-- context. But sync_log carries FORCE ROW LEVEL SECURITY + sync_log_tenant_isolation (0000), and no
-- role holds DELETE at all: 0000 grants only INSERT (app_user, the capture trigger) and SELECT
-- (sync_tailer, per-tenant). So this adds a DEDICATED role with a per-role permissive policy that
-- lets ONLY it see and delete across tenants, exactly the house pattern for cross-tenant operational
-- access — payments_webhook_resolver (packages/payments/drizzle/0008_payments_webhook_resolver.sql:
-- 16-39) and fiscal's envios_drainer / credentials_enumerator all do this.
--
-- Deliberately NOT "grant a role BYPASSRLS": granting BYPASSRLS requires the grantor to already hold
-- it, which the hardened migration role does not. A per-role permissive policy needs only ordinary
-- GRANT / CREATE POLICY on a table the migration role already owns.
--
-- sync_tailer is NOT widened for this: its SELECT is per-tenant (the tenant-isolation policy), and a
-- retention worker needs whole-log DELETE plus a cross-tenant read — giving sync_tailer a permissive
-- whole-table policy would break capture.gate.test.ts sub-test 4, which requires a sync_tailer member
-- under withTenant to see ONLY its own tenant. Hence a separate role.

-- sync_retention — NOLOGIN NOSUPERUSER, created idempotently and refusing to reuse a pre-existing
-- LOGIN role. It can read AND delete every tenant's sync_log, so a login-capable one is a cross-tenant
-- risk: anyone who authenticated as it could read or destroy any tenant's captured business data.
-- Roles are cluster-global and the manifest runs against shared test containers, so this stays
-- idempotent (mirrors 0000's sync_tailer block and 0008's payments_webhook_resolver block).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sync_retention') THEN
    CREATE ROLE sync_retention NOLOGIN NOSUPERUSER;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'sync_retention' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'sync_retention already exists with LOGIN — refusing to reuse it, since anyone who can authenticate as it could read and delete every tenant''s captured sync_log unfiltered';
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO sync_retention;
--> statement-breakpoint

-- SELECT for lagFor's cross-tenant max(seq) read and DELETE for pruneSyncLog. No INSERT/UPDATE on
-- sync_log: retention never writes a captured row.
GRANT SELECT, DELETE ON sync_log TO sync_retention;
--> statement-breakpoint

-- sync_cursor carries no RLS (0000: whole-DB operational, like deployment). SELECT+UPDATE let lagFor
-- read cursors and an operator advance/evict one; INSERT keeps the grant shape consistent with
-- sync_tailer's (0000 grants sync_tailer SELECT, INSERT, UPDATE on sync_cursor).
GRANT SELECT, INSERT, UPDATE ON sync_cursor TO sync_retention;
--> statement-breakpoint

-- The per-role permissive policy: visible/deletable only when the current role is (a member of)
-- sync_retention, which nothing but the retention worker ever is. FOR ALL so it covers both the
-- SELECT (lagFor) and the DELETE (pruneSyncLog), and additive to sync_log_tenant_isolation —
-- Postgres ORs permissive policies, so for sync_retention the effective predicate is
-- (tenant_id = current_tenant_id()) OR true = true (whole-log), while EVERY other role, sync_tailer
-- included, still sees only tenant_isolation and stays fenced to its own tenant. WITH CHECK (true)
-- for completeness (retention issues no INSERT/UPDATE, so it is never evaluated), mirroring 0008.
CREATE POLICY sync_log_retention ON sync_log
  FOR ALL
  TO sync_retention
  USING (true)
  WITH CHECK (true);
