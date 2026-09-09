import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

// Shared reason strings for the common case; a table with a more specific "why" states it inline.
const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";
const STATE = "manager configuration / live service; copied to a standby, never drained back";
const LOCAL = "this node's own record of what it is; not copied";

/**
 * Core's tables, classified for native replication (swap spec §2.1). `canvases` is `state` (it
 * succeeded the dropped `layout_profiles`); `bookings` left for `@waitron/bookings` (#270). The
 * completeness of this list against core's migrations is guarded by `classification.test.ts`, which
 * scans `drizzle/*.sql` for `CREATE TABLE`.
 */
export const CORE_CLASSIFICATION: readonly ClassifiedTable[] = [
  // ledger — append-only history copied to a standby AND drained back from a returned box.
  classify("sales", "ledger", LEDGER),
  classify("sale_lines", "ledger", LEDGER),
  classify("tenders", "ledger", LEDGER),
  classify("sale_settlements", "ledger", LEDGER),
  classify("sale_voids", "ledger", LEDGER),
  classify("sale_substitutions", "ledger", LEDGER),
  classify("ticket_items", "ledger", LEDGER),
  classify("drawer_opens", "ledger", LEDGER),
  classify("daily_closes", "ledger", LEDGER),
  classify(
    "daily_close_chain",
    "ledger",
    "hash-chained close records; drained back from a returned box",
  ),
  classify("purchase_invoices", "ledger", LEDGER),
  classify("purchase_invoice_vat", "ledger", LEDGER),

  // state — manager configuration and live service; copied to a standby, never drained back.
  classify(
    "working_order_counters",
    "state",
    "per-node order-number high-water mark; copied to a standby, never drained back",
  ),
  classify("tenants", "state", STATE),
  classify("locations", "state", STATE),
  classify("nodes", "state", STATE),
  classify("tills", "state", STATE),
  classify("devices", "state", STATE),
  classify("device_profiles", "state", STATE),
  classify("invoice_series", "state", STATE),
  classify("catalogues", "state", STATE),
  classify("location_catalogues", "state", STATE),
  classify("categories", "state", STATE),
  classify("products", "state", STATE),
  classify("option_groups", "state", STATE),
  classify("option_group_items", "state", STATE),
  classify("product_option_groups", "state", STATE),
  classify("ingredients", "state", STATE),
  classify("recipe_lines", "state", STATE),
  classify("floor_zones", "state", STATE),
  classify("dining_tables", "state", STATE),
  classify(
    "table_service_statuses",
    "state",
    "live table service in flight; copied to a standby, never drained back",
  ),
  classify("kitchen_stations", "state", STATE),
  classify("kitchen_courses", "state", STATE),
  classify("station_printers", "state", STATE),
  classify("printers", "state", STATE),
  classify("print_agents", "state", STATE),
  classify("canvases", "state", STATE),
  classify("tenant_themes", "state", STATE),
  classify("tenant_receipts", "state", STATE),
  classify("incidents", "state", STATE),
  classify("working_orders", "state", "orders in flight; copied to a standby, never drained back"),
  classify(
    "working_order_lines",
    "state",
    "order lines in flight; copied to a standby, never drained back",
  ),
  classify(
    "order_amendments",
    "state",
    "hash-chained order amendments in flight; copied to a standby, never drained back",
  ),
  classify("print_jobs", "state", STATE),

  // local — this node's own record of what it is; not copied, not drained.
  classify("deployment", "local", LOCAL),
  classify("mirror_config", "local", "this node's link to its cloud mirror; not copied"),
  classify("node_membership", "local", "this node's membership record; not copied"),
  classify(
    "print_agent_pairing_codes",
    "local",
    "this node's pending print-agent pairings; not copied",
  ),
  classify("join_requests", "local", "this node's pending joins, device and agent; not copied"),
];
