-- The outbox records local writes; app_user captures, reads, applies cursors and prunes.
-- sync_cursor tracks each subscriber, origin and lane independently. Peer revocation updates active;
-- peers have no DELETE grant. Config conflicts preserve rejected row images with no UPDATE/DELETE.
-- sync_capture runs with the writer's privileges, captures OLD on DELETE and NEW otherwise, and
-- defaults an unset node identity to the all-zero UUID. Its function body preserves JSON value types.
-- Every capture trigger skips writes when app.sync_apply is on, preventing replication echo.
-- Ephemeral identity sessions are not enrolled. Kitchen tickets follow their parent's DELETE cascade;
-- the parent's capture carries that deletion to subscribers.

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
REVOKE ALL ON sync_log FROM app_user;
--> statement-breakpoint
GRANT INSERT ON sync_log TO app_user;
--> statement-breakpoint
GRANT SELECT ON sync_log TO app_user;
--> statement-breakpoint
CREATE TABLE sync_cursor (
  subscriber_id    text        NOT NULL,
  origin_id        uuid        NOT NULL,
  last_applied_seq bigint      NOT NULL DEFAULT 0,
  alive            boolean     NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  lane            text        NOT NULL DEFAULT 'ordered',
  PRIMARY KEY (subscriber_id, origin_id, lane)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sync_cursor TO app_user;
--> statement-breakpoint
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
CREATE TRIGGER working_orders_capture AFTER INSERT OR UPDATE OR DELETE ON working_orders
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER working_order_lines_capture AFTER INSERT OR UPDATE OR DELETE ON working_order_lines
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
GRANT SELECT, DELETE ON sync_log TO app_user;
--> statement-breakpoint
GRANT DELETE ON sync_cursor TO app_user;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sync_log_origin_seq_idx ON sync_log (origin_id, seq);
--> statement-breakpoint
CREATE TABLE sync_peers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id text        NOT NULL,
  name          text        NOT NULL,
  token_hash    text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  last_seen_at  timestamptz,
  enrolled_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
GRANT SELECT ON sync_peers TO app_user;
--> statement-breakpoint
GRANT UPDATE (last_seen_at) ON sync_peers TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sync_peers TO app_user;
--> statement-breakpoint
CREATE TRIGGER floor_zones_capture AFTER INSERT OR UPDATE ON floor_zones
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER table_service_statuses_capture AFTER INSERT OR UPDATE ON table_service_statuses
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER dining_tables_capture AFTER INSERT OR UPDATE ON dining_tables
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER persons_capture AFTER INSERT OR UPDATE ON persons
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER webauthn_credentials_capture AFTER INSERT OR UPDATE OR DELETE ON webauthn_credentials
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER kitchen_stations_capture AFTER INSERT OR UPDATE ON kitchen_stations
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER kitchen_courses_capture AFTER INSERT OR UPDATE ON kitchen_courses
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER ticket_items_capture AFTER INSERT OR UPDATE ON ticket_items
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TABLE sync_config_conflicts (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  table_name  text        NOT NULL,   -- the enrolled config table the rejected row targeted
  origin_id   uuid        NOT NULL,   -- the (non-serving-primary) node that produced the rejected write
  lane        text        NOT NULL,   -- the lane the row arrived on
  row_image   jsonb       NOT NULL    -- the rejected row verbatim (the deferred per-field-merge seam); tenant_id lives in here
);
--> statement-breakpoint
GRANT INSERT ON sync_config_conflicts TO app_user;
--> statement-breakpoint
GRANT SELECT ON sync_config_conflicts TO app_user;
