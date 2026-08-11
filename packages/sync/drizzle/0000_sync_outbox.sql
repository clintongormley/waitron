-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no roles,
-- policies, plpgsql functions or triggers, and sync_log is not a Drizzle table, so NONE of this
-- survives a later `generate` — there is nothing for drizzle-kit to diff against. This set runs
-- LAST in migrations.manifest.json, after every enrolled table's own package (core/db, payments),
-- so each `CREATE TRIGGER … ON <table>` below targets a table that already exists.
--
-- WHAT THIS BUILDS. The commercial-lane outbox for cross-server sync (spec
-- docs/superpowers/specs/2026-08-08-sync-slice1-commercial-outbox-spec.md §2/§7): one transport
-- table (sync_log), one operational cursor (sync_cursor), one generic capture function
-- (sync_capture), and one capture trigger per enrolled table. Apply is application-level and lands
-- in packages/sync's later tasks; this migration only CAPTURES. The mechanism was validated as the
-- non-superuser app_login role in 2026-08-06-sync-container-gates-findings.md.

-- sync_log — the transport. FORCE ROW LEVEL SECURITY + a tenant-isolation policy because every
-- captured row_image is a tenant's own business data, so sync_log is a new tenant_id-bearing table
-- and carries the full recipe by hand (CLAUDE.md §3), not `.enableRLS()` alone. `op` carries
-- 'delete': the commercial lane's working_orders/working_order_lines hold the DELETE grant
-- (packages/db/drizzle/0004_working_orders.sql:73,75) and a line removed from an open order is a
-- real, exercised DELETE, so the design's fiscal-lane-only `op IN ('insert','update')` is widened
-- here (spec §2 finding).
CREATE TABLE sync_log (
  seq          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origin_id    uuid        NOT NULL,
  table_name   text        NOT NULL,
  op           text        NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  tenant_id    uuid        NOT NULL,
  row_image    jsonb       NOT NULL,
  txid         xid8        NOT NULL DEFAULT pg_current_xact_id(),
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint

ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- FORCE is mandatory, not decorative: without it the table owner (the migrator, and any deployment
-- that accidentally connects as it) bypasses the policy, and the fiscal inmutabilidad FORCE-RLS
-- scan is the guard that catches a missing FORCE on a tenant_id-bearing table (CLAUDE.md §3 — it
-- caught `nodes` shipping FORCE-less). See capture.gate.test.ts sub-test 4 for the in-package
-- catalog check, since that suite cannot run this migration (it needs the payments tables).
ALTER TABLE sync_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- USING filters what is readable, WITH CHECK what is writable; both, so the capture trigger can
-- only ever write a row into its own tenant and the sync_tailer reader can only ever read its own.
-- current_tenant_id() is packages/db/drizzle/0001_tenancy_rls.sql:52 — granted EXECUTE to app_user
-- there, and PUBLIC keeps the default function EXECUTE (that migration never revoked it), so
-- sync_tailer can evaluate the policy too.
CREATE POLICY sync_log_tenant_isolation ON sync_log
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- The app role CAPTURES but never READS sync_log: INSERT only. The AFTER trigger below runs as the
-- writing app role (it is not SECURITY DEFINER), so INSERT is the whole grant the capture path
-- needs. Reading every tenant's row_image is the dedicated sync_tailer role's job, below.
-- Deliberately NOT the gate findings' `GRANT INSERT, SELECT` — that SELECT was a documented
-- read-back shortcut for the throwaway gate suites (2026-08-06-sync-container-gates-findings.md,
-- surprise (i)); an app-readable sync_log would be a cross-tenant side-channel (spec §7).
REVOKE ALL ON sync_log FROM app_user;
--> statement-breakpoint
GRANT INSERT ON sync_log TO app_user;
--> statement-breakpoint

-- sync_tailer — the dedicated reader (spec §7). NOLOGIN NOSUPERUSER, created idempotently and
-- refusing to reuse a pre-existing LOGIN role, mirroring payments_webhook_resolver
-- (packages/payments/drizzle/0008_payments_webhook_resolver.sql:16-27): sync_tailer can SELECT
-- every tenant's row_image, so a login-capable one would let anyone who authenticates as it read
-- every tenant's captured business data unfiltered — the same cross-tenant risk. Roles are
-- cluster-global and the manifest runs against shared test containers, so this stays idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sync_tailer') THEN
    CREATE ROLE sync_tailer NOLOGIN NOSUPERUSER;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'sync_tailer' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'sync_tailer already exists with LOGIN — refusing to reuse it, since anyone who can authenticate as it would read every tenant''s captured row_image unfiltered';
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO sync_tailer;
--> statement-breakpoint
GRANT SELECT ON sync_log TO sync_tailer;
--> statement-breakpoint

-- sync_cursor — per-(subscriber, origin) operational state: how far each subscriber has applied.
-- NO tenant_id and NO RLS, deliberately: it is whole-DB operational state like `deployment`
-- (packages/db/drizzle/0010_deployment_stamp.sql), not tenant business data, and having no
-- tenant_id also keeps it out of the fiscal inmutabilidad FORCE-RLS scan by construction
-- (spec §4/§5). Read and written by sync_tailer only.
CREATE TABLE sync_cursor (
  subscriber_id    text        NOT NULL,
  origin_id        uuid        NOT NULL,
  last_applied_seq bigint      NOT NULL DEFAULT 0,
  alive            boolean     NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, origin_id)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sync_cursor TO sync_tailer;
--> statement-breakpoint

-- sync_capture — one generic AFTER-trigger function shared by every enrolled table. NOT SECURITY
-- DEFINER: it runs as the writing app role, which holds INSERT on sync_log (above), so it captures
-- into the writer's own tenant and the WITH CHECK policy is satisfied by construction. It branches
-- on TG_OP because NEW is NULL on a DELETE — a delete captures to_jsonb(OLD)/OLD.tenant_id, an
-- insert/update captures to_jsonb(NEW)/NEW.tenant_id. origin_id is the producing node's app.node_id
-- GUC, defaulting to the all-zero uuid when unset (matching the gate function, findings §Setup);
-- to_jsonb keeps text/numeric columns as JSON strings so a mirrored row restores byte-identically
-- (findings GATE 1). `lower(tg_op)` yields the check constraint's lowercase op, and `RETURN NULL`
-- because an AFTER trigger's return value is ignored.
CREATE FUNCTION sync_capture() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  rec jsonb;
  ten uuid;
BEGIN
  IF tg_op = 'DELETE' THEN
    rec := to_jsonb(old);
    ten := old.tenant_id;
  ELSE
    rec := to_jsonb(new);
    ten := new.tenant_id;
  END IF;
  INSERT INTO sync_log (origin_id, table_name, op, tenant_id, row_image)
  VALUES (
    coalesce(nullif(current_setting('app.node_id', true), '')::uuid,
             '00000000-0000-0000-0000-000000000000'::uuid),
    tg_table_name, lower(tg_op), ten, rec
  );
  RETURN NULL;
END;
$fn$;
--> statement-breakpoint

-- One capture trigger per enrolled table (spec §2, all 14). The WHEN clause reads the same-txn
-- app.sync_apply GUC: the apply worker sets app.sync_apply='on', so a replicated write is NOT
-- re-captured (no A→B→A echo loop; findings GATE 1). `IS DISTINCT FROM` so an unset GUC
-- (current_setting(..., true) → NULL) still fires the capture. The ops per group are grant facts,
-- not intentions (spec §2): Group A append-only (AFTER INSERT), Group B mutable with a watermark
-- (AFTER INSERT OR UPDATE), Group C working orders (AFTER INSERT OR UPDATE OR DELETE — they hold
-- the DELETE grant, 0004_working_orders.sql:73,75).

-- Group A — append-only → AFTER INSERT
CREATE TRIGGER sales_capture AFTER INSERT ON sales
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER sale_lines_capture AFTER INSERT ON sale_lines
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER tenders_capture AFTER INSERT ON tenders
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER sale_settlements_capture AFTER INSERT ON sale_settlements
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER sale_substitutions_capture AFTER INSERT ON sale_substitutions
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER sale_voids_capture AFTER INSERT ON sale_voids
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER payment_refunds_capture AFTER INSERT ON payment_refunds
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- Group B — mutable with a monotonic watermark → AFTER INSERT OR UPDATE
CREATE TRIGGER catalogues_capture AFTER INSERT OR UPDATE ON catalogues
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER categories_capture AFTER INSERT OR UPDATE ON categories
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER products_capture AFTER INSERT OR UPDATE ON products
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER payments_capture AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER payment_policy_capture AFTER INSERT OR UPDATE ON payment_policy
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- Group C — mutable, no watermark column, DELETE-capable → AFTER INSERT OR UPDATE OR DELETE
CREATE TRIGGER working_orders_capture AFTER INSERT OR UPDATE OR DELETE ON working_orders
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER working_order_lines_capture AFTER INSERT OR UPDATE OR DELETE ON working_order_lines
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
