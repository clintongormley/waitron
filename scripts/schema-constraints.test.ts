import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { packageDirOf } from "../packages/module/src/module.js";

/**
 * Every foreign key and every unique index the product's schema is supposed to have, checked
 * against the database the tree's own migrations actually build.
 *
 * A constraint that lives only in hand-written migration SQL disappears the moment a set is
 * regenerated from the TypeScript schema, and nothing else in the tree notices. The lists below are
 * the contract, checked one way only: a listed constraint missing from the built schema fails, and
 * a constraint nobody listed passes unseen.
 *
 * WHAT IT DOES NOT COVER. It reads the schema the migrations build; it does not try an offending
 * INSERT, so it cannot tell a constraint SQLite records from one SQLite enforces — `foreign_keys`
 * is a per-connection pragma, and whether the product turns it on is proven in
 * `packages/store/src/index.test.ts`. It matches a unique index and a check constraint by NAME, so
 * one renamed and left otherwise intact fails here, while one whose COLUMNS or PREDICATE changed
 * under a kept name passes. It reads a check's name out of the built schema's `CREATE TABLE` TEXT.
 * And it says nothing about indexes that are not unique.
 *
 * TWO KEYS ARE DELIBERATELY ABSENT from the foreign-key list: `products(image)` and
 * `category_details(image)`, both referencing `media_images`. `packages/media` depends on
 * `@waitron/catalogue` and `@waitron/db`, so neither owning package may depend on media to name the
 * column: that dependency would close a loop `scripts/workspace-cycles.test.ts` refuses, and that
 * guard reads each `package.json`, not source imports.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** `[child table, child columns, parent table]`, one row per foreign key. */
