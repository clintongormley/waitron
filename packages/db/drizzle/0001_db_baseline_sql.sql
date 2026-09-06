DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'app_user' AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION
      'app_user already exists with SUPERUSER or BYPASSRLS — refusing to grant it table access, the application role must lack elevated attributes, and SUPERUSER would bypass the table privilege revocations below';
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
GRANT SELECT ON "tenants" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "locations" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tills" TO app_user;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'WT001';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON "invoice_series" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "invoice_series" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("next_number") ON "invoice_series" TO app_user;
--> statement-breakpoint
REVOKE ALL ON working_orders FROM app_user;
--> statement-breakpoint
REVOKE ALL ON working_order_lines FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON working_orders TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON working_order_lines TO app_user;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION working_orders_enforce_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'open' THEN
    -- An open order may change freely (a label edit keeps status open) or move to any next state.
    RETURN NEW;
  ELSIF OLD.status = 'placed' AND NEW.status IN ('settled', 'abandoned') THEN
    -- A placed order may only be settled (collect) or abandoned (cancel).
    RETURN NEW;
  ELSIF OLD.status = 'settled' AND NEW.status = 'settled'
        AND OLD.collected_at IS NULL AND NEW.collected_at IS NOT NULL
        AND NEW.id IS NOT DISTINCT FROM OLD.id
        AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
        AND NEW.till_id IS NOT DISTINCT FROM OLD.till_id
        AND NEW.node_id IS NOT DISTINCT FROM OLD.node_id
        AND NEW.order_number IS NOT DISTINCT FROM OLD.order_number
        AND NEW.label IS NOT DISTINCT FROM OLD.label
        AND NEW.opened_at IS NOT DISTINCT FROM OLD.opened_at
        AND NEW.settled_at IS NOT DISTINCT FROM OLD.settled_at
        AND NEW.delivery_table_id IS NOT DISTINCT FROM OLD.delivery_table_id THEN
    -- The order-level kitchen-handover marker (KDS-1 §3e) is the ONLY field that may be written on an
    -- already-settled order (a Mode-P walk-up settles before it is fired, so it has no placed → settled
    -- transition to carry the stamp). Nothing else about a settled order may change — the fiscal record
    -- was filed at settle and is untouched here.
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'working order % cannot transition from % to %', OLD.id, OLD.status, NEW.status;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION working_order_lines_require_open_parent()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_id uuid := coalesce(NEW.working_order_id, OLD.working_order_id);
  parent_status working_order_status;
BEGIN
  SELECT status INTO parent_status FROM working_orders WHERE id = parent_id;
  IF parent_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'lines may only be written while the order is open (order % is %)',
      parent_id, coalesce(parent_status::text, 'missing');
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION working_order_lines_check_locales()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  configured text[];
  supplied text[];
BEGIN
  SELECT l.invoice_locales INTO configured
    FROM working_orders wo
    JOIN tills t ON t.id = wo.till_id
    JOIN locations l ON l.id = t.location_id
   WHERE wo.id = NEW.working_order_id;

  IF configured IS NULL THEN
    RAISE EXCEPTION 'working order % has no resolvable location', NEW.working_order_id;
  END IF;

  SELECT array_agg(k ORDER BY k) INTO supplied
    FROM jsonb_object_keys(NEW.descriptions) AS k;

  IF supplied IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(configured) AS c) THEN
    RAISE EXCEPTION
      'descriptions must carry exactly the venue locales % (got %)', configured, supplied;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_locales
  BEFORE INSERT OR UPDATE ON working_order_lines
  FOR EACH ROW EXECUTE FUNCTION working_order_lines_check_locales();
