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

/** The venue time-zone default, shared with runtime fallbacks. */
export const DEFAULT_TIME_ZONE = "Europe/Madrid";

/**
 * The per-venue KDS bump mode. `line` (default): each line bumped on its own. `ticket`: the display
 * additionally offers a whole-ticket bump that advances every one of an order's lines at a station
 * together. Governs ONLY that display convenience — the per-line state is always the truth.
 */
export const bumpMode = enumType(["line", "ticket"]);

/**
 * The per-venue FIRE CONTROL mode: which surface offers the fire action per held course — the
 * tab-ordering screen (`waiter`, default), the station display (`kitchen`), or the expediter/pass
 * display (`expo`). Governs ONLY which UI shows the affordance.
 */
export const fireControlMode = enumType(["waiter", "kitchen", "expo"]);

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
    taxpayerDomicile: label("taxpayer_domicile"),
    createdAt: ts("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    check("tenants_singleton_ck", sql`${t.id} = 1`),
    uniqueIndex("tenants_country_tax_id_key").on(t.country, t.taxId),
  ],
);

/**
 * A venue. `invoiceLocales` is an ORDERED list of one or two receipt languages. A
 * sale is filed and printed in the FIRST (`readReceiptLanguage`,
 * `packages/catalogue/src/operations.ts`); an order line's customer text is
 * snapshotted under every entry.
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
    bumpMode: bumpMode("bump_mode").notNull().default("line"),
    fireControl: fireControlMode("fire_control").notNull().default("waiter"),
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
    check("locations_bump_mode_ck", enumCheck(t.bumpMode)),
    check("locations_fire_control_ck", enumCheck(t.fireControl)),
  ],
);