const EXPECTED_FOREIGN_KEYS = [
  ["absences", ["decided_by_person_id"], "persons"],
  ["absences", ["person_id"], "persons"],
  ["acks", ["registro_id"], "registros_facturacion"],
  ["availability", ["person_id"], "persons"],
  ["bookings", ["location_id"], "locations"],
  ["bookings", ["tab_id"], "working_orders"],
  ["bookings", ["table_id"], "dining_tables"],
  ["cadenas", ["node_id"], "nodes"],
  ["cadenas", ["ultimo_registro_id"], "registros_facturacion"],
  ["categories", ["station_id"], "kitchen_stations"],
  ["category_details", ["category_id"], "categories"],
  ["category_details", ["parent_id"], "categories"],
  ["convenio_config", ["location_id"], "locations"],
  ["daily_close_chain", ["node_id"], "nodes"],
  ["daily_closes", ["node_id"], "nodes"],
  ["department_hours", ["department_id"], "departments"],
  ["departments", ["location_id"], "locations"],
  ["device_card_readers", ["device_id"], "devices"],
  ["device_card_readers", ["reader_id"], "card_readers"],
  ["device_profiles", ["canvas_id"], "canvases"],
  ["device_zone_defaults", ["device_id"], "devices"],
  ["device_zone_defaults", ["zone_id"], "floor_zones"],
  ["devices", ["device_profile_id"], "device_profiles"],
  ["devices", ["location_id"], "locations"],
  ["devices", ["receipt_printer_id"], "printers"],
  ["devices", ["station_id"], "kitchen_stations"],
  ["devices", ["till_id"], "tills"],
  ["dining_tables", ["location_id"], "locations"],
  ["dining_tables", ["status_id"], "table_service_statuses"],
  ["dining_tables", ["tab_id"], "working_orders"],
  ["dining_tables", ["zone_id"], "floor_zones"],
  ["drawer_opens", ["sale_id"], "sales"],
  ["drawer_opens", ["till_id"], "tills"],
  ["employments", ["person_id"], "persons"],
  ["envios", ["registro_id"], "registros_facturacion"],
  ["extra_list_items", ["list_id"], "extra_lists"],
  ["extra_list_items", ["product_id"], "products"],
  ["floor_zones", ["location_id"], "locations"],
  ["incidents", ["sale_id"], "sales"],
  ["incidents", ["till_id"], "tills"],
  ["invoice_series", ["node_id"], "nodes"],
  ["kitchen_courses", ["location_id"], "locations"],
  ["kitchen_stations", ["location_id"], "locations"],
  ["location_catalogues", ["catalogue_id"], "catalogues"],
  ["location_catalogues", ["location_id"], "locations"],
  ["locations", ["catalogue_id"], "catalogues"],
  ["management_account_actions", ["person_id"], "persons"],
  ["media_image_data", ["image_id"], "media_images"],
  ["menu_item_extra_items", ["menu_item_id", "list_id"], "menu_item_extra_lists"],
  ["menu_item_extra_items", ["product_id"], "products"],
  ["menu_item_extra_lists", ["list_id"], "extra_lists"],
  ["menu_item_extra_lists", ["menu_item_id"], "menu_items"],
  ["menu_item_variant_overrides", ["menu_item_id", "product_id"], "menu_items"],
  ["menu_item_variant_overrides", ["product_id", "variant_id"], "products"],
  ["menu_items", ["menu_id"], "catalogues"],
  ["menu_items", ["menu_id", "section_id"], "menu_sections"],
  ["menu_items", ["product_id"], "products"],
  ["menu_sections", ["menu_id"], "catalogues"],
  ["nodes", ["location_id"], "locations"],
  ["option_labels", ["list_id"], "option_lists"],
  ["order_amendments", ["captured_by_node_id"], "nodes"],
  ["order_amendments", ["captured_by_till_id"], "tills"],
  ["order_amendments", ["working_order_id"], "working_orders"],
  ["order_service_contexts", ["department_id"], "departments"],
  ["order_service_contexts", ["working_order_id"], "working_orders"],
  ["order_service_contexts", ["zone_id"], "floor_zones"],
  ["payment_refunds", ["payment_id"], "payments"],
  ["payments", ["node_id"], "nodes"],
  ["payments", ["reader_id"], "card_readers"],
  ["payments", ["sale_id"], "sales"],
  ["payments", ["working_order_id"], "working_orders"],
  ["preparation_routes", ["category_id"], "categories"],
  ["preparation_routes", ["location_id"], "locations"],
  ["preparation_routes", ["product_id"], "products"],
  ["preparation_routes", ["station_id"], "kitchen_stations"],
  ["preparation_routes", ["zone_id"], "floor_zones"],
  ["print_agents", ["location_id"], "locations"],
  ["print_jobs", ["claimed_by"], "print_agents"],
  ["print_jobs", ["location_id"], "locations"],
  ["print_jobs", ["printer_id"], "printers"],
  ["printers", ["location_id"], "locations"],
  ["product_categories", ["category_id"], "categories"],
  ["product_categories", ["product_id"], "products"],
  ["product_modifiers", ["extra_list_id"], "extra_lists"],
  ["product_modifiers", ["option_list_id"], "option_lists"],
  ["product_modifiers", ["product_id"], "products"],
  ["product_units", ["product_id"], "products"],
  ["product_units", ["unit_id"], "units"],
  ["products", ["catalogue_id"], "catalogues"],
  ["products", ["category_id"], "categories"],
  ["products", ["course_id"], "kitchen_courses"],
  ["products", ["parent_id", "catalogue_id"], "products"],
  ["products", ["station_id"], "kitchen_stations"],
  ["purchase_invoice_vat", ["purchase_invoice_id"], "purchase_invoices"],
  ["recipe_lines", ["ingredient_id"], "ingredients"],
  ["recipe_lines", ["product_id"], "products"],
  ["recovery_codes", ["person_id"], "persons"],
  ["registro_sif", ["node_id"], "nodes"],
  ["registros_facturacion", ["node_id"], "nodes"],
  ["registros_facturacion", ["sale_id"], "sales"],
  ["registros_facturacion", ["sif_id"], "registro_sif"],
  ["registros_facturacion", ["till_id"], "tills"],
  ["roster_versions", ["location_id"], "locations"],
  ["roster_versions", ["published_by_person_id"], "persons"],
  ["sale_lines", ["parent_line_id"], "sale_lines"],
  ["sale_lines", ["sale_id"], "sales"],
  ["sale_settlements", ["sale_id"], "sales"],
  ["sale_substitutions", ["substituted_sale_id"], "sales"],
  ["sale_substitutions", ["substitution_sale_id"], "sales"],
  ["sale_voids", ["sale_id"], "sales"],
  ["sales", ["corrects_sale_id"], "sales"],
  ["sales", ["node_id"], "nodes"],
  ["sales", ["series_id"], "invoice_series"],
  ["sales", ["till_id"], "tills"],
  ["sales", ["working_order_id"], "working_orders"],
  ["shift_swaps", ["decided_by_person_id"], "persons"],
  ["shift_swaps", ["from_shift_id"], "shifts"],
  ["shift_swaps", ["requested_by_person_id"], "persons"],
  ["shift_swaps", ["to_person_id"], "persons"],
  ["shift_swaps", ["to_shift_id"], "shifts"],
  ["shift_templates", ["location_id"], "locations"],
  ["shifts", ["location_id"], "locations"],
  ["shifts", ["person_id"], "persons"],
  ["shifts", ["roster_version_id"], "roster_versions"],
  ["station_printers", ["printer_id"], "printers"],
  ["station_printers", ["station_id"], "kitchen_stations"],
  ["tenders", ["sale_id"], "sales"],
  ["ticket_items", ["course_id"], "kitchen_courses"],
  ["ticket_items", ["node_id"], "nodes"],
  ["ticket_items", ["station_id"], "kitchen_stations"],
  ["ticket_items", ["working_order_line_id"], "working_order_lines"],
  ["tills", ["location_id"], "locations"],
  ["tills", ["receipt_printer_id"], "printers"],
  ["time_entries", ["captured_by_till_id"], "tills"],
  ["time_entries", ["correction_actor_id"], "persons"],
  ["time_entries", ["corrects_entry_id"], "time_entries"],
  ["time_entries", ["location_id"], "locations"],
  ["time_entries", ["node_id"], "nodes"],
  ["time_entries", ["person_id"], "persons"],
  ["time_entries", ["recorded_by_person_id"], "persons"],
  ["webauthn_credentials", ["person_id"], "persons"],
  ["workforce_chains", ["last_entry_id"], "time_entries"],
  ["workforce_chains", ["location_id"], "locations"],
  ["workforce_chains", ["node_id"], "nodes"],
  ["working_line_contexts", ["menu_item_id"], "menu_items"],
  ["working_line_contexts", ["working_order_line_id"], "working_order_lines"],
  ["working_order_counters", ["node_id"], "nodes"],
  ["working_order_lines", ["course_id"], "kitchen_courses"],
  ["working_order_lines", ["parent_line_id"], "working_order_lines"],
  ["working_order_lines", ["product_id"], "products"],
  ["working_order_lines", ["working_order_id"], "working_orders"],
  ["working_orders", ["delivery_table_id"], "dining_tables"],
  ["working_orders", ["node_id"], "nodes"],
  ["working_orders", ["till_id"], "tills"],
  ["zone_menus", ["menu_id"], "catalogues"],
  ["zone_menus", ["zone_id"], "zone_service_policies"],
  ["zone_service_policies", ["default_menu_id"], "catalogues"],
  ["zone_service_policies", ["department_id"], "departments"],
  ["zone_service_policies", ["location_id"], "locations"],
  ["zone_service_policies", ["zone_id"], "floor_zones"],
  ["zone_service_policies", ["zone_id", "default_menu_id"], "zone_menus"],
];