--> statement-breakpoint
REVOKE ALL ON sales FROM app_user;
--> statement-breakpoint
REVOKE ALL ON sale_lines FROM app_user;
--> statement-breakpoint
REVOKE ALL ON tenders FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sales TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sale_lines TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON tenders TO app_user;
--> statement-breakpoint
CREATE TRIGGER sales_enforce_immutability
  BEFORE UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sale_lines_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_lines
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER tenders_enforce_immutability
  BEFORE UPDATE OR DELETE ON tenders
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sales_block_truncate
  BEFORE TRUNCATE ON sales
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sale_lines_block_truncate
  BEFORE TRUNCATE ON sale_lines
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER tenders_block_truncate
  BEFORE TRUNCATE ON tenders
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sales_assert_tenders_cover(p_sale_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  sale_total  numeric(12, 2);
  corrections numeric(12, 2);
  tendered    numeric(12, 2);
  tipped      numeric(12, 2);
BEGIN
  SELECT total INTO sale_total FROM sales WHERE id = p_sale_id;
  IF sale_total IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  -- Net in every rectificativa that corrects this sale (signed; usually negative). corrects_sale_id
  -- is a tenant-consistent FK, so this can only sum same-tenant correctives even though the definer
  -- sees every row.
  SELECT coalesce(sum(total), 0) INTO corrections
    FROM sales WHERE corrects_sale_id = p_sale_id;

  SELECT coalesce(sum(amount), 0), coalesce(sum(tip_amount), 0)
    INTO tendered, tipped
    FROM tenders WHERE sale_id = p_sale_id;

  IF tendered <> sale_total + corrections + tipped THEN
    RAISE EXCEPTION 'tenders for sale % total % but sale.total + corrections + tips is %',
      p_sale_id, tendered, sale_total + corrections + tipped;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE INDEX "sale_voids_tenant_idx" ON "sale_voids" USING btree ("tenant_id");
--> statement-breakpoint
REVOKE ALL ON sale_voids FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sale_voids TO app_user;
--> statement-breakpoint
CREATE TRIGGER sale_voids_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_voids
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sale_voids_block_truncate
  BEFORE TRUNCATE ON sale_voids
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "incidents" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "incidents" TO app_user;
--> statement-breakpoint
GRANT UPDATE ("acknowledged_at", "acknowledged_by") ON "incidents" TO app_user;
--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_open_dedup"
  ON "incidents" ("tenant_id", "till_id", "code", "sale_id")
  NULLS NOT DISTINCT
  WHERE "acknowledged_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "deployment" (
	"id" integer PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"stamped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_singleton_ck" CHECK ("deployment"."id" = 1),
	CONSTRAINT "deployment_environment_ck" CHECK ("deployment"."environment" in ('production', 'preproduction'))
);
--> statement-breakpoint
GRANT SELECT ON "deployment" TO app_user;
--> statement-breakpoint
REVOKE ALL ON sale_settlements FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sale_settlements TO app_user;
--> statement-breakpoint
CREATE TRIGGER sale_settlements_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_settlements
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sale_settlements_block_truncate
  BEFORE TRUNCATE ON sale_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE FUNCTION sale_settlements_check_coverage()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM sales_assert_tenders_cover(NEW.sale_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sale_settlements_check_coverage
  BEFORE INSERT ON sale_settlements
  FOR EACH ROW EXECUTE FUNCTION sale_settlements_check_coverage();
--> statement-breakpoint
CREATE FUNCTION tenders_reject_post_settlement()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sale_settlements WHERE sale_id = NEW.sale_id) THEN
    RAISE EXCEPTION 'tender for sale % rejected: the sale is already settled', NEW.sale_id
      USING ERRCODE = 'WT002';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON sale_substitutions FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sale_substitutions TO app_user;
--> statement-breakpoint
CREATE TRIGGER sale_substitutions_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_substitutions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sale_substitutions_block_truncate
  BEFORE TRUNCATE ON sale_substitutions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
GRANT SELECT ON "nodes" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "catalogues" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "categories" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "products" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "working_order_counters" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "order_amendments" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "order_amendments" TO app_user;
--> statement-breakpoint
CREATE TRIGGER "order_amendments_enforce_immutability"
  BEFORE UPDATE OR DELETE ON "order_amendments"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "order_amendments_block_truncate"
  BEFORE TRUNCATE ON "order_amendments"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "daily_closes" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "daily_closes" TO app_user;
--> statement-breakpoint
CREATE TRIGGER "daily_closes_immutable"
  BEFORE UPDATE OR DELETE ON "daily_closes"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "daily_closes_no_truncate"
  BEFORE TRUNCATE ON "daily_closes"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "daily_close_chain" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "daily_close_chain" TO app_user;
