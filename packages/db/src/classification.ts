import { appendOnly, classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import { SETTINGS_CHANGE_TYPE, type ChangeSource } from "@waitron/shared";

// Shared reason strings for the common case; a table with a more specific "why" states it inline.
const LEDGER = "what happened, keyed by the writing node";
const STATE = "manager configuration / live service; copied to a standby";

/**
 * The tables core's own module code owns. Core's change sources and its own backup check read this
 * list; the modules hosted in core's set name theirs in their own packages.
 */
export const CORE_OWN_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify(
    "settings",
    "state",
    "each module’s configuration document; copied to a standby, never drained back",
  ),
  classify(
    "document_delivery_requests",
    "local",
    "node_id and recovery_epoch scope every protocol access; admission validates referenced ids",
  ),
  classify(
    "document_delivery_sequences",
    "local",
    "node_id and recovery_epoch scope every acceptance counter",
  ),
  classify(
    "device_invoice_save_operations",
    "local",
    "node_id and recovery_epoch scope every protocol access; admission validates referenced ids",
  ),

  // ledger — copied to a standby.
  appendOnly("sales", "ledger", LEDGER),
  appendOnly("sale_lines", "ledger", LEDGER),
  appendOnly("tenders", "ledger", LEDGER),
  appendOnly("sale_settlements", "ledger", LEDGER),
  appendOnly("sale_voids", "ledger", LEDGER),
  appendOnly("sale_substitutions", "ledger", LEDGER),
  appendOnly(
    "deferred_closures",
    "ledger",
    "a bill closed as a deferred payment, and the answer that close gave",
  ),
  appendOnly(
    "receipt_reprints",
    "ledger",
    "who requested a receipt copy and which document job carries it",
  ),
  appendOnly(
    "document_page_reprints",
    "ledger",
    "who requested an F2 page copy and which page job carries it",
  ),
  appendOnly(
    "invoice_pdf_downloads",
    "ledger",
    "who requested an invoice's PDF from the dashboard, and when; an audit row is never corrected",
  ),
  classify("ticket_items", "ledger", LEDGER),
  appendOnly("drawer_entries", "ledger", "cash and card movements recorded against a drawer"),
  classify("drawer_opens", "ledger", LEDGER),
  classify("purchase_invoices", "ledger", LEDGER),
  classify("purchase_invoice_vat", "ledger", LEDGER),
  classify(
    "activity_log",
    "ledger",
    "who did what, for people to read; product logic never decides from it; UPDATE is refused",
  ),
  classify(
    "bill_payments",
    "ledger",
    "money taken against a bill before its invoice; only its outcome moves, under a trigger",
  ),
  appendOnly(
    "bill_payment_lines",
    "ledger",
    "which lines an item payment paid for; never corrected, refunded by a refund row instead",
  ),
  appendOnly(
    "bill_advances",
    "ledger",
    "which advance invoice was issued against which bill; never corrected",
  ),
  classify(
    "refunds",
    "ledger",
    "money returned before or after the invoice; request identity and terminal outcomes held by its transition trigger",
  ),
  classify(
    "invoice_corrections",
    "ledger",
    "a till's correction of a paid invoice; only its state moves, under a trigger",
  ),
  appendOnly(
    "invoice_correction_refunds",
    "ledger",
    "which refund gave back money for which invoice correction; never corrected",
  ),
  appendOnly(
    "unpaid_departures",
    "ledger",
    "which bills a party left without paying, against which invoice, by whose authority; never corrected",
  ),
  appendOnly(
    "sale_line_dishes",
    "ledger",
    "which dish lines each filed sale row stands for; written with the sale, never corrected",
  ),

  // state — manager configuration and live service; copied to a standby.
  classify("taxpayer", "state", STATE),
  classify("day_cutover_changes", "state", STATE),
  classify("nodes", "state", STATE),
  classify("devices", "state", STATE),
  classify("device_approved_profiles", "state", STATE),
  classify("device_profiles", "state", STATE),
  classify("invoice_series", "state", STATE),
  classify("menus", "state", STATE),
  classify("categories", "state", STATE),
  classify("products", "state", STATE),
  classify("product_takeaway_vat_rates", "state", STATE),
  classify("floor_zones", "state", STATE),
  classify("dining_tables", "state", STATE),
  classify("floor_plan_sets", "state", STATE),
  classify("floor_plans", "state", STATE),
  classify("floor_plan_tables", "state", STATE),
  classify("floor_plan_placements", "state", STATE),
  classify("floor_reset_tables", "state", STATE),
  classify("table_merges", "state", STATE),
  classify("kitchen_stations", "state", STATE),
  classify("kitchen_courses", "state", STATE),
  classify(
    "ticket_item_moves",
    "state",
    "who moved a dish to another station, live service in flight; copied to a standby, never drained back",
  ),
  classify("printers", "state", STATE),
  classify("print_agents", "state", STATE),
  classify("custom_themes", "state", STATE),
  classify("incidents", "state", STATE),
  classify("working_orders", "state", "orders in flight; copied to a standby"),
  classify(
    "working_order_lines",
    "state",
    "order lines in flight; copied to a standby, never drained back",
  ),
  classify(
    "bill_set_menu_copies",
    "state",
    "menu copies used on a bill in flight; copied to a standby, never drained back",
  ),
  classify(
    "line_service_cancellations",
    "state",
    "cancelled service that retains its bill charge; copied to a standby, never drained back",
  ),
  appendOnly(
    "order_amendments",
    "state",
    "hash-chained order amendments in flight; copied to a standby, never drained back",
  ),
  classify("outgoing_mail", "state", "the one mail queue; copied to a standby, never drained back"),
  classify("print_jobs", "state", STATE),
  classify(
    "invoice_deliveries",
    "state",
    "mutable delivery queue for issued core invoices; copied to a standby, never drained back",
  ),
  classify(
    "kitchen_print_job_lines",
    "state",
    "which order lines each kitchen ticket carried; copied to a standby, never drained back",
  ),
  classify(
    "kitchen_print_jobs",
    "state",
    "which bill and station each kitchen ticket or linked correction slip concerns; copied to a standby, never drained back",
  ),
  classify("parties", "state", "a seated party in flight; copied to a standby, never drained back"),
  classify(
    "party_tables",
    "state",
    "which tables a seated party holds; copied to a standby, never drained back",
  ),
  classify(
    "service_commands",
    "state",
    "the recorded result of each service command and a bill's server-written made_here replay row; copied to a standby with the parties and bills they answer for, never drained back",
  ),
  classify(
    "order_groups",
    "state",
    "the groups a seated party's order is released in; copied to a standby, never drained back",
  ),
  classify(
    "order_group_hold_stations",
    "state",
    "the stations that have a held group's HOLD paper; copied to a standby, never drained back",
  ),
  classify(
    "order_drafts",
    "state",
    "each operator's unsent order on a seated party; copied to a standby, never drained back",
  ),
  classify(
    "order_draft_lines",
    "state",
    "the lines of an unsent order; copied to a standby, never drained back",
  ),
  appendOnly(
    "order_events",
    "state",
    "what happened to a bill's dishes, rounds and drafts, and who did it; never corrected, copied to a standby, never drained back",
  ),

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
  classify(
    "node_sealed_state",
    "local",
    "this node's own state files, locked with the recovery key; one row per node, keyed by its node id",
  ),
  classify(
    "recovery_packs",
    "local",
    "one node's recovery packs, keyed by its node id; a node holding another node's copy reads its own or none",
  ),
];