/** Every unique index that is not a primary key, by the name its declaration gives it. */
const EXPECTED_UNIQUE_INDEXES = [
  "canvases_tenant_name_key",
  "card_readers_provider_ref_key",
  "convenio_config_location_uq",
  "daily_closes_business_day_key",
  "daily_closes_sequence_key",
  "department_hours_interval_key",
  "departments_location_name_key",
  "departments_one_default_per_location_key",
  "device_profiles_tenant_name_key",
  "dining_tables_location_label_key",
  "extra_list_items_list_product_uq",
  "floor_zones_name_key",
  "incidents_open_dedup",
  "invoice_series_node_code_key",
  "kitchen_courses_name_key",
  "kitchen_stations_default_key",
  "kitchen_stations_name_key",
  "management_account_actions_token_hash_uq",
  "management_sessions_token_hash_uq",
  "media_images_filename_key",
  "menu_items_id_product_key",
  "menu_items_menu_product_key",
  "menu_sections_menu_id_key",
  "order_amendments_chain_position_key",
  "payments_provider_external_ref_key",
  "payments_provider_ref_key",
  "persons_tenant_email_uq",
  "persons_tenant_google_subject_uq",
  "persons_tenant_live_display_name_uq",
  "persons_tenant_pending_email_uq",
  "preparation_routes_venue_category_key",
  "preparation_routes_venue_product_key",
  "preparation_routes_zone_category_key",
  "preparation_routes_zone_product_key",
  "print_agents_tenant_node_key",
  "printers_local_key_key",
  "product_modifiers_product_extra_uq",
  "product_modifiers_product_option_uq",
  "products_id_catalogue_key",
  "products_parent_id_key",
  "purchase_invoices_supplier_number_key",
  "recipe_lines_product_ingredient_key",
  "registro_sif_activo_uq",
  "registro_sif_instalacion_uq",
  "registros_identidad_uq",
  "registros_tenant_node_secuencia_uq",
  "roster_versions_published_period_uq",
  "sale_lines_line_no_key",
  "sale_settlements_sale_key",
  "sale_substitutions_substituted_key",
  "sale_voids_sale_id_key",
  "sales_series_invoice_number_key",
  "sales_working_order_id_key",
  "scheduled_runs_key",
  "sessions_token_hash_uq",
  "table_service_statuses_tenant_label_key",
  "tenants_country_tax_id_key",
  "ticket_items_working_order_line_id_key",
  "tills_tenant_location_name_key",
  "time_entries_chain_position_uq",
  "units_seed_key_key",
  "webauthn_credentials_credential_id_uq",
  "working_order_lines_line_no_key",
  "zone_service_policies_one_counter_default_key",
];

