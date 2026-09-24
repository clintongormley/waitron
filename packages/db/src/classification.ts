import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

// Shared reason strings for the common case; a table with a more specific "why" states it inline.
const LEDGER = "what happened, keyed by the writing node; drained back from a returned box";
const STATE = "manager configuration / live service; copied to a standby, never drained back";
const LOCAL =
  "one node's own row, keyed by its node id; in venue.db like every table, read and written only by that node";

/**
 * Core's tables, classified for native replication (swap spec §2.1). `canvases` is `state` (it
 * succeeded the dropped `layout_profiles`); `bookings` left for `@waitron/bookings` (#270). The
 * completeness of this list against core's migrations is guarded by `classification.test.ts`, which
 * scans `drizzle/*.sql` for `CREATE TABLE`.
 */
export const CORE_CLASSIFICATION: readonly ClassifiedTable[] = [
  // ledger — append-only history copied to a standby AND drained back from a returned box.
  appendOnly("sales", "ledger", LEDGER),
  appendOnly("sale_lines", "ledger", LEDGER),
  appendOnly("tenders", "ledger", LEDGER),
  appendOnly("sale_settlements", "ledger", LEDGER),
  appendOnly("sale_voids", "ledger", LEDGER),
  appendOnly("sale_substitutions", "ledger", LEDGER),
  classify("ticket_items", "ledger", LEDGER),
  classify("drawer_opens", "ledger", LEDGER),
  appendOnly("daily_closes", "ledger", LEDGER),
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
  appendOnly(
    "order_amendments",
    "state",
    "hash-chained order amendments in flight; copied to a standby, never drained back",
  ),
  classify("print_jobs", "state", STATE),

  // state — one row per database, the same whichever node reads it.
  classify(
    "deployment",
    "state",
    "the environment this database was stamped for; one per database, whichever node reads it",
  ),
  classify(
    "node_membership",
    "state",
    "the venue's signed membership document; the same on every node, so one row",
  ),

  // local — belongs to one node; each says what ties a row to its node.
  classify("node_roles", "local", LOCAL),
  classify(
    "mirror_config",
    "local",
    "one node's link to the box it mirrors, keyed by its node id; read only by that node",
  ),
  classify(
    "join_requests",
    "local",
    "pending joins one node received, keyed by its node id; no other node lists or accepts them",
  ),
  classify(
    "change_log",
    "local",
    "one node's signal to its own dashboard, deleted by the transaction that wrote it; a row a write outside withTransaction left is delivered by the next transaction on whichever node holds the file",
  ),
];

/**
 * The tables whose row changes the dashboard is told about.
 *
 * `change_log` is filtered out because it is where the trigger PUTS its output: a change trigger on
 * it would insert a row for every row it writes, and that row would trigger another. Guard:
 * `classification.test.ts`.
 */
export const CORE_CHANGE_SOURCES: readonly ChangeSource[] = CORE_CLASSIFICATION.filter(
  ({ table }) => table !== "change_log",
).map(({ table }) => ({
  table,
  type: table,
  related: table === "print_jobs" ? [{ type: "printers", column: "printer_id" }] : [],
}));
