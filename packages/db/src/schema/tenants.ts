import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  label,
  labelList,
  newId,
  now,
  table,
  timeOfDay,
  ts,
} from "./columns.js";
import { catalogues } from "./catalogue.js";
import { printers } from "./printers.js";

/** The venue time-zone default, shared with runtime fallbacks. */
export const DEFAULT_TIME_ZONE = "Europe/Madrid";

/**
 * The per-venue pay-timing / service mode — see the `orderFlow` column on `locations` below for the
 * three modes and why the degenerate fourth cell is unrepresentable (design §3).
 */
export const orderFlow = enumType(["prepay", "invoice_first", "ticket_then_pay"]);

/**
 * The per-venue KDS bump mode (KDS-1, §2e). `line` (default): the per-line ticket-item state is the
 * only source of truth, each line bumped on its own. `ticket`: the display additionally offers a
 * whole-ticket bump that advances every one of an order's lines at a station together. Governs ONLY
 * that display convenience — the per-line state is always the truth. A shared enum declaration on `locations`, matching
 * `order_flow`'s precedent on the same table (one declaration yields both the union and the constraint).
 */
export const bumpMode = enumType(["line", "ticket"]);

/**
 * The per-venue FIRE CONTROL mode (KDS-2, §2c). `waiter` (default): the tab-ordering screen surfaces
 * the fire action per held course. `kitchen`: the station display surfaces it instead. Governs ONLY
 * which UI shows the affordance — `fireCourse` is the same verb either way, and all surfaces are
 * session-gated. `expo` (KDS-3, §2c): a dedicated expediter/pass display surfaces the fire action — its
 * surface, the session-gated `till-expo-screen`, ships in this same KDS-3 track. A shared enum declaration on `locations`,
 * matching `bump_mode` / `order_flow`'s precedent on the same table (one declaration yields both the
 * union and the constraint).
 */
export const fireControlMode = enumType(["waiter", "kitchen", "expo"]);

/**
 * The per-venue RECEIPT PRINT MODE (counter-receipt/drawer slice §2). `auto` (default): after a sale
 * is filed, the server auto-enqueues the customer receipt to the calling till's `receipt_printer_id`.
 * `on_request`: no auto-print — a manual reprint is always available. `never`: never auto-print.
 * Governs ONLY the post-filing auto-enqueue; it touches no fiscal record, and a manual reprint works
 * in every mode. A shared enum declaration on `locations`, matching `order_flow` / `bump_mode` / `fire_control`'s
 * precedent on the same table (a per-venue config mode — one declaration yields both the union and
 * the constraint).
 */
export const receiptPrintMode = enumType(["auto", "on_request", "never"]);

/**
 * The per-venue CASH-DRAWER OPEN POLICY (cash-drawer-authorization slice §2). `gated` (default): a
 * cash-drawer open must be authorized — the drawer route requires the `cash.drawer` permission
 * (@waitron/identity), and the `drawer_opens` audit row records who authorized it and whether an
 * override was used. `open`: no authorization is consulted; any operator may open the drawer. A shared enum declaration
 * on `locations`, matching `order_flow` / `bump_mode` / `fire_control` / `receipt_print_mode`'s precedent
 * on the same table (a per-venue config mode — one declaration yields both the union and the constraint).
 * Unlike those siblings, the DEFAULT is the SECURE value `'gated'`, not an inert one: a venue that has
 * not chosen a policy gets cash accountability, not an open drawer (spec §2).
 */
export const drawerOpenPolicy = enumType(["gated", "open"]);

/**
 * One taxpayer per database. Fiscal identity is country + tax_id, regime-agnostic: for a Spanish
 * tenant `tax_id` IS the NIF, and the Veri*Factu backend reads `tax_id` where it once read `nif`
 * (a NIF cannot be asked for before the country is known — spec D2). Unique on (country, tax_id).
 */