/**
 * Every named check constraint, by the name its declaration gives it. The built schema is expected
 * to be a superset of this list, never an equal: each enum column is a text column plus a named
 * check.
 */
const EXPECTED_CHECK_CONSTRAINTS = [
  "absences_range_ck",
  "acks_state_ck",
  "availability_effective_ck",
  "availability_from_minute_ck",
  "availability_to_minute_ck",
  "availability_weekday_ck",
  "availability_window_ck",
  "bookings_party_size_ck",
  "cadenas_puntero_ck",
  "content_languages_default_ck",
  "content_languages_list_ck",
  "content_languages_singleton_ck",
  "convenio_config_working_days_ck",
  "department_hours_weekday_ck",
  "departments_service_mode_ck",
  "deployment_environment_ck",
  "deployment_singleton_ck",
  "drawer_opens_reason_ck",
  "employments_contracted_minutes_ck",
  "employments_dates_ck",
  "envio_flujo_singleton_ck",
  "envios_estado_ck",
  "extra_list_items_price_ck",
  "extra_list_items_qty_ck",
  "extra_lists_picks_ck",
  "google_oidc_states_mode_ck",
  "google_oidc_states_state_hash_ck",
  "incidents_code_ck",
  "incidents_severity_ck",
  "invoice_series_code_ck",
  "invoice_series_next_number_ck",
  "invoice_series_purpose_ck",
  "kitchen_stations_thresholds_ordered",
  "locations_invoice_locales_len",
  "management_account_actions_code_attempts_ck",
  "management_account_actions_code_hash_ck",
  "management_account_actions_expiry_ck",
  "management_account_actions_purpose_ck",
  "management_account_actions_target_email_ck",
  "management_account_actions_token_hash_ck",
  "management_sessions_token_hash_ck",
  "media_images_filename_ck",
  "media_images_names_ck",
  "menu_item_extra_items_price_ck",
  "menu_item_variant_overrides_overrides_ck",
  "menu_item_variant_overrides_price_ck",
  "menu_items_gross_price_ck",
  "node_membership_singleton_ck",
  "node_roles_mode_ck",
  "node_roles_role_valid_ck",
  "node_roles_singleton_role_ck",
  "order_amendments_chaining_ck",
  "order_amendments_entry_hash_ck",
  "order_amendments_event_at_second_ck",
  "order_amendments_event_offset_ck",
  "order_amendments_sequence_no_ck",
  "order_service_contexts_mode_ck",
  "payment_policy_cap_ck",
  "payment_policy_offline_mode_ck",
  "payment_policy_singleton_ck",
  "payment_refunds_amount_ck",
  "payments_amount_ck",
  "payments_card_entry_mode_ck",
  "payments_card_last4_ck",
  "persons_display_name_ck",
  "persons_first_names_ck",
  "persons_last_names_ck",
  "persons_locale_ck",
  "persons_password_hash_ck",
  "persons_pending_email_ck",
  "persons_pin_hash_ck",
  "persons_telephone_ck",
  "persons_totp_secret_ck",
  "preparation_routes_subject_ck",
  "preparation_routes_target_ck",
  "print_jobs_kind_ck",
  "printers_character_table_ck",
  "printers_transport_fields_ck",
  "product_modifiers_one_reference_ck",
  "products_pricing_unit_ck",
  "products_top_level_owns_ck",
  "products_vat_class_ck",
  "purchase_invoice_vat_rate_ck",
  "purchase_invoices_deductible_proportion_ck",
  "recovery_codes_hash_ck",
  "registro_sif_numero_ck",
  "registros_encadenamiento_ck",
  "registros_entorno_ck",
  "registros_facturas_sustituidas_f3_ck",
  "registros_huella_ck",
  "registros_secuencia_ck",
  "registros_tipo_factura_rectificativa_ck",
  "registros_tipo_huella_ck",
  "registros_tipo_rectificativa_ck",
  "registros_tipo_registro_ck",
  "roster_versions_period_ck",
  "roster_versions_publish_shape_ck",
  "sale_lines_line_no_ck",
  "sale_lines_quantity_ck",
  "sale_lines_unit_precision_ck",
  "sale_lines_vat_rate_ck",
  "sales_invoice_locales_ck",
  "sales_invoice_number_ck",
  "sales_issued_offset_ck",
  "sales_locale_member_ck",
  "sales_total_ck",
  "scheduled_runs_attempts_ck",
  "scheduled_runs_generation_ck",
  "scheduled_runs_period_ck",
  "scheduled_runs_state_ck",
  "sessions_token_hash_ck",
  "shift_templates_ends_minute_ck",
  "shift_templates_label_ck",
  "shift_templates_starts_minute_ck",
  "shift_templates_weekday_ck",
  "shifts_ends_offset_ck",
  "shifts_interval_ck",
  "shifts_starts_offset_ck",
  "tenant_credentials_auth_tag_len_ck",
  "tenant_credentials_iv_len_ck",
  "tenant_credentials_key_version_ck",
  "tenant_credentials_purpose_ck",
  "tenant_receipts_singleton_ck",
  "tenant_themes_singleton_ck",
  "tenants_singleton_ck",
  "tenders_amount_ck",
  "tenders_cash_tendered_ck",
  "tenders_tip_amount_ck",
  "time_entries_chaining_ck",
  "time_entries_correction_shape_ck",
  "time_entries_entry_hash_ck",
  "time_entries_event_at_second_ck",
  "time_entries_event_offset_ck",
  "time_entries_recorded_at_second_ck",
  "time_entries_sequence_no_ck",
  "totp_enrollments_secret_ck",
  "unit_seed_states_singleton_ck",
  "units_hardware_unit_ck",
  "units_precision_ck",
  "workforce_chains_pointer_ck",
  "working_line_contexts_hardware_unit_ck",
  "working_line_contexts_unit_precision_ck",
  "working_line_contexts_vat_class_ck",
  "working_order_lines_line_no_ck",
  "working_order_lines_quantity_ck",
  "working_order_lines_unit_precision_ck",
  "working_order_lines_vat_rate_ck",
  "working_orders_settled_at_ck",
  "zone_service_policies_mode_ck",
];

