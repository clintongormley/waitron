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

/** The per-venue pay-timing / service mode — the three modes are on the `orderFlow` column below. */
export const orderFlow = enumType(["prepay", "invoice_first", "ticket_then_pay"]);

/**
 * The per-venue KDS bump mode. `line` (default): each line bumped on its own. `ticket`: the display
 * additionally offers a whole-ticket bump that advances every one of an order's lines at a station
 * together. Governs ONLY that display convenience — the per-line state is always the truth.
 */
export const bumpMode = enumType(["line", "ticket"]);

/**
 * The per-venue FIRE CONTROL mode: which surface offers the fire action per held course — the
 * tab-ordering screen (`waiter`, default), the station display (`kitchen`), or the expediter/pass
 * display (`expo`). Governs ONLY which UI shows the affordance — `fireCourse` is the same verb
 * either way.
 */
export const fireControlMode = enumType(["waiter", "kitchen", "expo"]);

/**
 * The per-venue RECEIPT PRINT MODE. `auto` (default): after a sale is filed, the server
 * auto-enqueues the customer receipt to the calling till's `receipt_printer_id`. `on_request` and
 * `never`: no auto-print. Governs ONLY the post-filing auto-enqueue; it touches no fiscal record,
 * and a manual reprint works in every mode.
 */
export const receiptPrintMode = enumType(["auto", "on_request", "never"]);

/**
 * The per-venue CASH-DRAWER OPEN POLICY. `gated` (default): the drawer route requires the
 * `cash.drawer` permission, and the `drawer_opens` audit row records who authorized it and whether
 * an override was used. `open`: no authorization is consulted. Unlike the other mode columns, the
 * DEFAULT is the SECURE value: a venue that has not chosen a policy gets cash accountability, not an
 * open drawer.
 */
export const drawerOpenPolicy = enumType(["gated", "open"]);

/**
 * One taxpayer per database. Fiscal identity is country + tax_id, regime-agnostic: for a Spanish
 * tenant `tax_id` IS the NIF (a NIF cannot be asked for before the country is known).
 */
export const tenants = table(
  "tenants",
  {
    // One row per database: `tenants_singleton_ck` pins the id to 1 and every writer states it.
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
 * monolingual, two means both languages on the same invoice in that order.
 *
 * The order is fiscal, not presentational. A reprint or a corrective invoice
 * issued a year later must reproduce the document the customer took, which is
 * why `sales.invoice_locales` snapshots this list at issuance. Reordering a
 * venue's configuration must therefore never change how an already-issued
 * receipt reprints — hence a snapshot of an ordered value, not a lookup of a set.
 * A `primary_locale`/`secondary_locale` pair encodes order but cannot grow past
 * two, and the cap belongs in a constraint that can be relaxed, not in the
 * column layout.
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
    // WHEN payment happens (order vs collect) × WHEN the invoice issues (placing vs pay), collapsed
    // to three meaningful modes by a single enum (the degenerate fourth cell is unrepresentable).
    // `prepay` = pay+issue at order, open → settled, no placed state. `invoice_first` = issue
    // deferred at placing, settle at collect (open → placed → settled). `ticket_then_pay` = place
    // with no fiscal doc, pay+issue at collect.
    orderFlow: orderFlow("order_flow").notNull().default("prepay"),
    bumpMode: bumpMode("bump_mode").notNull().default("line"),
    fireControl: fireControlMode("fire_control").notNull().default("waiter"),
    receiptPrintMode: receiptPrintMode("receipt_print_mode").notNull().default("auto"),
    drawerOpenPolicy: drawerOpenPolicy("drawer_open_policy").notNull().default("gated"),
    // This location's DEFAULT catalogue (menu); a venue may exist before a menu is assigned.
    // `location_catalogues` may add further catalogues, resolved by
    // `resolveAccessibleCatalogueIds` (`packages/catalogue/src/operations.ts`).
    /* v8 ignore start */
    catalogueId: id("catalogue_id").references(() => catalogues.id),
    /* v8 ignore stop */
  },
  (t) => [
    check(
      "locations_invoice_locales_len",
      sql`json_array_length(${t.invoiceLocales}) between 1 and 2`,
    ),
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
 * IdSIF) and never reusable — and `packages/db` is English and regime-neutral.
 * Putting them here would mean every future regime either widens this table or
 * leaves columns null. They live in the module-owned `registro_sif` table,
 * keyed by node (the SIF is the node). A node has exactly one live SIF
 * identity per regime, so that join is 1:1; a till reaches its SIF through the
 * node that serves it.
 */
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
    // Also the cash-drawer kick: the drawer is a printer capability, not a separate device. A till
    // with no printer just doesn't print.
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