--> statement-breakpoint
CREATE TRIGGER tenders_reject_post_settlement
  BEFORE INSERT ON tenders
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION tenders_reject_post_settlement();
--> statement-breakpoint
CREATE TRIGGER working_orders_enforce_transition
  BEFORE UPDATE ON working_orders
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION working_orders_enforce_transition();
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent
  BEFORE INSERT OR UPDATE OR DELETE ON working_order_lines
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION working_order_lines_require_open_parent();
--> statement-breakpoint
REVOKE ALL ON "ingredients" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "ingredients" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "recipe_lines" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "recipe_lines" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "purchase_invoices" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_invoices" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "purchase_invoice_vat" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_invoice_vat" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "dining_tables" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "dining_tables" TO app_user;
--> statement-breakpoint
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_tab_fk"
  FOREIGN KEY ("tenant_id", "tab_id")
  REFERENCES "working_orders" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "working_orders"
  ADD CONSTRAINT "working_orders_delivery_table_fk"
  FOREIGN KEY ("tenant_id", "delivery_table_id")
  REFERENCES "dining_tables" ("tenant_id", "id");
--> statement-breakpoint
REVOKE ALL ON "table_service_statuses" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "table_service_statuses" TO app_user;
--> statement-breakpoint
CREATE FUNCTION working_orders_clear_table_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE dining_tables
     SET status_id = NULL
   WHERE tenant_id = NEW.tenant_id
     AND tab_id = NEW.id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER working_orders_clear_table_status
  AFTER UPDATE ON working_orders
  FOR EACH ROW
  WHEN (OLD.status IN ('open', 'placed') AND NEW.status IN ('settled', 'abandoned'))
  EXECUTE FUNCTION working_orders_clear_table_status();
--> statement-breakpoint
REVOKE ALL ON "floor_zones" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "floor_zones" TO app_user;
--> statement-breakpoint
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_zone_fk"
  FOREIGN KEY ("tenant_id", "zone_id") REFERENCES "floor_zones" ("tenant_id", "id");
--> statement-breakpoint
REVOKE ALL ON "kitchen_stations" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "kitchen_stations" TO app_user;
--> statement-breakpoint
CREATE UNIQUE INDEX "kitchen_stations_default_key"
  ON "kitchen_stations" ("tenant_id", "location_id")
  WHERE "is_default";
--> statement-breakpoint
REVOKE ALL ON "ticket_items" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "ticket_items" TO app_user;
--> statement-breakpoint
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_node_fk"
  FOREIGN KEY ("tenant_id", "node_id") REFERENCES "nodes" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_line_fk"
  FOREIGN KEY ("tenant_id", "working_order_line_id") REFERENCES "working_order_lines" ("tenant_id", "id")
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");
--> statement-breakpoint
REVOKE ALL ON "kitchen_courses" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "kitchen_courses" TO app_user;
--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_course_fk"
  FOREIGN KEY ("tenant_id", "course_id") REFERENCES "kitchen_courses" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "working_order_lines"
  ADD CONSTRAINT "working_order_lines_course_fk"
  FOREIGN KEY ("tenant_id", "course_id") REFERENCES "kitchen_courses" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_course_fk"
  FOREIGN KEY ("tenant_id", "course_id") REFERENCES "kitchen_courses" ("tenant_id", "id");
--> statement-breakpoint
REVOKE ALL ON "devices" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "devices" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "device_pairing_codes" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "device_pairing_codes" TO app_user;
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");
--> statement-breakpoint
REVOKE ALL ON "print_agents" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "print_agents" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "print_agent_pairing_codes" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "print_agent_pairing_codes" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "printers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "printers" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "print_jobs" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "print_jobs" TO app_user;
--> statement-breakpoint
ALTER TABLE "printers"
  ADD CONSTRAINT "printers_agent_fk"
  FOREIGN KEY ("tenant_id", "agent_id") REFERENCES "print_agents" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "print_jobs"
  ADD CONSTRAINT "print_jobs_printer_fk"
  FOREIGN KEY ("tenant_id", "printer_id") REFERENCES "printers" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "printers"
  ADD CONSTRAINT "printers_transport_fields_ck" CHECK (
    (transport = 'usb' AND agent_id IS NOT NULL AND usb_path IS NOT NULL)
    OR (transport = 'network_tcp' AND agent_id IS NOT NULL AND host IS NOT NULL)
    OR (transport = 'cloud_poll' AND poll_id IS NOT NULL)
  );