/** Every migration set, applied into one database in the manifest's order, as the product does. */
function buildSchema() {
  const connection = new DatabaseSync(":memory:");
  for (const module of ALL_MODULES) {
    const drizzleDir = join(PACKAGES_DIR, packageDirOf(module), "drizzle");
    let entries;
    try {
      entries = readdirSync(drizzleDir);
    } catch {
      // A descriptor whose package ships no `drizzle/` directory. The anti-vacuity floors below
      // catch a discovery that found too little.
      continue;
    }
    for (const name of entries.filter((entry) => entry.endsWith(".sql")).sort()) {
      for (const statement of readFileSync(join(drizzleDir, name), "utf8").split(
        "--> statement-breakpoint",
      )) {
        const trimmed = statement.trim();
        if (trimmed) connection.exec(trimmed);
      }
    }
  }
  return connection;
}

function tablesIn(connection) {
  return connection
    .prepare(`select name from sqlite_master where type = 'table' order by name`)
    .all()
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith("__drizzle") && !name.startsWith("sqlite_"));
}

/** `table(col,col)->parent` for every foreign key the built schema records. */
function foreignKeysIn(connection) {
  const found = new Set();
  for (const table of tablesIn(connection)) {
    const byKey = new Map();
    for (const row of connection.prepare(`pragma foreign_key_list("${table}")`).all()) {
      const columns = byKey.get(row.id) ?? [];
      columns.push([row.seq, String(row.from)]);
      byKey.set(row.id, columns);
      byKey.set(`${row.id}:parent`, String(row.table));
    }
    for (const [id, columns] of byKey) {
      if (typeof id !== "number") continue;
      const ordered = columns.sort((a, b) => a[0] - b[0]).map(([, column]) => column);
      found.add(`${table}(${ordered.join(",")})->${byKey.get(`${id}:parent`)}`);
    }
  }
  return found;
}

