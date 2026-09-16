-- AFTER the generated tenant_id drop: put back, on their remaining column, every hand-written object
-- 0032 took off, and rewrite the four trigger functions whose bodies read `tenant_id`.
--
-- Each foreign key below was a pair `(tenant_id, x) → parent(tenant_id, id)` and is now `(x) →
-- parent(id)`. That still refuses a value naming no parent row, because `id` is the parent's primary
-- key; what it no longer does is compare a second column, which every row of this database shared.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_station_fk"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations" ("id");
--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_station_fk"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations" ("id");
--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_course_fk"
  FOREIGN KEY ("course_id") REFERENCES "kitchen_courses" ("id");
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_station_fk"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations" ("id");
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_till_fk"
  FOREIGN KEY ("till_id") REFERENCES "tills" ("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_receipt_printer_fk"
  FOREIGN KEY ("receipt_printer_id") REFERENCES "printers" ("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_device_profile_fk"
  FOREIGN KEY ("device_profile_id") REFERENCES "device_profiles" ("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "device_profiles"
  ADD CONSTRAINT "device_profiles_canvas_fk"
  FOREIGN KEY ("canvas_id") REFERENCES "canvases" ("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_tab_fk"
  FOREIGN KEY ("tab_id") REFERENCES "working_orders" ("id");
--> statement-breakpoint
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_zone_fk"
  FOREIGN KEY ("zone_id") REFERENCES "floor_zones" ("id");
--> statement-breakpoint
ALTER TABLE "working_orders"
  ADD CONSTRAINT "working_orders_delivery_table_fk"
  FOREIGN KEY ("delivery_table_id") REFERENCES "dining_tables" ("id");
--> statement-breakpoint
ALTER TABLE "drawer_opens"
  ADD CONSTRAINT "drawer_opens_till_fk"
  FOREIGN KEY ("till_id") REFERENCES "tills" ("id");
--> statement-breakpoint
ALTER TABLE "drawer_opens"
  ADD CONSTRAINT "drawer_opens_sale_fk"
  FOREIGN KEY ("sale_id") REFERENCES "sales" ("id");
--> statement-breakpoint
ALTER TABLE "location_catalogues"
  ADD CONSTRAINT "location_catalogues_location_fk"
  FOREIGN KEY ("location_id") REFERENCES "locations" ("id");
--> statement-breakpoint
ALTER TABLE "location_catalogues"
  ADD CONSTRAINT "location_catalogues_catalogue_fk"
  FOREIGN KEY ("catalogue_id") REFERENCES "catalogues" ("id");
--> statement-breakpoint
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_catalogue_fk"
  FOREIGN KEY ("catalogue_id") REFERENCES "catalogues" ("id");
--> statement-breakpoint
ALTER TABLE "print_jobs"
  ADD CONSTRAINT "print_jobs_printer_fk"
  FOREIGN KEY ("printer_id") REFERENCES "printers" ("id");
--> statement-breakpoint
-- MATCH SIMPLE (the default) skips the check when claimed_by IS NULL — a queued job.
ALTER TABLE "print_jobs"
  ADD CONSTRAINT "print_jobs_claimed_by_fk"
  FOREIGN KEY ("claimed_by") REFERENCES "print_agents" ("id") MATCH SIMPLE;
--> statement-breakpoint
ALTER TABLE "station_printers"
  ADD CONSTRAINT "station_printers_station_fk"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations" ("id");
--> statement-breakpoint
ALTER TABLE "station_printers"
  ADD CONSTRAINT "station_printers_printer_fk"
  FOREIGN KEY ("printer_id") REFERENCES "printers" ("id");
--> statement-breakpoint
ALTER TABLE "tills"
  ADD CONSTRAINT "tills_receipt_printer_fk"
  FOREIGN KEY ("receipt_printer_id") REFERENCES "printers" ("id");
--> statement-breakpoint
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_node_fk"
  FOREIGN KEY ("node_id") REFERENCES "nodes" ("id");
--> statement-breakpoint
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_line_fk"
  FOREIGN KEY ("working_order_line_id") REFERENCES "working_order_lines" ("id")
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_station_fk"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations" ("id");
--> statement-breakpoint
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_course_fk"
  FOREIGN KEY ("course_id") REFERENCES "kitchen_courses" ("id");
--> statement-breakpoint
ALTER TABLE "working_order_lines"
  ADD CONSTRAINT "working_order_lines_course_fk"
  FOREIGN KEY ("course_id") REFERENCES "kitchen_courses" ("id");
--> statement-breakpoint
ALTER TABLE "working_order_lines"
  ADD CONSTRAINT "working_order_lines_parent_fk"
  FOREIGN KEY ("parent_line_id") REFERENCES "working_order_lines" ("id");
--> statement-breakpoint
ALTER TABLE "working_order_lines"
  ADD CONSTRAINT "working_order_lines_option_item_fk"
  FOREIGN KEY ("option_group_item_id") REFERENCES "option_group_items" ("id")
  ON DELETE SET NULL ("option_group_item_id");
--> statement-breakpoint
ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_parent_fk"
  FOREIGN KEY ("parent_line_id") REFERENCES "sale_lines" ("id");
--> statement-breakpoint
-- The four partial/venue-scoped indexes, each rebuilt on what is left of its column list.
-- One open incident per (till, code, sale).
CREATE UNIQUE INDEX "incidents_open_dedup"
  ON "incidents" ("till_id", "code", "sale_id")
  NULLS NOT DISTINCT
  WHERE "acknowledged_at" IS NULL;
--> statement-breakpoint
-- Exactly one default station per location.
CREATE UNIQUE INDEX "kitchen_stations_default_key"
  ON "kitchen_stations" ("location_id")
  WHERE "is_default";
--> statement-breakpoint
-- One registered printer per physical USB/BT device per venue; a NULL local_key (network_tcp/
-- cloud_poll) is exempt, so many can coexist.
CREATE UNIQUE INDEX "printers_local_key_key" ON "printers" ("location_id", "local_key")
  WHERE "local_key" IS NOT NULL;
--> statement-breakpoint
-- A till's name is unique within its venue (device-enrolment §2.2/§9).
CREATE UNIQUE INDEX "tills_tenant_location_name_key" ON "tills" ("location_id", "name");
--> statement-breakpoint
-- The four trigger functions whose bodies read `tenant_id`. Each keeps its SET search_path and its
-- volatility; only the tenant predicate goes. A plpgsql body is not checked against the catalog at
-- CREATE time, so these would have kept the earlier migrations applying and failed at the first
-- write instead.
--
-- The kitchen-handover marker is the ONLY field that may be written on an already-settled order (a
-- Mode-P walk-up settles before it is fired, so it has no placed → settled transition to carry the
-- stamp). Nothing else about a settled order may change — the fiscal record was filed at settle.
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
        AND NEW.till_id IS NOT DISTINCT FROM OLD.till_id
        AND NEW.node_id IS NOT DISTINCT FROM OLD.node_id
        AND NEW.order_number IS NOT DISTINCT FROM OLD.order_number
        AND NEW.label IS NOT DISTINCT FROM OLD.label
        AND NEW.opened_at IS NOT DISTINCT FROM OLD.opened_at
        AND NEW.settled_at IS NOT DISTINCT FROM OLD.settled_at
        AND NEW.delivery_table_id IS NOT DISTINCT FROM OLD.delivery_table_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'working order % cannot transition from % to %', OLD.id, OLD.status, NEW.status;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION working_orders_clear_table_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE dining_tables
     SET status_id = NULL
   WHERE tab_id = NEW.id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION device_binding_rule() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  ff text;
BEGIN
  -- FOR SHARE row-locks the profile so a concurrent device_profiles form_factor UPDATE (which takes a
  -- FOR NO KEY UPDATE lock on the same row) serialises against this insert/rebind rather than racing it.
  -- Without the lock the two commit interleaved and leave an ACTIVE device whose binding contradicts its
  -- profile: the drift guard (device_profile_form_factor_locked) checks EXISTS(active device) but cannot
  -- see this INSERT while it is uncommitted, and this trigger reads the form factor without locking it —
  -- so each transaction sees a consistent-but-stale picture. The shared lock makes them wait: whichever
  -- commits second re-evaluates and one side is rejected.
  SELECT p.form_factor INTO ff
    FROM device_profiles p
   WHERE p.id = NEW.device_profile_id
   FOR SHARE;
  IF ff IS NULL THEN
    RAISE EXCEPTION 'device % has no profile', NEW.id;
  END IF;
  IF ff = 'kds' THEN
    IF NEW.station_id IS NULL OR NEW.till_id IS NOT NULL THEN
      RAISE EXCEPTION 'a kds device binds a station and no register';
    END IF;
  ELSE
    IF NEW.till_id IS NULL OR NEW.station_id IS NOT NULL THEN
      RAISE EXCEPTION 'a % device binds a register and no station', ff;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION device_profile_form_factor_locked() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.form_factor <> OLD.form_factor
     AND EXISTS (SELECT 1 FROM devices d
                  WHERE d.device_profile_id = NEW.id
                    AND d.active) THEN
    RAISE EXCEPTION 'cannot change form factor of a profile in use by an active device';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Only the stale comment changes here: `corrects_sale_id` is now a single-column key, so the old
-- sentence about it keeping the sum inside one tenant describes a column that no longer exists.
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

  -- Net in every rectificativa that corrects this sale (signed; usually negative).
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