--> statement-breakpoint
REVOKE ALL ON "station_printers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "station_printers" TO app_user;
--> statement-breakpoint
ALTER TABLE "station_printers"
  ADD CONSTRAINT "station_printers_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "station_printers"
  ADD CONSTRAINT "station_printers_printer_fk"
  FOREIGN KEY ("tenant_id", "printer_id") REFERENCES "printers" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "tills"
  ADD CONSTRAINT "tills_receipt_printer_fk"
  FOREIGN KEY ("tenant_id", "receipt_printer_id") REFERENCES "printers" ("tenant_id", "id");
--> statement-breakpoint
REVOKE ALL ON "drawer_opens" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "drawer_opens" TO app_user;
--> statement-breakpoint
ALTER TABLE "drawer_opens"
  ADD CONSTRAINT "drawer_opens_till_fk"
  FOREIGN KEY ("tenant_id", "till_id") REFERENCES "tills" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "drawer_opens"
  ADD CONSTRAINT "drawer_opens_sale_fk"
  FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "mode" text DEFAULT 'primary' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_mode_ck" CHECK ("deployment"."mode" in ('primary', 'mirror'));
--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "singleton_role" text DEFAULT 'primary' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_singleton_role_ck" CHECK ("deployment"."singleton_role" in ('primary', 'secondary'));
--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_role_valid_ck" CHECK (NOT ("deployment"."mode" = 'mirror' AND "deployment"."singleton_role" = 'primary'));
--> statement-breakpoint
CREATE TABLE "mirror_config" (
	"id" integer PRIMARY KEY NOT NULL DEFAULT 1,
	"relay_url" text NOT NULL,
	"box_hostname" text NOT NULL,
	"box_ca_pem" text NOT NULL,
	"adopted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mirror_config_singleton_ck" CHECK ("mirror_config"."id" = 1)
);
--> statement-breakpoint
GRANT SELECT ON "mirror_config" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "location_catalogues" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "location_catalogues" TO app_user;
--> statement-breakpoint
ALTER TABLE "location_catalogues"
  ADD CONSTRAINT "location_catalogues_location_fk"
  FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "location_catalogues"
  ADD CONSTRAINT "location_catalogues_catalogue_fk"
  FOREIGN KEY ("tenant_id", "catalogue_id") REFERENCES "catalogues" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_catalogue_fk"
  FOREIGN KEY ("tenant_id", "catalogue_id") REFERENCES "catalogues" ("tenant_id", "id");
--> statement-breakpoint
REVOKE ALL ON "bookings" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bookings" TO app_user;
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_table_fk"
  FOREIGN KEY ("tenant_id", "table_id") REFERENCES "dining_tables" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_tab_fk"
  FOREIGN KEY ("tenant_id", "tab_id") REFERENCES "working_orders" ("tenant_id", "id");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "option_groups" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "option_group_items" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_option_groups" TO app_user;
--> statement-breakpoint
ALTER TABLE "working_order_lines"
  ADD CONSTRAINT "working_order_lines_parent_fk"
  FOREIGN KEY ("tenant_id", "parent_line_id")
  REFERENCES "working_order_lines" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "working_order_lines"
  ADD CONSTRAINT "working_order_lines_option_item_fk"
  FOREIGN KEY ("tenant_id", "option_group_item_id")
  REFERENCES "option_group_items" ("tenant_id", "id")
  ON DELETE SET NULL ("option_group_item_id");
--> statement-breakpoint
ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_parent_fk"
  FOREIGN KEY ("tenant_id", "parent_line_id")
  REFERENCES "sale_lines" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_thresholds_ordered" CHECK ("warm_after_minutes" < "overdue_after_minutes" AND "overdue_after_minutes" < "forgotten_after_minutes");
