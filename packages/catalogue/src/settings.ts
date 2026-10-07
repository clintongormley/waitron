import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { catalogueSettings } from "./schema/settings.js";
import { VAT_CLASSES, type VatClass } from "./vat-rates.js";
import "./errors.js";

import type { CatalogueSettings } from "./settings-types.js";
export type { CatalogueSettings } from "./settings-types.js";

export async function readCatalogueSettings(tx: Transaction): Promise<CatalogueSettings> {
  const [row] = await tx
    .select({ defaultProductVatClass: catalogueSettings.defaultProductVatClass })
    .from(catalogueSettings)
    .where(eq(catalogueSettings.id, 1));
  return row ?? { defaultProductVatClass: "general" };
}

export async function saveCatalogueSettings(
  tx: Transaction,
  input: { defaultProductVatClass: unknown },
): Promise<CatalogueSettings> {
  const value = input.defaultProductVatClass;
  if (typeof value !== "string" || !VAT_CLASSES.includes(value as VatClass))
    throw new AppError("product.invalid", { field: "defaultProductVatClass" });
  const settings = { defaultProductVatClass: value as VatClass };
  await tx
    .insert(catalogueSettings)
    .values(settings)
    .onConflictDoUpdate({ target: catalogueSettings.id, set: settings });
  return settings;
}