function uniqueIndexNamesIn(connection) {
  return new Set(
    connection
      .prepare(`select name from sqlite_master where type = 'index' and sql like 'CREATE UNIQUE%'`)
      .all()
      .map((row) => String(row.name)),
  );
}

/**
 * Every named check constraint in the built schema, read out of the `CREATE TABLE` text: SQLite
 * keeps no catalogue of check constraints, so `sqlite_master.sql` is the only place a name can be
 * read from.
 */
function checkConstraintNamesIn(connection) {
  const names = new Set();
  for (const row of connection
    .prepare(`select sql from sqlite_master where type = 'table' and sql is not null`)
    .all()) {
    for (const match of String(row.sql).matchAll(/CONSTRAINT\s+[`"]?(\w+)[`"]?\s+CHECK/gi)) {
      names.add(match[1]);
    }
  }
  return names;
}

describe("the schema the migrations build", () => {
  const connection = buildSchema();

  // Anti-vacuity. Every assertion below is "is this in that set", so an empty set from a discovery
  // that silently found no migrations would pass all of them.
  it("built a schema with tables, keys and indexes in it", () => {
    expect(tablesIn(connection).length).toBeGreaterThan(90);
    expect(foreignKeysIn(connection).size).toBeGreaterThan(100);
    expect(uniqueIndexNamesIn(connection).size).toBeGreaterThan(40);
    expect(checkConstraintNamesIn(connection).size).toBeGreaterThan(100);
  });

  it("carries every foreign key the product declares", () => {
    const found = foreignKeysIn(connection);
    const missing = EXPECTED_FOREIGN_KEYS.map(
      ([table, columns, parent]) => `${table}(${columns.join(",")})->${parent}`,
    ).filter((key) => !found.has(key));
    expect(missing).toEqual([]);
  });

  it("carries every unique index the product declares", () => {
    const found = uniqueIndexNamesIn(connection);
    expect(EXPECTED_UNIQUE_INDEXES.filter((name) => !found.has(name))).toEqual([]);
  });

  it("carries every check constraint the product declares", () => {
    const found = checkConstraintNamesIn(connection);
    expect(EXPECTED_CHECK_CONSTRAINTS.filter((name) => !found.has(name))).toEqual([]);
  });
});