export const tenants = table(
  "tenants",
  {
    // One row per database: `tenants_singleton_ck` pins the id to 1 and every writer states it. No
    // column default — an `INTEGER PRIMARY KEY` is a rowid alias, and probed on Node v26.7.0 two
    // tables differing only in `DEFAULT 1` behaved identically: a statement omitting the id COLUMN
    // stored 1 in an empty table, and was refused errcode 275 beside a seeded row 1.
    id: count("id").primaryKey(),
    country: label("country").notNull(),
    taxId: label("tax_id").notNull(),
    legalName: label("legal_name").notNull(),
    createdAt: ts("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    check("tenants_singleton_ck", sql`${t.id} = 1`),
    uniqueIndex("tenants_country_tax_id_key").on(t.country, t.taxId),
  ],
);

/**
 * A venue. `invoiceLocales` is an ORDERED list of one or two locales: one means
 * monolingual, two means both languages on the same invoice in that order
 * (spec §9 — a Barcelona venue may want Spanish, Catalan, or both).
 *
 * The order is fiscal, not presentational. Spec §9 requires a reprint or a
 * corrective invoice issued a year later to reproduce the document the customer
 * took, which is why `sales.invoice_locales` snapshots this list at issuance.
 * Which language leads is part of what the document said; a corrective invoice
 * references an original that must be reproducible. Reordering a venue's
 * configuration must therefore never change how an already-issued receipt
 * reprints — hence a snapshot of an ordered value, not a lookup of a set.
 *
 * Rejected alternatives: a `jsonb` object cannot carry order at all, because
 * Postgres normalises and sorts `jsonb` keys on storage; a
 * `primary_locale`/`secondary_locale` pair encodes order but cannot grow past
 * two, and the cap belongs in a constraint that can be relaxed, not in the
 * column layout.
 *
 * The fiscal/address/time columns carry `DEFAULT`s (or are nullable) so the
 * reshape does not ripple to the ~28 existing location inserts, which never
 * read these columns. The `venue` command sets all of them explicitly, and no
 * runtime path reads a location's `fiscal_territory` to choose a regime — the
 * node's `filing_module` carries that (Task A3) — so a defaulted value on a
 * fixture is inert. `day_cutover`/`time_zone` are the inputs `computeDailyClose`
 * consumes (spec D9): `@waitron/reporting`'s `computeDailyClose` already takes
 * them as `DailyCloseInput` fields (`packages/reporting/src/daily-close.ts:14`,
 * landed #56). These columns are the source a caller will read them from — the
 * columns land now, that wiring is future.
 */
export const locations = table(
  "locations",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    invoiceLocales: labelList("invoice_locales").notNull(),
    operationDescription: label("operation_description").notNull(),
    fiscalTerritory: label("fiscal_territory").notNull().default("ES-common"),
    addressLine1: label("address_line1"),
    addressLine2: label("address_line2"),
    postalCode: label("postal_code"),
    city: label("city"),
    province: label("province"),
    timeZone: label("time_zone").notNull().default(DEFAULT_TIME_ZONE),
    dayCutover: timeOfDay("day_cutover").notNull().default("06:00:00"),
    // The per-venue pay-timing / service mode (design §3): WHEN payment happens (order vs collect) ×
    // WHEN the invoice issues (placing vs pay), collapsed to three meaningful modes by a single enum
    // (the degenerate fourth cell is structurally unrepresentable). `prepay` = pay+issue at order,
    // open → settled, no placed state (today's walk-up/park-pay — Decision 3). `invoice_first` = issue
    // deferred at placing, settle at collect (open → placed → settled). `ticket_then_pay` = place with
    // no fiscal doc, pay+issue at collect. DEFAULT 'prepay' so existing location fixtures stay inert.
    // No config-authoring UI in this slice (set at provisioning, like the layout editor).
    orderFlow: orderFlow("order_flow").notNull().default("prepay"),
    // The per-venue KDS bump mode (KDS-1, §2e): `line` (default) = per-line bump only; `ticket` = the
    // display also offers a whole-ticket bump. NOT NULL DEFAULT 'line' so existing location fixtures
    // stay inert, exactly as `order_flow` above defaults. Governs only the display convenience.
    bumpMode: bumpMode("bump_mode").notNull().default("line"),
    // The per-venue KDS fire-control mode: `waiter` (default, KDS-2) = the tab surfaces the fire action;
    // `kitchen` (KDS-2) = the station display surfaces it; `expo` (KDS-3) = the expediter/pass display
    // surfaces it. NOT NULL DEFAULT 'waiter' so existing location fixtures stay inert, exactly as
    // `bump_mode` / `order_flow` above default. Governs only which UI shows the affordance — the
    // `fireCourse` verb is unchanged by it.
    fireControl: fireControlMode("fire_control").notNull().default("waiter"),
    // The per-venue receipt print mode (counter-receipt/drawer slice §2): `auto` (default) = auto-print
    // the customer receipt after filing; `on_request` / `never` = skip the auto-enqueue. NOT NULL
    // DEFAULT 'auto' so existing location fixtures stay inert-consistent, exactly as `order_flow` /
    // `bump_mode` / `fire_control` above default. Read per-location by the print-on-sale hook (a later
    // task); no read logic here.
    receiptPrintMode: receiptPrintMode("receipt_print_mode").notNull().default("auto"),
    // The per-venue cash-drawer open policy (cash-drawer-authorization slice §2): `gated` (default) =
    // a drawer open requires the `cash.drawer` permission and is audited; `open` = no authorization is
    // consulted. NOT NULL DEFAULT 'gated' — the SECURE default, deliberately unlike the inert defaults of
    // `order_flow` / `bump_mode` / `fire_control` / `receipt_print_mode` above: an unconfigured venue gets
    // cash accountability, not an open drawer. Read per-location by the drawer route (a later task); no
    // read logic here.
    drawerOpenPolicy: drawerOpenPolicy("drawer_open_policy").notNull().default("gated"),
    // This location's DEFAULT catalogue (menu) — nullable (a venue may exist before a menu is
    // assigned). Not the only menu a location sells from: `location_catalogues` may add further
    // catalogues to the accessible set, resolved by `resolveAccessibleCatalogueIds`
    // (`packages/catalogue/src/operations.ts`). NULLABLE, and a foreign key does not check a NULL,
    // so a location with no default catalogue is accepted.
    /* v8 ignore start */
    catalogueId: id("catalogue_id").references(() => catalogues.id),
    /* v8 ignore stop */
  },
  (t) => [
    // json_array_length(), because `invoice_locales` is now a JSON array in a text column rather
    // than a PostgreSQL array. The reason the old expression picked its function carries across:
    // `json_array_length('[]')` is 0, so an empty locale list fails `between 1 and 2` and the
    // constraint still bites (measured on node:sqlite, Node v26.7.0, and recorded in
    // /tmp/f1-ddl-probe/RECIPE.md item 6).
    //
    // Until 2026-09-21 this comment read: "cardinality(), NOT array_length(). array_length('{}', 1)
    // is NULL, a CHECK whose expression is NULL is satisfied, and an empty locale list would
    // therefore be accepted — verified on PostgreSQL 18.4. cardinality('{}') is 0 and the
    // constraint bites." That was a claim about PostgreSQL's two array functions, and neither
    // function is reachable from here any more.
    //
    // What the rewrite does NOT carry: the old expression could only ever be handed a value the
    // `text[]` column type had already accepted as an array, and this one is handed whatever text
    // the column holds.
    check(
      "locations_invoice_locales_len",
      sql`json_array_length(${t.invoiceLocales}) between 1 and 2`,
    ),
    // The five per-venue mode columns were PostgreSQL enum TYPES, which refused a value outside
    // their set on their own; the SQLite text columns that replace them do not, so the refusals are
    // written here instead. Each one's values are read off the column (`enumCheck`), so every
    // vocabulary is still declared once, at the top of this file.
    check("locations_order_flow_ck", enumCheck(t.orderFlow)),
    check("locations_bump_mode_ck", enumCheck(t.bumpMode)),
    check("locations_fire_control_ck", enumCheck(t.fireControl)),
    check("locations_receipt_print_mode_ck", enumCheck(t.receiptPrintMode)),
    check("locations_drawer_open_policy_ck", enumCheck(t.drawerOpenPolicy)),
  ],
);