const MENU_STATE = "menu configuration; copied to a standby, never drained back";
const SUGGESTIONS =
  "translation suggestions waiting for a person's review; copied to a standby, never drained back";
const SERVICE_STATE =
  "venue service configuration or live order state; copied to a standby, never drained back";
const SEALED =
  "sealed under the box's key ring, which a spare receives from the main box when it joins, so both open the main box's rows. Not keyed by node id";

/** The tables of the modules whose tables live in core's set, each under the reason its module gave. */
const HOSTED_CLASSIFICATION: readonly ClassifiedTable[] = [
  // handover
  appendOnly(
    "handover_activations",
    "ledger",
    "which box took over from which, when, who asked and on what signed evidence; nothing may change or remove it",
  ),

  classify(
    "handover_return_batches",
    "state",
    "accounted batch digests for a takeover; copied with the venue",
  ),

  // menu
  classify("units", "state", MENU_STATE),
  classify("menu_items", "state", MENU_STATE),
  classify("menu_item_variant_overrides", "state", MENU_STATE),
  classify("set_menu_lines", "state", MENU_STATE),
  classify("set_menu_line_courses", "state", MENU_STATE),
  classify("set_menu_variant_exclusions", "state", MENU_STATE),
  classify("set_menu_dish_courses", "state", MENU_STATE),
  classify("option_lists", "state", MENU_STATE),
  classify("option_labels", "state", MENU_STATE),
  classify("extra_lists", "state", MENU_STATE),
  classify("extra_list_items", "state", MENU_STATE),
  classify("product_modifiers", "state", MENU_STATE),
  classify("sections", "state", MENU_STATE),
  classify("section_members", "state", MENU_STATE),
  appendOnly(
    "menu_versions",
    "state",
    "menu versions, published or queued, never changed once written; copied to a standby, never drained back",
  ),
  appendOnly(
    "menu_version_images",
    "state",
    "the photos each menu version names, published or queued; copied to a standby, never drained back",
  ),
  classify("menu_releases", "state", MENU_STATE),
  classify("content_suggestion_jobs", "state", SUGGESTIONS),
  classify("content_suggestions", "state", SUGGESTIONS),

  // venue-service
  classify(
    "departments",
    "state",
    "venue service configuration or live order state; copied to a standby",
  ),
  classify("department_courses", "state", SERVICE_STATE),
  classify("service_steps", "state", SERVICE_STATE),
  classify("service_step_completions", "state", SERVICE_STATE),
  classify("department_transfer_destinations", "state", SERVICE_STATE),
  classify("department_transfer_requests", "state", SERVICE_STATE),
  classify("menu_periods", "state", SERVICE_STATE),
  classify("routing_cells", "state", SERVICE_STATE),
  classify("routing_cell_periods", "state", SERVICE_STATE),
  classify("kitchen_notices", "state", SERVICE_STATE),
  classify("order_kitchen_notes", "state", SERVICE_STATE),
  classify("party_allergy_guests", "state", SERVICE_STATE),
  classify("allergy_line_ticks", "state", SERVICE_STATE),
  classify("seasons", "state", SERVICE_STATE),
  classify("special_days", "state", SERVICE_STATE),
  classify("special_day_dates", "state", SERVICE_STATE),
  classify("opening_hours", "state", SERVICE_STATE),

  // media
  classify("media_images", "state", "shared image metadata; copied to standbys"),
  classify("media_blobs", "state", "shared image bytes keyed by content hash"),

  // identity: every table means the same on every node of the venue. A sign-in's cookie token is
  // stored only as its hash, so neither that session's row id nor its stored hash, read from a copy
  // of the database, signs anybody in.
  classify("persons", "state", STATE),
  classify("roles", "state", "access roles and their granted permissions"),
  classify("person_roles", "state", "the access roles each person holds"),
  classify("staff_roles", "state", "the venue's job positions, which an owner edits"),
  classify("person_staff_roles", "state", "which staff roles a person can fill"),
  classify(
    "account_actions",
    "state",
    "pending account activation and recovery proofs; copied to a standby, never drained back",
  ),
  classify(
    "webauthn_credentials",
    "state",
    "a person's registered authenticators; copied to a standby, never drained back",
  ),
  classify(
    "recovery_codes",
    "state",
    "single-use account recovery proofs; copied to a standby, never drained back",
  ),
  classify(
    "till_sessions",
    "state",
    "a person's shift login at a till; the cookie's token is stored only as its hash; copied to a standby, never drained back",
  ),
  classify(
    "dashboard_sessions",
    "state",
    "a person's dashboard login; the cookie's token is stored only as its hash; copied to a standby, never drained back",
  ),
  classify(
    "sign_in_challenges",
    "state",
    "a sign-in or enrolment ceremony in flight; minutes long",
  ),
  classify(
    "device_profile_admission_roles",
    "state",
    "the roles a device profile admits; copied to a standby, never drained back",
  ),

  // credentials: a stored secret is sealed under the box's key ring, so a box holding a different
  // ring fails to read it (`credentials.decrypt_failed`, or `credentials.key_version_unknown` when
  // its ring holds no key of the row's version), never a wrong value.
  classify("venue_credentials", "local", SEALED),

  // adjustments
  classify(
    "adjustment_reasons",
    "state",
    "venue adjustment policy an owner edits; copied to a standby, never drained back",
  ),
  appendOnly(
    "adjustments",
    "ledger",
    "what was taken off a bill, by whom and under which reason; nothing may change or remove it",
  ),
  appendOnly(
    "adjustment_refunds",
    "ledger",
    "which cancelled dishes a refund paid back, and how much of it; nothing may change or remove it",
  ),
  appendOnly(
    "adjustment_lines",
    "ledger",
    "which bill lines a comp or discount covered; nothing may change or remove it",
  ),
];

