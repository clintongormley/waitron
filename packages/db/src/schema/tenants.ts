import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, id, label, newId, now, table, ts } from "./columns.js";
import { catalogues } from "./catalogue.js";

/** The venue time-zone default, shared with runtime fallbacks. */
export const DEFAULT_TIME_ZONE = "Europe/Madrid";

/**
 * Read by nothing: each station has its own `bump_mode`.
 */
export const bumpMode = enumType(["line", "ticket"]);

/**
 * Read by nothing. Dropping this column alone rebuilds `locations`, so A1301 S28's drop of
 * `locations` removes it.
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
    privacyNoticeUrl: label("privacy_notice_url"),
    privacyEmail: label("privacy_email"),
    createdAt: ts("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    check("tenants_singleton_ck", sql`${t.id} = 1`),
    uniqueIndex("tenants_country_tax_id_key").on(t.country, t.taxId),
  ],
);

export const locations = table(
  "locations",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    bumpMode: bumpMode("bump_mode").notNull().default("line"),
    fireControl: fireControlMode("fire_control").notNull().default("waiter"),
    // This location's DEFAULT catalogue (menu); a venue may exist before a menu is assigned.
    /* v8 ignore start */
    catalogueId: id("catalogue_id").references(() => catalogues.id),
    /* v8 ignore stop */
  },
  (t) => [
    check("locations_bump_mode_ck", enumCheck(t.bumpMode)),
    check("locations_fire_control_ck", enumCheck(t.fireControl)),
  ],
);
