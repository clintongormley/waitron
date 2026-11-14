import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, label, now, table, ts } from "./columns.js";

/** The venue time-zone default, shared with runtime fallbacks. */
export const DEFAULT_TIME_ZONE = "Europe/Madrid";

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
