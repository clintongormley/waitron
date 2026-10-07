import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, table } from "@waitron/db";
import { VAT_CLASSES } from "../vat-rates.js";

const vatClass = enumType(VAT_CLASSES);

export const catalogueSettings = table(
  "catalogue_settings",
  {
    id: count("id").primaryKey().notNull().default(1),
    defaultProductVatClass: vatClass("default_product_vat_class").notNull().default("general"),
  },
  (t) => [
    check("catalogue_settings_singleton_ck", sql`${t.id} = 1`),
    check("catalogue_settings_vat_class_ck", enumCheck(t.defaultProductVatClass)),
  ],
);
