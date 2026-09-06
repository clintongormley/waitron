CREATE TYPE "public"."bump_mode" AS ENUM('line', 'ticket');--> statement-breakpoint
CREATE TYPE "public"."drawer_open_policy" AS ENUM('gated', 'open');--> statement-breakpoint
CREATE TYPE "public"."fire_control_mode" AS ENUM('waiter', 'kitchen', 'expo');--> statement-breakpoint
CREATE TYPE "public"."order_flow" AS ENUM('prepay', 'invoice_first', 'ticket_then_pay');--> statement-breakpoint
CREATE TYPE "public"."receipt_print_mode" AS ENUM('auto', 'on_request', 'never');--> statement-breakpoint
CREATE TYPE "public"."doneness" AS ENUM('rare', 'medium_rare', 'medium', 'medium_well', 'well_done');--> statement-breakpoint
CREATE TYPE "public"."working_order_status" AS ENUM('open', 'placed', 'settled', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."order_amendment_kind" AS ENUM('order_placed', 'order_cancelled');--> statement-breakpoint
CREATE TYPE "public"."floor_table_shape" AS ENUM('round', 'square', 'rect');--> statement-breakpoint
CREATE TYPE "public"."ticket_state" AS ENUM('queued', 'preparing', 'ready');--> statement-breakpoint
CREATE TYPE "public"."device_kind" AS ENUM('kds_station', 'handheld', 'till');--> statement-breakpoint
CREATE TYPE "public"."print_ticket_scope" AS ENUM('station', 'order');--> statement-breakpoint
CREATE TYPE "public"."print_transport" AS ENUM('usb', 'network_tcp', 'cloud_poll');--> statement-breakpoint
CREATE TYPE "public"."print_job_status" AS ENUM('queued', 'printing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dietary_origin" AS ENUM('plant', 'meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey', 'other_animal');--> statement-breakpoint
CREATE TYPE "public"."purchase_regime" AS ENUM('general', 'equivalence_surcharge');--> statement-breakpoint
CREATE TYPE "public"."purchase_vat_kind" AS ENUM('ordinary', 'capital');--> statement-breakpoint
CREATE TYPE "public"."fiscal_state" AS ENUM('recorded', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."tender_method" AS ENUM('cash', 'card', 'voucher', 'transfer', 'other');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('booked', 'seated', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"invoice_locales" text[] NOT NULL,
	"operation_description" text NOT NULL,
	"fiscal_territory" text DEFAULT 'ES-common' NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"postal_code" text,
	"city" text,
	"province" text,
	"time_zone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"day_cutover" time DEFAULT '06:00:00' NOT NULL,
	"order_flow" "order_flow" DEFAULT 'prepay' NOT NULL,
	"bump_mode" "bump_mode" DEFAULT 'line' NOT NULL,
	"fire_control" "fire_control_mode" DEFAULT 'waiter' NOT NULL,
	"receipt_print_mode" "receipt_print_mode" DEFAULT 'auto' NOT NULL,
	"drawer_open_policy" "drawer_open_policy" DEFAULT 'gated' NOT NULL,
	"catalogue_id" uuid,
	CONSTRAINT "locations_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "locations_invoice_locales_len" CHECK (cardinality("locations"."invoice_locales") between 1 and 2)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" text NOT NULL,
	"tax_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"receipt_printer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tills_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filing_module" text,
	"tax_module" text,
	"public_key" text,
	"endorsement" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoice_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"code" text NOT NULL,
	"purpose" text DEFAULT 'standard' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_series_node_code_key" UNIQUE("tenant_id","node_id","code"),
	CONSTRAINT "invoice_series_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_series_purpose_ck" CHECK ("invoice_series"."purpose" in ('standard', 'rectificative')),
	CONSTRAINT "invoice_series_next_number_ck" CHECK ("invoice_series"."next_number" >= 1),
	CONSTRAINT "invoice_series_code_ck" CHECK ("invoice_series"."code" <> '')
);
--> statement-breakpoint
CREATE TABLE "working_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"working_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"descriptions" jsonb NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"unit_price_gross" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"category" text,
	"served_at" timestamp with time zone,
	"course_id" uuid,
	"parent_line_id" uuid,
	"option_group_item_id" uuid,
	"note" text,
	"doneness" "doneness",
	CONSTRAINT "working_order_lines_line_no_key" UNIQUE("working_order_id","line_no"),
	CONSTRAINT "working_order_lines_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "working_order_lines_quantity_ck" CHECK ("working_order_lines"."quantity" <> 0),
	CONSTRAINT "working_order_lines_vat_rate_ck" CHECK ("working_order_lines"."vat_rate" >= 0 and "working_order_lines"."vat_rate" <= 100),
	CONSTRAINT "working_order_lines_line_no_ck" CHECK ("working_order_lines"."line_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "working_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"node_id" uuid,
	"order_number" integer NOT NULL,
	"label" text,
	"status" "working_order_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"delivery_table_id" uuid,
	"collected_at" timestamp with time zone,
	CONSTRAINT "working_orders_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "working_orders_settled_at_ck" CHECK (("working_orders"."status" = 'settled') = ("working_orders"."settled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "order_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"working_order_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"kind" "order_amendment_kind" NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"captured_by_till_id" uuid NOT NULL,
	"captured_by_node_id" uuid NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"event_offset_minutes" integer NOT NULL,
	"entry_hash" text NOT NULL,
	"prev_entry_hash" text,
	"is_first_entry" boolean NOT NULL,
	CONSTRAINT "order_amendments_chain_position_key" UNIQUE("tenant_id","working_order_id","sequence_no"),
	CONSTRAINT "order_amendments_sequence_no_ck" CHECK ("order_amendments"."sequence_no" > 0),
	CONSTRAINT "order_amendments_entry_hash_ck" CHECK ("order_amendments"."entry_hash" ~ '^[0-9A-F]{64}$'),
	CONSTRAINT "order_amendments_event_offset_ck" CHECK ("order_amendments"."event_offset_minutes" between -840 and 840),
	CONSTRAINT "order_amendments_event_at_second_ck" CHECK (date_trunc('second', "order_amendments"."event_at") = "order_amendments"."event_at"),
	CONSTRAINT "order_amendments_chaining_ck" CHECK (("order_amendments"."is_first_entry" and "order_amendments"."prev_entry_hash" is null)
          or (not "order_amendments"."is_first_entry" and "order_amendments"."prev_entry_hash" is not null))
);
--> statement-breakpoint
CREATE TABLE "dining_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"label" text NOT NULL,
	"zone_id" uuid,
	"capacity" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tab_id" uuid,
	"status_id" uuid,
	"pos_x" smallint,
	"pos_y" smallint,
	"shape" "floor_table_shape",
	"rotation" smallint,
	CONSTRAINT "dining_tables_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "dining_tables_location_label_key" UNIQUE("tenant_id","location_id","label")
);
--> statement-breakpoint
CREATE TABLE "floor_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floor_zones_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "floor_zones_name_key" UNIQUE("tenant_id","location_id","name")
);
--> statement-breakpoint
CREATE TABLE "kitchen_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"warm_after_minutes" integer DEFAULT 5 NOT NULL,
	"overdue_after_minutes" integer DEFAULT 10 NOT NULL,
	"forgotten_after_minutes" integer DEFAULT 15 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kitchen_stations_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "kitchen_stations_name_key" UNIQUE("tenant_id","location_id","name")
);
--> statement-breakpoint
CREATE TABLE "kitchen_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kitchen_courses_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "kitchen_courses_name_key" UNIQUE("tenant_id","location_id","name")
);
--> statement-breakpoint
CREATE TABLE "ticket_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"working_order_id" uuid NOT NULL,
	"working_order_line_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"state" "ticket_state" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"preparing_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"course_id" uuid,
	"fired_at" timestamp with time zone,
	"away_at" timestamp with time zone,
	"note" text,
	"doneness" "doneness",
	CONSTRAINT "ticket_items_working_order_line_id_key" UNIQUE("tenant_id","working_order_line_id")
);
--> statement-breakpoint
CREATE TABLE "device_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"code_sha256" text NOT NULL,
	"device_kind" "device_kind" NOT NULL,
	"station_id" uuid,
	"till_id" uuid,
	"device_profile_id" uuid,
	"receipt_printer_id" uuid,
	"has_cash_drawer" boolean DEFAULT false NOT NULL,
	"card_provider" text DEFAULT 'none' NOT NULL,
	"card_reader_id" text,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_pairing_codes_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"device_kind" "device_kind" NOT NULL,
	"station_id" uuid,
	"till_id" uuid,
	"device_profile_id" uuid,
	"receipt_printer_id" uuid,
	"has_cash_drawer" boolean DEFAULT false NOT NULL,
	"card_provider" text DEFAULT 'none' NOT NULL,
	"card_reader_id" text,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "print_agent_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"code_sha256" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_agent_pairing_codes_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "print_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_agents_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"transport" "print_transport" NOT NULL,
	"agent_id" uuid,
	"host" text,
	"port" integer DEFAULT 9100,
	"usb_path" text,
	"poll_id" text,
	"poll_token_hash" text,
	"ticket_scope" "print_ticket_scope" DEFAULT 'station' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "printers_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"printer_id" uuid NOT NULL,
	"payload" "bytea" NOT NULL,
	"status" "print_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "station_printers" (
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"printer_id" uuid NOT NULL,
	CONSTRAINT "station_printers_pk" PRIMARY KEY("tenant_id","station_id","printer_id")
);
--> statement-breakpoint
CREATE TABLE "drawer_opens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"sale_id" uuid,
	"authorized_by" uuid,
	"via_override" boolean DEFAULT false NOT NULL,
	CONSTRAINT "drawer_opens_reason_ck" CHECK ("drawer_opens"."reason" in ('cash_sale', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "catalogues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogues_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"station_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_group_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"price_delta" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vat_class" text,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"add_allergens" jsonb,
	"remove_allergens" jsonb,
	"add_origins" jsonb,
	"remove_origins" jsonb,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "option_group_items_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "option_group_items_qty_ck" CHECK ("option_group_items"."max_quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "option_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "option_groups_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "option_groups_select_ck" CHECK ("option_groups"."max_select" >= "option_groups"."min_select" and "option_groups"."min_select" >= 0),
	CONSTRAINT "option_groups_required_ck" CHECK ("option_groups"."required" = false or "option_groups"."min_select" >= 1)
);
--> statement-breakpoint
CREATE TABLE "product_option_groups" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_option_groups_pk" PRIMARY KEY("tenant_id","product_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"category_id" uuid,
	"station_id" uuid,
	"course_id" uuid,
	"descriptions" jsonb NOT NULL,
	"pricing_unit" text NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"vat_class" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"image" text,
	"allergens" jsonb,
	"manual_allergens" jsonb,
	"recipe_derivation" jsonb,
	"diet_derivation" jsonb,
	"diet_override" jsonb,
	"diet" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "products_pricing_unit_ck" CHECK ("products"."pricing_unit" in ('each','weight')),
	CONSTRAINT "products_vat_class_ck" CHECK ("products"."vat_class" in ('general','reduced','super_reduced','zero'))
);
--> statement-breakpoint
CREATE TABLE "location_catalogues" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	CONSTRAINT "location_catalogues_pk" PRIMARY KEY("tenant_id","location_id","catalogue_id")
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"allergens" jsonb,
	"dietary_origin" "dietary_origin",
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_lines_product_ingredient_key" UNIQUE("product_id","ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_invoice_vat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_invoice_id" uuid NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"base" numeric(12, 2) NOT NULL,
	"tax" numeric(12, 2) NOT NULL,
	"kind" "purchase_vat_kind" DEFAULT 'ordinary' NOT NULL,
	CONSTRAINT "purchase_invoice_vat_rate_ck" CHECK ("purchase_invoice_vat"."rate" >= 0 and "purchase_invoice_vat"."rate" <= 100)
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_tax_id" text NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_invoice_number" text NOT NULL,
	"issued_on" date NOT NULL,
	"received_on" date NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"regime" "purchase_regime" DEFAULT 'general' NOT NULL,
	"deductible_proportion" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_invoices_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_invoices_supplier_number_key" UNIQUE("tenant_id","supplier_tax_id","supplier_invoice_number"),
	CONSTRAINT "purchase_invoices_deductible_proportion_ck" CHECK ("purchase_invoices"."deductible_proportion" >= 0 and "purchase_invoices"."deductible_proportion" <= 100)
);
--> statement-breakpoint
CREATE TABLE "canvases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvases_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "canvases_tenant_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "device_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"canvas_id" uuid,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_profiles_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "device_profiles_tenant_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "tenant_themes" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"theme" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_receipts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"receipt" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_service_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "table_service_statuses_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "table_service_statuses_tenant_label_key" UNIQUE("tenant_id","label")
);
--> statement-breakpoint
CREATE TABLE "working_order_counters" (
	"tenant_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "working_order_counters_pk" PRIMARY KEY("tenant_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"descriptions" jsonb NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"category" text,
	"parent_line_id" uuid,
	CONSTRAINT "sale_lines_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sale_lines_line_no_key" UNIQUE("sale_id","line_no"),
	CONSTRAINT "sale_lines_quantity_ck" CHECK ("sale_lines"."quantity" <> 0),
	CONSTRAINT "sale_lines_vat_rate_ck" CHECK ("sale_lines"."vat_rate" >= 0 and "sale_lines"."vat_rate" <= 100),
	CONSTRAINT "sale_lines_line_no_ck" CHECK ("sale_lines"."line_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "sale_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sale_settlements_sale_key" UNIQUE("tenant_id","sale_id")
);
--> statement-breakpoint
CREATE TABLE "sale_substitutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"substitution_sale_id" uuid NOT NULL,
	"substituted_sale_id" uuid NOT NULL,
	CONSTRAINT "sale_substitutions_substituted_key" UNIQUE("tenant_id","substituted_sale_id")
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"invoice_number" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_offset_minutes" integer NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"vat_breakdown" jsonb NOT NULL,
	"locale" text NOT NULL,
	"invoice_locales" text[] NOT NULL,
	"fiscal_backend" text NOT NULL,
	"fiscal_state" "fiscal_state" NOT NULL,
	"corrects_sale_id" uuid,
	"counterparty_tax_id" text,
	"counterparty_legal_name" text,
	"counterparty_country_code" text,
	"authorized_by" uuid,
	"operator_id" uuid,
	"working_order_id" uuid,
	CONSTRAINT "sales_series_invoice_number_key" UNIQUE("tenant_id","series_id","invoice_number"),
	CONSTRAINT "sales_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_working_order_id_key" UNIQUE("tenant_id","working_order_id"),
	CONSTRAINT "sales_total_ck" CHECK ("sales"."total" >= 0 or "sales"."corrects_sale_id" is not null),
	CONSTRAINT "sales_invoice_number_ck" CHECK ("sales"."invoice_number" >= 1),
	CONSTRAINT "sales_invoice_locales_ck" CHECK (array_length("sales"."invoice_locales", 1) between 1 and 2),
	CONSTRAINT "sales_locale_member_ck" CHECK ("sales"."locale" = any("sales"."invoice_locales")),
	CONSTRAINT "sales_issued_offset_ck" CHECK ("sales"."issued_offset_minutes" between -840 and 840)
);
--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "tender_method" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"tip_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tenders_amount_ck" CHECK ("tenders"."amount" > 0),
	CONSTRAINT "tenders_tip_amount_ck" CHECK ("tenders"."tip_amount" >= 0 and "tenders"."tip_amount" <= "tenders"."amount")
);
--> statement-breakpoint
CREATE TABLE "sale_voids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"voided_at" timestamp with time zone NOT NULL,
	"voided_by" uuid,
	CONSTRAINT "sale_voids_sale_id_key" UNIQUE("sale_id")
);
--> statement-breakpoint
CREATE TABLE "daily_close_chain" (
	"tenant_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"sequence_no" integer DEFAULT 0 NOT NULL,
	"last_entry_hash" text DEFAULT '' NOT NULL,
	CONSTRAINT "daily_close_chain_pk" PRIMARY KEY("tenant_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "daily_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"business_day" date NOT NULL,
	"sequence_no" integer NOT NULL,
	"prev_entry_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "daily_closes_business_day_key" UNIQUE("tenant_id","node_id","business_day"),
	CONSTRAINT "daily_closes_sequence_key" UNIQUE("tenant_id","node_id","sequence_no")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"sale_id" uuid,
	"code" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"severity" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	CONSTRAINT "incidents_severity_ck" CHECK ("incidents"."severity" in ('warning', 'error')),
	CONSTRAINT "incidents_code_ck" CHECK ("incidents"."code" <> '')
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"booking_time" time NOT NULL,
	"party_size" integer NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text,
	"notes" text,
	"table_id" uuid,
	"tab_id" uuid,
	"status" "booking_status" DEFAULT 'booked' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "bookings_party_size_ck" CHECK ("bookings"."party_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tills" ADD CONSTRAINT "tills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tills" ADD CONSTRAINT "tills_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_order_fk" FOREIGN KEY ("tenant_id","working_order_id") REFERENCES "public"."working_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_orders" ADD CONSTRAINT "working_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_orders" ADD CONSTRAINT "working_orders_till_id_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_orders" ADD CONSTRAINT "working_orders_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_order_fk" FOREIGN KEY ("tenant_id","working_order_id") REFERENCES "public"."working_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_till_fk" FOREIGN KEY ("tenant_id","captured_by_till_id") REFERENCES "public"."tills"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_node_fk" FOREIGN KEY ("tenant_id","captured_by_node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_status_fk" FOREIGN KEY ("tenant_id","status_id") REFERENCES "public"."table_service_statuses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_zones" ADD CONSTRAINT "floor_zones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_zones" ADD CONSTRAINT "floor_zones_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_courses" ADD CONSTRAINT "kitchen_courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_courses" ADD CONSTRAINT "kitchen_courses_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_items" ADD CONSTRAINT "ticket_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_agent_pairing_codes" ADD CONSTRAINT "print_agent_pairing_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_agent_pairing_codes" ADD CONSTRAINT "print_agent_pairing_codes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_agents" ADD CONSTRAINT "print_agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_agents" ADD CONSTRAINT "print_agents_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_printers" ADD CONSTRAINT "station_printers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawer_opens" ADD CONSTRAINT "drawer_opens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogues" ADD CONSTRAINT "catalogues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_group_items" ADD CONSTRAINT "option_group_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_group_items" ADD CONSTRAINT "option_group_items_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."option_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."option_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_catalogue_id_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."catalogues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_catalogues" ADD CONSTRAINT "location_catalogues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" ADD CONSTRAINT "purchase_invoice_vat_invoice_fk" FOREIGN KEY ("tenant_id","purchase_invoice_id") REFERENCES "public"."purchase_invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_themes" ADD CONSTRAINT "tenant_themes_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_receipts" ADD CONSTRAINT "tenant_receipts_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_service_statuses" ADD CONSTRAINT "table_service_statuses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_order_counters" ADD CONSTRAINT "working_order_counters_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_settlements" ADD CONSTRAINT "sale_settlements_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_substitutions" ADD CONSTRAINT "sale_substitutions_substitution_fk" FOREIGN KEY ("tenant_id","substitution_sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_substitutions" ADD CONSTRAINT "sale_substitutions_substituted_fk" FOREIGN KEY ("tenant_id","substituted_sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_till_id_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_series_id_invoice_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."invoice_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_corrects_fk" FOREIGN KEY ("tenant_id","corrects_sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_working_order_fk" FOREIGN KEY ("tenant_id","working_order_id") REFERENCES "public"."working_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_close_chain" ADD CONSTRAINT "daily_close_chain_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_till_id_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "locations_tenant_id_idx" ON "locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_country_tax_id_key" ON "tenants" USING btree ("country","tax_id");--> statement-breakpoint
CREATE INDEX "tills_tenant_id_idx" ON "tills" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "nodes_tenant_id_idx" ON "nodes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoice_series_tenant_idx" ON "invoice_series" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "working_order_lines_order_idx" ON "working_order_lines" USING btree ("working_order_id");--> statement-breakpoint
CREATE INDEX "working_orders_tenant_status_idx" ON "working_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "order_amendments_order_idx" ON "order_amendments" USING btree ("tenant_id","working_order_id");--> statement-breakpoint
CREATE INDEX "ticket_items_queue_idx" ON "ticket_items" USING btree ("tenant_id","station_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "device_pairing_codes_lookup_idx" ON "device_pairing_codes" USING btree ("tenant_id","code_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "print_agent_pairing_codes_lookup_idx" ON "print_agent_pairing_codes" USING btree ("tenant_id","code_sha256");--> statement-breakpoint
CREATE INDEX "print_jobs_pull_idx" ON "print_jobs" USING btree ("tenant_id","printer_id","status");--> statement-breakpoint
CREATE INDEX "catalogues_tenant_id_idx" ON "catalogues" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "categories_tenant_id_idx" ON "categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "option_group_items_group_idx" ON "option_group_items" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "option_groups_tenant_id_idx" ON "option_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "products_catalogue_id_idx" ON "products" USING btree ("catalogue_id");--> statement-breakpoint
CREATE INDEX "ingredients_tenant_id_idx" ON "ingredients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_product_id_idx" ON "recipe_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_ingredient_id_idx" ON "recipe_lines" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "purchase_invoice_vat_invoice_idx" ON "purchase_invoice_vat" USING btree ("tenant_id","purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_tenant_received_idx" ON "purchase_invoices" USING btree ("tenant_id","received_on");--> statement-breakpoint
CREATE INDEX "sale_lines_sale_idx" ON "sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_substitutions_substitution_idx" ON "sale_substitutions" USING btree ("tenant_id","substitution_sale_id");--> statement-breakpoint
CREATE INDEX "sales_tenant_issued_idx" ON "sales" USING btree ("tenant_id","issued_at");--> statement-breakpoint
CREATE INDEX "sales_fiscal_state_idx" ON "sales" USING btree ("tenant_id","fiscal_state");--> statement-breakpoint
CREATE INDEX "sales_corrects_idx" ON "sales" USING btree ("tenant_id","corrects_sale_id");--> statement-breakpoint
CREATE INDEX "tenders_sale_idx" ON "tenders" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "incidents_till_open_idx" ON "incidents" USING btree ("till_id","detected_at");--> statement-breakpoint
CREATE INDEX "bookings_tenant_location_date_idx" ON "bookings" USING btree ("tenant_id","location_id","booking_date");--> statement-breakpoint
CREATE INDEX "bookings_tenant_table_status_date_time_idx" ON "bookings" USING btree ("tenant_id","table_id","status","booking_date","booking_time");