--> statement-breakpoint
REVOKE ALL ON "canvases" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "canvases" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "tenant_themes" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_themes" TO app_user;
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_station_kind_ck"
  CHECK ((device_kind = 'kds_station') = (station_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_station_kind_ck"
  CHECK ((device_kind = 'kds_station') = (station_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_till_fk"
  FOREIGN KEY ("tenant_id", "till_id") REFERENCES "tills" ("tenant_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_receipt_printer_fk"
  FOREIGN KEY ("tenant_id", "receipt_printer_id") REFERENCES "printers" ("tenant_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_till_fk"
  FOREIGN KEY ("tenant_id", "till_id") REFERENCES "tills" ("tenant_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_receipt_printer_fk"
  FOREIGN KEY ("tenant_id", "receipt_printer_id") REFERENCES "printers" ("tenant_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE "node_membership" (
	"id" integer PRIMARY KEY NOT NULL DEFAULT 1,
	"term" bigint NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_membership_singleton_ck" CHECK ("node_membership"."id" = 1)
);
--> statement-breakpoint
GRANT SELECT ON "node_membership" TO app_user;
--> statement-breakpoint
GRANT INSERT, UPDATE ON "node_membership" TO app_user;
--> statement-breakpoint
ALTER TABLE "mirror_config" ADD COLUMN "origin_node_id" uuid NOT NULL;
--> statement-breakpoint
REVOKE ALL ON "canvases" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "canvases" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "tenant_receipts" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_receipts" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "device_profiles" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "device_profiles" TO app_user;
--> statement-breakpoint
ALTER TABLE "device_profiles"
  ADD CONSTRAINT "device_profiles_canvas_fk"
  FOREIGN KEY ("tenant_id", "canvas_id") REFERENCES "canvases" ("tenant_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_device_profile_fk"
  FOREIGN KEY ("tenant_id", "device_profile_id") REFERENCES "device_profiles" ("tenant_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_device_profile_fk"
  FOREIGN KEY ("tenant_id", "device_profile_id") REFERENCES "device_profiles" ("tenant_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ALWAYS TRIGGER "sales_enforce_immutability";
--> statement-breakpoint
ALTER TABLE "sale_lines" ENABLE ALWAYS TRIGGER "sale_lines_enforce_immutability";
--> statement-breakpoint
ALTER TABLE "tenders" ENABLE ALWAYS TRIGGER "tenders_enforce_immutability";
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ALWAYS TRIGGER "sales_block_truncate";
--> statement-breakpoint
ALTER TABLE "sale_lines" ENABLE ALWAYS TRIGGER "sale_lines_block_truncate";
--> statement-breakpoint
ALTER TABLE "tenders" ENABLE ALWAYS TRIGGER "tenders_block_truncate";
--> statement-breakpoint
ALTER TABLE "sale_voids" ENABLE ALWAYS TRIGGER "sale_voids_enforce_immutability";
--> statement-breakpoint
ALTER TABLE "sale_voids" ENABLE ALWAYS TRIGGER "sale_voids_block_truncate";
--> statement-breakpoint
ALTER TABLE "sale_settlements" ENABLE ALWAYS TRIGGER "sale_settlements_enforce_immutability";
--> statement-breakpoint
ALTER TABLE "sale_settlements" ENABLE ALWAYS TRIGGER "sale_settlements_block_truncate";
--> statement-breakpoint
ALTER TABLE "sale_substitutions" ENABLE ALWAYS TRIGGER "sale_substitutions_enforce_immutability";
--> statement-breakpoint
ALTER TABLE "sale_substitutions" ENABLE ALWAYS TRIGGER "sale_substitutions_block_truncate";
--> statement-breakpoint
ALTER TABLE "order_amendments" ENABLE ALWAYS TRIGGER "order_amendments_enforce_immutability";
--> statement-breakpoint
ALTER TABLE "order_amendments" ENABLE ALWAYS TRIGGER "order_amendments_block_truncate";
--> statement-breakpoint
ALTER TABLE "daily_closes" ENABLE ALWAYS TRIGGER "daily_closes_immutable";
--> statement-breakpoint
ALTER TABLE "daily_closes" ENABLE ALWAYS TRIGGER "daily_closes_no_truncate";
--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "canvases_created_at_not_null" TO "layout_profiles_created_at_not_null";
--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "canvases_definition_not_null" TO "layout_profiles_definition_not_null";
--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "canvases_id_not_null" TO "layout_profiles_id_not_null";
--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "canvases_name_not_null" TO "layout_profiles_name_not_null";
--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "canvases_tenant_id_not_null" TO "layout_profiles_tenant_id_not_null";
--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "canvases_updated_at_not_null" TO "layout_profiles_updated_at_not_null";
--> statement-breakpoint
ALTER TABLE "canvases" RENAME CONSTRAINT "canvases_pkey" TO "layout_profiles_pkey";