/**
 * Every table in core's set, classified for native replication: core's own and those of the modules
 * hosted in it. The completeness of this list against core's migrations is guarded by
 * `classification.test.ts`, which scans `drizzle/*.sql` for `CREATE TABLE`.
 */
export const CORE_CLASSIFICATION: readonly ClassifiedTable[] = [
  ...CORE_OWN_CLASSIFICATION,
  ...HOSTED_CLASSIFICATION,
];

/**
 * The tables whose row changes the dashboard is told about.
 *
 * `change_log` is filtered out because it is where the trigger PUTS its output: a change trigger on
 * it would insert a row for every row it writes, and that row would trigger another.
 * Guard: `classification.test.ts`.
 */
const NOT_CHANGE_SOURCES = new Set(["change_log", "node_sealed_state"]);

export const CORE_CHANGE_SOURCES: readonly ChangeSource[] = CORE_OWN_CLASSIFICATION.filter(
  ({ table }) => !NOT_CHANGE_SOURCES.has(table),
).map(({ table }) => ({
  table,
  type: table === "settings" ? SETTINGS_CHANGE_TYPE : table,
  ...(table === "settings" ? { typeSuffixColumn: "module" } : {}),
  ...(table === "dining_tables"
    ? {
        quiet: {
          type: "dining_tables.today",
          columns: [
            "on_floor",
            "today_seats",
            "today_fixed",
            "today_x",
            "today_y",
            "today_width",
            "today_height",
            "today_shape",
            "today_rotation",
            "taken_off",
            "today_name",
            "merge_id",
            "merge_before_x",
            "merge_before_y",
            "merge_before_rotation",
          ],
        },
      }
    : table === "floor_zones"
      ? {
          quiet: {
            type: "floor_zones.today",
            columns: [
              "today_business_day",
              "today_revision",
              "today_set_id",
              "today_layout_revision",
              "today_occurrence",
            ],
          },
        }
      : {}),
  related: table === "print_jobs" ? [{ type: "printers", column: "printer_id" }] : [],
}));