/**
 * A point of sale. Deliberately REGIME-NEUTRAL: `NúmeroInstalación` and
 * `IdSistemaInformatico` do NOT live here.
 *
 * They are Veri*Factu concepts — a Spanish SIF identity, minted per (NIF,
 * IdSIF) and never reusable (spec §3) — and `packages/db` is English and
 * regime-neutral by Global Constraint. Putting them here would mean every
 * future regime either widens this table or leaves columns null, and it would
 * put Spanish column names in a package the Task 3 guard forbids them in. They
 * live in the module-owned `registro_sif` table, keyed by node (the SIF is
 * the node — #33, node-id rekey), built in Task 13. A node has exactly one
 * live SIF identity per regime, so that join is 1:1; a till reaches its SIF
 * through the node that serves it.
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as ./sales.ts.
export const tills = table(
  "tills",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id")
      .notNull()
      /* v8 ignore start */
      .references(() => locations.id),
    /* v8 ignore stop */
    name: label("name").notNull(),
    // The till's per-till receipt printer (counter-receipt/drawer slice §2), which is also the
    // cash-drawer kick (deli-hardware §6 — the drawer is a printer capability, no separate device).
    // NULLABLE (a till with no printer just doesn't print), and a foreign key does not check a NULL.
    /* v8 ignore start */
    receiptPrinterId: id("receipt_printer_id").references(() => printers.id),
    /* v8 ignore stop */
    createdAt: ts("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    // No two tills share a name within a venue. The index keeps the name it was created under.
    uniqueIndex("tills_tenant_location_name_key").on(t.locationId, t.name),
  ],
);
